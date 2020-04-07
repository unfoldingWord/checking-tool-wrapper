import marked from 'marked';

/**
 * Produces a text renderer
 * @param linkRenderer a custom callback to handle rendering links
 * @returns {Renderer}
 */
const buildRenderer = (linkRenderer = null) => {
  // setup marked options:
  const Renderer = new marked.Renderer();

  /**
   * leave paragraphs unchanged (prevents wrapping text in <p>...</p>)
   * @type {String} text
   * @return {String} same as text
   */
  Renderer.paragraph = (text => text);

  /**
   * leave links as markdown since they will be processed later
   * @param {String} href
   * @param {String} title
   * @param {String} text
   * @return {String} link as markdown
   */
  Renderer.link = function (href, title, text) {
    if (typeof linkRenderer === 'function') {
      const data = linkRenderer({
        href,
        title: text,
      });
      href = data.href;
      text = data.title;
    }

    const link = href + (title ? ' ' + title : '');
    return '[' + text + '](' + link + ')';
  };
  return Renderer;
};

//
// link(string href, string title, string text)

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
 * @param {string} occurrenceNote
 * @param linkRenderer a callback to manually process link titles and hrefs.
 * @return {string}
 */
export function getNote(occurrenceNote, linkRenderer = null) {
  try {
    // convert legacy nameless links to proper links.
    occurrenceNote = occurrenceNote.replace(/\[\[(([^\][])*)]]/, '[$1]($1)');

    // render markdown
    const CustomRenderer = buildRenderer(linkRenderer);
    let convertedNote = marked(occurrenceNote, { renderer: CustomRenderer });

    if (convertedNote) { // if not empty use
      occurrenceNote = convertedNote;
    }
  } catch (e) {
    console.warn(`getNote() - failed to convert markdown in ${occurrenceNote}`);
  }

  return occurrenceNote;
}
