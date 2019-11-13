import path from 'path-extra';
import ospath from 'ospath';

// Paths
export const USER_RESOURCES_PATH = path.join(ospath.home(), 'translationCore', 'resources');
export const PROJECT_DOT_APPS_PATH = path.join('.apps', 'translationCore');
export const PROJECT_CHECKDATA_DIRECTORY = path.join(PROJECT_DOT_APPS_PATH, 'checkData');
// String names
export const SOURCE_CONTENT_UPDATER_MANIFEST = 'source-content-updater-manifest.json';
export const TRANSLATION_NOTES = 'translationNotes';
export const TRANSLATION_WORDS = 'translationWords';
export const TRANSLATION_ACADEMY = 'translationAcademy';
export const NT_ORIG_LANG = 'el-x-koine';
export const NT_ORIG_LANG_BIBLE = 'ugnt';
export const OT_ORIG_LANG = 'hbo';
export const OT_ORIG_LANG_BIBLE = 'uhb';
// Numbers
export const DEFAULT_MAX_SELECTIONS = 4;
export const TN_MAX_SELECTIONS = 10;
