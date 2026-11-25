/* eslint-env jest */
/**
 * Builds the evaluation sets of plans/improve-single-prompt.md (D3, Step 2.1) from the training
 * data in `llmTrainingData/*.json`, as ordinary case files the training-data runner can run:
 *   llmTrainingData/promptEval/dev.json          DEV: 1,500 cases the app sends to the AI
 *   llmTrainingData/promptEval/dev-nohist.json   DEV-NOHIST: the first 750 of DEV, no history
 *   llmTrainingData/promptEval/test.json         TEST: every case of the fine-tune's test files
 *   llmTrainingData/promptEval/test-nohist.json  TEST-NOHIST: TEST with no history
 *   llmTrainingData/promptEval/meta/manifest.json  settings, counts and the commit (in a subfolder,
 *                                                since the runner runs every `.json` in the folder)
 * and, for plans/prompt-span-experiments.md (D4), with `LLM_PROMPT_EVAL_SETS=ftdev,newdev`:
 *   ftdev.json, ftdev-nohist.json    FT-DEV: D3's validation cases the app sends to the AI
 *   newdev.json, newdev-nohist.json  NEW-DEV: about 1,000 cases from the new projects
 * Those are added to the folder (and under `spanPlan` in the manifest) without touching the
 * other sets, which were built from the data files as they were on 2026-11-22.
 * The choice is seeded (`PROMPT_EVAL_DEFAULTS` in `helpers/promptEvalCases.js`), so a rebuild from
 * the same training data and algorithm gives the same sets.
 *
 * Skipped unless `LLM_PROMPT_EVAL_BUILD=1`; run it with `npm run build:prompt-eval-cases`. Then run
 * the algorithm on the sets, which `scripts/compare-prompt-variants.js` needs:
 *   LLM_TRAINING_DATA_DIR=llmTrainingData/promptEval npm run run:llm-training-data
 * The unit tests of the helpers always run.
 *
 * Environment variables:
 *   LLM_PROMPT_EVAL_BUILD     set to 1 to build
 *   LLM_PROMPT_EVAL_ADD_GL_VERSE  set to 1 to only add `glVerse` to the set files already built
 *                             (same cases and ids, so earlier results stay comparable)
 *   LLM_PROMPT_EVAL_TC_HOME   translationCore folder with the GL bibles (default ~/translationCore)
 *   LLM_PROMPT_EVAL_DATA_DIR  training data folder (default llmTrainingData)
 *   LLM_PROMPT_EVAL_OUT_DIR   output folder (default llmTrainingData/promptEval)
 *   LLM_PROMPT_EVAL_SETS      which sets to build, comma-separated: `dev` and `test` (built
 *                             together, the default), `ftdev`, `newdev`; or `testadd` alone, which
 *                             brings test.json and test-nohist.json in line with
 *                             `FINETUNE_TEST_FILES`: it appends the cases of files they do not have
 *                             yet and drops those of files no longer listed (DEV and the other TEST
 *                             cases are unchanged, so earlier results stay comparable on them)
 *   LLM_PROMPT_EVAL_FTDEV_META  D3's validation meta file (default
 *                             llmTrainingData/finetune-d3/valid.meta.jsonl)
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because
 * `fs-extra` is mocked globally.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { ALGORITHM_CERTAIN_CONFIDENCE } from '../src/utils/checkingSuggestionsUtils';
import { runTestCase } from './helpers/suggestionsHelpers';
import {
  addGlVerses, countBy, FINETUNE_TEST_FILES, NEW_DEV_DEFAULTS, NEW_DEV_FILES, projectOfFile,
  PROMPT_EVAL_DEFAULTS, readSplitCaseIds, seededShuffle, selectDevCases, toEvalCase, withoutHistory,
} from './helpers/promptEvalCases';

const env = process.env;
const BUILD = env.LLM_PROMPT_EVAL_BUILD === '1';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT, env.LLM_PROMPT_EVAL_DATA_DIR || 'llmTrainingData');
const OUT_DIR = path.resolve(ROOT, env.LLM_PROMPT_EVAL_OUT_DIR || 'llmTrainingData/promptEval');
const ADD_GL_VERSE = env.LLM_PROMPT_EVAL_ADD_GL_VERSE === '1';
const TC_HOME = env.LLM_PROMPT_EVAL_TC_HOME || path.join(os.homedir(), 'translationCore');
const SET_NAMES = ['dev', 'dev-nohist', 'test', 'test-nohist'];
const SETS = (env.LLM_PROMPT_EVAL_SETS || 'dev,test').split(',').map(name => name.trim()).filter(Boolean);
const FTDEV_META = path.resolve(ROOT, env.LLM_PROMPT_EVAL_FTDEV_META || 'llmTrainingData/finetune-d3/valid.meta.jsonl');

/** the algorithm runs on a few thousand cases */
const TIMEOUT_MS = 60 * 60 * 1000;

describe('promptEvalCases helpers', () => {
  test('projectOfFile', () => {
    expect(projectOfFile('vi_glt_luk_book_unfoldingWord_en')).toBe('vi_glt_luk');
    expect(projectOfFile('en_ult_tit_book_es-419_gl_es-419')).toBe('en_ult_tit');
  });

  test('seededShuffle is repeatable and keeps every item', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const a = seededShuffle(items, 7);
    expect(seededShuffle(items, 7)).toEqual(a);
    expect(seededShuffle(items, 8)).not.toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(items[0]).toBe(0); // the input is not changed
  });

  test('toEvalCase and withoutHistory make ids unique per file and per set', () => {
    const evalCase = toEvalCase({ id: 'c1', history: { a: { b: 1 } } }, 'f1');

    expect(evalCase).toMatchObject({
      id: 'f1/c1', sourceId: 'c1', sourceFile: 'f1',
    });
    expect(withoutHistory(evalCase)).toMatchObject({ id: 'f1/c1#nohist', history: {} });
    expect(evalCase.history).toEqual({ a: { b: 1 } });
  });

  test('selectDevCases keeps AI cases only, caps each language, and is repeatable', async () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, targetLang: i < 30 ? 'vi' : 'ru', certain: i % 4 === 0,
    }));
    const options = {
      seed: 3, size: 10, maxLanguageShare: 0.5, isSentToAi: c => Promise.resolve(!c.certain),
    };
    const first = await selectDevCases(candidates, options);

    expect(first.cases.length).toBe(10);
    expect(first.cases.every(c => !c.certain)).toBe(true);
    expect(countBy(first.cases, c => c.targetLang)).toEqual({ vi: 5, ru: 5 });
    expect(first.examined).toBe(first.cases.length + first.certain);
    expect((await selectDevCases(candidates, options)).cases).toEqual(first.cases);
  });

  test('selectDevCases can cap by another group, e.g. the file', async () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, targetLang: 'en', sourceFile: i < 30 ? 'a' : 'b',
    }));
    const { cases } = await selectDevCases(candidates, {
      seed: 3, size: 10, maxLanguageShare: 0.6, isSentToAi: () => Promise.resolve(true), groupOf: c => c.sourceFile,
    });

    const counts = countBy(cases, c => c.sourceFile);

    expect(cases.length).toBe(10);
    expect(Math.max(counts.a, counts.b)).toBeLessThanOrEqual(6); // 60% of 10, by file
    expect(Object.keys(counts).sort()).toEqual(['a', 'b']);
  });

  test('readSplitCaseIds reads file and id per line, in order', () => {
    const text = '{"id":"x1","file":"f1","label":95}\n\n{"id":"x2","file":"f2"}\n';

    expect(readSplitCaseIds(text)).toEqual([{ file: 'f1', id: 'x1' }, { file: 'f2', id: 'x2' }]);
  });
});

const describeIfBuild = BUILD && (SETS.includes('dev') || SETS.includes('test')) ? describe : describe.skip;
const describeIfBuildSpanSets = BUILD && (SETS.includes('ftdev') || SETS.includes('newdev')) ? describe : describe.skip;
const describeIfAddGlVerse = ADD_GL_VERSE ? describe : describe.skip;
const describeIfAddTestFiles = BUILD && SETS.includes('testadd') ? describe : describe.skip;

describeIfAddTestFiles('add new test files to the prompt evaluation sets', () => {
  test('appends the cases of new test files to test and test-nohist, and drops files no longer listed', () => {
    const testFile = path.join(OUT_DIR, 'test.json');
    const noHistoryFile = path.join(OUT_DIR, 'test-nohist.json');
    const manifestFile = path.join(OUT_DIR, 'meta', 'manifest.json');
    const listed = new Set(FINETUNE_TEST_FILES);
    const before = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    const removedFiles = [...new Set(before.map(c => c.sourceFile))].filter(file => !listed.has(file));
    const test_ = before.filter(c => listed.has(c.sourceFile));
    const noHistory = JSON.parse(fs.readFileSync(noHistoryFile, 'utf8')).filter(c => listed.has(c.sourceFile));
    const present = new Set(test_.map(c => c.sourceFile));
    const newFiles = FINETUNE_TEST_FILES.filter(file => !present.has(file));
    const added = newFiles.flatMap(file => JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${file}.json`), 'utf8'))
      .map(testCase => toEvalCase(testCase, file)));
    const glVerses = addGlVerses(added, TC_HOME);

    fs.writeFileSync(testFile, `${JSON.stringify([...test_, ...added], null, 2)}\n`);
    fs.writeFileSync(noHistoryFile, `${JSON.stringify([...noHistory, ...added.map(withoutHistory)], null, 2)}\n`);

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.testFiles = FINETUNE_TEST_FILES;
    manifest.counts = {
      ...manifest.counts, 'test': test_.length + added.length, 'test-nohist': noHistory.length + added.length,
    };
    manifest.testByFile = countBy([...test_, ...added], c => c.sourceFile);
    manifest.testAdded = [...(manifest.testAdded || []), {
      addedAt: new Date().toISOString(), files: newFiles, cases: added.length, glVerseMissing: glVerses.missing.length,
      removedFiles, removedCases: before.length - test_.length,
    }];
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`test files added: ${newFiles.join(' ') || '(none)'}; ${added.length} cases; GL verse missing ${glVerses.missing.length}; ` +
      `removed: ${removedFiles.join(' ') || '(none)'}, ${before.length - test_.length} cases`);
    expect(new Set([...test_, ...added].map(c => c.id)).size).toBe(test_.length + added.length);
  });
});

describeIfAddGlVerse('add the GL verse to the prompt evaluation sets', () => {
  test('adds glVerse to each case of dev, dev-nohist, test and test-nohist', () => {
    for (const name of SET_NAMES) {
      const file = path.join(OUT_DIR, `${name}.json`);
      const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ids = cases.map(c => c.id);
      const { added, missing } = addGlVerses(cases, TC_HOME);

      expect(cases.map(c => c.id)).toEqual(ids);
      fs.writeFileSync(file, `${JSON.stringify(cases, null, 2)}\n`);
      console.log(`${name}: glVerse added to ${added} of ${cases.length}; missing ${missing.length}`, missing.slice(0, 5));
    }
  });
});

describeIfBuild('build the prompt evaluation sets', () => {
  test('writes dev, dev-nohist, test and test-nohist', async () => {
    const {
      seed, devSize, maxLanguageShare, noHistoryShare,
    } = PROMPT_EVAL_DEFAULTS;
    const files = fs.readdirSync(DATA_DIR).filter(file => path.extname(file) === '.json').sort();
    const testFiles = new Set(FINETUNE_TEST_FILES);
    const testProjects = new Set(FINETUNE_TEST_FILES.map(projectOfFile));
    const missingTestFiles = FINETUNE_TEST_FILES.filter(file => !files.includes(`${file}.json`));

    expect(missingTestFiles).toEqual([]);

    const devCandidates = [];
    const testCases = [];

    for (const file of files) {
      const fileBase = path.basename(file, '.json');
      const cases = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))
        .map(testCase => toEvalCase(testCase, fileBase));

      if (testFiles.has(fileBase)) {
        testCases.push(...cases);
      } else if (!testProjects.has(projectOfFile(fileBase))) {
        devCandidates.push(...cases);
      }
    }

    const quiet = ['log', 'warn'].map(name => jest.spyOn(console, name).mockImplementation(() => {}));
    let dev;

    try {
      dev = await selectDevCases(devCandidates, {
        seed,
        size: devSize,
        maxLanguageShare,
        isSentToAi: async testCase => {
          const { result } = await runTestCase(testCase);
          return !(result?.bestSelections?.[0]?.confidence >= ALGORITHM_CERTAIN_CONFIDENCE);
        },
      });
    } finally {
      quiet.forEach(spy => spy.mockRestore());
    }

    const devNoHistory = dev.cases.slice(0, Math.round(dev.cases.length * noHistoryShare)).map(withoutHistory);
    const sets = {
      'dev': dev.cases,
      'dev-nohist': devNoHistory,
      'test': testCases,
      'test-nohist': testCases.map(withoutHistory),
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });

    const glVerses = addGlVerses(Object.values(sets).flat(), TC_HOME);

    for (const [name, cases] of Object.entries(sets)) {
      fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), `${JSON.stringify(cases, null, 2)}\n`);
    }

    let commit = '';

    try {
      commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    } catch (e) {
      commit = '(unknown)';
    }

    const manifest = {
      createdAt: new Date().toISOString(),
      commit,
      dataDir: path.relative(ROOT, DATA_DIR),
      settings: { ...PROMPT_EVAL_DEFAULTS, algorithmCertainConfidence: ALGORITHM_CERTAIN_CONFIDENCE },
      testFiles: FINETUNE_TEST_FILES,
      devCandidates: devCandidates.length,
      devExamined: dev.examined,
      devCertainLeftOut: dev.certain,
      counts: Object.fromEntries(Object.entries(sets).map(([name, cases]) => [name, cases.length])),
      devByLanguage: countBy(dev.cases, c => c.targetLang),
      devByGlLanguage: countBy(dev.cases, c => c.glLang),
      devByProject: countBy(dev.cases, c => projectOfFile(c.sourceFile)),
      testByFile: countBy(testCases, c => c.sourceFile),
      glVerseMissing: glVerses.missing.length,
    };

    fs.mkdirSync(path.join(OUT_DIR, 'meta'), { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'meta', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`prompt evaluation sets written to ${OUT_DIR}`, manifest);

    expect(dev.cases.length).toBe(devSize);
  }, TIMEOUT_MS);
});

/**
 * @param {object} testCase - an eval case
 * @returns {Promise<boolean>} true when the app would ask the AI (algorithm top confidence below
 *   `ALGORITHM_CERTAIN_CONFIDENCE`)
 */
async function isSentToAi(testCase) {
  const { result } = await runTestCase(testCase);
  return !(result?.bestSelections?.[0]?.confidence >= ALGORITHM_CERTAIN_CONFIDENCE);
}

/**
 * @param {string} file
 * @returns {string} its sha256, hex
 */
function sha256OfFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describeIfBuildSpanSets('build the span plan evaluation sets', () => {
  test('writes ftdev, ftdev-nohist, newdev and newdev-nohist', async () => {
    const readCases = fileBase => JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${fileBase}.json`), 'utf8'))
      .map(testCase => toEvalCase(testCase, fileBase));
    const sets = {};
    const spanPlan = {};
    const sourceFiles = new Set();
    const quiet = ['log', 'warn'].map(name => jest.spyOn(console, name).mockImplementation(() => {}));

    try {
      if (SETS.includes('ftdev')) {
        const ids = readSplitCaseIds(fs.readFileSync(FTDEV_META, 'utf8'));
        const byFile = new Map();
        const missing = [];
        const ftdev = [];
        let certain = 0;

        for (const { file, id } of ids) {
          if (!byFile.has(file)) {
            byFile.set(file, new Map(readCases(file).map(c => [c.sourceId, c])));
            sourceFiles.add(file);
          }

          const evalCase = byFile.get(file).get(id);

          if (!evalCase) {
            missing.push(`${file}/${id}`);
          // eslint-disable-next-line no-await-in-loop
          } else if (await isSentToAi(evalCase)) {
            ftdev.push(evalCase);
          } else {
            certain++;
          }
        }
        sets.ftdev = ftdev;
        sets['ftdev-nohist'] = ftdev.map(withoutHistory);
        spanPlan.ftdev = {
          meta: path.relative(ROOT, FTDEV_META),
          validCases: ids.length,
          missingFromData: missing,
          certainLeftOut: certain,
          byFile: countBy(ftdev, c => c.sourceFile),
          byLanguage: countBy(ftdev, c => c.targetLang),
        };
      }

      if (SETS.includes('newdev')) {
        const candidates = NEW_DEV_FILES.flatMap(file => {
          sourceFiles.add(file);
          return readCases(file);
        });
        const {
          seed, size, maxFileShare,
        } = NEW_DEV_DEFAULTS;
        const newdev = await selectDevCases(candidates, {
          seed, size, maxLanguageShare: maxFileShare, isSentToAi, groupOf: c => c.sourceFile,
        });

        sets.newdev = newdev.cases;
        sets['newdev-nohist'] = newdev.cases.map(withoutHistory);
        spanPlan.newdev = {
          settings: NEW_DEV_DEFAULTS,
          files: NEW_DEV_FILES,
          candidates: candidates.length,
          examined: newdev.examined,
          certainLeftOut: newdev.certain,
          byFile: countBy(newdev.cases, c => c.sourceFile),
          byLanguage: countBy(newdev.cases, c => c.targetLang),
        };
      }
    } finally {
      quiet.forEach(spy => spy.mockRestore());
    }

    const glVerses = addGlVerses(Object.values(sets).flat(), TC_HOME);

    fs.mkdirSync(path.join(OUT_DIR, 'meta'), { recursive: true });

    for (const [name, cases] of Object.entries(sets)) {
      fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), `${JSON.stringify(cases, null, 2)}\n`);
    }

    let commit = '';

    try {
      commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    } catch (e) {
      commit = '(unknown)';
    }

    const manifestFile = path.join(OUT_DIR, 'meta', 'manifest.json');
    const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
    const previous = manifest.spanPlan || {};

    manifest.spanPlan = {
      ...previous,
      ...spanPlan,
      createdAt: new Date().toISOString(),
      commit,
      algorithmCertainConfidence: ALGORITHM_CERTAIN_CONFIDENCE,
      counts: {
        ...previous.counts,
        ...Object.fromEntries(Object.entries(sets).map(([name, cases]) => [name, cases.length])),
      },
      glVerseMissing: glVerses.missing.length,
      dataFileSha256: {
        ...previous.dataFileSha256,
        ...Object.fromEntries([...sourceFiles].sort()
          .map(file => [file, sha256OfFile(path.join(DATA_DIR, `${file}.json`))])),
      },
    };
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`span plan evaluation sets written to ${OUT_DIR}`, JSON.stringify(manifest.spanPlan, null, 2));

    expect(Object.keys(sets).length).toBeGreaterThan(0);
  }, TIMEOUT_MS);
});
