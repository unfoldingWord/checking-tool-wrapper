/**
 * Finds the target-language words a translator aligned to a check's original-language quote.
 * Shared by the builders of AI evaluation cases (`buildLlmEvalRealCases.test.js`) and AI training
 * data (`buildLlmTrainingData.test.js`). Also turns a case into the options `getBestSelections`
 * takes (`testCaseToSelectionOptions`), and runs a list of cases through it
 * (`runTestCases`).
 *
 * This folder is in jest's `testPathIgnorePatterns`, so it is not run as a test.
 */
import usfmjs from 'usfm-js';
import {
  getBestSelections, getWordList, normalizeForCompare,
} from '../../src/utils/checkingSuggestionsUtils';
import { isNT } from '../../src/common/booksOfTheBible';
import { NT_ORIG_LANG, OT_ORIG_LANG } from '../../src/common/constants';
import { normalizeString } from '../../src/helpers/stringHelpers';

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
 * Runs each case through `getBestSelections`, one case per call and one after the other, so each
 * time is for that case alone. The options come from {@link testCaseToSelectionOptions}.
 *
 * With no `settings.llmQueryUrl` this is the algorithm path and makes no network call. With one,
 * a case whose algorithm answer is certain (confidence 100) is answered without asking the AI
 * (`result.algorithmFirst`), as in the app.
 * @param {Array<object>} testCases - cases, e.g. the contents of
 *   `llmTrainingData/vi_glt_luk_book_ru_gl_ru.json` (see {@link testCaseToSelectionOptions})
 * @param {object} [settings] - suggestion settings, passed to {@link testCaseToSelectionOptions}
 * @returns {Promise<Array<{id: string, result: object, elapsedMs: number}>>} - one element per
 *   case, in the same order:
 *   - **id**: the case's `id`
 *   - **result**: what `getBestSelections` returned for the case: `{error, bestSelections,
 *     elapsedStr, model}`, where `bestSelections` is up to 3 `{selections: [{text, occurrence}],
 *     confidence}`, best first; `{error: true}` when it failed
 *   - **elapsedMs**: how long the `getBestSelections` call took, in milliseconds
 * @example
 * const testCases = JSON.parse(fs.readFileSync('llmTrainingData/vi_glt_luk_book_ru_gl_ru.json', 'utf8'));
 * const results = await runTestCases(testCases);
 * // [{ id: 'train-vi-luk-1-73-abraham', result: { error: false, bestSelections: [...], ... }, elapsedMs: 1.84 }, ...]
 */
export async function runTestCases(testCases, settings = {}) {
  const results = [];

  for (const testCase of testCases || []) {
    const options = testCaseToSelectionOptions(testCase, settings);
    const start = process.hrtime.bigint();
    // eslint-disable-next-line no-await-in-loop
    const [result] = await getBestSelections(options);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    results.push({
      id: testCase.id, result, elapsedMs,
    });
  }
  return results;
}
