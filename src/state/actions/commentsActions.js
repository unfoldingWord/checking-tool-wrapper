// TODO: Pending changes

import { ADD_COMMENT } from '../actions/actionTypes';
import generateTimestamp from '../../utils/generateTimestamp';

/**
 * Add a comment for the current check.
 * @param {String} text - comment text.
 * @param {String} username - username.
 */
export const addComment = (text, username, contextId) => ((dispatch) => {
  // const state = getState();
  // const contextId = state.contextIdReducer.contextId; TODO:
  const {
    bookId, chapter, verse,
  } = contextId.reference;

  // const {TODO:
  //   gatewayLanguageCode,
  //   gatewayLanguageQuote,
  // } = gatewayLanguageHelpers.getGatewayLanguageCodeAndQuote(state);
  dispatch({
    type: ADD_COMMENT,
    username: username,
    activeBook: bookId,
    activeChapter: chapter,
    activeVerse: verse,
    modifiedTimestamp: generateTimestamp(),
    // gatewayLanguageCode,
    // gatewayLanguageQuote,
    text,
  });
});
