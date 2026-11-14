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
import { normalizer } from 'string-punctuation-tokenizer';
import { runTestCases } from './helpers/alignedTargetWords';

const DATA_FILE = path.join(__dirname, '..',
  process.env.LLM_TRAINING_DATA_FILE || path.join('llmTrainingData', 'en_ult_tit_book_ru_gl_ru.json'));
/** how many wrong answers the summary lists */
const MAX_MISSES_SHOWN = 10;

const describeIfData = fs.existsSync(DATA_FILE) ? describe : describe.skip;

describeIfData(`runTestCases on ${path.basename(DATA_FILE)}`, () => {
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
    const summary = summarize(testCases, results);
    console.log(formatSummary(path.basename(DATA_FILE), summary));

    expect(summary.cases).toBe(testCases.length);
    expect(summary.top1 + summary.wrong + summary.noSuggestion).toBe(summary.cases);
  });
});

/**
 * Scores each result against its case's `expected` answers, as `llmModelSuitability.test.js`
 * scores them (`normalizer`, then lowercase, on the `word word:2` text of an option).
 * @param {Array<object>} testCases
 * @param {Array<{id: string, result: object, elapsedMs: number}>} results - from `runTestCases`
 * @returns {object}
 */
function summarize(testCases, results) {
  const scored = results.map(({
    id, result, elapsedMs,
  }, index) => {
    const testCase = testCases[index];
    const options = result?.bestSelections || [];
    const expected = testCase.expected.map(normalizePhrase);
    const isRight = option => expected.includes(normalizePhrase(optionText(option)));
    return {
      id,
      elapsedMs,
      expected: testCase.expected,
      got: options.map(optionText),
      confidence: options[0]?.confidence,
      top1: !!options.length && isRight(options[0]),
      top3: options.some(isRight),
      hasHistory: !!Object.keys(testCase.history || {}).length,
    };
  });
  const times = scored.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b);
  const right = scored.filter(s => s.top1);
  const wrong = scored.filter(s => !s.top1 && s.got.length);

  return {
    cases: scored.length,
    top1: right.length,
    top3: scored.filter(s => s.top3).length,
    wrong: wrong.length,
    noSuggestion: scored.filter(s => !s.got.length).length,
    withHistory: scored.filter(s => s.hasHistory).length,
    meanConfidenceRight: mean(right.map(s => s.confidence)),
    meanConfidenceWrong: mean(wrong.map(s => s.confidence)),
    totalMs: times.reduce((sum, ms) => sum + ms, 0),
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    maxMs: times[times.length - 1] || 0,
    misses: scored.filter(s => !s.top1),
  };
}

/**
 * @param {string} name - file name
 * @param {object} summary - from `summarize`
 * @returns {string}
 */
function formatSummary(name, summary) {
  const pct = count => `${count} (${summary.cases ? Math.round((100 * count) / summary.cases) : 0}%)`;
  const lines = [
    `runTestCases summary for ${name} (algorithm path)`,
    `  cases:                 ${summary.cases} (${summary.withHistory} with history)`,
    `  top answer right:      ${pct(summary.top1)}`,
    `  right answer in top 3: ${pct(summary.top3)}`,
    `  wrong top answer:      ${pct(summary.wrong)}`,
    `  no suggestion:         ${pct(summary.noSuggestion)}`,
    `  mean top confidence:   ${summary.meanConfidenceRight.toFixed(1)} when right, ${summary.meanConfidenceWrong.toFixed(1)} when wrong`,
    `  time:                  ${summary.totalMs.toFixed(1)} ms total, median ${summary.medianMs.toFixed(2)} ms, 95th percentile ${summary.p95Ms.toFixed(2)} ms, max ${summary.maxMs.toFixed(2)} ms`,
  ];

  if (summary.misses.length) {
    lines.push(`  misses (first ${Math.min(MAX_MISSES_SHOWN, summary.misses.length)} of ${summary.misses.length}):`);

    for (const miss of summary.misses.slice(0, MAX_MISSES_SHOWN)) {
      lines.push(`    ${miss.id}: expected ${JSON.stringify(miss.expected)}, got ${miss.got.length ? miss.got.join(' | ') : '(none)'}`);
    }
  }
  return lines.join('\n');
}

/**
 * Text of an option as `word word:2`, the format of `expected` in the cases.
 * @param {{selections: Array<{text: string, occurrence: number}>}} option
 * @returns {string}
 */
function optionText(option) {
  return (option?.selections || [])
    .map(({ text, occurrence }) => (occurrence > 1 ? `${text}:${occurrence}` : text))
    .join(' ');
}

function normalizePhrase(phrase) {
  return normalizer(phrase || '').toLowerCase().trim();
}

function mean(values) {
  const numbers = values.filter(value => typeof value === 'number');
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
}

function percentile(sorted, fraction) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] : 0;
}
