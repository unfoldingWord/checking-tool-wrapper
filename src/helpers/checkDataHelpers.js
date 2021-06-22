import fs from 'fs-extra';
import path from 'path-extra';
import isEqual from 'deep-equal';
import { PROJECT_CHECKDATA_DIRECTORY } from '../common/constants';
import {
  ADD_COMMENT,
  SET_INVALIDATED,
  SET_BOOKMARK,
  CHANGE_SELECTIONS,
} from '../state/actions/actionTypes';

/**x
 * @description loads checkdata from project for specific key.
 * @param {string} projectSaveLocation - path to project
 * @param {object} contextId - groupData unique context Id.
 * @param {string} key - to fetch (e.g. 'selections')
 * @return {object} returns the object loaded from the file system.
 */
export function loadCheckDataForKey(projectSaveLocation, contextId, key) {
  const loadPath = generateLoadPath(projectSaveLocation, contextId, key);
  const checkData = loadCheckData(loadPath, contextId);
  return checkData;
}

/**x
 * @description loads checkdata based on given contextId.
 * @param {String} loadPath - load path.
 * @param {object} contextId - groupData unique context Id.
 * @return {object} returns the object loaded from the file system.
 */
export function loadCheckData(loadPath, contextId) {
  let checkDataObject;

  if (loadPath && contextId && fs.existsSync(loadPath)) {
    let files = fs.readdirSync(loadPath);

    files = files.filter(file => // filter the filenames to only use .json
      path.extname(file) === '.json'
    );

    let sorted = files.sort().reverse(); // sort the files to put latest first
    const isQuoteArray = Array.isArray(contextId.quote);

    for (let i = sorted.length - 1; i >= 0; i--) { // check starting with most recent
      const file = sorted[i];

      // check each file for contextId
      try {
        const readPath = path.join(loadPath, file);
        let _checkDataObject = fs.readJsonSync(readPath);

        if (_checkDataObject && _checkDataObject.contextId &&
          _checkDataObject.contextId.groupId === contextId.groupId &&
          _checkDataObject.contextId.checkId === contextId.checkId &&
          (isQuoteArray ? isEqual(_checkDataObject.contextId.quote, contextId.quote) : (_checkDataObject.contextId.quote === contextId.quote)) &&
          _checkDataObject.contextId.occurrence === contextId.occurrence) {
          checkDataObject = _checkDataObject; // return the first match since it is the latest modified one
          break;
        }
      } catch (err) {
        console.warn('File exists but could not be loaded \n', err);
      }
    }
  }
  /**
  * @description Will return undefined if checkDataObject was not populated
  * so that the load method returns and then dispatches an empty action object
  * to initialized the reducer.
  */
  return checkDataObject;
}

/**
 * Generates the output directory.
 * @param {string} projectSaveLocation - Project's absolute path.
 * @param {object} contextId - context id.
 * @param {string} checkDataName - checkData folder name.
 * @return {string} save path
 * e.g. /translationCore/ar_eph_text_ulb/.apps/translationCore/checkData/comments/eph/1/3
 */
export function generateLoadPath(projectSaveLocation, contextId, checkDataName) {
  if (projectSaveLocation) {
    const bookAbbreviation = contextId.reference.bookId;
    const chapter = contextId.reference.chapter.toString();
    const verse = contextId.reference.verse.toString();
    const loadPath = path.join(
      projectSaveLocation,
      PROJECT_CHECKDATA_DIRECTORY,
      checkDataName,
      bookAbbreviation,
      chapter,
      verse
    );
    return loadPath;
  } else {
    console.warn('projectSaveLocation is undefined');
  }
}

/**
 * Loads the latest comment file from the file system for the specify contextID.
 * @param {string} projectSaveLocation - Project's absolute path.
 * @param {object} contextId - context id.
 * @return {Object} Dispatches an action that loads the commentsReducer with data.
 */
export function loadComments(projectSaveLocation, contextId) {
  const commentsObject = loadCheckDataForKey(projectSaveLocation, contextId, 'comments');

  if (commentsObject) {
    return {
      type: ADD_COMMENT,
      modifiedTimestamp: commentsObject.modifiedTimestamp,
      text: commentsObject.text,
      userName: commentsObject.userName,
    };
  } else {
    // The object is undefined because the file wasn't found in the directory thus we init the reducer to a default value.
    return {
      type: ADD_COMMENT,
      modifiedTimestamp: '',
      text: '',
      userName: '',
    };
  }
}

/**
 * Loads the latest invalidated file from the file system for the specify contextID.
 * @param {string} projectSaveLocation - project path.
 * @param {*} contextId - context id.
 * @param {string} gatewayLanguageCode - gateway language code.
 * @param {string} gatewayLanguageQuote - gateway language quote.
 */
export function loadInvalidated(projectSaveLocation, contextId, gatewayLanguageCode, gatewayLanguageQuote) {
  const invalidatedObject = loadCheckDataForKey(projectSaveLocation, contextId, 'invalidated');

  if (invalidatedObject) {
    return {
      type: SET_INVALIDATED,
      enabled: invalidatedObject.enabled,
      username: invalidatedObject.userName || invalidatedObject.username,
      modifiedTimestamp: invalidatedObject.modifiedTimestamp,
      gatewayLanguageCode,
      gatewayLanguageQuote,
    };
  } else {
    // The object is undefined because the file wasn't found in the directory thus we init the reducer to a default value.
    return {
      type: SET_INVALIDATED,
      enabled: false,
      modifiedTimestamp: '',
      username: '',
      gatewayLanguageCode: null,
      gatewayLanguageQuote: null,
    };
  }
}

/**
 * Loads the latest bookmarks file from the file system for the specify contextID.
 * @param {string} projectSaveLocation - project path.
 * @param {*} contextId - context id.
 * @param {string} gatewayLanguageCode - gateway language code.
 * @param {string} gatewayLanguageQuote - gateway language quote.
 */
export function loadBookmarks(projectSaveLocation, contextId, gatewayLanguageCode, gatewayLanguageQuote) {
  const remindersObject = loadCheckDataForKey(projectSaveLocation, contextId, 'reminders');

  if (remindersObject) {
    return {
      type: SET_BOOKMARK,
      enabled: remindersObject.enabled,
      username: remindersObject.userName || remindersObject.username,
      modifiedTimestamp: remindersObject.modifiedTimestamp,
      gatewayLanguageCode,
      gatewayLanguageQuote,
    };
  } else {
    // The object is undefined because the file wasn't found in the directory thus we init the reducer to a default value.
    return {
      type: SET_BOOKMARK,
      enabled: false,
      modifiedTimestamp: '',
      username: '',
      gatewayLanguageCode: null,
      gatewayLanguageQuote: null,
    };
  }
}

/**
 * Loads the latest selections file from the file system for the specific contextID.
 * @param {string} projectSaveLocation - project path.
 * @param {*} contextId - context id.
 * @return {Object} Dispatches an action that loads the selectionsReducer with data.
 */
export function loadSelections(projectSaveLocation, contextId) {
  const selectionsObject = loadCheckDataForKey(projectSaveLocation, contextId, 'selections');

  if (selectionsObject) {
    let {
      selections,
      modifiedTimestamp,
      nothingToSelect,
      username,
      userName, // for old project data
      gatewayLanguageCode,
      gatewayLanguageQuote,
    } = selectionsObject;
    username = username || userName;

    return {
      type: CHANGE_SELECTIONS,
      selections: selections,
      nothingToSelect: nothingToSelect,
      username,
      modifiedTimestamp: modifiedTimestamp,
      gatewayLanguageCode: gatewayLanguageCode,
      gatewayLanguageQuote: gatewayLanguageQuote,
    };
  } else {
    // The object is undefined because the file wasn't found in the directory thus we init the reducer to a default value.
    return {
      type: CHANGE_SELECTIONS,
      modifiedTimestamp: null,
      selections: [],
      username: null,
    };
  }
}

/**
 * checks to see if verseEdits are recorded for this verse in checks.
 * @param {*} projectSaveLocation - project path.
 * @param {*} contextId - context id.
 * @return {Boolean} true if verse has been edited
 */
export function loadVerseEdit(projectSaveLocation, contextId) {
  const verseEditPath = generateLoadPath(projectSaveLocation, contextId, 'verseEdits');
  return fs.existsSync(verseEditPath);
}
