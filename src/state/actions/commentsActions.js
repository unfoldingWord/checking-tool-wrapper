// TODO: Pending changes

import { ADD_COMMENT } from '../actions/actionTypes';
// helpers
import generateTimestamp from '../../utils/generateTimestamp';
import { getContextId } from '../../selectors';
import { getGatewayLanguageCodeAndQuote } from '../../helpers/gatewayLanguageHelpers';

/**
 * Add a comment for the current check.
 * @param {String} text - comment text.
 * @param {String} username - username.
 * @param {String} gatewayLanguageCode - gatewayLanguageCode.
 * @param {String} glBibles - glBibles.
 */
export const addComment = (text, username, gatewayLanguageCode, glBibles) => ((dispatch, getState) => {
  const state = getState();
  const contextId = getContextId(state);
  const {
    bookId,
    chapter,
    verse,
  } = contextId.reference;
  const { gatewayLanguageQuote } = getGatewayLanguageCodeAndQuote(gatewayLanguageCode, contextId, glBibles);

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
