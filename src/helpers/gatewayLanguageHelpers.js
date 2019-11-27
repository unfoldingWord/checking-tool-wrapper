/* eslint-disable no-nested-ternary */
import { getAlignedText } from 'tc-ui-toolkit';

/**
 * Returns the gateway langauge code and quote.
 * @param {string} gatewayLanguageCode - gateway language code.
 * @param {object} contextId - context id.
 * @param {object} glBibles - gateway language bibles.
 * @return {{gatewayLanguageCode: *, gatewayLanguageQuote: *}}
 */
export const getGatewayLanguageCodeAndQuote = (gatewayLanguageCode, contextId, glBibles) => {
  const gatewayLanguageQuote = getAlignedGLText(contextId, glBibles);

  return {
    gatewayLanguageCode,
    gatewayLanguageQuote,
  };
};

/**
 * get the selected text from the GL resource for this context
 * @param {*} contextId - current context id.
 * @param {*} glBibles - gateway language Bibles.
 */
export function getAlignedGLText(contextId, glBibles) {
  if (contextId) {
    if (!contextId.quote || !glBibles || !glBibles || !Object.keys(glBibles).length) {
      return contextId.quote;
    }

    const sortedBibleIds = Object.keys(glBibles).sort(bibleIdSort);

    for (let i = 0; i < sortedBibleIds.length; ++i) {
      const bible = glBibles[sortedBibleIds[i]];
      const alignedText = getAlignedTextFromBible(contextId, bible);

      if (alignedText) {
        return alignedText;
      }
    }
    return contextId.quote;
  }

  return null;
}

/**
 * Return book code with highest precidence
 * @param {*} a - First book code of 2
 * @param {*} b - second book code
 */
export function bibleIdSort(a, b) {
  const biblePrecedence = ['udb', 'ust', 'ulb', 'ult', 'irv']; // these should come first in this order if more than one aligned Bible, from least to greatest

  if (biblePrecedence.indexOf(a) == biblePrecedence.indexOf(b)) {
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
    return getAlignedText(verseObjects, contextId.quote, contextId.occurrence);
  }
}
