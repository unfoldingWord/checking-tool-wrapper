import path from 'path-extra';
import { PROJECT_INDEX_FOLDER_PATH } from '../common/constants';

/**
 * find path in index for current contextId
 * @param {String} projectSaveLocation
 * @param {String} toolName
 * @param {String} bookId
 */
export function getContextIdPathFromIndex(projectSaveLocation, toolName, bookId) {
  return path.join(projectSaveLocation, PROJECT_INDEX_FOLDER_PATH, toolName, bookId, 'currentContextId', 'contextId.json');
}
