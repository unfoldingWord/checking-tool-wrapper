import {getAlignedText} from 'tc-ui-toolkit';

export function getAlignedGLText(currentProjectToolsSelectedGL, contextId, bibles, currentToolName, translate) {
  const selectedGL = currentProjectToolsSelectedGL[currentToolName];
  if(! bibles || ! bibles[selectedGL] || ! Object.keys(bibles[selectedGL]).length)
    return contextId.quote;
  const sortedBibleIds = Object.keys(bibles[selectedGL]).sort(bibleIdSort);
  for (let i = 0; i < sortedBibleIds.length; ++i) {
    const bible = bibles[selectedGL][sortedBibleIds[i]];
    if(bible && bible[contextId.reference.chapter] && bible[contextId.reference.chapter][contextId.reference.verse] && bible[contextId.reference.chapter][contextId.reference.verse].verseObjects) {
      const verseObjects = bible[contextId.reference.chapter][contextId.reference.verse].verseObjects;
      const alignedText = getAlignedText(verseObjects, contextId.quote, contextId.occurrence);
      if (alignedText) {
        return alignedText;
      }
    }
  }
  const origLangQuote = getQuoteAsString(contextId.quote);
  const message = translate("quote_invalid", {quote: origLangQuote});
  return message;
}

export function getQuoteAsString(quote) {
  if (Array.isArray(quote)) {
    return quote.map(({word}) => word).join(' ');
  } else if (typeof quote === 'string') {
    return quote;
  }
  return "";
}

export function bibleIdSort(a, b) {
  const biblePrecedence = ['udb', 'ust', 'ulb', 'ult', 'irv']; // these should come first in this order if more than one aligned Bible, from least to greatest
  if (biblePrecedence.indexOf(a) == biblePrecedence.indexOf(b))
    return (a < b? -1 : a > b ? 1 : 0);
  else
    return biblePrecedence.indexOf(b) - biblePrecedence.indexOf(a); // this plays off the fact other Bible IDs will be -1
}
