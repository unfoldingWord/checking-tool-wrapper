/**
 * Original-language (OL) keys for the suggestion history (plans/original-language-history.md).
 *
 * A check's quote is OL text (Greek or Hebrew, as written in the verse). The OL bible (`ugnt`,
 * `uhb`) gives each word its lemma, Strong's number and morphology. These helpers find the
 * quote's words in a verse of the OL bible and make the keys a history can be counted under:
 *  - the **lemma key**, the main key: the quote's lemmas, lowercased, joined by spaces
 *    (e.g. 'πίστις'), the same for every form of the word;
 *  - the **form key**, the finer key: the quote's words as written, lowercased, without accents or
 *    word joiners (e.g. 'πιστεως'), so different forms of a lemma differ.
 * Strong's numbers are kept with the words, for telling apart lemmas spelled alike.
 *
 * Nothing here looks at the target language, except that a history rendering is lowercased as the
 * GL-keyed history's renderings are (`getSelectionHistoryKey`).
 *
 * In the app (Step 3), {@link countOlSelections} tallies the checks of every project the selection
 * history reads, by both keys, through the `onBookChecks` hook of `fetchPreviousSelectionData`. The
 * tally is counted even for books whose GL bible is missing, which the GL-keyed history must skip
 * (Step 4 of the plan). {@link getOlHistoryForCheck} gives the algorithm its `olHistory` option.
 */
import path from 'path-extra';
import { isNT } from '../common/booksOfTheBible';
import {
  NT_ORIG_LANG, NT_ORIG_LANG_BIBLE, OT_ORIG_LANG, OT_ORIG_LANG_BIBLE,
} from '../common/constants';
import { getMostRecentVersionInFolderMajor, readHelpsFolder } from '../helpers/fileHelpers';
import { getQuoteWords } from './alignmentHistoryUtils';
import {
  getSelectionHistoryKey, normalizeForCompare, toLowerCaseForLang,
} from './checkingSuggestionsUtils';

/** owner of the OL bibles read for the history */
export const OL_BIBLE_OWNER = 'unfoldingWord';

/** U+2060 WORD JOINER, which the Hebrew bible puts between a prefix or suffix and its word */
const WORD_JOINER = /⁠/g;
/** combining marks: Greek accents and breathings, Hebrew vowel points and cantillation */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * The OL language of a book: Greek for the New Testament, Hebrew for the Old.
 * @param {string} bookId
 * @returns {string} - `NT_ORIG_LANG` or `OT_ORIG_LANG`
 */
export function getOrigLangId(bookId) {
  return isNT(bookId) ? NT_ORIG_LANG : OT_ORIG_LANG;
}

/**
 * The words of an OL verse in order, with nested objects (milestones) opened.
 * @param {Array<object>} verseObjects - a verse of the OL bible
 * @returns {Array<{text: string, strong: string, lemma: string, morph: string}>}
 */
export function getOlVerseWords(verseObjects) {
  const words = [];

  const walk = objects => {
    for (const object of objects || []) {
      if (object?.type === 'word' && object.text) {
        words.push(object);
      }

      if (object?.children) {
        walk(object.children);
      }
    }
  };

  walk(verseObjects);
  return words;
}

/**
 * An OL word as compared loosely: lowercased, without word joiners or combining marks.
 * @param {string} word
 * @param {string} origLangId
 * @returns {string}
 */
export function getLooseOlForm(word, origLangId) {
  return toLowerCaseForLang((word || '').normalize('NFD').replace(WORD_JOINER, '').replace(COMBINING_MARKS, ''), origLangId)
    .normalize('NFC');
}

/**
 * Finds the words of a check's quote in its verse of the OL bible. Each quote word is matched
 * with its occurrence: first as written (after `normalizeForCompare`), then loosely
 * ({@link getLooseOlForm}), since a project's quote can come from another version of the OL bible
 * than the one at hand, with other accents or word joiners.
 * @param {object} contextId - the check's context; `quote` is a string or `[{word, occurrence}]`
 * @param {Array<object>} verseObjects - the check's verse in the OL bible
 * @returns {Array<{word: string, occurrence: number, lemma: string, strong: string,
 *   morph: string}>|null} - in quote order; null when the quote cannot be placed or a word is not
 *   found in the verse
 */
export function getQuoteOlWords(contextId, verseObjects) {
  const quoteWords = contextId && getQuoteWords(contextId);
  const verseWords = getOlVerseWords(verseObjects);

  if (!quoteWords?.length || !verseWords.length) {
    return null;
  }

  const origLangId = getOrigLangId(contextId.reference?.bookId);
  const exact = word => normalizeForCompare(word, origLangId);
  const loose = word => getLooseOlForm(word, origLangId);
  const found = [];

  for (const { word, occurrence } of quoteWords) {
    const match = findNth(verseWords, word, occurrence, exact) || findNth(verseWords, word, occurrence, loose);

    if (!match) {
      return null;
    }
    found.push({
      word, occurrence, lemma: match.lemma || '', strong: match.strong || '', morph: match.morph || '',
    });
  }
  return found;
}

/**
 * The `occurrence`th verse word equal to `word` under `toKey`.
 * @param {Array<{text: string}>} verseWords
 * @param {string} word
 * @param {number} occurrence - 1-based
 * @param {function(string): string} toKey
 * @returns {object|undefined}
 */
function findNth(verseWords, word, occurrence, toKey) {
  const wanted = toKey(word);
  let seen = 0;
  return verseWords.find(verseWord => toKey(verseWord.text) === wanted && ++seen === (occurrence || 1));
}

/**
 * A Strong's number without its Hebrew prefixes: 'b:H3117' → 'H3117', 'c:d:H0776' → 'H0776'.
 * @param {string} strong
 * @returns {string}
 */
export function getBaseStrong(strong) {
  return (strong || '').split(':').pop();
}

/**
 * The history keys of a check's OL words.
 * @param {Array<{word: string, lemma: string}>|null} olWords - from {@link getQuoteOlWords}
 * @param {string} bookId - for the OL language
 * @returns {{lemma: string, form: string}|null} - `lemma`: the lemmas, lowercased, joined by
 *   spaces (a word without a lemma uses its loose form); `form`: the words' loose forms joined by
 *   spaces; null without words
 * @example
 * getOlKeys([{ word: 'Θεοῦ', lemma: 'θεός' }], 'tit'); // { lemma: 'θεός', form: 'θεου' }
 */
export function getOlKeys(olWords, bookId) {
  if (!olWords?.length) {
    return null;
  }

  const origLangId = getOrigLangId(bookId);
  return {
    lemma: olWords.map(({ word, lemma }) => (lemma ? toLowerCaseForLang(lemma, origLangId) : getLooseOlForm(word, origLangId))).join(' '),
    form: olWords.map(({ word }) => getLooseOlForm(word, origLangId)).join(' '),
  };
}

/**
 * Loads one book of the newest unfoldingWord OL bible (`ugnt` for the New Testament, `uhb` for the
 * Old) from the resources folder next to the projects folder, using and filling `olBooksCache`.
 * @param {string} projectsFolder - the translationCore projects folder
 * @param {string} bookId - e.g. 'tit'
 * @param {Object<string, object|null>} olBooksCache - books by id, changed in place; a missing book
 *   is cached as null
 * @returns {object|null} - the book keyed by chapter then verse, or null when not found
 */
export function loadOlBookForSuggestions(projectsFolder, bookId, olBooksCache) {
  if (!(bookId in olBooksCache)) {
    const origLangId = getOrigLangId(bookId);
    const bibleId = origLangId === NT_ORIG_LANG ? NT_ORIG_LANG_BIBLE : OT_ORIG_LANG_BIBLE;
    const bibleFolder = path.join(projectsFolder, '../resources', origLangId, 'bibles', bibleId);
    const version = getMostRecentVersionInFolderMajor(bibleFolder, OL_BIBLE_OWNER);
    olBooksCache[bookId] = (version && readHelpsFolder(path.join(bibleFolder, version, bookId))) || null;
  }
  return olBooksCache[bookId];
}

/**
 * The history keys of a check, from its quote and its verse in the OL bible.
 * @param {object} contextId - the check's context
 * @param {object|null} olBook - the check's book of the OL bible, keyed by chapter then verse
 * @returns {{lemma: string, form: string}|null} - see {@link getOlKeys}; null when the verse or a
 *   quote word is not found
 */
export function getCheckOlKeys(contextId, olBook) {
  const {
    bookId, chapter, verse,
  } = contextId?.reference || {};
  const verseObjects = olBook?.[chapter]?.[verse]?.verseObjects;
  return verseObjects ? getOlKeys(getQuoteOlWords(contextId, verseObjects), bookId) : null;
}

/**
 * An empty OL-keyed tally.
 * @returns {{lemma: object, form: object}}
 */
export function newOlSelections() {
  return { lemma: {}, form: {} };
}

/**
 * Adds the selections of a book's checks to an OL-keyed tally, as `getSelectionsForBook` adds them to
 * the GL-keyed one: the rendering is the selected words joined by spaces and lowercased with
 * `getSelectionHistoryKey` (a check whose `selections` is an empty array counts under `''`).
 * @param {Array<{contextId: object, selections: Array<{text: string}>}>|null} checks - the checks of
 *   one group in one book
 * @param {object|null} olBook - that book of the OL bible
 * @param {{lemma: Object<string, Object<string, number>>, form: Object<string, Object<string, number>>}}
 *   olSelections - `{ olKey: { rendering: count } }` by lemma key and by form key; changed in place
 * @param {string} targetLangId - for lowercasing the renderings
 * @returns {number} - how many checks were counted
 */
export function countOlSelections(checks, olBook, olSelections, targetLangId) {
  let counted = 0;

  for (const check of checks || []) {
    const keys = check?.selections && getCheckOlKeys(check.contextId, olBook);

    if (keys) {
      const rendering = getSelectionHistoryKey(check.selections.map(word => word?.text).join(' '), targetLangId);
      addCount(olSelections.lemma, keys.lemma, rendering);
      addCount(olSelections.form, keys.form, rendering);
      counted++;
    }
  }
  return counted;
}

function addCount(tally, key, rendering) {
  tally[key] = tally[key] || {};
  tally[key][rendering] = (tally[key][rendering] || 0) + 1;
}

/**
 * The `olHistory` option of `getBestTWordSelectionWithConfidenceAlgorithm` for one check.
 * @param {{lemma: object, form: object}|null} olSelections - from {@link countOlSelections}
 * @param {object} contextId - the check's context
 * @param {object|null} olBook - the check's book of the OL bible
 * @returns {{lemma: object, form: object, keys: {lemma: string, form: string}}|null} - null without
 *   a tally or when the check's quote is not found in the OL bible
 */
export function getOlHistoryForCheck(olSelections, contextId, olBook) {
  const keys = olSelections && getCheckOlKeys(contextId, olBook);
  return keys ? {
    lemma: olSelections.lemma, form: olSelections.form, keys,
  } : null;
}
