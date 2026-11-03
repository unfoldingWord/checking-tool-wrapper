/* eslint-disable no-nested-ternary */
import { getAlignedText } from 'tc-ui-toolkit';
import { getVerses } from 'bible-reference-range';
import _ from 'lodash';

/**
 * Identifies one check in a checking tool. The same shape is used for the current check
 * (`state.tool.contextId`) and for the `contextId` saved with each check record in
 * `.apps/translationCore/index/{toolName}/{bookId}/{groupId}.json`.
 * The same typedef is in `src/utils/autoCheckingUtils.js`; keep both in sync.
 *
 * The functions in this file only read `reference`, `quote` and `occurrence`.
 *
 * @typedef {object} ContextId
 * @property {object} reference - where the check is
 * @property {string} reference.bookId - book id (e.g. 'tit')
 * @property {number|string} reference.chapter - chapter number; sometimes saved as a string
 *   (e.g. '12')
 * @property {number|string} reference.verse - verse number. It can also be a string: a number
 *   (e.g. '1'), 'front' for a chapter introduction, or a verse range (e.g. '3-4')
 * @property {string} tool - checking tool name (e.g. 'translationWords', 'translationNotes')
 * @property {string} groupId - check group id: a translationWords entry (e.g. 'humble') or a
 *   translationNotes category (e.g. 'figs-metaphor')
 * @property {string} [checkId] - short id of the check from the helps TSV (e.g. 'xrq8')
 * @property {string|Array<{word: string, occurrence: number}>} [quote] - original-language
 *   words being checked. translationWords usually uses a single string (e.g. 'πραΰτητα').
 *   translationNotes usually uses an array of words, each with its occurrence in the verse,
 *   including separators such as '־'.
 * @property {string} [quoteString] - `quote` as a single string
 * @property {number} [occurrence] - which occurrence of `quote` in the verse this check is for
 *   (1-based)
 * @property {string} [glQuote] - gateway-language quote from the helps TSV; often `''`
 * @property {string} [occurrenceNote] - note text for this check (translationNotes); `''` for
 *   translationWords
 * @property {string} [verseSpan] - verse range when the check spans verses (e.g. '3-4'); same
 *   as `reference.verse`
 * @example
 * // translationWords
 * {
 *   checkId: 'xrq8',
 *   occurrenceNote: '',
 *   reference: { bookId: 'tit', chapter: 3, verse: 2 },
 *   tool: 'translationWords',
 *   groupId: 'humble',
 *   quote: 'πραΰτητα',
 *   quoteString: 'πραΰτητα',
 *   glQuote: '',
 *   occurrence: 1,
 * }
 * @example
 * // translationNotes, spanning two verses
 * {
 *   checkId: 'whh9',
 *   occurrenceNote: 'If it would be more natural in your language, ...',
 *   reference: { bookId: 'jos', chapter: 3, verse: '3-4' },
 *   tool: 'translationNotes',
 *   groupId: 'figs-infostructure',
 *   quote: [{ word: 'אַֽל', occurrence: 1 }, { word: '־', occurrence: 1 }, ...],
 *   quoteString: '...',
 *   glQuote: '',
 *   occurrence: 1,
 *   verseSpan: '3-4',
 * }
 */

/**
 * Looks up the gateway-language text aligned to the current check and returns it together with
 * the gateway language code. This wraps {@link getAlignedGLTextHelper}.
 * @param {string} gatewayLanguageCode - gateway language code (e.g. 'en'); returned unchanged
 *   and used to pick matching entries in `tsvRelation`
 * @param {ContextId} contextId - context of the current check
 * @param {Object<string, object>} glBibles - gateway-language bibles keyed by bible id
 *   (e.g. `{ult: {...}, ust: {...}}`)
 * @param {Array<string>|null} tsvRelation - `relation` list from the helps resource manifest
 *   (e.g. `['en/tw', 'en/ult?v=45', 'hbo/uhb?v=2.1.30']`); see {@link getAlignedGLTextHelperMajor}
 * @return {{gatewayLanguageCode: string, gatewayLanguageQuote: string}}
 *   - **gatewayLanguageCode**: the `gatewayLanguageCode` argument, unchanged
 *   - **gatewayLanguageQuote**: the aligned gateway-language text, the original-language quote if
 *     there are no gateway-language bibles, or `''` if nothing was found
 * @example
 * getGatewayLanguageCodeAndQuote('en', contextId, glBibles, ['en/ult']);
 * // Returns: { gatewayLanguageCode: 'en', gatewayLanguageQuote: 'faith' }
 */
export const getGatewayLanguageCodeAndQuote = (gatewayLanguageCode, contextId, glBibles, tsvRelation) => {
  const gatewayLanguageQuote = getAlignedGLTextHelper(contextId, glBibles, gatewayLanguageCode, tsvRelation);

  return {
    gatewayLanguageCode,
    gatewayLanguageQuote,
  };
};

/**
 * Finds the gateway-language text aligned to the original-language quote of a check, and reports
 * which gateway-language bible it came from.
 *
 * Search order:
 * 1. If `contextId.quote` is set but `glBibles` is missing or empty, the original-language quote
 *    itself is returned as `alignedText` and no bible is searched.
 * 2. Each `tsvRelation` entry of the form `{glID}/{bibleId}` (an optional `?v=...` suffix is
 *    ignored) is tried in list order, using `glBibles[bibleId]` if present.
 * 3. If nothing was found, every bible in `glBibles` is tried in {@link bibleIdSort} order
 *    (glt, irv, ult, ulb, then any others alphabetically).
 *
 * The first bible that gives non-empty text wins (see {@link getAlignedTextFromBible}).
 *
 * @param {ContextId} contextId - context of the current check. Must not be null. Uses
 *   `reference`, `quote` and `occurrence`; if `quote` is missing or empty, see case 1 above.
 * @param {Object<string, object>|null} glBibles - gateway-language bibles keyed by bible id
 *   (e.g. `{ult: {...}, ust: {...}}`); each value is book data keyed by chapter then verse.
 *   If `contextId.quote` is empty, this must not be null, or `Object.keys()` will throw.
 * @param {Array<string>|null} tsvRelation - `relation` list from the helps resource manifest,
 *   giving the preferred bibles (e.g. `['en/tw', 'en/ult?v=45', 'hbo/uhb?v=2.1.30']`). Entries for
 *   other languages, or with more or fewer than one `/`, are skipped.
 * @param {string} glID - gateway language code (e.g. 'en', 'es-419'), matched against the part of
 *   each `tsvRelation` entry before the `/`
 * @return {{alignedText: string, bibleId: string|null, bible: object|null}}
 *   - **alignedText**: the aligned gateway-language text; the original-language quote in case 1
 *     above; or `''` (or possibly `undefined`) if no bible gave any text
 *   - **bibleId**: id of the bible that gave `alignedText`. `null` in case 1. If no bible gave any
 *     text, this is the *last* bible id tried, not `null`, so check `alignedText` first.
 *   - **bible**: the book data for `bibleId` (`glBibles[bibleId]`), with the same caveats as `bibleId`
 * @example
 * const { alignedText, bibleId } = getAlignedGLTextHelperMajor(
 *   { reference: { bookId: 'gal', chapter: 2, verse: 16 }, quote: 'πίστεως', occurrence: 1 },
 *   { ult: ultGal, ust: ustGal },
 *   ['en/tw', 'en/ult?v=45'],
 *   'en',
 * );
 * // alignedText: 'faith', bibleId: 'ult'
 */
export function getAlignedGLTextHelperMajor(contextId, glBibles, tsvRelation, glID) {
  let bible = null;
  let alignedText = '';
  let bibleId = null;

  if (!contextId.quote || !glBibles || !Object.keys(glBibles).length) {
    alignedText = contextId.quote || '';
  }

  if (!alignedText) { // if no match, check TSV relations in order
    if (Array.isArray(tsvRelation)) {
      // look for GL text in TSV relations
      for (let relation of tsvRelation) {
        const parts = relation.split('/');

        if (parts.length === 2 && parts[0] === glID) {
          // make sure it is for same gl and has the expected number of levels
          bibleId = parts[1];
          bibleId = bibleId.split('?')[0];
          bible = glBibles[bibleId];

          if (bible) {
            // if bible present, see if we can find GL text
            alignedText = getAlignedTextFromBible(contextId, bible);

            if (alignedText) { // we succeeded and we are done
              break;
            }
          }
        }
      }
    }
  }

  if (!alignedText) { // if no match, check aligned text in any glBible
    // fall back to searching for GL text in default priority
    const sortedBibleIds = Object.keys(glBibles).sort(bibleIdSort);

    for (let i = 0; i < sortedBibleIds.length; ++i) {
      bibleId = sortedBibleIds[i];
      bible = glBibles[bibleId];
      alignedText = getAlignedTextFromBible(contextId, bible);

      if (alignedText) { // we succeeded and we are done
        break;
      }
    }
  }
  return {
    alignedText, bibleId, bible,
  };
}

/**
 * Returns just the aligned gateway-language text for a check. This is a null-safe wrapper around
 * {@link getAlignedGLTextHelperMajor}, which has the full search order. Note the different
 * argument order: here `glID` comes before `tsvRelation`.
 * @param {ContextId|null} contextId - context of the current check (uses `reference`, `quote`,
 *   `occurrence`); if null, `''` is returned
 * @param {Object<string, object>|null} glBibles - gateway-language bibles keyed by bible id
 * @param {string} [glID=''] - gateway language code (e.g. 'en'), used to match `tsvRelation` entries
 * @param {Array<string>|null} [tsvRelation=null] - `relation` list from the helps resource manifest
 *   (e.g. `['en/tw', 'en/ult?v=45']`)
 * @return {string} the aligned gateway-language text; the original-language quote if there are no
 *   gateway-language bibles; or `''` if nothing was found. Never `undefined`.
 */
export function getAlignedGLTextHelper(contextId, glBibles, glID = '', tsvRelation = null) {
  let alignedText = '';

  if (contextId) {
    const __ret = getAlignedGLTextHelperMajor(
      contextId,
      glBibles,
      tsvRelation,
      glID
    );
    alignedText = __ret.alignedText;
  }

  return alignedText || '';
}

/**
 * Comparator for `Array.prototype.sort()` that orders gateway-language bible ids by preference.
 * The resulting order is 'glt', 'irv', 'ult', 'ulb', then any other ids in alphabetical order.
 * @param {string} a - first bible id (e.g. 'ult')
 * @param {string} b - second bible id
 * @return {number} negative if `a` should come first, positive if `b` should come first, `0` if
 *   they are the same
 * @example
 * ['ust', 'ulb', 'ult', 'glt'].sort(bibleIdSort);
 * // Returns: ['glt', 'ult', 'ulb', 'ust']
 */
export function bibleIdSort(a, b) {
  const biblePrecedence = ['ulb', 'ult', 'irv', 'glt']; // TRICKY: we search in this order if more than one aligned Bible for GL, the last in this list is the first checked

  if (biblePrecedence.indexOf(a) === biblePrecedence.indexOf(b)) {
    return (a < b ? -1 : a > b ? 1 : 0);
  } else {
    return biblePrecedence.indexOf(b) - biblePrecedence.indexOf(a);
  } // this plays off the fact other Bible IDs will be -1
}

/**
 * For a multi-verse reference (e.g. 'gal 2:16-17'), renumbers the `occurrence` of each aligned
 * original-language word so that numbering continues across verses instead of restarting at 1 in
 * each verse. This lets a quote's `occurrence` be matched against the joined verses.
 *
 * Only alignment milestones (`tag === 'zaln'`) are changed, recursing into their `children`.
 * Does nothing if `multiVerse` is false.
 *
 * Changes `verseObjects` and `currentVerseCounts` in place; the caller should pass a deep copy
 * of the bible's verse objects.
 * @param {Array<object>|null} verseObjects - USFM verse objects for one verse
 * @param {number} verseCnt - 0-based position of this verse in the range; each milestone gets
 *   `vo.verseCnt` set to this value
 * @param {boolean} multiVerse - true if the reference covers more than one verse
 * @param {Object<string, number>} currentVerseCounts - running total of occurrences per
 *   original-language word up to and including this verse; filled in by this function
 * @param {Object<string, number>} previousVerseWordCounts - the same totals up to and including the
 *   previous verse (`{}` for the first verse); added to each milestone's `occurrence`
 * @return {void}
 */
function updateOriginalWordsOccurrence(verseObjects, verseCnt, multiVerse, currentVerseCounts, previousVerseWordCounts) {
  if (verseObjects) {
    for (const vo of verseObjects) {
      if ( multiVerse && (vo?.tag === 'zaln')) {
        vo.verseCnt = verseCnt;
        const origWord = vo?.content;

        if (origWord) {
          const previousCount = previousVerseWordCounts[origWord] || 0;
          const currentCount = currentVerseCounts[origWord] || 0;

          if (!currentCount) {
            currentVerseCounts[origWord] = vo.occurrences + previousCount;
          }

          if (verseCnt && previousCount) { // if not verse verse, update counts to include previous verse counts
            vo.occurrence += previousCount;
          }

          if (vo.children) {
            updateOriginalWordsOccurrence(vo.children, verseCnt, multiVerse, currentVerseCounts, previousVerseWordCounts);
          }
        }
      }
    }
  }
}

/**
 * Gets the gateway-language words in one bible book that are aligned to a check's
 * original-language quote.
 *
 * The verse (or verse range) in `contextId.reference` is looked up with `getVerses()`. For a
 * range, the verse objects are deep-copied, joined, and their occurrence numbers made continuous
 * (see `updateOriginalWordsOccurrence`), so `bookData` is not changed. The joined verse objects
 * are then passed to `getAlignedText()` from tc-ui-toolkit with `contextId.quote` and
 * `contextId.occurrence`.
 * @param {ContextId|null} contextId - context of the current check. Uses `reference.chapter`,
 *   `reference.verse` (a single verse or a range such as '16-17'), `quote` and `occurrence`;
 *   `bookId` is not used, since `bookData` is already one book.
 * @param {object|null} bookData - one book of a gateway-language bible, keyed by chapter then
 *   verse, where each verse has `verseObjects` with alignment milestones
 * @returns {string|undefined} the aligned gateway-language text as returned by `getAlignedText()`
 *   (e.g. 'faith'), which is empty if no words are aligned to the quote; `undefined` if
 *   `bookData` or `contextId.reference` is missing
 * @example
 * getAlignedTextFromBible(
 *   { reference: { chapter: 2, verse: 16 }, quote: 'πίστεως', occurrence: 1 },
 *   ultGal,
 * );
 * // Returns: 'faith'
 */
export function getAlignedTextFromBible(contextId, bookData) {
  if (bookData && contextId?.reference) {
    const chapter = contextId.reference.chapter;
    const verseRef = contextId.reference.verse;
    const refs = getVerses(bookData, `${chapter}:${verseRef}`);
    let verseObjects = [];
    const verseWordCounts = [];
    const multiVerse = refs.length > 1;

    for (let verseCnt = 0; verseCnt < refs.length; verseCnt++) {
      const previousVerseWordCounts = verseCnt > 0 ? verseWordCounts[verseCnt-1] : {};
      const currentVerseCounts = {};
      verseWordCounts.push(currentVerseCounts);
      const ref = refs[verseCnt];
      const verseData = ref.verseData;

      if (verseData?.verseObjects) { // if we found verse objects
        let verseObjects_ = multiVerse ? _.cloneDeep(verseData.verseObjects) : verseData.verseObjects;
        updateOriginalWordsOccurrence(verseObjects_, verseCnt, multiVerse, currentVerseCounts, previousVerseWordCounts, verseWordCounts);
        Array.prototype.push.apply(verseObjects, verseObjects_);

        if (multiVerse && verseCnt < refs.length-1) {
          const words = Object.keys(previousVerseWordCounts);

          for (const word of words) { // update current verse with counts from previous verse
            if (!currentVerseCounts[word]) {
              currentVerseCounts[word] = previousVerseWordCounts[word];
            }
          }
        }
      }
    }
    return getAlignedText(verseObjects, contextId.quote, contextId.occurrence);
  }
}
