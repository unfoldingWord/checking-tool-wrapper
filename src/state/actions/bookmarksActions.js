import generateTimestamp from '../../utils/generateTimestamp';
import { getContextId, getBookmarksReducer } from '../../selectors';
import { saveBookmark } from '../../localStorage/saveMethods';
import { TOGGLE_BOOKMARKS_IN_GROUPDATA, TOGGLE_BOOKMARK } from './actionTypes';

/**
 * Toggles the bookmark to true or false
 * @param {string} username - user name.
 * @param {string} gatewayLanguageCode - gateway Language Code.
 * @param {string} gatewayLanguageQuote - gateway Language Quote.
 * @param {string} projectSaveLocation - project directory path.
 */
export const toggleBookmark = (username, gatewayLanguageCode, gatewayLanguageQuote, projectSaveLocation) => (async (dispatch, getState) => {
  const state = getState();
  const contextId = getContextId(state);
  const modifiedTimestamp = generateTimestamp();
  const { enabled } = getBookmarksReducer(state);
  console.log('toggleBookmark enabled', enabled);
  const bookmarkData = {
    enabled: !enabled,
    username,
    modifiedTimestamp,
    gatewayLanguageCode,
    gatewayLanguageQuote,
  };

  await saveBookmark(contextId, bookmarkData, projectSaveLocation);
  dispatch(toggle(username, gatewayLanguageCode, gatewayLanguageQuote, modifiedTimestamp));
  dispatch({
    type: TOGGLE_BOOKMARKS_IN_GROUPDATA,
    contextId,
    projectSaveLocation,
  });
});

export function toggle(username, gatewayLanguageCode, gatewayLanguageQuote, modifiedTimestamp = null) {
  return {
    type: TOGGLE_BOOKMARK,
    modifiedTimestamp: modifiedTimestamp || generateTimestamp(),
    gatewayLanguageCode,
    gatewayLanguageQuote,
    username,
  };
}
