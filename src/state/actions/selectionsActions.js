import { batchActions } from 'redux-batched-actions';
// constants
import {
  TRANSLATION_WORDS,
  TRANSLATION_NOTES,
} from '../../common/constants';
// helpers
import { getGatewayLanguageCodeAndQuote } from '../../helpers/gatewayLanguageHelpers';
import generateTimestamp from '../../utils/generateTimestamp';
import { sameContext } from '../../helpers/contextIdHelpers';
import { saveSelectionsForOtherContext } from '../../localStorage/saveMethods';
// selectors
import { getContextId } from '../../selectors';
import {
  CHANGE_SELECTIONS,
  TOGGLE_SELECTIONS_IN_GROUPDATA,
  SET_INVALIDATION_IN_GROUPDATA,
} from './actionTypes';

/**
 * Adds a selection array to the selections reducer.
 * @param {Array} selections - An array of selections.
 * @param {Boolean} invalidated - if true then selection if flagged as invalidated, otherwise it is not flagged as invalidated
 * @param {Object} contextId - optional contextId to use, otherwise will use current
 * @param {Array} batchGroupData - if present then add group data actions to this array for later batch operation
 * @param {Boolean} nothingToSelect - nothing to select checkbox.
 * @param {String} username - User name.
 * @param {String} selectedToolName - Current tool selected.
 * @param {function} setInvalidation - Action to set an invalidation in tCore.
 */
export const changeSelections = (selections, invalidated = false, contextId = null,
  batchGroupData = null, nothingToSelect = false, username, selectedToolName, setInvalidation) => ((dispatch, getState) => {
  const state = getState();
  const validTools = [TRANSLATION_WORDS, TRANSLATION_NOTES];

  if (validTools.includes(selectedToolName) || validTools.includes(contextId.tool)) {
    const currentContextId = getContextId(state);
    contextId = contextId || currentContextId; // use current if contextId is not passed
    const {
      gatewayLanguageCode,
      gatewayLanguageQuote,
    } = getGatewayLanguageCodeAndQuote(getState(), contextId);

    if (sameContext(currentContextId, contextId)) { // see if we need to update current selection
      const modifiedTimestamp = generateTimestamp();

      dispatch({
        type: CHANGE_SELECTIONS,
        modifiedTimestamp,
        gatewayLanguageCode,
        gatewayLanguageQuote,
        selections,
        nothingToSelect,
        username,
      });
      setInvalidation(username, modifiedTimestamp, invalidated);
    } else {
      saveSelectionsForOtherContext(getState(), gatewayLanguageCode, gatewayLanguageQuote, selections, invalidated, username, contextId);
    }

    const actionsBatch = Array.isArray(batchGroupData) ? batchGroupData : []; // if batch array passed in then use it, otherwise create new array

    actionsBatch.push({
      type: TOGGLE_SELECTIONS_IN_GROUPDATA,
      contextId,
      selections,
      nothingToSelect,
    });
    actionsBatch.push({
      type: SET_INVALIDATION_IN_GROUPDATA,
      contextId,
      boolean: invalidated,
    });

    if (!Array.isArray(batchGroupData)) { // if we are not returning batch, then process actions now
      dispatch(batchActions(actionsBatch));
    }
  }
});
