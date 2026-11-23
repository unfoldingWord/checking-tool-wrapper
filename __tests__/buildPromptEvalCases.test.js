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
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because
 * `fs-extra` is mocked globally.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { ALGORITHM_CERTAIN_CONFIDENCE } from '../src/utils/checkingSuggestionsUtils';
import { getBestVerseFromChapter } from '../src/helpers/verseHelpers';
import { runTestCase } from './helpers/suggestionsHelpers';
import {
  countBy, FINETUNE_TEST_FILES, projectOfFile, PROMPT_EVAL_DEFAULTS, seededShuffle,
  selectDevCases, toEvalCase, verseDataToText, withoutHistory,
} from './helpers/promptEvalCases';

const env = process.env;
const BUILD = env.LLM_PROMPT_EVAL_BUILD === '1';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT, env.LLM_PROMPT_EVAL_DATA_DIR || 'llmTrainingData');
const OUT_DIR = path.resolve(ROOT, env.LLM_PROMPT_EVAL_OUT_DIR || 'llmTrainingData/promptEval');
const ADD_GL_VERSE = env.LLM_PROMPT_EVAL_ADD_GL_VERSE === '1';
const TC_HOME = env.LLM_PROMPT_EVAL_TC_HOME || path.join(os.homedir(), 'translationCore');
const SET_NAMES = ['dev', 'dev-nohist', 'test', 'test-nohist'];

/**
 * Adds `glVerse` to cases in place: the plain text of the case's verse in the GL bible its GL
 * phrase came from (named at the end of `source`, e.g. `GL en ult/v91_unfoldingWord`), read from
 * `<TC_HOME>/resources/<glLang>/bibles/<bible>/<book>/<chapter>.json`. For X3 of the plan.
 * @param {Array<object>} cases
 * @returns {{added: number, missing: Array<string>}} - ids of cases with no GL verse found
 */
function addGlVerses(cases) {
  const chapters = new Map();
  const missing = [];
  let added = 0;

  for (const evalCase of cases) {
    const bible = (evalCase.source || '').split(' GL ')[1]?.split(' ')[1];
    const {
      bookId, chapter, verse,
    } = evalCase.contextId?.reference || {};
    const file = bible && path.join(TC_HOME, 'resources', evalCase.glLang, 'bibles', bible, bookId, `${chapter}.json`);

    if (file && !chapters.has(file)) {
      chapters.set(file, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
    }

    const chapterData = file && chapters.get(file);
    const text = chapterData ? verseDataToText(getBestVerseFromChapter(chapterData, verse)) : '';

    if (text) {
      evalCase.glVerse = text;
      added++;
    } else {
      missing.push(evalCase.id);
    }
  }
  return { added, missing };
}

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
});

const describeIfBuild = BUILD ? describe : describe.skip;
const describeIfAddGlVerse = ADD_GL_VERSE ? describe : describe.skip;

describeIfAddGlVerse('add the GL verse to the prompt evaluation sets', () => {
  test('adds glVerse to each case of dev, dev-nohist, test and test-nohist', () => {
    for (const name of SET_NAMES) {
      const file = path.join(OUT_DIR, `${name}.json`);
      const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ids = cases.map(c => c.id);
      const { added, missing } = addGlVerses(cases);

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

    const glVerses = addGlVerses(Object.values(sets).flat());

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
