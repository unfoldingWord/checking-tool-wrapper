/* eslint-disable no-nested-ternary */
import { getAlignedText } from 'tc-ui-toolkit';
import { getVerses } from 'bible-reference-range';
import _ from 'lodash';

/**
 * Returns the gateway language code and quote.
 * @param {string} gatewayLanguageCode - gateway language code.
 * @param {object} contextId - context id.
 * @param {object} glBibles - gateway language bibles.
 * @param {array|null} tsvRelation - list of relationship items in manifest
 * @return {{gatewayLanguageCode: *, gatewayLanguageQuote: *}}
 */
export const getGatewayLanguageCodeAndQuote = (gatewayLanguageCode, contextId, glBibles, tsvRelation) => {
  const gatewayLanguageQuote = getAlignedGLTextHelper(contextId, glBibles, gatewayLanguageCode, tsvRelation);

  return {
    gatewayLanguageCode,
    gatewayLanguageQuote,
  };
};

/**
 * Helper function to retrieve aligned gateway language text from GL Bibles.
 * Searches for aligned text first in TSV relations (if provided), then falls back to searching all available GL Bibles in priority order.
 * @param {object} contextId - Current context id containing reference information and quote details.
 * @param {object} glBibles - Gateway language Bibles organized by Bible ID.
 * @param {array|null} tsvRelation - List of relationship items from the manifest specifying preferred GL Bible sources.
 * @param {string} glID - Current gateway language identifier (e.g., 'en', 'es').
 * @param {string|null} bibleId - Bible ID to be populated during search.
 * @param {object|null} bible - Bible object to be populated during search.
 * @return {{alignedText: string, bibleId: string|null, bible: object|null}} Object containing the aligned text, Bible ID, and Bible object.
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
  return { alignedText, bibleId, bible };
}

/**
 * Retrieves the aligned gateway language text for the given context from the available GL Bibles.
 * Searches through TSV relations first (if provided), then falls back to searching all available GL Bibles.
 * @param {object} contextId - Current context id containing reference information and quote details.
 * @param {object} glBibles - Gateway language Bibles organized by Bible ID.
 * @param {string} glID - Current gateway language identifier (e.g., 'en', 'es').
 * @param {array|null} tsvRelation - List of relationship items from the manifest specifying preferred GL Bible sources.
 * @return {string} The aligned gateway language text, or an empty string if not found.
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
 * Return book code with highest precedence
 * @param {*} a - First book code of 2
 * @param {*} b - second book code
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
 * count original words in verseObjects - it is nested so this is recursive
 * @param {array} verseObjects
 * @param {number} verseCnt
 * @param {boolean} multiVerse
 * @param {object} previousVerseWordCounts
 * @param {object} currentVerseCounts
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
 * Gets the aligned GL text from the given bible
 * @param {object} contextId
 * @param {object} bookData
 * @returns {string}
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
