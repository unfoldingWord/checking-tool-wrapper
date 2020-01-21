import { ADD_COMMENT, TOGGLE_COMMENTS_IN_GROUPDATA } from '../actions/actionTypes';
// helpers
import generateTimestamp from '../../utils/generateTimestamp';
// selectors
import { getContextId } from '../../selectors';

/**
 * Add a comment for the current check.
 * @param {string} text - comment text.
 * @param {string} username - username.
 * @param {string} gatewayLanguageCode - gateway Language Code.
 * @param {string} gatewayLanguageQuote - gateway Language Quote.
 * @param {string} projectSaveLocation - project directory path.
 */
export const addComment = (text, username, gatewayLanguageCode, gatewayLanguageQuote, projectSaveLocation) => ((dispatch, getState) => {
  console.log('====================================');
  console.log('addComment()');
  console.log('====================================');
  const state = getState();
  const contextId = getContextId(state);
  const {
    bookId,
    chapter,
    verse,
  } = contextId.reference;

  dispatch({
    type: ADD_COMMENT,
    username,
    activeBook: bookId,
    activeChapter: chapter,
    activeVerse: verse,
    modifiedTimestamp: generateTimestamp(),
    gatewayLanguageCode,
    gatewayLanguageQuote,
    text,
  });
  dispatch({
    type: TOGGLE_COMMENTS_IN_GROUPDATA,
    text,
    contextId,
    projectSaveLocation,
  });
});
