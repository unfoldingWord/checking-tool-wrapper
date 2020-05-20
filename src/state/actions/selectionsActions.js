import { batchActions } from 'redux-batched-actions';
// constants
import {
  TRANSLATION_WORDS,
  TRANSLATION_NOTES,
  ALERT_SELECTIONS_INVALIDATED_ID,
  ALERT_SELECTIONS_INVALIDATED_MSG,
  ALERT_ALIGNMENTS_RESET_ID,
  ALERT_ALIGNMENTS_RESET_MSG,
  ALERT_ALIGNMENTS_AND_SELECTIONS_RESET_MSG,
} from '../../common/constants';
// helpers
import generateTimestamp from '../../utils/generateTimestamp';
import { sameContext } from '../../helpers/contextIdHelpers';
import { saveSelectionsForOtherContext, saveSelections } from '../../localStorage/saveMethods';
// selectors
import { getContextId } from '../../selectors';
import {
  CHANGE_SELECTIONS,
  TOGGLE_SELECTIONS_IN_GROUPDATA,
  SET_INVALIDATION_IN_GROUPDATA,
} from './actionTypes';
import { setInvalidation } from './InvalidatedActions';

/**
 * Adds a selection array to the selections reducer.
 * @param {array} selections - An array of selections.
 * @param {boolean} invalidated - if true then selection if flagged as invalidated, otherwise it is not flagged as invalidated
 * @param {object} contextId - optional contextId to use, otherwise will use current
 * @param {array} batchGroupData - if present then add group data actions to this array for later batch operation
 * @param {boolean} nothingToSelect - nothing to select checkbox.
 * @param {String} username - User name.
 * @param {String} currentToolName - Current tool selected.
 * @param {string} gatewayLanguageCode - gateway Language Code
 * @param {string} gatewayLanguageQuote - gateway Language Quote
 * @param {string} projectSaveLocation - gateway Language Quote
 */
export const changeSelections = (selections, invalidated = false, contextId = null, batchGroupData = null, nothingToSelect = false,
  username, currentToolName, gatewayLanguageCode, gatewayLanguageQuote, projectSaveLocation) => ((dispatch, getState) => {
  const state = getState();
  const validTools = [TRANSLATION_WORDS, TRANSLATION_NOTES];
  const currentContextId = getContextId(state);
  contextId = contextId || currentContextId; // use current if contextId is not passed

  if (validTools.includes(currentToolName) || validTools.includes(contextId.tool)) {
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

      const selectionData = {
        modifiedTimestamp,
        gatewayLanguageCode,
        gatewayLanguageQuote,
        selections,
        nothingToSelect,
        username,
      };
      // Persisting selection checkData in filesystem.
      saveSelections(contextId, selectionData, projectSaveLocation);
      dispatch(setInvalidation(username, invalidated, gatewayLanguageCode, gatewayLanguageQuote, projectSaveLocation));
    } else {
      saveSelectionsForOtherContext(gatewayLanguageCode, gatewayLanguageQuote, selections, invalidated, username, contextId, projectSaveLocation);
    }

    const actionsBatch = Array.isArray(batchGroupData) ? batchGroupData : []; // if batch array passed in then use it, otherwise create new array

    actionsBatch.push({
      type: TOGGLE_SELECTIONS_IN_GROUPDATA,
      contextId,
      selections,
      nothingToSelect,
      projectSaveLocation,
    });
    actionsBatch.push({
      type: SET_INVALIDATION_IN_GROUPDATA,
      contextId,
      boolean: invalidated,
      projectSaveLocation,
    });

    if (!Array.isArray(batchGroupData)) { // if we are not returning batch, then process actions now
      dispatch(batchActions(actionsBatch));
    }
  }
});

/**
 * Displays warning that selections, alignments, or both have been invalidated
 * @param {boolean} showSelectionInvalidated
 * @param {boolean} showAlignmentsInvalidated
 * @param {Function} translate - locale method.
 * @param {Function} showIgnorableAlert - show alert method.
 * @return {Function}
 */
export const showInvalidatedWarnings = (showSelectionInvalidated, showAlignmentsInvalidated, translate, showIgnorableAlert) => () => {
  let message = null;
  let id = null;

  if (showSelectionInvalidated && showAlignmentsInvalidated) {
    message = ALERT_ALIGNMENTS_AND_SELECTIONS_RESET_MSG;
    id = ALERT_ALIGNMENTS_RESET_ID;
  } else if (showSelectionInvalidated) {
    message = ALERT_SELECTIONS_INVALIDATED_MSG;
    id = ALERT_SELECTIONS_INVALIDATED_ID;
  } else { // (showAlignmentsInvalidated)
    message = ALERT_ALIGNMENTS_RESET_MSG;
    id = ALERT_ALIGNMENTS_RESET_ID;
  }

  showIgnorableAlert(id, translate(message));
};
