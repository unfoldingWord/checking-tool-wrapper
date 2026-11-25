/**
 * Test helpers for checking suggestions (`src/utils/checkingSuggestionsUtils.js`):
 *  - `getAlignedTargetWords` and `getQuoteWords` (re-exported from
 *    `src/utils/alignmentHistoryUtils.js`) find the target-language words a translator aligned to
 *    a check's original-language quote. Used by the builders of AI evaluation cases
 *    (`buildLlmEvalRealCases.test.js`) and AI training data (`buildLlmTrainingData.test.js`);
 *  - `testCaseToSelectionOptions` turns a training or evaluation case into the options
 *    `getBestSelections` takes;
 *  - `runTestCases` and `runTestCasesFromJson` run a list of cases, or a file of them, through
 *    `getBestSelections` and time each call (see `runTrainingCases.test.js`);
 *  - `summarizeTestResults` and `formatSummary` score those results against each case's `expected`
 *    answers and print a report, using `optionText`, `normalizePhrase`, `mean` and `percentile`.
 *  - `installNodeAiApis` lets AI runs work under jest, which has no `fetch`;
 *  - `findUnhelpfulTrainingCases` finds training cases that may not help train the AI, for the
 *    reasons in `UNHELPFUL_REASONS` (see `findUnhelpfulTrainingCases.test.js`).
 *
 * This folder is in jest's `testPathIgnorePatterns`, so this file is not run as a test.
 */
import fs from 'fs';
import http from 'http';
import https from 'https';
import { normalizer } from 'string-punctuation-tokenizer';
import usfmjs from 'usfm-js';
import path from 'path-extra';
import {
  buildChatMessages, getBestSelections, getExtraParams, getValidChatMessages, getWordList,
  normalizeForCompare, wordSimilarity,
} from '../../src/utils/checkingSuggestionsUtils';
import { normalizeString } from '../../src/helpers/stringHelpers';

// moved to src (plans/alignment-history.md, Step 1); exported here for the builders that use them
export { getAlignedTargetWords, getQuoteWords } from '../../src/utils/alignmentHistoryUtils';

/** how many wrong answers `formatSummary` lists */
export const MAX_MISSES_SHOWN = 10;

/**
 * Builds the options (one job) that `getBestSelections` takes for a case, as `Container.js` builds
 * them for a check. Works for training data cases (`llmTrainingData/*.json`) and the `llmEval`
 * cases, which share these fields: `verse`, `targetLang`, `glPhrase`, `glLang`, `history`, and
 * `occurrence` or `contextId`.
 *
 * The verse is cleaned as the app's `getVerseText` cleans it: USFM markers left in the verse text,
 * such as `\q1`, are removed with `usfm-js`, and whitespace is normalized. Words keep their
 * Unicode form, so answers compare with the case's `expected` as they are.
 * @param {object} testCase - a training case (an entry of `llmTrainingData/*.json`, written by
 *   `buildLlmTrainingData.test.js`) or an evaluation case (an entry of
 *   `__fixtures__/llmEval/cases.json` or `realCases.json`). Only these fields are used; others,
 *   such as `expected`, `selections`, `tags` and `source`, are ignored:
 * @param {string} testCase.verse - target-language verse text, as saved in the project; it may
 *   still hold USFM markers (e.g. `\q1`), which are removed
 * @param {string} testCase.targetLang - target language code, e.g. 'vi'; becomes
 *   `targetLanguageDetails.id`
 * @param {string} testCase.glPhrase - GL text aligned to the check's quote, e.g. 'faith' or
 *   'Аврааму'; becomes `alignedGLText`
 * @param {string} testCase.glLang - GL language code, e.g. 'en' or 'ru'; becomes
 *   `gatewayLanguageCode`
 * @param {Object<string, Object<string, number>>} [testCase.history] - previous renderings,
 *   `{ glPhrase: { targetWords: count } }`, e.g. `{ 'Аврааму': { 'với Áp ra ham': 1 } }`; becomes
 *   `selectionsData.selections`. Missing is taken as `{}` (no history)
 * @param {object} [testCase.contextId] - the check's context (training cases have it). It is passed
 *   on as `contextId`, and its `reference` (`{bookId, chapter, verse}`), `groupId` and `checkId`
 *   make the cache `key`, as `generateKey` in `Container.js` does
 *   (`translationWords_ru_vi_abraham_luk_1_73_hsjm`). Its `occurrence` (default 1) says which run
 *   of the words in the verse the check is for
 * @param {number} [testCase.occurrence=1] - which occurrence the check is for; used when the case
 *   has no `contextId` (evaluation cases), or no `occurrence` in it
 * @param {string} [testCase.id] - the case id, e.g. 'real-vi-heb-7-26-sin'; used as the `key` when
 *   the case has no `contextId.reference`
 * @param {object} [settings] - suggestion settings, as in translationCore's checking settings
 * @param {string|null} [settings.llmQueryUrl] - AI server URL; leave out for the algorithm path
 * @param {string} [settings.currentModel] - AI model name
 * @param {number} [settings.llmTemperature] - AI temperature
 * @param {object} [settings.llmExtraParams] - extra fields for the AI request body
 * @param {boolean} [settings.llmEnableThinking] - let the AI think (experiments only)
 * @param {string} [settings.apiToken] - bearer token for the AI server
 * @param {string} [settings.toolName='translationWords'] - used in the cache `key`
 * @returns {object} - options for `getBestSelections`; pass an array of them for a batched query
 * @example
 * const [result] = await getBestSelections(testCaseToSelectionOptions(trainingCase));
 * const results = await getBestSelections(cases.map(c => testCaseToSelectionOptions(c, { llmQueryUrl })));
 */
export function testCaseToSelectionOptions(testCase, settings = {}) {
  const {
    llmQueryUrl = null,
    currentModel,
    llmTemperature,
    llmExtraParams,
    llmEnableThinking,
    apiToken,
    toolName = 'translationWords',
  } = settings;
  const contextId = testCase.contextId || { occurrence: testCase.occurrence || 1 };
  const {
    bookId, chapter, verse,
  } = contextId.reference || {};
  // the cache key `Container.js` builds with `generateKey`
  const key = contextId.reference ?
    `${toolName}_${testCase.glLang}_${testCase.targetLang}_${contextId.groupId}_${bookId}_${chapter}_${verse}_${contextId.checkId}` :
    testCase.id;

  return {
    verseText: normalizeString(usfmjs.removeMarker(testCase.verse || '')).trim(),
    targetLanguageDetails: { id: testCase.targetLang },
    alignedGLText: testCase.glPhrase,
    gatewayLanguageCode: testCase.glLang,
    glVerseText: testCase.glVerse,
    selectionsData: { selections: testCase.history || {} },
    contextId: { ...contextId, occurrence: contextId.occurrence || testCase.occurrence || 1 },
    key,
    llmQueryUrl,
    currentModel,
    llmTemperature,
    llmExtraParams,
    llmEnableThinking,
    apiToken,
  };
}

/**
 * Runs one case through `getBestSelections` and times the call. The options come from
 * {@link testCaseToSelectionOptions}; only the call itself is timed, not building the options.
 *
 * With no `settings.llmQueryUrl` this is the algorithm path and makes no network call. With one,
 * a case whose algorithm answer is certain (confidence `ALGORITHM_CERTAIN_CONFIDENCE`, 95, or more)
 * is answered without asking the AI
 * (`result.algorithmFirst`), as in the app.
 * @param {object} testCase - a training or evaluation case (see {@link testCaseToSelectionOptions})
 * @param {object} [settings] - suggestion settings, passed to {@link testCaseToSelectionOptions}
 * @returns {Promise<{id: string, result: object, options: object, elapsedMs: number}>}
 *   - **id**: the case's `id`
 *   - **result**: what `getBestSelections` returned for the case: `{error, bestSelections,
 *     elapsedStr, model}`, where `bestSelections` is up to 3 `{selections: [{text, occurrence}],
 *     confidence}`, best first; `{error: true}` when it failed
 *   - **options**: the options sent to `getBestSelections`, without the fields that are `null` or
 *     `undefined` (e.g. the AI settings on the algorithm path)
 *   - **elapsedMs**: how long the `getBestSelections` call took, in milliseconds
 * @example
 * const { result, elapsedMs } = await runTestCase(trainingCase);
 */
export async function runTestCase(testCase, settings) {
  const options = testCaseToSelectionOptions(testCase, settings);
  const start = process.hrtime.bigint();
  const [result] = await getBestSelections(options);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  const _options = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== null && value !== undefined)
  );

  const testCaseResults = {
    id: testCase.id,
    result,
    options: _options,
    elapsedMs,
  };
  return testCaseResults;
}

/**
 * Runs each case through `getBestSelections` with {@link runTestCase}, one case per call and one
 * after the other, so each time is for that case alone.
 * @param {Array<object>} testCases - cases, e.g. the contents of
 *   `llmTrainingData/vi_glt_luk_book_ru_gl_ru.json` (see {@link testCaseToSelectionOptions});
 *   `null` or `undefined` is taken as no cases
 * @param {object} [settings] - suggestion settings, passed to {@link testCaseToSelectionOptions}
 * @returns {Promise<Array<{id: string, result: object, options: object, elapsedMs: number}>>} -
 *   one element per case, in the same order, as {@link runTestCase} returns it
 * @example
 * const testCases = JSON.parse(fs.readFileSync('llmTrainingData/vi_glt_luk_book_ru_gl_ru.json', 'utf8'));
 * const results = await runTestCases(testCases);
 * // [{ id: 'train-vi-luk-1-73-abraham', result: { error: false, bestSelections: [...], ... }, elapsedMs: 1.84 }, ...]
 */
export async function runTestCases(testCases, settings = {}) {
  const results = [];

  for (const testCase of testCases || []) {
    // eslint-disable-next-line no-await-in-loop
    const testCaseResults = await runTestCase(testCase, settings);
    results.push( testCaseResults );
  }
  return results;
}

/**
 * Reads a JSON file of cases and runs them with {@link runTestCases}.
 *
 * Reads with Node's `fs`, not `fs-extra`, so it reads the real file even though `fs-extra` is
 * mocked in the tests.
 * @param {string} testDataPath - path to a JSON file holding an array of cases, e.g.
 *   `llmTrainingData/en_ult_tit_book_ru_gl_ru.json`; a relative path is resolved from the
 *   current folder (the repo folder when run with jest)
 * @param {object} [settings] - suggestion settings, passed to {@link testCaseToSelectionOptions}
 * @returns {Promise<Array<{id: string, result: object, options: object, elapsedMs: number}>|null>}
 *   - one element per case, as {@link runTestCases} returns them; `null` when the file does not
 *   exist. Throws if the file is not valid JSON
 * @example
 * const results = await runTestCasesFromJson('llmTrainingData/en_ult_tit_book_ru_gl_ru.json');
 */
export async function runTestCasesFromJson(testDataPath, settings = {}) {
  if (fs.existsSync(testDataPath)) {
    const testCases = JSON.parse(fs.readFileSync(testDataPath, 'utf8'));
    const results = await runTestCases(testCases, settings);
    const summary = summarizeTestResults(testCases, results);
    console.log(`runTestCasesFromJson ran test cases from ${testDataPath} and got ${results?.length} results`);
    return { results, summary };
  }
  return null;
}

/**
 * Scores each result against its case's `expected` answers, as `llmModelSuitability.test.js`
 * scores them (`normalizer`, then lowercase, on the `word word:2` text of an option).
 * An option is right when its text equals any of the expected answers.
 * @param {Array<{id: string, expected: string[], history?: object}>} testCases - the cases that
 *   were run, in the same order as `results`
 * @param {Array<{id: string, result: object, elapsedMs: number}>} results - from `runTestCases`.
 *   `result.bestSelections` holds up to 3 options, best first; it may be missing on an error.
 * @returns {{
 *   cases: number,
 *   top1: number,
 *   top3: number,
 *   wrong: number,
 *   noSuggestion: number,
 *   withHistory: number,
 *   meanConfidenceRight: number,
 *   meanConfidenceWrong: number,
 *   totalMs: number,
 *   medianMs: number,
 *   p95Ms: number,
 *   maxMs: number,
 *   misses: Array<{id: string, elapsedMs: number, expected: string[], got: string[],
 *     confidence: number|undefined, top1: boolean, top3: boolean, hasHistory: boolean}>
 * }} counts of cases whose top option is right (`top1`), that have a right option in any place
 *   (`top3`), whose top option is wrong (`wrong`) and that got no option (`noSuggestion`), so
 *   `top1 + wrong + noSuggestion === cases`; how many cases have history; the mean confidence of
 *   the top option when right and when wrong (0 when there are none); the call times in
 *   milliseconds; and every case whose top option is not right (`misses`), wrong or empty.
 */
export function summarizeTestResults(testCases, results) {
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
      testCase,
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
 * Formats a summary from `summarizeTestResults` as a report to print: the counts with percentages of all
 * cases, the mean confidences, the times, and the first `MAX_MISSES_SHOWN` misses with what was
 * expected and the options given.
 * @param {string} name - name for the report's first line, such as the training data file name
 * @param {object} summary - from `summarizeTestResults`
 * @returns {string} the report, one line per item
 */
export function formatSummary(name, summary) {
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
      let missStr = miss.got.length ? miss.got.join(' | ') : '';
      missStr = missStr ? `[${missStr}]` : '(none)';
      const misCompare = `    ${miss.id}: expected '${JSON.stringify(miss.expected)}', got options: '${missStr}'`;
      lines.push(misCompare);
    }
  }
  return lines.join('\n');
}

/**
 * Text of an option as `word word:2`, the format of `expected` in the cases.
 * @param {{selections: Array<{text: string, occurrence: number}>}} option
 * @returns {string}
 */
export function optionText(option) {
  return (option?.selections || [])
    .map(({ text, occurrence }) => (occurrence > 1 ? `${text}:${occurrence}` : text))
    .join(' ');
}

/**
 * Normalizes a phrase for comparing answers: `normalizer` from string-punctuation-tokenizer,
 * then lowercase, then trimmed. Keeps an `:2` occurrence suffix.
 * @param {string} [phrase] - such as `word word:2`; null or undefined gives ''
 * @returns {string}
 */
export function normalizePhrase(phrase) {
  return normalizer(phrase || '').toLowerCase().trim();
}

/**
 * Mean of the numbers in a list. Values that are not numbers, such as a missing confidence, are
 * left out.
 * @param {Array<*>} values
 * @returns {number} the mean, or 0 when the list has no numbers
 */
export function mean(values) {
  const numbers = values.filter(value => typeof value === 'number');
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
}

/**
 * Value at a fraction of a sorted list (nearest rank, no interpolation): 0.5 gives the median,
 * 0.95 the 95th percentile.
 * @param {number[]} sorted - numbers sorted from smallest to largest
 * @param {number} fraction - from 0 to 1
 * @returns {number} the value, or 0 for an empty list
 */
export function percentile(sorted, fraction) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] : 0;
}

/**
 * Runs test cases from a JSON file, then saves both the raw results and summary beside the source
 * file in a `results` folder.
 *
 * The output files are named after the input file:
 * - `<baseName>.results.json`
 * - `<baseName>.summary.json`
 *
 * @param {string} testDataPath - path to a JSON file holding an array of cases
 * @param {object} [settings] - suggestion settings, passed to {@link runTestCasesFromJson}
 * @param {string} [settings.runLabel] - for an AI run, added to the file names after the model
 *   name, e.g. `prompt-X1` gives `<file>_<model>_prompt-X1.results.json`
 * @returns {Promise<{results: Array<object>, summary: object}>} the results and summary that were
 *   saved, as {@link runTestCasesFromJson} returns them
 */
export async function runTestCasesFromJsonAndSaveResults(testDataPath, settings = {}) {
  const { results, summary } = await runTestCasesFromJson(testDataPath, settings);

  const baseFileName_ = path.basename(testDataPath, '.json');
  // a model id such as `qwen/qwen3-4b` has characters that cannot be in a file name
  const modelName = settings?.llmQueryUrl ? String(settings.currentModel).replace(/[^\w.-]+/g, '-') : 'Algorithm';
  // e.g. `_prompt-X1` for a prompt variant (plans/improve-single-prompt.md)
  const runLabel = settings?.llmQueryUrl && settings.runLabel ? `_${settings.runLabel}` : '';
  const baseFileName = `${baseFileName_}_${modelName}${runLabel}`;
  const destFolder = path.join(path.dirname(testDataPath), 'results');
  fs.mkdirSync(destFolder, { recursive: true });

  // for an AI run, compare with the algorithm's saved results, band by band of its confidence
  const algorithmResultsPath = path.join(destFolder, `${baseFileName_}_Algorithm.results.json`);

  if (settings?.llmQueryUrl && fs.existsSync(algorithmResultsPath)) {
    const testCases = JSON.parse(fs.readFileSync(testDataPath, 'utf8'));
    const algorithmResults = JSON.parse(fs.readFileSync(algorithmResultsPath, 'utf8'));
    summary.byAlgorithmConfidence = summarizeByAlgorithmConfidence(testCases, results, algorithmResults);
  }

  const resultsPath = path.join(destFolder, `${baseFileName}.results.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  const summaryPath = path.join(destFolder, `${baseFileName}.summary.json`);
  const summaryJson = JSON.stringify(summary, null, 2);
  fs.writeFileSync(summaryPath, summaryJson);

  return { results, summary };
}

/**
 * Bands of the algorithm's top confidence used by {@link summarizeByAlgorithmConfidence}, highest
 * first. A case is in the first band whose `min` its confidence reaches; a case the algorithm gave
 * no option is in `none`. The 100 and 95-99 bands are what `ALGORITHM_CERTAIN_CONFIDENCE` (95) in
 * `checkingSuggestionsUtils.js` answers without the AI (see `scoreSuggestionFromHistory`).
 */
export const ALGORITHM_CONFIDENCE_BANDS = [
  { band: '100', min: 100 },
  { band: '95-99', min: 95 },
  { band: '90-94', min: 90 },
  { band: '85-89', min: 85 },
  { band: '80-84', min: 80 },
  { band: '60-79', min: 60 },
  { band: '1-59', min: 1 },
  { band: '0', min: 0 },
  { band: 'none', min: null },
];

/**
 * Compares an AI run with the algorithm on the same cases, band by band of the algorithm's top
 * confidence, to choose `ALGORITHM_CERTAIN_CONFIDENCE`: where the AI is right less often than the
 * algorithm, the algorithm's answer is the better one to show. Answers are scored as
 * {@link summarizeTestResults} scores them. Cases are matched to the algorithm results by `id`;
 * a case missing from either is counted in `unmatched`.
 *
 * In an AI run, `getBestSelections` answers a case with algorithm confidence
 * `ALGORITHM_CERTAIN_CONFIDENCE` (95) or more without the AI (`algorithmFirst`), so the `100` and
 * `95-99` bands show the algorithm on both sides. `getBestSelections` does
 * not fall back to the algorithm when the AI gives no option, but the app does (`LlmRequestQueue`
 * marks those `algorithmFallback`), so `appTop1` scores the run with that fallback: it is what the
 * user sees, and the number to compare with `algorithmTop1`. Pass the bands to
 * {@link topOneByThreshold} for the top-1 at each possible `ALGORITHM_CERTAIN_CONFIDENCE`.
 * @param {Array<object>} testCases - the cases that were run
 * @param {Array<{id: string, result: object}>} results - the AI run (from {@link runTestCases})
 * @param {Array<{id: string, result: object}>} algorithmResults - the algorithm's results for the
 *   same file (`<file>_Algorithm.results.json`)
 * @returns {{bands: Array<{band: string, cases: number, aiAsked: number, top1: number,
 *   appTop1: number, algorithmTop1: number, noSuggestion: number}>, unmatched: number}} - per band:
 *   the cases, how many were sent to the AI (not `algorithmFirst`), how many the run's top option got
 *   right (`top1`), how many the run got right with the app's fallback to the algorithm when it gave
 *   no option (`appTop1`), how many the algorithm's top option got right, and how many got no option
 *   in the run
 */
export function summarizeByAlgorithmConfidence(testCases, results, algorithmResults) {
  const algorithmById = new Map((algorithmResults || []).map(item => [item.id, item.result]));
  const resultById = new Map((results || []).map(item => [item.id, item.result]));
  const bands = ALGORITHM_CONFIDENCE_BANDS.map(({ band }) => ({
    band, cases: 0, aiAsked: 0, top1: 0, appTop1: 0, algorithmTop1: 0, noSuggestion: 0,
  }));
  let unmatched = 0;

  for (const testCase of testCases || []) {
    if (!algorithmById.has(testCase.id) || !resultById.has(testCase.id)) {
      unmatched++;
      continue;
    }

    const expected = (testCase.expected || []).map(normalizePhrase);
    const isRight = option => !!option && expected.includes(normalizePhrase(optionText(option)));
    const algorithmTop = algorithmById.get(testCase.id)?.bestSelections?.[0];
    const confidence = algorithmTop?.confidence;
    const bandIndex = confidence === undefined ?
      ALGORITHM_CONFIDENCE_BANDS.length - 1 :
      ALGORITHM_CONFIDENCE_BANDS.findIndex(({ min }) => min !== null && confidence >= min);
    const counts = bands[bandIndex];
    const result = resultById.get(testCase.id);

    counts.cases++;
    counts.aiAsked += result?.algorithmFirst ? 0 : 1;
    counts.top1 += isRight(result?.bestSelections?.[0]) ? 1 : 0;
    counts.appTop1 += isRight(result?.bestSelections?.[0] || algorithmTop) ? 1 : 0;
    counts.algorithmTop1 += isRight(algorithmTop) ? 1 : 0;
    counts.noSuggestion += result?.bestSelections?.length ? 0 : 1;
  }
  return { bands: bands.filter(({ cases }) => cases), unmatched };
}

/**
 * Top-1 at each possible `ALGORITHM_CERTAIN_CONFIDENCE`, from the bands of
 * {@link summarizeByAlgorithmConfidence}: with threshold `t`, the bands whose `min` is at least `t`
 * are answered by the algorithm (`algorithmTop1`) and the others by the AI with the app's fallback
 * (`appTop1`). The thresholds are the bands' `min` values from 100 down to 1, so each is exact.
 * The 100 band is answered by the algorithm in the run too, so a threshold above 100 cannot be
 * measured from it.
 * @param {Array<{band: string, cases: number, appTop1: number, algorithmTop1: number}>} bands
 * @returns {Array<{threshold: number, cases: number, top1: number}>} - highest threshold first
 * @example
 * topOneByThreshold(summary.byAlgorithmConfidence.bands);
 * // [{ threshold: 100, cases: 5349, top1: 3231 }, { threshold: 95, ... }, ...]
 */
export function topOneByThreshold(bands) {
  const minByBand = new Map(ALGORITHM_CONFIDENCE_BANDS.map(({ band, min }) => [band, min]));
  const cases = (bands || []).reduce((sum, counts) => sum + counts.cases, 0);

  return ALGORITHM_CONFIDENCE_BANDS
    .filter(({ min }) => min >= 1)
    .map(({ min: threshold }) => ({
      threshold,
      cases,
      top1: (bands || []).reduce((sum, counts) => {
        const min = minByBand.get(counts.band);
        return sum + (min !== null && min >= threshold ? counts.algorithmTop1 : counts.appTop1);
      }, 0),
    }));
}

export async function runAllTestCasesInFolderAndSaveResults(testDataFolder, settings = {}) {
  let fileCount = 0;
  let testCount = 0;

  if (fs.existsSync(testDataFolder)) {
    let files = [];

    try {
      files = fs.readdirSync(testDataFolder);
    } catch (err) {
      console.error(`Error reading directory ${testDataFolder}: ${err}`);
      return fileCount;
    }

    files = files.filter(file => // filter the filenames to only use .json
      path.extname(file) === '.json'
    );

    for (const file of files) {
      const filePath = path.join(testDataFolder, file);
      console.log(`Processing file: ${filePath}`);

      try {
        // eslint-disable-next-line no-await-in-loop
        const { results } = await runTestCasesFromJsonAndSaveResults(filePath, settings);
        fileCount++;
        testCount += results?.length || 0;
      } catch (e) {
        console.error(`Error processing file ${filePath}: ${e}`);
      }
    }
  } else {
    console.error(`Directory ${testDataFolder} does not exist`);
  }

  console.log(`Processed ${fileCount} files and ${testCount} tests`);
  return { fileCount, testCount };
}

/**
 * Why a training case may not help train the AI, with what each reason means. The keys are the
 * reason codes {@link findUnhelpfulTrainingCases} gives. "Another form" is a history word that
 * `wordSimilarity` matches (as the app matches inflected or compound forms); words shorter than its
 * minimum length only ever match exactly.
 */
export const UNHELPFUL_REASONS = {
  noExpected: 'the case has no expected answer',
  emptyGlPhrase: 'the case has no GL phrase',
  noHistory: 'the case has no history, so it teaches nothing about using previous translations',
  noRelatedWordInHistory: 'no expected word is in any history rendering, exactly or as another form',
  onlyOtherFormsInHistory: 'no expected word is in the history exactly, but some are there as another form (may still be useful: rule 5 of the prompt)',
  someExpectedWordsNotInHistory: 'some expected words are in the history exactly, others only as another form or not at all',
  expectedNotInVerse: 'an expected word (at its occurrence) is not in the verse, so the answer cannot be selected',
  unusuallyLongAnswer: 'the answer is longer than its language\'s usual answers (over the language limit from `getAnswerLengthLimits`) and more than `LONG_ANSWER_HISTORY_MARGIN` words longer than the longest history rendering; it may be wider than a checker would select',
  duplicate: 'same verse, GL phrase, history and expected answer as an earlier case in the file',
};

/** percentile of a language's answer lengths used as its limit by {@link getAnswerLengthLimits} */
export const LONG_ANSWER_PERCENTILE = 0.99;
/** words an answer may be longer than its longest history rendering before it counts as unusually long */
export const LONG_ANSWER_HISTORY_MARGIN = 2;

/**
 * Number of space-separated words in a text. Used for answer lengths, so `Áp ra ham` is 3 words:
 * languages space words differently, which is why the limits are per language.
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

/**
 * Works out, for each target language, how many words an answer can have before it is unusual: the
 * `fraction` percentile of the lengths of that language's first expected answers, in words. Each check is
 * counted once, by `targetLang` and `id`, because one check appears in several files when a project
 * was built for several GLs. Pass every training data file's cases, so the limits are for whole
 * languages.
 * @param {Array<object>} testCases - training cases, from any number of files
 * @param {number} [fraction=LONG_ANSWER_PERCENTILE] - percentile, between 0 and 1
 * @returns {Object<string, number>} - limit in words, by target language code
 * @example
 * getAnswerLengthLimits([...viCases, ...ruCases]); // { vi: 6, ru: 4 }
 */
export function getAnswerLengthLimits(testCases, fraction = LONG_ANSWER_PERCENTILE) {
  const lengths = {};
  const seen = new Set();

  for (const testCase of testCases || []) {
    const lang = testCase.targetLang || '';
    const key = `${lang} ${testCase.id}`;
    const words = countWords(testCase.expected?.[0]);

    if (!words || seen.has(key)) {
      continue;
    }
    seen.add(key);
    (lengths[lang] = lengths[lang] || []).push(words);
  }
  return Object.fromEntries(Object.entries(lengths).map(([lang, values]) => {
    const sorted = values.sort((a, b) => a - b);
    return [lang, percentile(sorted, fraction)];
  }));
}

/**
 * Splits an expected answer such as `Chúa:3 Cứu:2 Thế` into words with their occurrence.
 * @param {string} expected
 * @returns {Array<{word: string, occurrence: number}>}
 */
function parseExpectedWords(expected) {
  return (expected || '').split(/\s+/).filter(Boolean).map(token => {
    const match = token.match(/^(.+):(\d+)$/);
    return match ? { word: match[1], occurrence: Number(match[2]) } : { word: token, occurrence: 1 };
  });
}

/**
 * Finds how an expected word appears in the history: exactly, as another form, or not at all.
 * @param {string} normalized - the expected word, through `normalizeForCompare`
 * @param {Map<string, string>} historyWords - normalized history word to its first spelling
 * @returns {{match: 'exact'|'otherForm'|'missing', historyWord?: string, similarity?: number}} -
 *   for another form, the most similar history word (as spelled in the history) and its similarity
 */
function findWordInHistory(normalized, historyWords) {
  if (historyWords.has(normalized)) {
    return { match: 'exact' };
  }

  let best = { match: 'missing' };

  for (const [historyNormalized, historyWord] of historyWords) {
    const similarity = wordSimilarity(normalized, historyNormalized);

    if (similarity > (best.similarity || 0)) {
      best = {
        match: 'otherForm', historyWord, similarity,
      };
    }
  }
  return best;
}

/**
 * Finds the cases of a training data file that may not help train the AI. A case can have several
 * reasons (see {@link UNHELPFUL_REASONS}). Words are compared with `normalizeForCompare` in the
 * case's target language, after splitting with `getWordList`, and other forms are found with
 * `wordSimilarity`; the verse is cleaned as {@link testCaseToSelectionOptions} cleans it. When a
 * case has several expected answers, the one with the most words in the history exactly, then the
 * most as another form, is used.
 * @param {Array<object>} testCases - the cases of one training data file
 *   (`llmTrainingData/*.json`)
 * @param {object} [options]
 * @param {Object<string, number>} [options.answerLengthLimits] - answer length limit in words by
 *   target language, from {@link getAnswerLengthLimits}; without a limit for a case's language,
 *   `unusuallyLongAnswer` is not checked for it
 * @returns {Array<{index: number, id: string, reasons: string[], missingFromHistory: string[],
 *   otherFormsInHistory: Array<{word: string, historyWord: string, similarity: number}>,
 *   missingFromVerse: string[], longAnswer: object|undefined,
 *   duplicateOf: string|undefined}>} - one element per unhelpful case,
 *   in file order. Expected words are as written in `expected`: `missingFromHistory` are in the
 *   history neither exactly nor as another form, `otherFormsInHistory` are there only as another
 *   form (with the history word matched and its similarity, rounded to 2 places), and
 *   `missingFromVerse` are not in the verse at their occurrence. `longAnswer` is set for an
 *   unusually long answer: `{words, languageLimit, longestHistoryRendering}`, all in words
 * @example
 * findUnhelpfulTrainingCases([{ id: 'a', targetLang: 'ru', verse: 'и Авеля', glPhrase: 'Abel',
 *   history: { Abel: { 'Авель': 1 } }, expected: ['Авеля'] }]);
 * // [{ index: 0, id: 'a', reasons: ['onlyOtherFormsInHistory'], missingFromHistory: [],
 * //    otherFormsInHistory: [{ word: 'Авеля', historyWord: 'Авель', similarity: 0.8 }], ... }]
 */
export function findUnhelpfulTrainingCases(testCases, { answerLengthLimits = {} } = {}) {
  const seen = new Map();
  const unhelpful = [];
  const asText = ({ word, occurrence }) => (occurrence > 1 ? `${word}:${occurrence}` : word);

  (testCases || []).forEach((testCase, index) => {
    const lang = testCase.targetLang || '';
    const normalize = word => normalizeForCompare(word, lang);
    const reasons = [];
    const history = testCase.history || {};
    const historyWords = new Map();

    for (const word of Object.values(history)
      .flatMap(counts => Object.keys(counts || {}))
      .flatMap(rendering => getWordList(rendering))) {
      const normalized = normalize(word);

      if (normalized && !historyWords.has(normalized)) {
        historyWords.set(normalized, word);
      }
    }

    const expectedList = (testCase.expected || []).filter(text => (text || '').trim());
    let missingFromHistory = [];
    let otherFormsInHistory = [];
    let missingFromVerse = [];
    let longAnswer;

    if (!expectedList.length) {
      reasons.push('noExpected');
    }

    if (!(testCase.glPhrase || '').trim()) {
      reasons.push('emptyGlPhrase');
    }

    if (!historyWords.size) {
      reasons.push('noHistory');
    }

    if (expectedList.length) {
      const verseWords = getWordList(testCaseToSelectionOptions(testCase).verseText).map(normalize);
      const checked = expectedList.map(text => {
        const words = parseExpectedWords(text).map(item => ({ ...item, ...findWordInHistory(normalize(item.word), historyWords) }));
        return {
          words,
          exact: words.filter(word => word.match === 'exact').length,
          otherForms: words.filter(word => word.match === 'otherForm'),
          missing: words.filter(word => word.match === 'missing'),
          missingFromVerse: words.filter(({ word, occurrence }) =>
            verseWords.filter(verseWord => verseWord === normalize(word)).length < occurrence),
        };
      });
      const best = checked.reduce((a, b) => (
        (b.exact > a.exact || (b.exact === a.exact && b.otherForms.length > a.otherForms.length)) ? b : a));

      missingFromHistory = best.missing.map(asText);
      otherFormsInHistory = best.otherForms.map(item => ({
        word: asText(item),
        historyWord: item.historyWord,
        similarity: Math.round(item.similarity * 100) / 100,
      }));
      missingFromVerse = best.missingFromVerse.map(asText);

      // with no history at all, `noHistory` already says it
      if (historyWords.size && best.exact < best.words.length) {
        if (best.exact) {
          reasons.push('someExpectedWordsNotInHistory');
        } else {
          reasons.push(best.otherForms.length ? 'onlyOtherFormsInHistory' : 'noRelatedWordInHistory');
        }
      }

      if (missingFromVerse.length) {
        reasons.push('expectedNotInVerse');
      }

      const languageLimit = answerLengthLimits[lang];
      const longestHistoryRendering = Math.max(0, ...Object.values(history)
        .flatMap(counts => Object.keys(counts || {}))
        .map(countWords));

      if (languageLimit && best.words.length > languageLimit &&
        best.words.length > longestHistoryRendering + LONG_ANSWER_HISTORY_MARGIN) {
        reasons.push('unusuallyLongAnswer');
        longAnswer = {
          words: best.words.length, languageLimit, longestHistoryRendering,
        };
      }
    }

    const key = JSON.stringify([lang, testCase.verse, testCase.glPhrase, history, testCase.expected]);
    const duplicateOf = seen.get(key);

    if (duplicateOf !== undefined) {
      reasons.push('duplicate');
    } else {
      seen.set(key, testCase.id);
    }

    if (reasons.length) {
      unhelpful.push({
        index,
        id: testCase.id,
        reasons,
        missingFromHistory,
        otherFormsInHistory,
        missingFromVerse,
        longAnswer,
        duplicateOf,
      });
    }
  });
  return unhelpful;
}

/** longest wait for one AI request made by {@link installNodeAiApis}, in milliseconds */
const NODE_AI_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Makes `queryAiAPI` work under jest. jest's jsdom environment has no `fetch`, so without this every
 * AI request fails ("fetch is not defined") and each case gets no suggestion. It sets
 * `window.AiAPIs.query`, which `queryAiAPI` uses when translationCore provides it, to a stand-in
 * for translationCore's main process (`electronite/queryAiApisFromMainProcess.js`) that sends the
 * same request body with Node's http, not streamed, as `llmModelSuitability.test.js` does.
 * @returns {function(): void} - call it to remove `window.AiAPIs` again
 * @example
 * const uninstall = installNodeAiApis();
 * try { await runTestCases(cases, { llmQueryUrl: 'http://localhost:1234', currentModel }); } finally { uninstall(); }
 */
export function installNodeAiApis() {
  const previous = window.AiAPIs;
  // `features` as translationCore declares them (`electronite/preloadAiApi.js`)
  window.AiAPIs = { query: nodeAiApisQuery, features: { messages: true } };
  return () => {
    if (previous === undefined) {
      delete window.AiAPIs;
    } else {
      window.AiAPIs = previous;
    }
  };
}

/**
 * The `window.AiAPIs.query` stand-in of {@link installNodeAiApis}.
 * Builds the messages as translationCore's main process does
 * (`electronite/queryAiApisFromMainProcess.js`): `options.messages` when valid, otherwise a system
 * message (left out when `systemPrompt` is empty) and `query` as the user message.
 * @param {string} query - user message, as `queryAiAPI` passes it
 * @param {object} options - the options `queryAiAPI` passes: `baseUrl`, `apiToken`, `model`,
 *   `systemPrompt`, `temperature`, `maxTokens`, `enable_thinking`, `extraParams`, `messages`
 * @returns {Promise<{replyText: string, reasoningText: string, actualModel: string}>}
 */
async function nodeAiApisQuery(query, options) {
  const reply = await postJsonWithNode(`${options.baseUrl}/v1/chat/completions`, {
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    chat_template_kwargs: { enable_thinking: options.enable_thinking },
    ...getExtraParams(options.extraParams), // merged as translationCore's main process does
    model: options.model,
    messages: getValidChatMessages(options.messages) || buildChatMessages(options.systemPrompt, query),
    stream: false,
  }, options.apiToken);
  const message = reply?.choices?.[0]?.message || {};
  const reasoning = message.reasoning_content || message.reasoning || '';
  return {
    replyText: message.content || reasoning,
    reasoningText: reasoning,
    actualModel: reply?.model,
  };
}

/**
 * POSTs JSON with Node's http or https and parses the JSON reply.
 * @param {string} href - full URL
 * @param {object} body
 * @param {string} [apiToken] - sent as a bearer token when set
 * @returns {Promise<object>}
 */
function postJsonWithNode(href, body, apiToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(href);
    const bodyStr = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) };

    if (apiToken) {
      headers.Authorization = `Bearer ${apiToken}`;
    }

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: NODE_AI_REQUEST_TIMEOUT_MS,
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`POST ${url.href} failed (${res.statusCode}): ${data.slice(0, 300)}`));
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`POST ${url.href} returned non-JSON: ${data.slice(0, 300)}`));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error(`POST ${url.href} timed out after ${NODE_AI_REQUEST_TIMEOUT_MS} ms`)));
    req.on('error', error => reject(new Error(`Cannot reach ${url.href}: ${error.message}`)));
    req.end(bodyStr);
  });
}
