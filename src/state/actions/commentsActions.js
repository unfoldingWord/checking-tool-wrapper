import { ADD_COMMENT } from '../actions/actionTypes';
// helpers
import generateTimestamp from '../../utils/generateTimestamp';
// selectors
import { getContextId } from '../../selectors';

/**
 * Add a comment for the current check.
 * @param {String} text - comment text.
 * @param {String} username - username.
 * @param {String} gatewayLanguageCode - gateway Language Code.
 * @param {String} gatewayLanguageQuote - gateway Language Quote.
 */
export const addComment = (text, username, gatewayLanguageCode, gatewayLanguageQuote) => ((dispatch, getState) => {
  const state = getState();
  const contextId = getContextId(state);
  const {
    bookId,
    chapter,
    verse,
  } = contextId.reference;

  dispatch({
    type: ADD_COMMENT,
    username: username,
    activeBook: bookId,
    activeChapter: chapter,
    activeVerse: verse,
    modifiedTimestamp: generateTimestamp(),
    gatewayLanguageCode,
    gatewayLanguageQuote,
    text,
  });
});
