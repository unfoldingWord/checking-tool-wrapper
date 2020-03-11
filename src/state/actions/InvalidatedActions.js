import { SET_INVALIDATED, SET_INVALIDATION_IN_GROUPDATA } from '../actions/actionTypes';
import { getContextId } from '../../selectors';
import generateTimestamp from '../../utils/generateTimestamp';
import { saveInvalidated } from '../../localStorage/saveMethods';

/**
 * Invalidates the current check.
 * @param {string} username - The username of who invalidated.
 * @param {boolean} invalidated - new state for invalidated flag.
 * @param {string} gatewayLanguageCode - gateway Language Code.
 * @param {string} gatewayLanguageQuote - gateway Language Quote.
 * @param {string} projectSaveLocation - gateway Language Quote.
 * @return {object} action state.
 */
export const setInvalidation = (username, invalidated, gatewayLanguageCode, gatewayLanguageQuote, projectSaveLocation) => ((dispatch, getState) => {
  const state = getState();
  const contextId = getContextId(state);
  const invalidatedData = {
    username,
    invalidated,
    gatewayLanguageCode,
    gatewayLanguageQuote,
    modifiedTimestamp: generateTimestamp(),
  };

  // Peristing invalidation data
  saveInvalidated(contextId, invalidatedData, projectSaveLocation);

  dispatch({
    type: SET_INVALIDATED,
    ...invalidatedData,
  });
  dispatch({
    type: SET_INVALIDATION_IN_GROUPDATA,
    contextId,
    projectSaveLocation,
    boolean: invalidated,
  });
});
