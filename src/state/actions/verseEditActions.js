import { batchActions } from 'redux-batched-actions';
import generateTimestamp from '../../utils/generateTimestamp';
import { getContextId, getGroupsData } from '../../selectors';
import {
  TRANSLATION_NOTES,
  TRANSLATION_WORDS,
} from '../../common/constants';
import { getGroupDataForVerse } from '../../helpers/groupDataHelpers';
import { updateGroupDataIndexForVerseEdits } from '../../helpers/verseEditHelpers';
import { saveVerseEdit } from '../../localStorage/saveMethods';
import delay from '../../utils/delay';
import {
  ADD_VERSE_EDIT,
  TOGGLE_VERSE_EDITS_IN_GROUPDATA,
} from './actionTypes';
import { showInvalidatedWarnings } from './selectionsActions';

/**
 * This is called by tool when a verse has been edited. It updates group data reducer for current tool
 * and updates the file system for tools not loaded.
 * This will first do TW selections validation and prompt user if invalidations are found.
 * Then it calls updateVerseEditStatesAndCheckAlignments to save verse edits and then validate alignments.
 * @param {int} chapterWithVerseEdit
 * @param {int|string} verseWithVerseEdit
 * @param {string} before - the verse text before the edit
 * @param {string} after - the verse text after the edit
 * @param {array} tags - an array of tags indicating the reason for the edit
 * @param {string} username - user's name.
 * @param {string} gatewayLanguageCode - gateway Language Code.
 * @param {string} gatewayLanguageQuote - gateway Language quote.
 * @param {string} projectSaveLocation - project path.
 * @param {string} currentToolName - tool name.
 * @param {function} translate - locale function.
 * @param {function} showAlert - showAlert.
 * @param {function} closeAlert - closeAlert.
 * @param {function} showIgnorableAlert - showIgnorableAlert.
 * @param {function} updateTargetVerse - updateTargetVerse.
 * @param {object} toolApi - toolApi.
 */
export const editTargetVerse = (chapterWithVerseEdit, verseWithVerseEdit, before, after, tags, username, gatewayLanguageCode, gatewayLanguageQuote, projectSaveLocation, currentToolName, translate, showAlert, closeAlert, showIgnorableAlert, updateTargetVerse, toolApi) => (dispatch, getState) => {
  const state = getState();
  const contextId = getContextId(state);
  const currentCheckContextId = contextId;
  const {
    bookId, chapter: currentCheckChapter, verse: currentCheckVerse,
  } = currentCheckContextId.reference;

  const contextIdWithVerseEdit = {
    ...currentCheckContextId,
    reference: {
      ...currentCheckContextId.reference,
      chapter: chapterWithVerseEdit,
      verse: verseWithVerseEdit,
    },
  };
  const actionsBatch = [];

  // create verse edit record to write to file system
  const verseEdit = {
    verseBefore: before,
    verseAfter: after,
    tags,
    username,
    activeBook: bookId,
    activeChapter: currentCheckChapter,
    activeVerse: currentCheckVerse,
    modifiedTimestamp: generateTimestamp(),
    gatewayLanguageCode,
    gatewayLanguageQuote,
    quote: contextIdWithVerseEdit.quote,
    occurrence: contextIdWithVerseEdit.occurrence,
    contextId: contextIdWithVerseEdit,
  };

  dispatch(
    updateVerseEditStatesAndCheckAlignments(
      verseEdit, contextIdWithVerseEdit, currentCheckContextId, actionsBatch, currentToolName, translate,
      showAlert, closeAlert, projectSaveLocation, showIgnorableAlert, updateTargetVerse, toolApi
    )
  );

  // Persisting verse edit checkData in filesystem.
  saveVerseEdit(contextIdWithVerseEdit, verseEdit, projectSaveLocation);
};

/**
 * updates verse edit in group data reducer (and in file system if tw group data is not loaded) and
 *   then does alignment validation checking
 *
 * @param {{
      verseBefore: String,
      verseAfter: String,
      tags: Array,
      userName: String,
      activeBook: String,
      activeChapter: Number,
      activeVerse: Number,
      modifiedTimestamp: String,
      gatewayLanguageCode: String,
      gatewayLanguageQuote: String,
      contextId: Object
    }} verseEdit - record to be saved to file system if in WA tool
 * @param {object} contextIdWithVerseEdit - contextId of verse being edited
 * @param {object} currentCheckContextId - contextId of group menu item selected
 * @param {array} batchGroupData - if present then add group data actions to this array for later batch operation
 * @param {string} currentToolName -
 * @param {function} translate -
 * @param {function} showAlert -
 * @param {function} closeAlert -
 * @param {string} projectSaveLocation -
 * @param {function} showIgnorableAlert -
 * @param {function} updateTargetVerse -
 * @param {object} toolApi -
 */
export const updateVerseEditStatesAndCheckAlignments = (verseEdit, contextIdWithVerseEdit, currentCheckContextId, batchGroupData = null, currentToolName, translate, showAlert, closeAlert, projectSaveLocation, showIgnorableAlert, updateTargetVerse, toolApi) => async (dispatch) => {
  const actionsBatch = Array.isArray(batchGroupData) ? batchGroupData : []; // if batch array passed in then use it, otherwise create new array
  showAlert(translate('invalidation_checking'), true);
  await delay(300);
  const chapterWithVerseEdit = contextIdWithVerseEdit.reference.chapter;
  const verseWithVerseEdit = contextIdWithVerseEdit.reference.verse;
  updateTargetVerse(chapterWithVerseEdit, verseWithVerseEdit, verseEdit.verseAfter);

  const showAlignmentsInvalidated = !toolApi.validateVerseAlignments(chapterWithVerseEdit, verseWithVerseEdit, true);
  let showSelectionInvalidated = !toolApi.validateVerse(chapterWithVerseEdit, verseWithVerseEdit, true);
  const selectionsInvalidatedInOtherTools = !toolApi.validateVerseSelectionsInOtherTools(chapterWithVerseEdit, verseWithVerseEdit, true);
  showSelectionInvalidated = showSelectionInvalidated || selectionsInvalidatedInOtherTools;
  closeAlert();

  if (showSelectionInvalidated || showAlignmentsInvalidated) {
    dispatch(showInvalidatedWarnings(showSelectionInvalidated, showAlignmentsInvalidated, translate, showIgnorableAlert));
  }
  dispatch(doBackgroundVerseEditsUpdates(verseEdit, contextIdWithVerseEdit,
    currentCheckContextId, actionsBatch, currentToolName, projectSaveLocation));
};

/**
 * iterates through groupData to make sure all checks for this verse have verse edit set
 * @param {string} projectSaveLocation
 * @param {string} toolName
 * @param contextIdWithVerseEdit
 * @param {Array|null} batchGroupData
 * @return {function(...[*]=)}
 */
export const updateGroupDataForVerseEdit = (projectSaveLocation, toolName, contextIdWithVerseEdit, batchGroupData = null) => (dispatch, getState) => {
  const actionsBatch = Array.isArray(batchGroupData) ? batchGroupData : []; // if batch array passed in then use it, otherwise create new array
  const groupsData = getGroupsData(getState());
  const editedChecks = {};

  if (toolName === TRANSLATION_WORDS || toolName === TRANSLATION_NOTES) {
    getCheckVerseEditsInGroupData(groupsData, contextIdWithVerseEdit, editedChecks, projectSaveLocation);
    const { groupEditsCount } = editChecksToBatch(editedChecks, actionsBatch); // optimize edits into batch

    if (groupEditsCount) {
      console.info(`updateGroupDataForVerseEdit() - ${groupEditsCount} group edits found`);
    }
  }

  if (actionsBatch.length) {
    console.info(`updateGroupDataForVerseEdit() - batch size: ${actionsBatch.length}`);
    dispatch(batchActions(actionsBatch));

    // update group data index files with new data
    updateGroupDataIndexForVerseEdits(getState(), editedChecks, toolName, projectSaveLocation);
  }
};

/**
 * after a delay it starts updating the verse edit flags.  There are also delays between operations
 *   so we don't slow down UI interactions of user
 * @param {{
      verseBefore: String,
      verseAfter: String,
      tags: Array,
      userName: String,
      activeBook: String,
      activeChapter: Number,
      activeVerse: Number,
      modifiedTimestamp: String,
      gatewayLanguageCode: String,
      gatewayLanguageQuote: String,
      contextId: Object
    }} verseEdit - record to be saved to file system if in WA tool
 * @param {Object} contextIdWithVerseEdit - contextId of verse being edited
 * @param {Object} currentCheckContextId - contextId of group menu item selected
 * @param {array} batchGroupData - if present then add group data actions to this array for later batch operation
 * @param {string} toolName - tool Name.
 * @param {string} projectSaveLocation - project Directory path.
 */
export const doBackgroundVerseEditsUpdates = (verseEdit, contextIdWithVerseEdit, currentCheckContextId, batchGroupData = null, toolName, projectSaveLocation) => (dispatch) => {
  const chapterWithVerseEdit = contextIdWithVerseEdit.reference.chapter;
  const verseWithVerseEdit = contextIdWithVerseEdit.reference.verse;

  dispatch(recordTargetVerseEdit(verseEdit.activeBook, chapterWithVerseEdit, verseWithVerseEdit,
    verseEdit.verseBefore, verseEdit.verseAfter, verseEdit.tags, verseEdit.userName, generateTimestamp(),
    verseEdit.gatewayLanguageCode, verseEdit.gatewayLanguageQuote, currentCheckContextId));

  dispatch(updateGroupDataForVerseEdit(projectSaveLocation, toolName, contextIdWithVerseEdit, batchGroupData));
};

/**
 * Records an edit to a verse in the target language bible.
 * This will result in the verse text being written to the disk.
 * @param {string} bookId - the id of the book receiving the edit
 * @param {int} chapter - the chapter receiving the edit
 * @param {int} verse - the verse that was edited
 * @param {string} before - the verse text before the edit
 * @param {string} after - the verse text after the edit
 * @param {string[]} tags - an array of tags indicating the reason for the edit
 * @param {string} username - the current user's username
 * @param {string} modified - the edit timestamp
 * @param {string|null} [glCode=null] - the gateway language code
 * @param {string|null} [glQuote=null] - the gateway language code
 * @return {Object} - record to save to file
 */
export const recordTargetVerseEdit = (bookId, chapter, verse, before, after, tags, username, modified, glCode=null, glQuote=null,
  {
    reference:{ chapter:activeChapter, verse:activeVerse }, quote, groupId, occurrence,
  }) => ({
  type: ADD_VERSE_EDIT,
  before,
  after,
  tags,
  username,
  activeBook: bookId,
  activeChapter,
  activeVerse,
  modifiedTimestamp: modified,
  gatewayLanguageCode: glCode,
  gatewayLanguageQuote: glQuote,
  reference: {
    bookId,
    chapter: parseInt(chapter, 10),
    verse: verse,
    groupId,
  },
  quote,
  occurrence,
});

/**
 * batch setting verse edit flags for all tw checks in verse if not set
 * @param {object} groupsData - groups Data.
 * @param {object} contextId - of verse edit.
 * @param {object} editedChecks - gets loaded with verse edits indexed by groupId.
 * @param {string} projectSaveLocation - project Directory path.
 */
export const getCheckVerseEditsInGroupData = (groupsData, contextId, editedChecks, projectSaveLocation) => {
  const matchedGroupData = getGroupDataForVerse(groupsData, contextId);
  const keys = Object.keys(matchedGroupData);

  if (keys.length) {
    for (let i = 0, l = keys.length; i < l; i++) {
      const groupItem = matchedGroupData[keys[i]];

      if (groupItem) {
        for (let j = 0, lenGI = groupItem.length; j < lenGI; j++) {
          const check = groupItem[j];

          if (!check.verseEdits) { // only set if not yet set
            const groupId = check.contextId.groupId;

            if (!editedChecks[groupId]) {
              editedChecks[groupId] = [];
            }
            editedChecks[groupId].push({
              type: TOGGLE_VERSE_EDITS_IN_GROUPDATA,
              contextId: check.contextId,
              projectSaveLocation,
            });
          }
        }
      }
    }
  }
};

/**
 * Populates batch and optimizes by combining multiple edits for a groupID
 * @param {Object} editedChecks - gets loaded with verse edits indexed by groupId
 * @param {Array} actionBatch - will be populated with verse edit actions
 * @return {{groupIds: Array, groupEditsCount: Number}}
 */
export const editChecksToBatch = (editedChecks, actionBatch) => {
  const groupIds = Object.keys(editedChecks);
  let groupEditsCount = 0;

  // process by group
  for (let j = 0, l = groupIds.length; j < l; j++) {
    const groupId = groupIds[j];
    const verseEdits = editedChecks[groupId];

    // for each verseEdit
    for (let k = 0, l2 = verseEdits.length; k < l2; k++) {
      actionBatch.push(verseEdits[k]);
      groupEditsCount += 1;
    }
  }
  return { groupIds, groupEditsCount };
};
