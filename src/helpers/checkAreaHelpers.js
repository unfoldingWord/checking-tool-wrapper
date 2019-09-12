import { getAlignedText } from 'tc-ui-toolkit';

/**
 * looks up the GL text from an aligned GL bible using the Original Language
 * @param {object} toolsSelectedGLs
 * @param {object} contextId
 * @param {object} bibles
 * @param {string} currentToolName
 * @param {Function} translate
 * @param {Function} onInvalidQuote - optional method to call if quote cannot be matched
 * @return {*}
 */
export function getAlignedGLText(toolsSelectedGLs, contextId, bibles, currentToolName, translate, onInvalidQuote) {
  const selectedGL = toolsSelectedGLs[currentToolName];

  if (! bibles || ! bibles[selectedGL] || ! Object.keys(bibles[selectedGL]).length) {
    return contextId.quote;
  }

  const sortedBibleIds = Object.keys(bibles[selectedGL]).sort(bibleIdSort);

  for (let i = 0; i < sortedBibleIds.length; ++i) {
    const bible = bibles[selectedGL][sortedBibleIds[i]];

    if (bible && bible[contextId.reference.chapter] && bible[contextId.reference.chapter][contextId.reference.verse] && bible[contextId.reference.chapter][contextId.reference.verse].verseObjects) {
      const verseObjects = bible[contextId.reference.chapter][contextId.reference.verse].verseObjects;
      const alignedText = getAlignedText(verseObjects, contextId.quote, contextId.occurrence);

      if (alignedText) {
        return alignedText;
      }
    }
  }

  /* eslint-disable-next-line no-unused-expressions */ //TODO: ask Bruce why is the line below needed
  onInvalidQuote && onInvalidQuote(contextId, selectedGL);
  const origLangQuote = getQuoteAsString(contextId.quote);
  const message = translate('quote_invalid', { quote: origLangQuote });
  return message;
}

export function getQuoteAsString(quote) {
  let text = '';

  if (Array.isArray(quote)) {
    text = quote.map(({ word }) => word).join(' ');
  } else if (typeof quote === 'string') {
    text = quote;
  }
  // remove space before any punctuation that is used in Greek except `...` and `…`
  text = text.replace(/\s+(?!\.\.\.)(?!…)([.,;'’`?!"]+)/g, '$1');
  return text;
}

export function bibleIdSort(a, b) {
  const biblePrecedence = ['udb', 'ust', 'ulb', 'ult', 'irv']; // these should come first in this order if more than one aligned Bible, from least to greatest

  if (biblePrecedence.indexOf(a) == biblePrecedence.indexOf(b)) {/* eslint-disable-next-line no-nested-ternary */
    return (a < b? -1 : a > b ? 1 : 0);
  } else {
    return biblePrecedence.indexOf(b) - biblePrecedence.indexOf(a);
  } // this plays off the fact other Bible IDs will be -1
}
