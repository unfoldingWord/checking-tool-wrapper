/**
 * Reading a project's word alignments for translationWords suggestions
 * (`plans/alignment-history.md`):
 *  - `getVerseAlignments` reads one verse's alignments from
 *    `.apps/translationCore/alignmentData/<book>/<chapter>.json`, caching the chapter files;
 *  - `getQuoteWords` gives the original-language words of a check's quote, each with its
 *    occurrence;
 *  - `getAlignedTargetWords` finds the target words a translator aligned to that quote;
 *  - `fetchAlignmentHistoryEntries` gathers those words for every check of a group in the
 *    projects with the current target language and resource id, `getSuggestionHistory` adds them
 *    to the selection history for one check (leaving out its own verse), and
 *    `updateAlignmentEntrySelection` keeps a check from being counted twice when the user saves
 *    a selection for it.
 *
 * They were test helpers used to build the AI training data and evaluation cases; the training
 * data builder and `__tests__/helpers/suggestionsHelpers.js` now use these.
 */
import fs from 'fs-extra';
import path from 'path-extra';
import { isBibleBookId, isNT } from '../common/booksOfTheBible';
import { NT_ORIG_LANG, OT_ORIG_LANG } from '../common/constants';
import { getQuoteAsString } from '../helpers/checkAreaHelpers';
import { getDetailsFromProjectNameMini, readJsonFile } from '../helpers/fileHelpers';
import { getAlignedTextFromBible } from '../helpers/gatewayLanguageHelpers';
import {
  cleanGlQuote,
  getFirstGlBibleId,
  getProjectInfo,
  getSelectionHistoryKey,
  getWordList,
  loadGlBookForSuggestions,
  normalizeForCompare,
  resetGlBiblesCacheForProject,
} from './checkingSuggestionsUtils';

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

/**
 * One check's contribution to the alignment history of its group.
 * @typedef {object} AlignmentHistoryEntry
 * @property {string} key - from {@link getAlignmentCheckKey}
 * @property {string} projectName - project folder name
 * @property {string} bookId
 * @property {number|string} chapter
 * @property {number|string} verse
 * @property {string} glPhrase - the gateway-language text aligned to the check's quote, cleaned
 *   as the selection history keys are (`cleanGlQuote`)
 * @property {string} words - the target words, joined by spaces and lowercased as a history
 *   rendering (`getSelectionHistoryKey`)
 * @property {'alignment'|'selection'} source - `selection` for a saved selection in a project the
 *   selection history leaves out (another testament), else `alignment`
 * @property {boolean} hasSelection - the check has a saved selection that the selection history
 *   already counts, so this entry is not added (a saved selection wins over an alignment)
 */

/**
 * Identifies a check of a project, for finding its alignment history entry again.
 * @param {string} projectName - project folder name
 * @param {object} contextId - the check's context
 * @returns {string}
 */
export function getAlignmentCheckKey(projectName, contextId) {
  const {
    bookId, chapter, verse,
  } = contextId?.reference || {};
  const quote = contextId?.quoteString || getQuoteAsString(contextId?.quote);
  return [projectName, contextId?.groupId, bookId, chapter, verse, contextId?.checkId, quote,
    contextId?.occurrence].join('|');
}

/**
 * Makes the alignment history entries for one project's checks of a group.
 * @param {Array<{contextId: object, selections: Array|false}>} checks - the project's checks of
 *   the group, from `.apps/translationCore/index/<tool>/<book>/<groupId>.json`
 * @param {object} options
 * @param {string} options.projectName - project folder name
 * @param {object} options.glBook - the gateway-language bible book, for each check's GL phrase
 * @param {string} options.languageId - target language id
 * @param {function(object): string} options.readVerseText - gives the target verse text for a
 *   reference
 * @param {function(object): (Array|null)} options.readAlignments - gives the verse's alignments
 *   for a reference
 * @param {boolean} options.selectionsCounted - the selection history already counts this
 *   project's saved selections (`fetchPreviousSelectionData` reads only projects of the same
 *   testament)
 * @returns {Array<AlignmentHistoryEntry>} - one entry per check with a GL phrase and either
 *   aligned target words or a saved selection the selection history leaves out
 */
export function getAlignmentEntriesForChecks(checks, {
  projectName, glBook, languageId, readVerseText, readAlignments, selectionsCounted,
}) {
  const entries = [];

  for (const check of checks || []) {
    const contextId = check?.contextId;

    if (!contextId?.reference) {
      continue;
    }

    const glText = getAlignedTextFromBible(contextId, glBook);
    const glPhrase = glText ? cleanGlQuote(glText) : '';

    if (!glPhrase) {
      continue;
    }

    const selected = Array.isArray(check.selections) && check.selections.length ?
      check.selections.map(word => word?.text).join(' ') : '';
    let words = '';
    let source = 'alignment';

    if (selected && !selectionsCounted) {
      words = selected;
      source = 'selection';
    } else {
      const verseText = readVerseText(contextId.reference);
      const alignments = verseText ? readAlignments(contextId.reference) : null;
      words = alignments ? getAlignedTargetWords(contextId, verseText, alignments, languageId)?.words || '' : '';
    }

    if (words) {
      const {
        bookId, chapter, verse,
      } = contextId.reference;
      // counted as the selection history counts renderings (lowercased)
      words = getSelectionHistoryKey(words, languageId);

      entries.push({
        key: getAlignmentCheckKey(projectName, contextId),
        projectName,
        bookId,
        chapter,
        verse,
        glPhrase,
        words,
        source,
        hasSelection: !!selected && selectionsCounted,
      });
    }
  }
  return entries;
}

/**
 * Gathers the alignment history of a group: for every check of `groupId` in the projects with
 * the current project's target language and resource id (from the project folder names, as for
 * the selection history), the target words aligned to the check's quote, keyed by the
 * gateway-language text aligned to it (plans/alignment-history.md, Step 2). The current project
 * is included. Checks whose quote is not aligned, or is aligned together with other original
 * words, are left out.
 * @param {string} projectSaveLocation - path to the current project folder
 * @param {object} glBibles - available gateway-language bibles keyed by bible id
 * @param {string} toolName - e.g. 'translationWords'
 * @param {string} groupId - e.g. 'faith'
 * @param {string} gatewayLanguageCode - e.g. 'en'
 * @param {string} glOwnerStr - owner of the gateway-language bible
 * @param {object} glBiblesCache - see `fetchPreviousSelectionData`; changed in place
 * @param {object} [options]
 * @param {boolean} [options.allTestaments=true] - false keeps only projects of the current
 *   project's testament, as the selection history does
 * @param {function} [options.loadGlBook=loadGlBookForSuggestions] - loads a GL bible book
 * @returns {Array<AlignmentHistoryEntry>}
 */
export function fetchAlignmentHistoryEntries(
  projectSaveLocation,
  glBibles,
  toolName,
  groupId,
  gatewayLanguageCode,
  glOwnerStr,
  glBiblesCache,
  { allTestaments = true, loadGlBook = loadGlBookForSuggestions } = {},
) {
  const {
    projectsFolder, currentBookId, currentLanguageId, currentResourceId,
  } = getProjectInfo(projectSaveLocation);
  resetGlBiblesCacheForProject(glBiblesCache, currentLanguageId, currentResourceId);
  const glBibleId = getFirstGlBibleId(glBibles);
  const usingNT = isNT(currentBookId);
  const entries = [];

  if (!glBibleId || !fs.existsSync(projectsFolder)) {
    return entries;
  }

  for (const projectName of fs.readdirSync(projectsFolder)) {
    const {
      bookId, languageId, resourceId,
    } = getDetailsFromProjectNameMini(projectName);

    if (!isBibleBookId(bookId) || languageId !== currentLanguageId || resourceId !== currentResourceId) {
      continue;
    }

    const sameTestament = isNT(bookId) === usingNT;

    if (!allTestaments && !sameTestament) {
      continue;
    }

    const projectPath = path.join(projectsFolder, projectName);
    const checks = readJsonFile(path.join(projectPath, '.apps', 'translationCore', 'index', toolName, bookId, `${groupId}.json`));

    if (!checks?.length) {
      continue;
    }

    const glBook = loadGlBook(projectsFolder, bookId, glBibleId, gatewayLanguageCode, glOwnerStr, glBiblesCache);

    if (!glBook) {
      continue;
    }

    const verseChapters = {};
    const alignmentChapters = {};

    const readVerseText = ({ chapter, verse }) => {
      if (!(chapter in verseChapters)) {
        verseChapters[chapter] = readJsonFile(path.join(projectPath, bookId, `${chapter}.json`)) || {};
      }

      const text = verseChapters[chapter][verse];
      return typeof text === 'string' ? text.trim() : '';
    };

    entries.push(...getAlignmentEntriesForChecks(checks, {
      projectName,
      glBook,
      languageId,
      readVerseText,
      readAlignments: reference => getVerseAlignments(projectPath, bookId, reference, alignmentChapters),
      selectionsCounted: sameTestament,
    }));
  }
  return entries;
}

/**
 * The history for one check: the selection history plus the alignment history entries, each
 * counted once, leaving out entries of the check's own verse in the current project (its
 * alignment is the answer) and checks whose saved selection the selection history already
 * counts.
 * @param {Object<string, Object<string, number>>} selections - selection history,
 *   `{ glPhrase: { targetText: count } }`; not changed
 * @param {Array<AlignmentHistoryEntry>|null} alignmentEntries - from
 *   {@link fetchAlignmentHistoryEntries}
 * @param {string} projectName - the current project folder name
 * @param {object} contextId - the check the history is for
 * @returns {Object<string, Object<string, number>>} - `selections` itself when there are no
 *   entries, else a new object
 */
export function getSuggestionHistory(selections, alignmentEntries, projectName, contextId) {
  if (!alignmentEntries?.length) {
    return selections;
  }

  const {
    bookId, chapter, verse,
  } = contextId?.reference || {};
  const merged = {};

  for (const [glPhrase, renderings] of Object.entries(selections || {})) {
    merged[glPhrase] = { ...renderings };
  }

  for (const entry of alignmentEntries) {
    const ownVerse = entry.projectName === projectName && entry.bookId === bookId &&
      String(entry.chapter) === String(chapter) && String(entry.verse) === String(verse);

    if (entry.hasSelection || ownVerse || !entry.words || !entry.glPhrase) {
      continue;
    }

    const renderings = merged[entry.glPhrase] || (merged[entry.glPhrase] = {});
    renderings[entry.words] = (renderings[entry.words] || 0) + 1;
  }
  return merged;
}

/**
 * Records that a check of the current project has, or no longer has, a saved selection, so its
 * alignment is not counted along with the selection (or comes back when the selection is
 * cleared).
 * @param {Array<AlignmentHistoryEntry>|null} alignmentEntries - changed in place
 * @param {string} projectName - the current project folder name
 * @param {object} contextId - the changed check
 * @param {Array} newSelections - the check's selections after the change
 * @returns {boolean} - whether an entry was found
 */
export function updateAlignmentEntrySelection(alignmentEntries, projectName, contextId, newSelections) {
  const key = getAlignmentCheckKey(projectName, contextId);
  const entry = (alignmentEntries || []).find(item => item.key === key && item.source === 'alignment');

  if (entry) {
    entry.hasSelection = !!newSelections?.length;
  }
  return !!entry;
}
