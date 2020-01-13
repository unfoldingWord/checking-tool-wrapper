import { batchActions } from 'redux-batched-actions';
import generateTimestamp from '../../utils/generateTimestamp';
import { getContextId, getGroupsData } from '../../selectors';
import {
  WORD_ALIGNMENT,
  TRANSLATION_WORDS,
  TRANSLATION_NOTES,
} from '../../common/constants';
import { writeTranslationWordsVerseEditToFile } from '../../helpers/verseEditHelpers';
import { getGroupDataForVerse } from '../../helpers/groupDataHelpers';
import {
  ADD_VERSE_EDIT,
  UPDATE_TARGET_VERSE,
  TOGGLE_VERSE_EDITS_IN_GROUPDATA,
  TOGGLE_MULTIPLE_VERSE_EDITS_IN_GROUPDATA,
} from './actionTypes';
import { validateSelections, showInvalidatedWarnings } from './selectionsActions';

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
 * @param {string} selectedToolName - tool name.
 */
export const editTargetVerse = (chapterWithVerseEdit, verseWithVerseEdit, before, after, tags, username, gatewayLanguageCode, gatewayLanguageQuote, projectSaveLocation, selectedToolName) => (dispatch, getState) => {
  const state = getState();
  const contextId = getContextId(state);
  const currentCheckContextId = contextId;
  const {
    bookId, chapter: currentCheckChapter, verse: currentCheckVerse,
  } = currentCheckContextId.reference;
  verseWithVerseEdit = (typeof verseWithVerseEdit === 'string') ? parseInt(verseWithVerseEdit) : verseWithVerseEdit; // make sure number

  const contextIdWithVerseEdit = {
    ...currentCheckContextId,
    reference: {
      ...currentCheckContextId.reference,
      chapter: chapterWithVerseEdit,
      verse: verseWithVerseEdit,
    },
  };
  const selectionsValidationResults = {};
  const actionsBatch = [];

  dispatch(validateSelections(after, contextIdWithVerseEdit, chapterWithVerseEdit, verseWithVerseEdit,
    false, selectionsValidationResults, actionsBatch, projectSaveLocation, bookId, selectedToolName, username));

  // create verse edit record to write to file system
  const modifiedTimestamp = generateTimestamp();
  const verseEdit = {
    verseBefore: before,
    verseAfter: after,
    tags,
    username,
    activeBook: bookId,
    activeChapter: currentCheckChapter,
    activeVerse: currentCheckVerse,
    modifiedTimestamp,
    gatewayLanguageCode,
    gatewayLanguageQuote,
    contextId: contextIdWithVerseEdit,
  };

  dispatch(updateVerseEditStatesAndCheckAlignments(verseEdit, contextIdWithVerseEdit, currentCheckContextId,
    selectionsValidationResults.selectionsChanged, actionsBatch));
};

/**
 * Updates the verse text in the target language bible resource.
 * This will not write any changes to the disk.
 * @param {int} chapter
 * @param {int} verse
 * @param {string} text
 */
export const updateTargetVerse = (chapter, verse, text) => ({
  type: UPDATE_TARGET_VERSE,
  editedText: text,
  chapter,
  verse,
});


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
 * @param {Object} contextIdWithVerseEdit - contextId of verse being edited
 * @param {Object} currentCheckContextId - contextId of group menu item selected
 * @param {Boolean} showSelectionInvalidated - if true then show prompt that selections invalidated
 * @param {Array|null} batchGroupData - if present then add group data actions to this array for later batch operation
 * @param {Object} selectedToolName -
 * @param {Object} translate -
 * @param {Object} showAlert -
 * @param {Object} closeAlert -
 * @param {Object} projectSaveLocation -
 */
export const updateVerseEditStatesAndCheckAlignments = (verseEdit, contextIdWithVerseEdit, currentCheckContextId, showSelectionInvalidated, batchGroupData = null, selectedToolName, translate, showAlert, closeAlert, projectSaveLocation, showIgnorableAlert) => (dispatch) => {
  const actionsBatch = Array.isArray(batchGroupData) ? batchGroupData : []; // if batch array passed in then use it, otherwise create new array
  showAlert(translate('tools.invalidation_checking'), true);
  // await delay(1000); TODO:
  const chapterWithVerseEdit = contextIdWithVerseEdit.reference.chapter;
  const verseWithVerseEdit = contextIdWithVerseEdit.reference.verse;
  dispatch(updateTargetVerse(chapterWithVerseEdit, verseWithVerseEdit, verseEdit.verseAfter));

  if (selectedToolName === WORD_ALIGNMENT) {
    // since tw group data is not loaded into reducer, need to save verse edit record directly to file system
    dispatch(writeTranslationWordsVerseEditToFile(verseEdit, projectSaveLocation));
    // in group data reducer set verse edit flag for the verse edited
    dispatch({
      type: TOGGLE_VERSE_EDITS_IN_GROUPDATA,
      contextId: contextIdWithVerseEdit,
    });
  }

  // TODO: Ask Joel how to use tool api within its own codebase.
  // const api = Api();
  let showAlignmentsInvalidated = false;
  // showAlignmentsInvalidated = !api.validateVerse(chapterWithVerseEdit, verseWithVerseEdit, true);

  closeAlert();

  if (showSelectionInvalidated || showAlignmentsInvalidated) {
    dispatch(showInvalidatedWarnings(showSelectionInvalidated, showAlignmentsInvalidated, null, translate, showIgnorableAlert));
  }
  dispatch(doBackgroundVerseEditsUpdates(verseEdit, contextIdWithVerseEdit,
    currentCheckContextId, actionsBatch, selectedToolName));
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
 */
export const doBackgroundVerseEditsUpdates = (verseEdit, contextIdWithVerseEdit, currentCheckContextId, batchGroupData = null, toolName) => (dispatch, getState) => {
  const chapterWithVerseEdit = contextIdWithVerseEdit.reference.chapter;
  const verseWithVerseEdit = contextIdWithVerseEdit.reference.verse;

  dispatch(recordTargetVerseEdit(verseEdit.activeBook, chapterWithVerseEdit, verseWithVerseEdit,
    verseEdit.verseBefore, verseEdit.verseAfter, verseEdit.tags, verseEdit.userName, generateTimestamp(),
    verseEdit.gatewayLanguageCode, verseEdit.gatewayLanguageQuote, currentCheckContextId));

  const actionsBatch = Array.isArray(batchGroupData) ? batchGroupData : []; // if batch array passed in then use it, otherwise create new array
  const state = getState();
  const groupsData = getGroupsData(state);

  if (toolName === TRANSLATION_WORDS || toolName === TRANSLATION_NOTES) {
    const editedChecks = {};
    getCheckVerseEditsInGroupData(groupsData, contextIdWithVerseEdit, editedChecks);
    const { groupEditsCount } = editChecksToBatch(editedChecks, actionsBatch); // optimize edits into batch

    if (groupEditsCount) {
      console.log(`doBackgroundVerseEditsUpdates() - ${groupEditsCount} group edits found`);
    }
  }
  dispatch(batchActions(actionsBatch));
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
    chapter: parseInt(chapter),
    verse: parseInt(verse),
    groupId,
  },
  quote,
  occurrence,
});

/**
 * batch setting verse edit flags for all tw checks in verse if not set
 * @param {Object} state - current state
 * @param {Object} contextId - of verse edit
 * @param {Object} editedChecks - gets loaded with verse edits indexed by groupId
 */
export const getCheckVerseEditsInGroupData = (groupsData, contextId, editedChecks) => {
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

    if (verseEdits.length === 1) { // if only one, then don't need to combine
      actionBatch.push(verseEdits[0]); // batch the only verse edit
      groupEditsCount += 1;
    } else { // combine multiple verse edits into one call
      const references = verseEdits.map(item => (item.contextId.reference)); // just get all the references to change

      actionBatch.push({
        type: TOGGLE_MULTIPLE_VERSE_EDITS_IN_GROUPDATA,
        groupId,
        references,
      });
      groupEditsCount += references.length;
    }
  }
  return { groupIds, groupEditsCount };
};