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
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because
 * `fs-extra` is mocked globally.
 */
import fs from 'fs';
import path from 'path';
import { runTestCasesFromJsonAndSaveResults } from './helpers/suggestionsHelpers';

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
/** an AI run can take minutes per file */
const TIMEOUT_MS = 24 * 60 * 60 * 1000;

const describeIfRun = RUN ? describe : describe.skip;

describeIfRun(`run training data in ${DATA_DIR}`, () => {
  test('runs each file and saves its results', async () => {
    if (SETTINGS.llmQueryUrl && !SETTINGS.currentModel) {
      throw new Error('LLM_TRAINING_MODEL is required with LLM_TRAINING_URL');
    }

    const files = getFilesToRun();
    expect(files.length).toBeGreaterThan(0);

    const rows = [];

    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const { summary } = await runTestCasesFromJsonAndSaveResults(path.join(DATA_DIR, file), SETTINGS);
      rows.push({ file, ...summary });
    }

    console.log(formatTable(rows));
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
