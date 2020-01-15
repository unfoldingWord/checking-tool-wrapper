// TODO: IF THIS FILE GETS To long separate functions by categories
import fs from 'fs-extra';
import path from 'path-extra';
import generateTimestamp from '../utils/generateTimestamp';
import { PROJECT_CHECKDATA_DIRECTORY } from '../common/constants';

/**
 * Generates the output directory.
 * @param {object} contextId - context id.
 * @param {String} checkDataName - checkData folder name.
 *  @example comments, bookmarks, selections, verseEdits etc.
 * @param {String} modifiedTimestamp - timestamp.
 * that contains the specific timestamp.
 * @return {String} save path.
 */
function generateSavePath(contextId, checkDataName, modifiedTimestamp, projectSaveLocation) {
  try {
    if (projectSaveLocation && contextId && modifiedTimestamp) {
      const bookAbbreviation = contextId.reference.bookId;
      const chapter = contextId.reference.chapter.toString();
      const verse = contextId.reference.verse.toString();
      const fileName = modifiedTimestamp + '.json';
      const savePath = path.join(
        projectSaveLocation,
        PROJECT_CHECKDATA_DIRECTORY,
        checkDataName,
        bookAbbreviation,
        chapter,
        verse,
        fileName.replace(/[:"]/g, '_')
      );
      return savePath;
    } else {
      console.error(`projectSaveLocation is undefined`, );
    }
  } catch (err) {
    console.error(err);
  }
}

/**
 * abstracted function to handle data saving.
 * @param {object} contextId - context Id.
 * @param {string} checkDataName - checkDate folder name where data will be saved.
 *  @example 'comments', 'bookmarks', 'selections', 'verseEdits' etc
 * @param {object} payload - checkData.
 * @param {string} modifiedTimestamp - timestamp.
 */
function saveData(contextId, checkDataName, payload, modifiedTimestamp, projectSaveLocation) {
  return new Promise((resolve, reject) => {
    try {
      const savePath = generateSavePath(contextId, checkDataName, modifiedTimestamp, projectSaveLocation);

      if (savePath) {
        fs.outputJsonSync(savePath, payload, { spaces: 2 });
        console.info(`Succesfully saved: ${checkDataName} check data item.`);
        resolve();
      } else {
        const errorMessage = `saveData(): savePath is undefined or path does not exists ${savePath}`;
        console.error(errorMessage);
        reject(errorMessage);
      }
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}

/**
 * Saves the bookmarks check data.
 * @param {object} contextId - context Id.
 * @param {object} bookmarkData - bookmark check Data.
 * @param {string} projectSaveLocation - project directory Path.
 */
export const saveBookmark = (contextId, bookmarkData, projectSaveLocation) => {
  try {
    const bookmarkPayload = {
      contextId,
      ...bookmarkData,
    };
    const modifiedTimestamp = bookmarkData.modifiedTimestamp || generateTimestamp();
    return saveData(contextId, 'reminders', bookmarkPayload, modifiedTimestamp, projectSaveLocation);
  } catch (err) {
    console.error(err);
    throw new Error(err);
  }
};

// TODO: Review code below
/**
 * This function saves the selections data.
 * @param {Object} state - The state object courtesy of the store
 */
export const saveSelections = state => {
  try {
    let selectionsPayload = {
      ...state.contextIdReducer,
      ...state.selectionsReducer,
    };
    let modifiedTimestamp = state.selectionsReducer.modifiedTimestamp;
    saveData(state, 'selections', selectionsPayload, modifiedTimestamp);
  } catch (err) {
    console.warn(err);
  }
};

/**
* saves selection data for a context that is not current
* @param {String} gatewayLanguageCode
* @param {String} gatewayLanguageQuote
* @param {Array} selections
* @param {Boolean} invalidated
* @param {String} userName
* @param {Object} contextId
*/
export const saveSelectionsForOtherContext = (state, gatewayLanguageCode, gatewayLanguageQuote, selections, invalidated, userName, contextId) => {
  const selectionData = {
    modifiedTimestamp: generateTimestamp(),
    gatewayLanguageCode,
    gatewayLanguageQuote,
    selections,
    userName,
  };
  const newState = {
    projectDetailsReducer: state.projectDetailsReducer,
    contextIdReducer: { contextId },
    selectionsReducer: selectionData,
  };
  saveSelections(newState);
  saveInvalidatedForOtherContext(state, gatewayLanguageCode, gatewayLanguageQuote, invalidated, userName, contextId); // now update invalidated
};

/**
 * saves selection data for a context that is not current
 * @param {Object} state
 * @param {String} gatewayLanguageCode
 * @param {String} gatewayLanguageQuote
 * @param {Boolean} invalidated
 * @param {String} username
 * @param {Object} contextId
 */
export const saveInvalidatedForOtherContext = (state, gatewayLanguageCode, gatewayLanguageQuote, invalidated, username, contextId) => {
  delete invalidated.invalidatedChecksTotal;
  delete invalidated.verseEditsTotal;
  delete invalidated.invalidatedAlignmentsTotal;
  const selectionData = {
    modifiedTimestamp: generateTimestamp(),
    gatewayLanguageCode,
    gatewayLanguageQuote,
    invalidated,
    username,
  };
  const newState = {
    projectDetailsReducer: state.projectDetailsReducer,
    contextIdReducer: { contextId },
    invalidatedReducer: selectionData,
  };
  saveInvalidated(newState);
};

/**
 * This function saves the invalidated data.
 * @param {object} state - store state object.
 */
export const saveInvalidated = state => {
  try {
    let invalidatedPayload = {
      ...state.contextIdReducer,
      ...state.invalidatedReducer,
    };
    let modifiedTimestamp = state.invalidatedReducer.modifiedTimestamp;
    saveData(state, 'invalidated', invalidatedPayload, modifiedTimestamp);
  } catch (err) {
    console.warn(err);
  }
};
