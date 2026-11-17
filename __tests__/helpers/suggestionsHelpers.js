/**
 * Test helpers for checking suggestions (`src/utils/checkingSuggestionsUtils.js`):
 *  - `getAlignedTargetWords` and `getQuoteWords` find the target-language words a translator
 *    aligned to a check's original-language quote. Used by the builders of AI evaluation cases
 *    (`buildLlmEvalRealCases.test.js`) and AI training data (`buildLlmTrainingData.test.js`);
 *  - `testCaseToSelectionOptions` turns a training or evaluation case into the options
 *    `getBestSelections` takes;
 *  - `runTestCases` and `runTestCasesFromJson` run a list of cases, or a file of them, through
 *    `getBestSelections` and time each call (see `runTrainingCases.test.js`);
 *  - `summarizeTestResults` and `formatSummary` score those results against each case's `expected`
 *    answers and print a report, using `optionText`, `normalizePhrase`, `mean` and `percentile`.
 *  - `findUnhelpfulTrainingCases` finds training cases that may not help train the AI, for the
 *    reasons in `UNHELPFUL_REASONS` (see `findUnhelpfulTrainingCases.test.js`).
 *
 * This folder is in jest's `testPathIgnorePatterns`, so this file is not run as a test.
 */
import fs from 'fs';
import { normalizer } from 'string-punctuation-tokenizer';
import usfmjs from 'usfm-js';
import path from 'path-extra';
import {
  getBestSelections, getWordList, normalizeForCompare, wordSimilarity,
} from '../../src/utils/checkingSuggestionsUtils';
import { isNT } from '../../src/common/booksOfTheBible';
import { NT_ORIG_LANG, OT_ORIG_LANG } from '../../src/common/constants';
import { normalizeString } from '../../src/helpers/stringHelpers';

/** how many wrong answers `formatSummary` lists */
export const MAX_MISSES_SHOWN = 10;

/**
 * Finds the target words aligned to a check's original-language quote, in verse order.
 * @param {object} contextId - the check's context; `quote` is a string or `[{word, occurrence}]`
 * @param {string} verseText - target verse text
 * @param {Array<{topWords: Array, bottomWords: Array}>} alignments - the verse's alignments, from
 *   `.apps/translationCore/alignmentData/<book>/<chapter>.json`
 * @param {string} languageId - target language code
 * @param {number} [maxWords=Infinity] - longest answer kept, in words
 * @returns {{text: string, words: string, selections: Array<{text: string, occurrence: number,
 *   occurrences: number}>}|null} - `text` as in the eval cases' `expected` (`word:2` for a later
 *   occurrence), `words` as a history rendering (plain words), `selections` as translationCore
 *   saves a selection (one per word); null when the quote is not aligned, is aligned together
 *   with other original words, a word cannot be found in the verse, or the answer is too long
 */
export function getAlignedTargetWords(contextId, verseText, alignments, languageId, maxWords = Infinity) {
  const quoteWords = getQuoteWords(contextId);

  if (!quoteWords || !Array.isArray(alignments)) {
    return null;
  }

  const origLangId = isNT(contextId.reference?.bookId) ? NT_ORIG_LANG : OT_ORIG_LANG;
  const topKey = (word, occurrence) => `${normalizeForCompare(word, origLangId)}:${occurrence}`;
  const wanted = new Set(quoteWords.map(({ word, occurrence }) => topKey(word, occurrence)));
  const matched = alignments.filter(alignment =>
    (alignment.topWords || []).some(top => wanted.has(topKey(top.word, top.occurrence))));
  const found = new Set(matched.flatMap(alignment => alignment.topWords.map(top => topKey(top.word, top.occurrence))));

  // the quote must be aligned, and only to itself: an alignment that also holds other original
  // words (e.g. "will be" merged with "God") covers more than a checker would select
  if (!matched.length || found.size !== wanted.size || [...wanted].some(key => !found.has(key))) {
    return null;
  }

  const wordList = getWordList(verseText);
  const normalized = wordList.map(word => normalizeForCompare(word, languageId));
  const positions = [];

  for (const bottom of matched.flatMap(alignment => alignment.bottomWords || [])) {
    const target = normalizeForCompare(bottom.word, languageId);
    let seen = 0;
    const index = normalized.findIndex(word => word === target && ++seen === (bottom.occurrence || 1));

    if (index < 0) {
      return null;
    }
    positions.push(index);
  }

  const sorted = [...new Set(positions)].sort((a, b) => a - b);

  if (!sorted.length || sorted.length > maxWords) {
    return null;
  }

  const selections = sorted.map(index => ({
    text: wordList[index],
    occurrence: wordList.slice(0, index + 1).filter(word => word === wordList[index]).length,
    occurrences: wordList.filter(word => word === wordList[index]).length,
  }));
  const text = selections
    .map(({ text: word, occurrence }) => (occurrence > 1 ? `${word}:${occurrence}` : word))
    .join(' ');
  return {
    text,
    words: selections.map(selection => selection.text).join(' '),
    selections,
  };
}

/**
 * The original-language words of a check's quote, each with its occurrence in the verse.
 * @param {object} contextId
 * @returns {Array<{word: string, occurrence: number}>|null} - null for a quote that cannot be
 *   placed (a multi-word string quote whose phrase occurrence is above 1)
 */
export function getQuoteWords(contextId) {
  const quote = contextId.quote;

  if (Array.isArray(quote)) {
    return quote.filter(item => item?.word).map(({ word, occurrence }) => ({ word, occurrence: occurrence || 1 }));
  }

  const words = (quote || '').split(/[\s&]+/).filter(Boolean);

  if (words.length === 1) {
    return [{ word: words[0], occurrence: contextId.occurrence || 1 }];
  }

  if ((contextId.occurrence || 1) !== 1) {
    return null;
  }

  const counts = {};
  return words.map(word => {
    counts[word] = (counts[word] || 0) + 1;
    return { word, occurrence: counts[word] };
  });
}

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
    selectionsData: { selections: testCase.history || {} },
    contextId: { ...contextId, occurrence: contextId.occurrence || testCase.occurrence || 1 },
    key,
    llmQueryUrl,
    currentModel,
    llmTemperature,
    llmExtraParams,
    apiToken,
  };
}

/**
 * Runs one case through `getBestSelections` and times the call. The options come from
 * {@link testCaseToSelectionOptions}; only the call itself is timed, not building the options.
 *
 * With no `settings.llmQueryUrl` this is the algorithm path and makes no network call. With one,
 * a case whose algorithm answer is certain (confidence 100) is answered without asking the AI
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
 * @returns {Promise<{results: Array<object>, summary: object}>} the results and summary that were
 *   saved, as {@link runTestCasesFromJson} returns them
 */
export async function runTestCasesFromJsonAndSaveResults(testDataPath, settings = {}) {
  const { results, summary } = await runTestCasesFromJson(testDataPath, settings);

  const baseFileName_ = path.basename(testDataPath, '.json');
  // a model id such as `qwen/qwen3-4b` has characters that cannot be in a file name
  const modelName = settings?.llmQueryUrl ? String(settings.currentModel).replace(/[^\w.-]+/g, '-') : 'Algorithm';
  const baseFileName = `${baseFileName_}_${modelName}`;
  const destFolder = path.join(path.dirname(testDataPath), 'results');
  fs.mkdirSync(destFolder, { recursive: true });

  const resultsPath = path.join(destFolder, `${baseFileName}.results.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  const summaryPath = path.join(destFolder, `${baseFileName}.summary.json`);
  const summaryJson = JSON.stringify(summary, null, 2);
  fs.writeFileSync(summaryPath, summaryJson);

  return { results, summary };
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
  duplicate: 'same verse, GL phrase, history and expected answer as an earlier case in the file',
};

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
 * @returns {Array<{index: number, id: string, reasons: string[], missingFromHistory: string[],
 *   otherFormsInHistory: Array<{word: string, historyWord: string, similarity: number}>,
 *   missingFromVerse: string[], duplicateOf: string|undefined}>} - one element per unhelpful case,
 *   in file order. Expected words are as written in `expected`: `missingFromHistory` are in the
 *   history neither exactly nor as another form, `otherFormsInHistory` are there only as another
 *   form (with the history word matched and its similarity, rounded to 2 places), and
 *   `missingFromVerse` are not in the verse at their occurrence
 * @example
 * findUnhelpfulTrainingCases([{ id: 'a', targetLang: 'ru', verse: 'и Авеля', glPhrase: 'Abel',
 *   history: { Abel: { 'Авель': 1 } }, expected: ['Авеля'] }]);
 * // [{ index: 0, id: 'a', reasons: ['onlyOtherFormsInHistory'], missingFromHistory: [],
 * //    otherFormsInHistory: [{ word: 'Авеля', historyWord: 'Авель', similarity: 0.8 }], ... }]
 */
export function findUnhelpfulTrainingCases(testCases) {
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
        duplicateOf,
      });
    }
  });
  return unhelpful;
}
