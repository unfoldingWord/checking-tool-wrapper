import generateTimestamp from '../../utils/generateTimestamp';
import { getContextId } from '../../selectors';
import { TOGGLE_BOOKMARKS_IN_GROUPDATA, TOGGLE_BOOKMARK } from './actionTypes';

/**
 * Toggles the bookmark to true or false
 * @param {string} username - user name.
 * @param {string} gatewayLanguageCode - gateway Language Code.
 * @param {string} gatewayLanguageQuote - gateway Language Quote.
 */
export const toggleBookmark = (username, gatewayLanguageCode, gatewayLanguageQuote) => ((dispatch, getState) => {
  const state = getState();
  const contextId = getContextId(state);

  dispatch(toggle(username, gatewayLanguageCode, gatewayLanguageQuote));
  dispatch({
    type: TOGGLE_BOOKMARKS_IN_GROUPDATA,
    contextId,
  });
});

export function toggle(username, gatewayLanguageCode, gatewayLanguageQuote) {
  return {
    type: TOGGLE_BOOKMARK,
    modifiedTimestamp: generateTimestamp(),
    gatewayLanguageCode,
    gatewayLanguageQuote,
    username,
  };
}
