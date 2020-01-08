import fs from 'fs-extra';
import path from 'path-extra';
import isEqual from 'deep-equal';
import usfm from 'usfm-js';
import { batchActions } from 'redux-batched-actions';
import { checkSelectionOccurrences } from 'selections';
// constants
import {
  WORD_ALIGNMENT,
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
import { getGroupDataForVerse } from '../../helpers/groupDataHelpers';
import { saveSelectionsForOtherContext } from '../../localStorage/saveMethods';
// selectors
import { getContextId, getGroupsData } from '../../selectors';
import { generateLoadPath, loadCheckData } from '../../helpers/checkDataHelpers';
import {
  CHANGE_SELECTIONS,
  TOGGLE_SELECTIONS_IN_GROUPDATA,
  SET_INVALIDATION_IN_GROUPDATA,
} from './actionTypes';
;

/**
 * Adds a selection array to the selections reducer.
 * @param {Array} selections - An array of selections.
 * @param {Boolean} nothingToSelect - nothing to select checkbox.
 * @param {String} username - User name.
 * @param {String} selectedToolName - Current tool selected.
 * @param {function} setInvalidation - Action to set an invalidation in tCore.
 * @param {Boolean} invalidated - if true then selection if flagged as invalidated, otherwise it is not flagged as invalidated
 * @param {Object} contextId - optional contextId to use, otherwise will use current
 * @param {Array} batchGroupData - if present then add group data actions to this array for later batch operation
 * @param {Array} gatewayLanguageCode - gateway Language Code
 * @param {Array} gatewayLanguageQuote - gateway Language Quote
 */
export const changeSelections = (selections, nothingToSelect = false, username,
  selectedToolName, setInvalidation, invalidated = false, contextId = null, batchGroupData = null, gatewayLanguageCode, gatewayLanguageQuote) => ((dispatch, getState) => {
  const state = getState();
  const validTools = [TRANSLATION_WORDS, TRANSLATION_NOTES];

  if (validTools.includes(selectedToolName) || validTools.includes(contextId.tool)) {
    const currentContextId = getContextId(state);
    contextId = contextId || currentContextId; // use current if contextId is not passed

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

/**
 * @description This method validates the current selections to see if they are still valid.
 * @param {String} targetVerse - target bible verse.
 * @param {Object} contextId - optional contextId to use, otherwise will use current
 * @param {Number} chapterNumber - optional chapter number of verse text being edited, if not given will use contextId
 * @param {Number} verseNumber - optional verse number of verse text being edited, if not given will use contextId
 * @param {Boolean} showInvalidation - if true then selections invalidation warning is shown - otherwise just set flag in results
 * @param {object} results - returns state of validations
 * @param {Array} batchGroupData - if present then add group data actions to this array for later batch operation
 * @param {string} projectSaveLocation
 * @param {string} bookId
 * @param {string} selectedToolName
 * @param {string} username
 */
export const validateSelections = (targetVerse, contextId = null, chapterNumber, verseNumber,
  showInvalidation = true, results = {}, batchGroupData = null, projectSaveLocation, bookId, selectedToolName, username) => (dispatch, getState) => {
  const state = getState();
  contextId = contextId || getContextId(state);
  const { chapter, verse } = contextId.reference;
  chapterNumber = chapterNumber || chapter;
  verseNumber = verseNumber || verse;
  let selectionInvalidated = false;
  const actionsBatch = Array.isArray(batchGroupData) ? batchGroupData : []; // if batch array passed in then use it, otherwise create new array

  if (selectedToolName !== WORD_ALIGNMENT) {
    const groupsData = getGroupsData(state);
    // for this groupId, find every check for this chapter/verse
    const matchedGroupData = getGroupDataForGroupIdChapterVerse(groupsData, contextId.groupId, chapterNumber, verseNumber);

    for (let i = 0, l = matchedGroupData.length; i < l; i++) {
      const groupObject = matchedGroupData[i];
      const selections = getSelectionsForContextID(projectSaveLocation, groupObject.contextId);
      const validSelections = checkSelectionOccurrences(targetVerse, selections);
      const selectionsChanged = (selections.length !== validSelections.length);

      if (selectionsChanged) {
        dispatch(changeSelections([], true, groupObject.contextId, actionsBatch)); // clear selections
      }
      selectionInvalidated = selectionInvalidated || selectionsChanged;
    }

    const results_ = { selectionsChanged: selectionInvalidated };
    dispatch(validateAllSelectionsForVerse(targetVerse, results_, true, contextId, false, actionsBatch));
    selectionInvalidated = selectionInvalidated || results_.selectionsChanged; // if new selections invalidated
    selectionInvalidated = validateSelectionsForUnloadedTools(projectSaveLocation, bookId, chapter, verse, targetVerse, selectionInvalidated, username, selectedToolName);
  } else { // wordAlignment tool
    selectionInvalidated = validateSelectionsForUnloadedTools(projectSaveLocation, bookId, chapter, verse, targetVerse, selectionInvalidated, username, selectedToolName);
  }

  if (!Array.isArray(batchGroupData)) { // if we are not returning batch, then process actions now
    dispatch(batchActions(actionsBatch));
  }
  results.selectionsChanged = selectionInvalidated;

  if (showInvalidation && selectionInvalidated) {
    dispatch(showSelectionsInvalidatedWarning());
  }
};

/**
 * get selections for context ID
 * @param {Object} contextId - contextId to use in lookup
 * @param {String} projectSaveLocation
 * @return {Array} - selections
 */
export const getSelectionsForContextID = (projectSaveLocation, contextId) => {
  let selections = [];
  const loadPath = generateLoadPath(projectSaveLocation, contextId, 'selections');
  const selectionsObject = loadCheckData(loadPath, contextId);

  if (selectionsObject) {
    selections = selectionsObject.selections;
  }
  return selections;
};

/**
 * populates groupData with all groupData entries for groupId and chapter/verse
 * @param {Object} groupsDataReducer
 * @param {String} groupId
 * @param {Number} chapterNumber - optional chapter number of verse text being edited
 * @param {Number} verseNumber - optional verse number of verse text being edited
 * @return {Array} - group data items that match
 */
export const getGroupDataForGroupIdChapterVerse = (groupsData, groupId, chapterNumber, verseNumber) => {
  const matchedGroupData = [];
  const groupData = groupId && groupsData && groupsData[groupId];

  if (groupData && groupData.length) {
    for (let i = 0, l = groupData.length; i < l; i++) {
      const groupObject = groupData[i];

      if ((groupObject.contextId.reference.chapter === chapterNumber) &&
        (groupObject.contextId.reference.verse === verseNumber)) {
        matchedGroupData.push(groupObject);
      }
    }
  }
  return matchedGroupData;
};

/**
 * verify all selections for current verse
 * @param {string} targetVerse - new text for verse
 * @param {object} results - keeps state of
 * @param {Boolean} skipCurrent - if true, then skip over validation of current contextId
 * @param {Object} contextId - optional contextId to use, otherwise will use current
 * @param {Boolean} warnOnError - if true, then will show message on selection change
 * @param {Array|null} batchGroupData - if present then add group data actions to this array for later batch operation
 * @return {Function}
 */
export const validateAllSelectionsForVerse = (targetVerse, results, skipCurrent = false, contextId = null,
  warnOnError = false, batchGroupData = null) => (dispatch, getState) => {
  const state = getState();
  const initialSelectionsChanged = results.selectionsChanged;
  contextId = contextId || state.contextIdReducer.contextId;
  const groupsData = getGroupsData(state);
  const groupsDataForVerse = getGroupDataForVerse(groupsData, contextId);
  let filtered = null;
  results.selectionsChanged = false;
  const actionsBatch = Array.isArray(batchGroupData) ? batchGroupData : []; // if batch array passed in then use it, otherwise create new array

  const groupsDataKeys = Object.keys(groupsDataForVerse);

  for (let i = 0, l = groupsDataKeys.length; i < l; i++) {
    const groupItemKey = groupsDataKeys[i];
    const groupItem = groupsDataForVerse[groupItemKey];

    for (let j = 0, lenGI = groupItem.length; j < lenGI; j++) {
      const checkingOccurrence = groupItem[j];
      const selections = checkingOccurrence.selections;

      if (!skipCurrent || !sameContext(contextId, checkingOccurrence.contextId)) {
        if (selections && selections.length) {
          if (!filtered) { // for performance, we filter the verse only once and only if there is a selection
            filtered = usfm.removeMarker(targetVerse); // remove USFM markers
          }

          const validSelections = checkSelectionOccurrences(filtered, selections);

          if (selections.length !== validSelections.length) {
            results.selectionsChanged = true;
            dispatch(changeSelections([], true, checkingOccurrence.contextId, actionsBatch)); // clear selection
          }
        }
      }
    }
  }

  if (!Array.isArray(batchGroupData)) { // if we are not returning batch, then process actions now
    dispatch(batchActions(actionsBatch));
  }

  if (warnOnError && (initialSelectionsChanged || results.selectionsChanged)) {
    dispatch(showSelectionsInvalidatedWarning());
  }
};

/**
 * does validation for tools not loaded into group reducer
 * @param {String} projectSaveLocation
 * @param {String} bookId
 * @param {String|Number} chapter
 * @param {String|Number} verse
 * @param {Object} state
 * @param {String} targetVerse - new verse text
 * @param {Boolean} selectionInvalidated
 * @return {Boolean} - updated value for selectionInvalidated
 */
const validateSelectionsForUnloadedTools = (projectSaveLocation, bookId, chapter, verse,
  targetVerse, selectionInvalidated, username, selectedToolName) => (dispatch) => {
  const selectionsPath = path.join(projectSaveLocation, '.apps', 'translationCore', 'checkData', 'selections', bookId, chapter.toString(), verse.toString());

  if (fs.existsSync(selectionsPath)) {
    let files = fs.readdirSync(selectionsPath);

    files = files.filter(file => // filter the filenames to only use .json
      path.extname(file) === '.json'
    ).sort();

    // load all files keeping the latest for each context
    const latestContext = {};

    for (let i = 0, l = files.length; i < l; i++) {
      const selectionsData = fs.readJsonSync(path.join(selectionsPath, files[i]));
      const contextId = selectionsData.contextId;

      if (contextId) {
        if (selectedToolName !== contextId.tool) {
          const contextIdQuote = Array.isArray(contextId.quote) ? contextId.quote.map(({ word }) => word).join(' ') : contextId.quote;
          const key = contextId.groupId + ':' + contextId.occurrence + ':' + contextIdQuote;
          latestContext[key] = selectionsData;
        }
      }
    }

    const modifiedTimestamp = generateTimestamp();
    const keys = Object.keys(latestContext);

    for (let j = 0, l = keys.length; j < l; j++) {
      const selectionsData = latestContext[keys[j]];
      const validSelections = checkSelectionOccurrences(targetVerse, selectionsData.selections);

      if (!isEqual(selectionsData.selections, validSelections)) { // if true found invalidated check
        // add invalidation entry
        const newInvalidation = {
          contextId: selectionsData.contextId,
          invalidated: true,
          username,
          modifiedTimestamp: modifiedTimestamp,
          gatewayLanguageCode: selectionsData.gatewayLanguageCode,
          gatewayLanguageQuote: selectionsData.gatewayLanguageQuote,
        };
        const newFilename = modifiedTimestamp + '.json';
        const invalidatedCheckPath = path.join(projectSaveLocation, '.apps', 'translationCore', 'checkData', 'invalidated', bookId, chapter.toString(), verse.toString());
        fs.ensureDirSync(invalidatedCheckPath);
        fs.outputJSONSync(path.join(invalidatedCheckPath, newFilename.replace(/[:"]/g, '_')), newInvalidation);
        dispatch(changeSelections([], true, newInvalidation.contextId));
        selectionInvalidated = true;
      }
    }
  }
  return selectionInvalidated;
};

/**
 * displays warning that selections have been invalidated
 * @param {Function|Null} callback - optional callback after OK button clicked
 * @return {Function}
 */
export const showSelectionsInvalidatedWarning = (callback = null) => showInvalidatedWarnings(true, false, callback);

/**
 * Displays warning that selections, alignments, or both have been invalidated
 * @param {boolean} showSelectionInvalidated
 * @param {boolean} showAlignmentsInvalidated
 * @param {Function|Null} callback - optional callback after OK button clicked
 * @param {Function} translate - locale method.
 * @param {Function} showIgnorableAlert - show alert method.
 * @return {Function}
 */
export const showInvalidatedWarnings = (showSelectionInvalidated, showAlignmentsInvalidated,
  callback = null, translate, showIgnorableAlert) => (dispatch) => {
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

  dispatch(showIgnorableAlert(id, translate(message), { onConfirm: callback }));
};
