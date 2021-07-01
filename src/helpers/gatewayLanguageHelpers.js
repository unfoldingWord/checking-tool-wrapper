/* eslint-disable no-nested-ternary */
import { getAlignedText } from 'tc-ui-toolkit';

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
    if (!contextId.quote || !glBibles || !glBibles || !Object.keys(glBibles).length) {
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
 * Gets the aligned GL text from the given bible
 * @param {object} contextId
 * @param {object} bible
 * @returns {string}
 */
export function getAlignedTextFromBible(contextId, bible) {
  if (bible && contextId && contextId.reference &&
    bible[contextId.reference.chapter] && bible[contextId.reference.chapter][contextId.reference.verse] &&
    bible[contextId.reference.chapter][contextId.reference.verse].verseObjects) {
    const verseObjects = bible[contextId.reference.chapter][contextId.reference.verse].verseObjects;
    console.log('searching for aligned text', verseObjects, contextId.quote, contextId.occurrence);
    return getAlignedText(verseObjects, contextId.quote, contextId.occurrence);
  }
}
