/* eslint-env jest */
/**
 * Runs the training data files in `llmTrainingData` through `getBestSelections` with
 * `runTestCasesFromJsonAndSaveResults`, which saves `<file>_<model>.results.json` and
 * `<file>_<model>.summary.json` in `llmTrainingData/results` (`_Algorithm` without
 * `LLM_TRAINING_URL`), then prints a table of the scores of every file.
 *
 * Skipped unless `LLM_TRAINING_RUN=1`, so `npm test` does not run every file.
 * Run it with `npm run run:llm-training-data`, e.g.
 *   npm run run:llm-training-data                                          # algorithm, all files
 *   LLM_TRAINING_FILES="en_ult_tit_book_ru_gl_ru vi_glt_luk_book_ru_gl_ru" npm run run:llm-training-data
 *   LLM_TRAINING_URL=http://localhost:1234 LLM_TRAINING_MODEL=qwen/qwen3-4b-2507 \
 *     npm run run:llm-training-data                                        # AI
 *
 * Environment variables:
 *   LLM_TRAINING_RUN           set to 1 to run
 *   LLM_TRAINING_DATA_DIR      folder of training data files, relative to the repo folder or
 *                              absolute (default llmTrainingData)
 *   LLM_TRAINING_FILES         space-separated file names to run, with or without `.json`
 *                              (default: every `.json` file in the folder)
 *   LLM_TRAINING_URL           AI server base URL; without it the algorithm path is used
 *   LLM_TRAINING_MODEL         model id as the server lists it (required with LLM_TRAINING_URL)
 *   LLM_TRAINING_TEMPERATURE   AI temperature (default: the app's default)
 *   LLM_TRAINING_TOKEN         bearer token for the AI server
 *   LLM_TRAINING_EXTRA_PARAMS  JSON object of extra request body fields, e.g. '{"seed":42}'
 *   LLM_PROMPT_VARIANT         prompt variant for single AI requests, a key of `PROMPT_VARIANTS` in
 *                              `helpers/promptVariants.js` (default: the app's prompt, no override).
 *                              The result files get `_prompt-<variant>` after the model name.
 *
 * For an AI run, a file whose algorithm results are already saved (`<file>_Algorithm.results.json`,
 * from a run without `LLM_TRAINING_URL`) also gets `byAlgorithmConfidence` in its summary: the AI
 * against the algorithm, band by band of the algorithm's top confidence (see
 * `summarizeByAlgorithmConfidence` in `helpers/suggestionsHelpers.js`). The bands of all files run
 * are pooled into a second table, with the run scored as the app shows it (falling back to the
 * algorithm when the AI gives no option) and the top-1 at each possible
 * `ALGORITHM_CERTAIN_CONFIDENCE`, and saved as `results/<model>.byAlgorithmConfidence.json`. It is
 * for choosing that threshold: where the AI is right less often than the algorithm, showing the
 * algorithm's answer is better. Run the algorithm first so those files exist and match the cases.
 *
 * jest has no `fetch`, so for an AI run the requests go through `installNodeAiApis`, a stand-in
 * for translationCore's `window.AiAPIs` that uses Node's http.
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because
 * `fs-extra` is mocked globally.
 */
import fs from 'fs';
import path from 'path';
import {
  ALGORITHM_CONFIDENCE_BANDS, installNodeAiApis, runTestCasesFromJsonAndSaveResults,
  summarizeByAlgorithmConfidence, topOneByThreshold,
} from './helpers/suggestionsHelpers';
import { getPromptVariantFromEnv, installPromptVariant } from './helpers/promptVariants';

const env = process.env;
const RUN = env.LLM_TRAINING_RUN === '1';
const DATA_DIR = path.resolve(__dirname, '..', env.LLM_TRAINING_DATA_DIR || 'llmTrainingData');
const FILES = (env.LLM_TRAINING_FILES || '').split(/\s+/).filter(Boolean)
  .map(name => (name.endsWith('.json') ? name : `${name}.json`));
const SETTINGS = {
  llmQueryUrl: env.LLM_TRAINING_URL || null,
  currentModel: env.LLM_TRAINING_MODEL || undefined,
  llmTemperature: env.LLM_TRAINING_TEMPERATURE ? Number(env.LLM_TRAINING_TEMPERATURE) : undefined,
  apiToken: env.LLM_TRAINING_TOKEN || undefined,
  llmExtraParams: env.LLM_TRAINING_EXTRA_PARAMS ? JSON.parse(env.LLM_TRAINING_EXTRA_PARAMS) : undefined,
};
/** prompt variant of an AI run, '' for the app's prompt (plans/improve-single-prompt.md) */
const PROMPT_VARIANT = env.LLM_TRAINING_URL ? getPromptVariantFromEnv(env) : '';

if (PROMPT_VARIANT) {
  SETTINGS.runLabel = `prompt-${PROMPT_VARIANT}`;
}

/** an AI run can take minutes per file */
const TIMEOUT_MS = 24 * 60 * 60 * 1000;

const describeIfRun = RUN ? describe : describe.skip;

describe('summarizeByAlgorithmConfidence', () => {
  const option = (text, confidence) => ({ selections: [{ text, occurrence: 1 }], confidence });
  const testCases = [
    { id: 'a', expected: ['fe'] },
    { id: 'b', expected: ['iglesia'] },
    { id: 'c', expected: ['amor'] },
    { id: 'd', expected: ['paz'] },
    { id: 'e', expected: ['gozo'] },
    { id: 'f', expected: ['luz'] },
    { id: 'missing', expected: ['x'] },
  ];
  const algorithmResults = [
    { id: 'a', result: { bestSelections: [option('fe', 100)] } },
    { id: 'b', result: { bestSelections: [option('la', 92)] } },
    { id: 'c', result: { bestSelections: [option('amor', 90)] } },
    { id: 'd', result: { bestSelections: [] } },
    { id: 'e', result: { bestSelections: [option('gozo', 86)] } },
    { id: 'f', result: { bestSelections: [option('luz', 70)] } },
  ];
  const results = [
    { id: 'a', result: { bestSelections: [option('fe', 100)], algorithmFirst: true } },
    { id: 'b', result: { bestSelections: [option('iglesia', 95)] } },
    { id: 'c', result: { bestSelections: [option('amar', 70)] } },
    { id: 'd', result: { bestSelections: [] } },
    // the AI gave nothing: the app shows the algorithm's answer
    { id: 'e', result: { bestSelections: [] } },
    { id: 'f', result: { bestSelections: [option('día', 80)] } },
  ];
  const summary = summarizeByAlgorithmConfidence(testCases, results, algorithmResults);

  test('counts the run, the run with fallback and the algorithm per band of the algorithm confidence', () => {
    expect(summary).toEqual({
      bands: [
        {
          band: '100', cases: 1, aiAsked: 0, top1: 1, appTop1: 1, algorithmTop1: 1, noSuggestion: 0,
        },
        {
          band: '90-94', cases: 2, aiAsked: 2, top1: 1, appTop1: 1, algorithmTop1: 1, noSuggestion: 0,
        },
        {
          band: '85-89', cases: 1, aiAsked: 1, top1: 0, appTop1: 1, algorithmTop1: 1, noSuggestion: 1,
        },
        {
          band: '60-79', cases: 1, aiAsked: 1, top1: 0, appTop1: 0, algorithmTop1: 1, noSuggestion: 0,
        },
        {
          band: 'none', cases: 1, aiAsked: 1, top1: 0, appTop1: 0, algorithmTop1: 0, noSuggestion: 1,
        },
      ],
      unmatched: 1,
    });
  });

  test('topOneByThreshold answers the bands at or above the threshold with the algorithm', () => {
    expect(topOneByThreshold(summary.bands)).toEqual([
      {
        threshold: 100, cases: 6, top1: 3,
      },
      {
        threshold: 95, cases: 6, top1: 3,
      },
      {
        threshold: 90, cases: 6, top1: 3,
      },
      {
        threshold: 85, cases: 6, top1: 3,
      },
      {
        threshold: 80, cases: 6, top1: 3,
      },
      {
        threshold: 60, cases: 6, top1: 4,
      },
      {
        threshold: 1, cases: 6, top1: 4,
      },
    ]);
  });
});

describeIfRun(`run training data in ${DATA_DIR}`, () => {
  test('runs each file and saves its results', async () => {
    if (SETTINGS.llmQueryUrl && !SETTINGS.currentModel) {
      throw new Error('LLM_TRAINING_MODEL is required with LLM_TRAINING_URL');
    }

    const files = getFilesToRun();
    expect(files.length).toBeGreaterThan(0);

    const rows = [];

    // jest has no `fetch`: send the AI requests with Node's http, as translationCore's main process would
    const uninstall = SETTINGS.llmQueryUrl ? installNodeAiApis() : () => {};

    const uninstallVariant = PROMPT_VARIANT ? installPromptVariant(PROMPT_VARIANT) : () => {};

    try {
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const { summary } = await runTestCasesFromJsonAndSaveResults(path.join(DATA_DIR, file), SETTINGS);
        rows.push({ file, ...summary });
      }
    } finally {
      uninstallVariant();
      uninstall();
    }

    console.log(formatTable(rows));

    if (rows.some(row => row.byAlgorithmConfidence)) {
      const pooled = poolBands(rows);
      const pooledPath = path.join(DATA_DIR, 'results', `${modelFileName()}.byAlgorithmConfidence.json`);

      fs.writeFileSync(pooledPath, JSON.stringify({
        model: SETTINGS.currentModel, url: SETTINGS.llmQueryUrl, files: rows.map(row => row.file), ...pooled,
      }, null, 2));
      console.log(formatBandTable(pooled));
      console.log(`saved in ${pooledPath}`);
    }
    expect(rows.length).toBe(files.length);
  }, TIMEOUT_MS);
});

/**
 * Training data files to run: `LLM_TRAINING_FILES` if set, otherwise every `.json` file in the
 * folder, sorted by name.
 * @returns {string[]} file names in `DATA_DIR`
 * @throws {Error} if the folder or a named file does not exist
 */
function getFilesToRun() {
  if (!fs.existsSync(DATA_DIR) || !fs.statSync(DATA_DIR).isDirectory()) {
    throw new Error(`training data folder not found: ${DATA_DIR}`);
  }

  if (FILES.length) {
    const missing = FILES.filter(file => !fs.existsSync(path.join(DATA_DIR, file)));

    if (missing.length) {
      throw new Error(`training data files not found in ${DATA_DIR}: ${missing.join(', ')}`);
    }
    return FILES;
  }
  return fs.readdirSync(DATA_DIR).filter(file => path.extname(file) === '.json').sort();
}

/**
 * One line per file with its scores, and a total line.
 * @param {Array<object>} rows - `{file, ...summary}`, summaries from `summarizeTestResults`
 * @returns {string}
 */
function formatTable(rows) {
  const pct = (count, cases) => (cases ? `${Math.round((100 * count) / cases)}%` : '-');
  const width = Math.max(5, ...rows.map(({ file }) => file.length));
  const line = (name, cases, top1, top3, none, ms) => [
    name.padEnd(width),
    String(cases).padStart(6),
    pct(top1, cases).padStart(5),
    pct(top3, cases).padStart(5),
    pct(none, cases).padStart(5),
    `${ms.toFixed(0)} ms`.padStart(10),
  ].join('  ');
  const total = key => rows.reduce((sum, row) => sum + row[key], 0);
  const model = SETTINGS.llmQueryUrl ? `${SETTINGS.currentModel} at ${SETTINGS.llmQueryUrl}` : 'algorithm';

  return [
    `training data results (${model}), saved in ${path.join(DATA_DIR, 'results')}`,
    ['file'.padEnd(width), ' cases', ' top1', ' top3', ' none', '      time'].join('  '),
    ...rows.map(row => line(row.file, row.cases, row.top1, row.top3, row.noSuggestion, row.totalMs)),
    line('total', total('cases'), total('top1'), total('top3'), total('noSuggestion'), total('totalMs')),
  ].join('\n');
}

/**
 * Pools the `byAlgorithmConfidence` bands of the files run.
 * @param {Array<object>} rows - `{file, ...summary}`; summaries with `byAlgorithmConfidence`
 * @returns {{bands: Array<object>, unmatched: number, thresholds: Array<object>}} - bands as
 *   `summarizeByAlgorithmConfidence` gives them, summed over the files, in band order, and the
 *   top-1 at each threshold from `topOneByThreshold`
 */
function poolBands(rows) {
  const pooled = new Map(ALGORITHM_CONFIDENCE_BANDS.map(({ band }) => [band, {
    band, cases: 0, aiAsked: 0, top1: 0, appTop1: 0, algorithmTop1: 0, noSuggestion: 0,
  }]));
  let unmatched = 0;

  for (const row of rows.filter(item => item.byAlgorithmConfidence)) {
    unmatched += row.byAlgorithmConfidence.unmatched;

    for (const counts of row.byAlgorithmConfidence.bands) {
      const total = pooled.get(counts.band);

      for (const key of Object.keys(total).filter(name => name !== 'band')) {
        total[key] += counts[key] || 0;
      }
    }
  }

  const bands = [...pooled.values()].filter(({ cases }) => cases);
  return {
    bands, unmatched, thresholds: topOneByThreshold(bands),
  };
}

/**
 * One line per band of the algorithm's top confidence, pooled over the files run: cases, how many
 * were sent to the AI, top-1 for the run, for the run with the app's fallback to the algorithm
 * (what the user sees), and for the algorithm alone, the difference between the last two, and the
 * run's cases with no option. Then the top-1 at each possible `ALGORITHM_CERTAIN_CONFIDENCE`.
 * @param {{bands: Array<object>, unmatched: number, thresholds: Array<object>}} pooled - from
 *   `poolBands`
 * @returns {string}
 */
function formatBandTable({
  bands, unmatched, thresholds,
}) {
  const pct = (count, cases) => (cases ? (100 * count) / cases : 0);
  const lines = bands.map(counts => {
    const app = pct(counts.appTop1, counts.cases);
    const algorithm = pct(counts.algorithmTop1, counts.cases);
    return [
      counts.band.padEnd(7),
      String(counts.cases).padStart(6),
      String(counts.aiAsked).padStart(8),
      `${pct(counts.top1, counts.cases).toFixed(1)}%`.padStart(8),
      `${app.toFixed(1)}%`.padStart(13),
      `${algorithm.toFixed(1)}%`.padStart(9),
      `${(app - algorithm) >= 0 ? '+' : ''}${(app - algorithm).toFixed(1)}`.padStart(6),
      `${pct(counts.noSuggestion, counts.cases).toFixed(1)}%`.padStart(6),
    ].join('  ');
  });
  const best = thresholds.reduce((a, b) => (b.top1 > a.top1 ? b : a), thresholds[0]);
  const algorithmAlone = bands.reduce((sum, counts) => sum + counts.algorithmTop1, 0);
  const cases = thresholds[0]?.cases || 0;

  return [
    `run against the algorithm, by the algorithm's top confidence (${SETTINGS.currentModel}; the 100 band ` +
      `is answered by the algorithm in both)${unmatched ? `; ${unmatched} cases not matched` : ''}`,
    ['band   ', ' cases', 'AI asked', 'run top1', '   + fallback', 'algorithm', '  diff', '  none'].join('  '),
    ...lines,
    '"+ fallback" is the run with the app\'s fallback to the algorithm when the AI gave no option (what ' +
      'the user sees); "diff" is it minus the algorithm.',
    `top-1 with ALGORITHM_CERTAIN_CONFIDENCE at: ${thresholds.map(({ threshold, top1 }) =>
      `${threshold} ${pct(top1, cases).toFixed(1)}%${threshold === best?.threshold ? ' (best)' : ''}`).join(', ')}; ` +
      `algorithm alone ${pct(algorithmAlone, cases).toFixed(1)}%`,
  ].join('\n');
}

/**
 * The model as it appears in result file names (`runTestCasesFromJsonAndSaveResults` names them
 * the same way).
 * @returns {string}
 */
function modelFileName() {
  const name = String(SETTINGS.currentModel).replace(/[^\w.-]+/g, '-');
  return SETTINGS.runLabel ? `${name}_${SETTINGS.runLabel}` : name;
}
