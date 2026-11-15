/* eslint-env jest */
/**
 * Runs the cases of a training data file through `getBestSelections` with `runTestCases` and
 * prints a summary: how many top answers are right, how many cases got no suggestion, and how
 * long the calls took.
 *
 * Uses the algorithm path (no `llmQueryUrl`), so it makes no network call and runs in `npm test`.
 *
 * Environment variables:
 *   LLM_TRAINING_DATA_FILE  training data file to run, relative to the repo folder
 *                           (default llmTrainingData/en_ult_tit_book_ru_gl_ru.json)
 *
 * Node's `fs` is used because `fs-extra` is mocked globally.
 */
import fs from 'fs';
import path from 'path';
import {
  formatSummary,
  runAllTestCasesInFolderAndSaveResults,
  runTestCases,
  runTestCasesFromJsonAndSaveResults,
  summarizeTestResults,
} from './helpers/suggestionsHelpers';

const TEST_FILE = 'en_ult_tit_book_ru_gl_ru.json';
const DATA_FOLDER = path.join(__dirname, '..',
  process.env.LLM_TRAINING_DATA_FILE || 'llmTrainingData');
const DATA_FILE = path.join(DATA_FOLDER, TEST_FILE);

// const describeIfData = fs.existsSync(DATA_FILE) ? describe : describe.skip;

describe(`runTestCases on ${path.basename(DATA_FILE)}`, () => {
  const testCases = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  let results;

  beforeAll(async () => {
    results = await runTestCases(testCases);
  });

  test('returns one result per case, in order', () => {
    expect(testCases.length).toBeGreaterThan(0);
    expect(results.map(({ id }) => id)).toEqual(testCases.map(({ id }) => id));

    for (const { elapsedMs } of results) {
      expect(elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('summarizes the results', () => {
    const summary = summarizeTestResults(testCases, results);
    console.log(formatSummary(path.basename(DATA_FILE), summary));

    expect(summary.cases).toBe(testCases.length);
    expect(summary.top1 + summary.wrong + summary.noSuggestion).toBe(summary.cases);
  });
});

test.skip('run algorithm all test in JSON file', async () => {
  const { results } = await runTestCasesFromJsonAndSaveResults(DATA_FILE);
  expect(results.length).toBeGreaterThan(0);
});

test.skip('run algorithm all test files in folder', async () => {
  const { fileCount, testCount } = await runAllTestCasesInFolderAndSaveResults(
    DATA_FOLDER
  );
  expect(fileCount).toBeGreaterThan(0);
  expect(testCount).toBeGreaterThan(0);
});
