
/**
 * Gets the phrase from tW
 * @param {array} translationWords
 * @param {string} articleId
 * @param {object} translationHelps
 * @return {string}
 */
export function getPhraseFromTw(translationWords, articleId, translationHelps) {
  let currentFile = '';

  if (translationWords && translationWords[articleId]) {
    currentFile = translationHelps.translationWords[articleId];
  }

  let splitLine = currentFile.split('\n');

  if (splitLine.length === 1 && splitLine[0] === '') {
    return '';
  }

  let finalArray = [];

  for (let i = 0; i < splitLine.length; i++) {
    if (splitLine[i] !== '' && !~splitLine[i].indexOf('#')) {
      finalArray.push(splitLine[i]);
    }
  }

  let maxLength = 225;
  let finalString = '';
  let chosenString = finalArray[0];
  let splitString = chosenString.split(' ');

  for (let word of splitString) {
    if ((finalString + ' ' + word).length >= maxLength) {
      finalString += '...';
      break;
    }
    finalString += ' ';
    finalString += word;
  }
  return finalString;
}

/**
 * Removes the (See: [...](rc://...)) links at the end of an occurrenceNote
 * Ex: Paul speaks of God’s message as if it were an object (See: [Idiom](rc://en/ta/man/translate/figs-idiom) and [Metaphor](rc://en/ta/man/translate/figs-metaphor)) =>
 *     Paul speaks of God’s message as if it were an object
 * @param {string} occurrecntNote
 * @return {string}
 */
export function getNote(occurrenceNote) {
  return occurrenceNote.replace(/\s*\([^()[\]]+((\[[^[\]]+\])*(\[\[|\()+rc:\/\/[^)\]]+(\]\]|\))[^([)\]]*)+[^()[]]*\)\s*$/g, '');
}
