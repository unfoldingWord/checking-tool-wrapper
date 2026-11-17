/* eslint-env jest */
/**
 * Builds the fine-tuning data of `plans/fine-tune-qwen3.md` (Steps 2 and 3) with
 * `buildFineTuneData` in `helpers/fineTuneHelpers.js`, and tests its parts.
 *
 * The build is skipped unless `LLM_FINETUNE_BUILD=1`. Run it with `npm run build:finetune-data`
 * after `npm run run:llm-training-data` (the algorithm results decide which cases the app sends to
 * the AI) and `npm run check:llm-training-data`. It writes to `llmTrainingData/finetune/`
 * (git-ignored): `train.jsonl`, `valid.jsonl` and `test.jsonl` for `mlx_lm.lora --data`, the
 * matching `*.meta.jsonl` and `manifest.json`.
 *
 * The unit tests and the parity test (the exporter's messages equal what `getBestSelections` sends)
 * run in `npm test`.
 *
 * Environment variables:
 *   LLM_FINETUNE_BUILD          set to 1 to build
 *   LLM_FINETUNE_DATA_DIR       training data folder (default llmTrainingData)
 *   LLM_FINETUNE_OUT_DIR        output folder (default llmTrainingData/finetune)
 *   LLM_FINETUNE_INCLUDE        extra categories to train on, space-separated:
 *                               someExpectedWordsNotInHistory noRelatedWordInHistory (Step 4B)
 *   LLM_FINETUNE_TEST_PROJECTS  test projects, space-separated, `*` allowed
 *                               (default: ne_glt_* bn_glt_eph es-419_est_rut en_ult_tit)
 *   LLM_FINETUNE_SEED           random seed (default 3407)
 *   LLM_FINETUNE_VALID_PERCENT  share of (project, group) pairs for validation (default 5)
 *   LLM_FINETUNE_CERTAIN_KEEP   share of the algorithm-certain-and-right cases kept (default 0.2)
 *   LLM_FINETUNE_PROJECT_CAP    examples per target project (default 2000)
 *   LLM_FINETUNE_GROUP_CAP      examples per (project, group) (default 40)
 *   LLM_FINETUNE_NEGATIVES      negative examples as a share of train (default 0.03; 0 for none)
 *   LLM_FINETUNE_DROP_LONG      set to 1 to drop `unusuallyLongAnswer` cases
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because
 * `fs-extra` is mocked globally.
 */
import fs from 'fs';
import path from 'path';
import { getBestSelections } from '../src/utils/checkingSuggestionsUtils';
import {
  buildFineTuneData, buildSingleExample, buildSingleRequestMessages, capExamples, DEFAULT_BUILD_OPTIONS,
  decodeAnswer, getEvalCaseKeys, getSplit, getTargetProject, isTestProject, labelConfidence, makeRandom,
  stripOccurrences, verseHasNoCaseWords, verseGroupKey,
} from './helpers/fineTuneHelpers';
import { testCaseToSelectionOptions } from './helpers/suggestionsHelpers';

const env = process.env;
const BUILD = env.LLM_FINETUNE_BUILD === '1';
const REPO = path.resolve(__dirname, '..');
const REAL_CASES_PATH = path.join(__dirname, '__fixtures__', 'llmEval', 'realCases.json');
const realCases = JSON.parse(fs.readFileSync(REAL_CASES_PATH, 'utf8'));

const words = text => (text || '').split(/\s+/).filter(Boolean);

describe('fine-tune data helpers', () => {
  test('getTargetProject takes the name before _book_', () => {
    expect(getTargetProject('vi_glt_luk_book_ru_gl_ru.json')).toBe('vi_glt_luk');
    expect(getTargetProject('es-419_est_rut_book_unfoldingWord_en.json')).toBe('es-419_est_rut');
  });

  test('isTestProject matches patterns with *', () => {
    const patterns = DEFAULT_BUILD_OPTIONS.testProjects;
    expect(isTestProject('ne_glt_2co', patterns)).toBe(true);
    expect(isTestProject('en_ult_tit', patterns)).toBe(true);
    expect(isTestProject('bn_glt_2co', patterns)).toBe(false);
    expect(isTestProject('xne_glt_2co', patterns)).toBe(false);
  });

  test('getSplit puts every group of a test project in test and is stable for the others', () => {
    expect(getSplit('ne_glt_2co', 'god', DEFAULT_BUILD_OPTIONS)).toBe('test');
    const split = getSplit('vi_glt_heb', 'abraham', DEFAULT_BUILD_OPTIONS);
    expect(['train', 'valid']).toContain(split);
    expect(getSplit('vi_glt_heb', 'abraham', DEFAULT_BUILD_OPTIONS)).toBe(split);
    expect(getSplit('vi_glt_heb', 'abraham', { ...DEFAULT_BUILD_OPTIONS, validPercent: 100 })).toBe('valid');
    expect(getSplit('vi_glt_heb', 'abraham', { ...DEFAULT_BUILD_OPTIONS, validPercent: 0 })).toBe('train');
  });

  test('getEvalCaseKeys reads the verse and group from each real case', () => {
    const keys = getEvalCaseKeys(realCases);
    expect(keys.size).toBeGreaterThan(0);
    expect(keys.has(verseGroupKey('vi_glt_heb', 7, 26, 'sin'))).toBe(true);
  });

  test('stripOccurrences removes :n suffixes', () => {
    expect(stripOccurrences('Chúa:3 Cứu:2 Thế')).toBe('Chúa Cứu Thế');
    expect(stripOccurrences('fe')).toBe('fe');
    expect(stripOccurrences(undefined)).toBe('');
  });

  test('labelConfidence follows rule 5', () => {
    const wordList = words('para la iglesia de Éfeso');

    expect(labelConfidence('iglesia', { church: { iglesia: 3 } }, wordList, 'es-419'))
      .toEqual({ confidence: 95, historyInVerseButDiffers: false });
    expect(labelConfidence('la iglesia', { church: { iglesia: 3 } }, wordList, 'es-419'))
      .toEqual({ confidence: 75, historyInVerseButDiffers: true });
    expect(labelConfidence('iglesia', { churches: { iglesias: 3 } }, wordList, 'es-419').confidence).toBe(75);
    expect(labelConfidence('Éfeso', { church: { congregación: 3 } }, wordList, 'es-419').confidence).toBe(55);
    expect(labelConfidence('Éfeso', {}, wordList, 'es-419').confidence).toBe(55);
  });

  test('decodeAnswer moves the answer to the check occurrence, as getBestSelections does', () => {
    const wordList = words('Dios dijo que Dios es amor');
    expect(decodeAnswer('"Dios",95', wordList, 1, 'es-419')).toBe('Dios');
    expect(decodeAnswer('"Dios",95', wordList, 2, 'es-419')).toBe('Dios:2');
    expect(decodeAnswer('"",0', wordList, 1, 'es-419')).toBe('');
  });

  test('buildSingleExample answers plain words and passes the round trip', () => {
    const testCase = {
      id: 'a',
      targetLang: 'es-419',
      glLang: 'en',
      verse: 'Dios dijo que Dios es amor.',
      glPhrase: 'God',
      history: { God: { Dios: 4 } },
      expected: ['Dios:2'],
      contextId: {
        reference: {
          bookId: 'tit', chapter: 1, verse: 1,
        }, groupId: 'god', checkId: 'x', occurrence: 2,
      },
    };
    const example = buildSingleExample(testCase);
    expect(example.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(example.messages[0].content.startsWith('/no_think\n')).toBe(true);
    expect(example.messages[1].content.startsWith('/no_think\n')).toBe(true);
    expect(example.answer).toBe('"Dios",95');
    expect(example.roundTrip).toBe(true);
    expect(buildSingleExample({ ...testCase, expected: ['Pablo'] }).roundTrip).toBe(false);
  });

  test('verseHasNoCaseWords finds verses without the answer or history words', () => {
    const testCase = {
      targetLang: 'es-419', expected: ['iglesia'], history: { church: { 'la iglesia': 2 } },
    };
    expect(verseHasNoCaseWords(testCase, words('pablo saludó a timoteo'))).toBe(true);
    expect(verseHasNoCaseWords(testCase, words('para las iglesias'))).toBe(false); // another form
    expect(verseHasNoCaseWords(testCase, words('la casa'))).toBe(false); // history word 'la'
  });

  test('capExamples caps per group and per project', () => {
    const examples = [];

    for (let i = 0; i < 10; i++) {
      examples.push({ meta: { project: 'p1', groupId: i < 6 ? 'god' : `g${i}` } });
    }
    examples.push({ meta: { project: 'p2', groupId: 'god' } });

    const { kept, dropped } = capExamples(examples, { projectCap: 5, groupCap: 3 }, makeRandom(1));
    const p1 = kept.filter(e => e.meta.project === 'p1');
    expect(p1.filter(e => e.meta.groupId === 'god').length).toBeLessThanOrEqual(3);
    expect(p1.length).toBe(5);
    expect(kept.filter(e => e.meta.project === 'p2').length).toBe(1);
    expect(dropped.groupCap + dropped.projectCap).toBe(5);
  });
});

describe('fine-tune data parity with the app', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('the exporter messages equal what getBestSelections sends', async () => {
    const bodies = [];

    global.fetch = jest.fn((url, { body }) => {
      bodies.push(JSON.parse(body));
      return Promise.resolve({
        ok: false, status: 500, text: () => Promise.resolve('recorded'),
      });
    });

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let compared = 0;

    try {
      for (const testCase of realCases) {
        bodies.length = 0;
        // eslint-disable-next-line no-await-in-loop
        await getBestSelections(testCaseToSelectionOptions(testCase, { llmQueryUrl: 'http://localhost:1234', currentModel: 'm' }));

        if (bodies.length) { // the algorithm was not certain, so the app asked the AI
          const { messages } = buildSingleRequestMessages(testCase);
          expect(bodies[0].messages).toEqual(messages);
          compared++;
        }
      }
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(compared).toBeGreaterThanOrEqual(5);
  });
});

const describeIfBuild = BUILD ? describe : describe.skip;

describeIfBuild('build fine-tune data', () => {
  test('writes train, valid and test JSONL', () => {
    const list = name => (env[name] || '').split(/\s+/).filter(Boolean);
    const number = (name, fallback) => (env[name] !== undefined && env[name] !== '' ? Number(env[name]) : fallback);
    const options = {
      seed: number('LLM_FINETUNE_SEED', DEFAULT_BUILD_OPTIONS.seed),
      testProjects: list('LLM_FINETUNE_TEST_PROJECTS').length ? list('LLM_FINETUNE_TEST_PROJECTS') : DEFAULT_BUILD_OPTIONS.testProjects,
      validPercent: number('LLM_FINETUNE_VALID_PERCENT', DEFAULT_BUILD_OPTIONS.validPercent),
      includeCategories: list('LLM_FINETUNE_INCLUDE'),
      certainRightKeep: number('LLM_FINETUNE_CERTAIN_KEEP', DEFAULT_BUILD_OPTIONS.certainRightKeep),
      projectCap: number('LLM_FINETUNE_PROJECT_CAP', DEFAULT_BUILD_OPTIONS.projectCap),
      groupCap: number('LLM_FINETUNE_GROUP_CAP', DEFAULT_BUILD_OPTIONS.groupCap),
      negativeShare: number('LLM_FINETUNE_NEGATIVES', DEFAULT_BUILD_OPTIONS.negativeShare),
      dropLongAnswers: env.LLM_FINETUNE_DROP_LONG === '1',
    };
    const dataDir = path.resolve(REPO, env.LLM_FINETUNE_DATA_DIR || 'llmTrainingData');
    const outDir = path.resolve(REPO, env.LLM_FINETUNE_OUT_DIR || 'llmTrainingData/finetune');
    // parseLlmSelectionOptions logs every answer it cannot decode
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let manifest;

    try {
      manifest = buildFineTuneData({
        dataDir, outDir, realCases, options,
      });
    } finally {
      logSpy.mockRestore();
    }

    console.log([
      `fine-tune data written to ${outDir}`,
      `  counts: ${JSON.stringify(manifest.counts)} (negatives in train: ${manifest.negatives})`,
      `  cap drops: ${JSON.stringify(manifest.capDrops)}`,
      `  drops: ${JSON.stringify(manifest.drops, null, 1)}`,
      `  train by category: ${JSON.stringify(manifest.byCategory.train)}`,
      `  train by label: ${JSON.stringify(manifest.byLabel.train)}`,
      `  train by GL: ${JSON.stringify(manifest.byGlLanguage.train)}`,
      `  test files: ${manifest.testFiles.join(' ')}`,
      `  unusually long answers kept: ${manifest.unusuallyLongAnswers.length}; history in verse but answer differs: ${manifest.contradictsRule3.length}`,
    ].join('\n'));
    expect(manifest.counts.train).toBeGreaterThan(0);
    expect(manifest.counts.valid).toBeGreaterThan(0);
    expect(manifest.counts.test).toBeGreaterThan(0);
  }, 30 * 60 * 1000);
});
