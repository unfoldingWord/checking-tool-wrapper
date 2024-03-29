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
 * get the selected text from the GL resource for this context
 * @param {*} contextId - current context id.
 * @param {*} glBibles - gateway language Bibles.
 * @param {string} glID - current GL
 * @param {array|null} tsvRelation - list of relationship items in manifest
 */
export function getAlignedGLTextHelper(contextId, glBibles, glID = '', tsvRelation = null) {
  if (contextId) {
    if (!contextId.quote || !glBibles || !Object.keys(glBibles).length) {
      return contextId.quote || '';
    }

    if (Array.isArray(tsvRelation)) { // look for GL text in TSV relations
      for (let relation of tsvRelation) {
        const parts = relation.split('/');

        if ((parts.length === 2) && (parts[0] === glID)) { // make sure it is for same gl and has the expected number of levels
          let bibleId = parts[1];
          bibleId = bibleId.split('?')[0];
          const bible = glBibles[bibleId];

          if (bible) { // if bible present, see if we can find GL text
            const alignedText = getAlignedTextFromBible(contextId, bible);

            if (alignedText) {
              return alignedText; // we succeeded and we are done
            }
          }
        }
      }
    }

    // fall back to searching for GL text in default priority
    const sortedBibleIds = Object.keys(glBibles).sort(bibleIdSort);

    for (let i = 0; i < sortedBibleIds.length; ++i) {
      const bible = glBibles[sortedBibleIds[i]];
      const alignedText = getAlignedTextFromBible(contextId, bible);

      if (alignedText) {
        return alignedText;
      }
    }
  }

  return '';
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
