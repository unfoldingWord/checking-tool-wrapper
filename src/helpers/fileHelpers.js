import fs from 'fs-extra';
import path from 'path-extra';
import { resourcesHelpers } from 'tc-source-content-updater';
import { isBibleBookId } from '../common/booksOfTheBible';

/**
 * Reads and parses a JSON file if it exists.
 * @param {string} jsonPath - path to the JSON file
 * @returns {Object|null} parsed JSON contents, or null if the file doesn't exist or fails to parse
 */
export function readJsonFile(jsonPath) {
  if (fs.existsSync(jsonPath)) {
    try {
      const resourceManifest = fs.readJsonSync(jsonPath);
      return resourceManifest;
    } catch (e) {
      console.error(`readJsonFile(): could not read ${jsonPath}`, e);
    }
  }
  return null;
}

/**
 * Checks whether a path is a directory.
 * @param {string} fullPath - path to check
 * @returns {boolean} true if the path is a directory
 */
export function isDirectory(fullPath) {
  return fs.lstatSync(fullPath).isDirectory();
}

/**
 * Reads a file's contents as UTF-8 text.
 * @param {string} filePath - path to the file
 * @returns {string} file contents
 */
export function readTextFile(filePath) {
  const data = fs.readFileSync(filePath, 'UTF-8').toString();
  return data;
}

/**
 * Recursively reads a helps folder, parsing JSON and Markdown files and descending into subfolders.
 * @param {string} folderPath - path to the helps folder
 * @param {string} [filterBook=''] - when set, limits the 'groups' subfolder to this book's contents
 * @returns {Object} nested contents of the folder, keyed by file/folder name
 */
export function readHelpsFolder(folderPath, filterBook = '') {
  const contents = {}
  const files = fs.readdirSync(folderPath)
  for (const file of files) {
    const filePath = path.join(folderPath, file)
    const parts = path.parse(file)
    const key = parts.name
    const type = parts.ext
    if (type === '.json') {
      const data = readJsonFile(filePath)
      if (data) {
        contents[key] = data
      }
    } else if (type === '.md') {
      const data = readTextFile(filePath)
      if (data) {
        contents[key] = data
      }
    } else if (isDirectory(filePath)) {
      if ((key === 'groups') && filterBook) {
        const bookPath = path.join(filePath, filterBook)
        const data = readHelpsFolder(bookPath)
        contents[key] = data
      } else {
        const data = readHelpsFolder(filePath, filterBook)
        contents[key] = data
      }
    }
  }
  return contents
}

/**
 * Extracts language, resource, and book IDs from a project name, supporting both old and new naming formats.
 * @param {string} projectName - project name, e.g. 'en_ult_tit_book' or 'aaw_php_text_reg'
 * @returns {{bookId: string, languageId: string, resourceId: string}} extracted details
 */
export function getDetailsFromProjectNameMini(projectName) {
  let bookId = '';
  let languageId = '';
  let resourceId = '';

  if (projectName) {
    const parts = projectName.split('_');
    languageId = parts[0];
    resourceId = (parts?.length >= 4) ? parts[1] : '';

    // we can have a bunch of old formats (e.g. en_act, aaw_php_text_reg) and new format (en_ult_tit_book)
    for (let i = 1; i < parts.length; i++) { // iteratively try the fields to see if valid book ids
      const possibleBookId = parts[i].toLowerCase();

      if (isBibleBookId(possibleBookId)) {
        bookId = possibleBookId;
        break;
      }
    }
  }
  return {
    bookId,
    languageId,
    resourceId,
  };
}

/**
 * Resolves the actual resourcesHelpers module, unwrapping a nested `resourcesHelpers.resourcesHelpers` if present.
 * @returns {Object} the resourcesHelpers module
 */
function getNestedResourcesHelpers() {
  let resourcesHelpers_ = resourcesHelpers;

  if (resourcesHelpers?.resourcesHelpers) {
    // TRICKY - check if nested
    resourcesHelpers_ = resourcesHelpers.resourcesHelpers;
  }
  return resourcesHelpers_;
}

/**
 * Returns the versioned folder within the directory with the highest value.
 * e.g. `v10` is greater than `v9`
 * @param {Array} versions - list of versions found
 * @param {string} ownerStr - optional owner, if not given defaults to Door43-Catalog
 * @returns {string|null} the latest version found
 */
export function getLatestVersion(versions, ownerStr) {
  const resourcesHelpers = getNestedResourcesHelpers();
  return resourcesHelpers.getLatestVersionFromList(versions, ownerStr);
}

/**
 * Search folder for most recent version
 * @param {string} bibleFolderPath
 * @param {string} ownerStr - optional owner, if not given defaults to Door43-Catalog
 * @return {string} latest version found
 */
export function getMostRecentVersionInFolder(bibleFolderPath, ownerStr = apiHelpers.DOOR43_CATALOG) {
  const versionNumbers = fs.readdirSync(bibleFolderPath).filter(folder => folder !== '.DS_Store'); // ex. v9

  if (versionNumbers && versionNumbers.length) {
    const latestVersion = getLatestVersion(
      versionNumbers,
      ownerStr
    );
    return latestVersion;
  }
  return null;
}

/**
 * Search folder for most recent version, if the folder exists.
 * @param {string} bibleFolderPath
 * @param {string} ownerStr - optional owner, if not given defaults to Door43-Catalog
 * @returns {string|null} latest version found, or null if the folder doesn't exist
 */
export function getMostRecentVersionInFolderMajor(bibleFolderPath, ownerStr = apiHelpers.DOOR43_CATALOG) {
  if (fs.existsSync(bibleFolderPath)) {
    return getMostRecentVersionInFolder(bibleFolderPath, ownerStr);
  }
  return null;
}
