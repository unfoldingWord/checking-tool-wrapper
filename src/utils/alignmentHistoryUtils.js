/**
 * Reading a project's word alignments for translationWords suggestions
 * (`plans/alignment-history.md`):
 *  - `getVerseAlignments` reads one verse's alignments from
 *    `.apps/translationCore/alignmentData/<book>/<chapter>.json`, caching the chapter files;
 *  - `getQuoteWords` gives the original-language words of a check's quote, each with its
 *    occurrence;
 *  - `getAlignedTargetWords` finds the target words a translator aligned to that quote.
 *
 * They were test helpers used to build the AI training data and evaluation cases; the training
 * data builder and `__tests__/helpers/suggestionsHelpers.js` now use these.
 */
import path from 'path-extra';
import { isNT } from '../common/booksOfTheBible';
import { NT_ORIG_LANG, OT_ORIG_LANG } from '../common/constants';
import { readJsonFile } from '../helpers/fileHelpers';
import { getWordList, normalizeForCompare } from './checkingSuggestionsUtils';

/**
 * Path of a chapter's alignment data in a project.
 * @param {string} projectPath - project folder
 * @param {string} bookId - e.g. 'tit'
 * @param {number|string} chapter
 * @returns {string} - `<project>/.apps/translationCore/alignmentData/<book>/<chapter>.json`
 */
export function getAlignmentChapterPath(projectPath, bookId, chapter) {
  return path.join(projectPath, '.apps', 'translationCore', 'alignmentData', bookId, `${chapter}.json`);
}

/**
 * Reads one verse's word alignments from a project, caching the chapter files.
 * @param {string} projectPath - project folder
 * @param {string} bookId - e.g. 'tit'
 * @param {{chapter: number|string, verse: number|string}} reference
 * @param {object} chapters - cache of this book's alignment chapter files by chapter, changed in
 *   place (a chapter with no file is cached as `{}`)
 * @param {function(string): (object|null)} [readJson=readJsonFile] - reads a JSON file, or gives
 *   null when it is missing; the training data builders pass a reader that uses Node's `fs`,
 *   since `fs-extra` is mocked under jest
 * @returns {Array<{topWords: Array, bottomWords: Array}>|null} - the verse's alignments, or null
 *   when the chapter or verse has none
 */
export function getVerseAlignments(projectPath, bookId, { chapter, verse }, chapters, readJson = readJsonFile) {
  if (!(chapter in chapters)) {
    chapters[chapter] = readJson(getAlignmentChapterPath(projectPath, bookId, chapter)) || {};
  }
  return chapters[chapter][verse]?.alignments || null;
}

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
