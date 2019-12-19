// TODO: IF THIS FILE GETS To long separate functions by categiries
import fs from 'fs-extra';
import path from 'path-extra';
import isEqual from 'deep-equal';
import generateTimestamp from '../utils/generateTimestamp';
import { PROJECT_CHECKDATA_DIRECTORY } from '../common/constants';
import { loadCheckData } from '../helpers/checkDataHelpers';

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
    console.warn(err);
  }
}

/**
 * abstracted function to handle data saving.
 * @param {object} state - store state object.
 * @param {string} checkDataName - checkDate folder name where data will be saved.
 *  @example 'comments', 'reminders', 'selections', 'verseEdits' etc
 * @param {object} payload - object of data: merged contextIdReducer and commentsReducer.
 * @param {string} modifiedTimestamp - timestamp.
 */
function saveData(state, checkDataName, payload, modifiedTimestamp) {
  try {
    let savePath = generateSavePath(state, checkDataName, modifiedTimestamp);

    if (savePath !== undefined) {
      // since contextId updates and triggers the rest to load, contextId get's updated and fires this.
      // let's not overwrite files, so check to see if it exists.
      const saveDir = path.parse(savePath).dir;
      const existingPayload = loadCheckData(saveDir, payload.contextId);

      if (!fs.existsSync(savePath) && !isEqual(existingPayload, payload)) {
        fs.outputJsonSync(savePath, payload, { spaces: 2 });
      }
    } else {
      // no savepath
    }
  } catch (err) {
    console.warn(err);
  }
}

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
