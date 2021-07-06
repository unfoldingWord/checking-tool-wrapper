import fs from 'fs-extra';
import path from 'path-extra';
import isEqual from 'deep-equal';
import { batchActions } from 'redux-batched-actions';
import {
  CLEAR_PREVIOUS_GROUPS_DATA,
  SET_BOOKMARKS_IN_GROUPDATA,
  SET_INVALIDATION_IN_GROUPDATA,
  LOAD_GROUPS_DATA_FROM_FS,
  TOGGLE_VERSE_EDITS_IN_GROUPDATA,
  TOGGLE_COMMENTS_IN_GROUPDATA,
  TOGGLE_SELECTIONS_IN_GROUPDATA,
} from '../actions/actionTypes';
import {
  findGroupDataItem,
  getGroupDataForVerse,
  loadProjectGroupData,
} from '../../helpers/groupDataHelpers';
import { PROJECT_CHECKDATA_DIRECTORY } from '../../common/constants';
import { getGroupsData } from '../../selectors/index';
import { editChecksToBatch } from './verseEditActions';

/**
 * Loads all of a tool's group data from the project.
 * @param {string} toolName - the name of the tool who's helps will be loaded.
 * @param {string} projectDir - the absolute path to the project.
 */
export const loadGroupsData = (toolName, projectDir) => (dispatch) => {
  const groupsData = loadProjectGroupData(toolName, projectDir);

  dispatch({
    type: LOAD_GROUPS_DATA_FROM_FS,
    groupsData,
  });
};

/**
 * Clears the GroupsDataReducer to its inital state.
 */
export const clearGroupsData = () => ({ type: CLEAR_PREVIOUS_GROUPS_DATA });

/**
 * @description verifies that the data in the checkdata folder is reflected in the groups data.
 * @param {String} toolName
 * @param {String} projectSaveLocation
 * @param {String} bookID
 * @return {object} action object.
 */
export function verifyGroupDataMatchesWithFs(toolName, projectSaveLocation, bookID) {
  console.log(`verifyGroupDataMatchesWithFs(${toolName})`);
  return (async (dispatch, getState) => {
    const groupsData = getGroupsData(getState());
    const checkDataPath = path.join(
      projectSaveLocation,
      PROJECT_CHECKDATA_DIRECTORY
    );

    const checkVerseEdits = {};

    // build the batch
    let actionsBatch = [];

    if (fs.existsSync(checkDataPath)) {
      let folders = fs.readdirSync(checkDataPath).filter(folder => folder !== '.DS_Store');
      const isCheckTool = true;

      for (let i = 0, lenF = folders.length; i < lenF; i++) {
        const folderName = folders[i];
        const isVerseEdit = folderName === 'verseEdits';
        const isCheckVerseEdit = isCheckTool && isVerseEdit;
        let dataPath = generatePathToDataItems(projectSaveLocation, folderName, bookID);

        if (!fs.existsSync(dataPath)) {
          continue;
        }

        let chapters = fs.readdirSync(dataPath);
        chapters = filterAndSort(chapters);

        for (let j = 0, lenC = chapters.length; j < lenC; j++) {
          const chapterFolder = chapters[j];
          const chapterDir = path.join(dataPath, chapterFolder);

          if (!fs.existsSync(chapterDir)) {
            continue;
          }

          let verses = fs.readdirSync(chapterDir);
          verses = filterAndSort(verses);

          for (let k = 0, lenV = verses.length; k < lenV; k++) {
            const verseFolder = verses[k];
            let filePath = path.join(dataPath, chapterFolder, verseFolder);
            let latestObjects = readLatestChecks(filePath);

            for (let l = 0, lenO = latestObjects.length; l < lenO; l++) {
              const object = latestObjects[l];
              const contextId = object.contextId;

              if (isCheckVerseEdit) {
                // special handling for check external verse edits, save edit verse
                const chapter = (contextId && contextId.reference && contextId.reference.chapter);

                if (chapter) {
                  const verse = contextId.reference.verse;

                  if (verse) {
                    const verseKey = chapter + ':' + verse; // save by chapter:verse to remove duplicates

                    if (!checkVerseEdits[verseKey]) {
                      const reference = {
                        bookId: contextId.reference.bookId,
                        chapter,
                        verse,
                      };
                      checkVerseEdits[verseKey] = { reference };
                    }
                  }
                }
              } else if (contextId.tool === toolName) {
                // TRICKY: make sure item is in reducer before trying to set.  In case of tN different GLs
                //  may have different checks
                const currentGroupData = groupsData[object.contextId.groupId];

                if (currentGroupData) {
                  const index = findGroupDataItem(object.contextId, currentGroupData);
                  const oldGroupObject = (index >= 0) ? currentGroupData[index] : null;

                  if (oldGroupObject) {
                    // only toggle if attribute values are different (folderName contains check attribute such as 'selections`)
                    const isChanged = isAttributeChanged(object, folderName, oldGroupObject);

                    if (isChanged) {
                      // TRICKY: we are using the contextId of oldGroupObject here because sometimes
                      //            there are slight differences with the contextIds of the checkData due to build
                      //            changes (such as quoteString) and getToggledGroupData() requires exact match
                      object.contextId = oldGroupObject.contextId;
                      const action = toggleGroupDataItems(folderName, object, projectSaveLocation);

                      if (action) {
                        actionsBatch.push(action);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (Object.keys(checkVerseEdits).length) {
        await dispatch(ensureCheckVerseEditsInGroupData(checkVerseEdits, projectSaveLocation));
      }

      // run the batch of queue actions
      if (actionsBatch.length) {
        console.log(`verifyGroupDataMatchesWithFs(${toolName}) - processing batch size: ${actionsBatch.length}`);
        dispatch(batchActions(actionsBatch));
      }
      console.log(`verifyGroupDataMatchesWithFs(${toolName}) - done`);
    }
  });
}

/**
 * make sure verse edit flag is set for all tw checks in verses
 * @param {Object} twVerseEdits - indexed by verse - contextIds for each verse edit
 * @param {String} projectSaveLocation
 * @return {Function}
 */
export const ensureCheckVerseEditsInGroupData = (twVerseEdits, projectSaveLocation) => (dispatch, getState) => {
  const versesEdited = Object.keys(twVerseEdits);

  if (versesEdited && versesEdited.length) {
    const state = getState();
    const editedChecks = {};

    for (let i = 0, lenVE = versesEdited.length; i < lenVE; i++) {
      const contextId = twVerseEdits[versesEdited[i]];
      getCheckVerseEditsInGroupData(state, contextId, editedChecks, projectSaveLocation);
    }

    const actionBatch = [];
    const { groupIds, groupEditsCount } = editChecksToBatch(editedChecks, actionBatch);

    if (actionBatch.length) {
      console.log('ensureCheckVerseEditsInGroupData() - edited verses=' + versesEdited.length);
      console.log('ensureCheckVerseEditsInGroupData() - actionBatch length=' + actionBatch.length);
      dispatch(batchActions(actionBatch));
      console.log('ensureCheckVerseEditsInGroupData() - total checks changed=' + groupEditsCount);
      console.log('ensureCheckVerseEditsInGroupData() - batch finished, groupId\'s edited=' + groupIds.length);
    }
  }
};

/**
 * batch setting verse edit flags for all checks in verse if not set
 * @param {Object} state - current state
 * @param {Object} contextId - of verse edit
 * @param {Object} editedChecks - gets loaded with verse edits indexed by groupId
 * @param {String} projectSaveLocation
 */
export const getCheckVerseEditsInGroupData = (state, contextId, editedChecks, projectSaveLocation) => {
  // in group data reducer set verse edit flag for every check of the verse edited
  const groupsData = getGroupsData(state);
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
 * @description generates a path to a check data item.
 * @param {string} PROJECT_SAVE_LOCATION - project path/directory.
 * @param {string} checkDataName - comments, reminders, selections and verseEdits folders.
 * @return {string} path/directory to be use to load a file.
 */
export function generatePathToDataItems(PROJECT_SAVE_LOCATION, checkDataName, bookID) {
  if (PROJECT_SAVE_LOCATION) {
    const loadPath = path.join(
      PROJECT_SAVE_LOCATION,
      PROJECT_CHECKDATA_DIRECTORY,
      checkDataName,
      bookID
    );
    return loadPath;
  }
}

/**
 * @description filters and sorts an array.
 * @param {array} array - array to be filtered and sorted.
 * @return {array} filtered and sorted array.
 */
export function filterAndSort(array) {
  let filteredArray = array.filter(folder => folder !== '.DS_Store').sort((a, b) => {
    a = parseInt(a, 10);
    b = parseInt(b, 10);
    return a - b;
  });
  return filteredArray;
}

/**
 * @description dispatches appropiate action based on label string.
 * @param {string} label - string to be use to determine which action to dispatch.
 * @param {object} fileObject - checkdata object.
 * @param {string} projectSaveLocation
 */
export function toggleGroupDataItems(label, fileObject, projectSaveLocation) {
  let action;

  switch (label) {
  case 'comments':
    action = {
      type: TOGGLE_COMMENTS_IN_GROUPDATA,
      contextId: fileObject.contextId,
      text: fileObject.text,
      projectSaveLocation,
    };
    break;
  case 'reminders':
    action = {
      type: SET_BOOKMARKS_IN_GROUPDATA,
      contextId: fileObject.contextId,
      boolean: fileObject.enabled,
      projectSaveLocation,
    };
    break;
  case 'selections':
    action = {
      type: TOGGLE_SELECTIONS_IN_GROUPDATA,
      contextId: fileObject.contextId,
      selections: fileObject.selections,
      nothingToSelect: fileObject.nothingToSelect,
      projectSaveLocation,
    };
    break;
  case 'verseEdits':
    action = {
      type: TOGGLE_VERSE_EDITS_IN_GROUPDATA,
      contextId: fileObject.contextId,
      projectSaveLocation,
    };
    break;
  case 'invalidated':
    action = {
      type: SET_INVALIDATION_IN_GROUPDATA,
      contextId: fileObject.contextId,
      boolean: fileObject.invalidated,
      projectSaveLocation,
    };
    break;
  default:
    action = null;
    console.warn('Undefined label in toggleGroupDataItems switch');
    break;
  }
  return action;
}

/**
 * Reads the latest unique checks from the directory.
 * @param {string} dir - directory where check data is saved.
 * @return {array} - array of the most recent check data
 */
export function readLatestChecks(dir) {
  let checks = [];

  if (!fs.existsSync(dir)) {
    return [];
  }

  // list sorted json files - most recents are in front of list
  const files = fs.readdirSync(dir).filter(file => path.extname(file) === '.json').sort().reverse();

  for (let i = 0, len = files.length; i < len; i ++) {
    const checkPath = path.join(dir, files[i]);

    try {
      const data = fs.readJsonSync(checkPath);

      if (isCheckUnique(data, checks)) {
        checks.push(data);
      }
    } catch (err) {
      console.error(`Check data could not be loaded from ${checkPath}`, err);
    }
  }

  return checks;
}

/**
 * get value for check attribute and compare with old value - tricky because there is no consistency in field names and representation of value for checks
 * @param {Object} object
 * @param {String} checkAttr
 * @param {Object} oldGroupObject
 * @return {Boolean} true if value has changed
 */
export function isAttributeChanged(object, checkAttr, oldGroupObject) {
  const oldValue = oldGroupObject[checkAttr];
  let value;

  switch (checkAttr) {
  case 'reminders':
    value = !!object['enabled']; // just want true if enabled
    return value !== !!oldValue; // compare boolean equivalents
  case 'comments':
    value = object['text'];
    return value ? (value !== oldValue) : (!value !== !oldValue); // if text set, do exact match.  Otherwise compare boolean equivalents
  case 'invalidated':
    value = !!object[checkAttr]; // just want true if set
    return value !== !!oldValue; // compare boolean equivalents
  case 'selections': {
    // first check for changes in nothingToSelect
    const oldSelectNothing = oldGroupObject['nothingToSelect'];
    const newSelectNothing = object['nothingToSelect'];
    let changed = (!oldSelectNothing !== !newSelectNothing); // compare boolean equivalents

    if (!changed) { // if no change in nothingToSelect, then compare selections
      value = object[checkAttr];
      const hasSelection = value && value.length;

      if (hasSelection) {
        changed = !isEqual(value, oldValue);
      } else {
        const hasOldSelection = oldValue && oldValue.length;
        changed = (!hasSelection !== !hasOldSelection); // compare boolean equivalents of has selections
      }
    }

    return changed;
  }
  case 'verseEdits':
    return true !== !!oldValue; // TRICKY: verse edit is special case since its value is always true
  default: // put warning in log that this check attribute is not supported
    console.log(`isValueChanged() - unsupported check attribute: ${checkAttr}`);
    return false;
  }
}

/**
 * compares quotes and can handle both arrays and strings
 * @param {object} previousCheckContextId
 * @param {object} checkContextId
 * @return {boolean} - true if the quotes are the same
 */
function isQuoteSame(previousCheckContextId, checkContextId) {
  return Array.isArray(previousCheckContextId.quote) ?
    isEqual(previousCheckContextId.quote, checkContextId.quote) : previousCheckContextId.quote === checkContextId.quote;
}

/**
 * Evaluates whether a check has already been loaded
 * @param {object} checkData - the json check data
 * @param {array} loadedChecks - an array of loaded unique checks
 * @returns {boolean} - true if the check has not been loaded yet.
 */
export function isCheckUnique(checkData, loadedChecks) {
  const checkContextId = checkData.contextId;

  if (checkContextId) {
    for (const check of loadedChecks) {
      if (!check.contextId) { // sanity check
        return false;
      }

      if (check.contextId.checkId === checkContextId.checkId &&
        check.contextId.groupId === checkContextId.groupId &&
        isQuoteSame(check.contextId, checkContextId) &&
        check.contextId.occurrence === checkContextId.occurrence) {
        return false;
      }
    }
    return true;
  }
  throw new Error('Invalid check data, missing contextId');
}
