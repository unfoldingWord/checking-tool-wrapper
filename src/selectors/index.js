import isEqual from 'deep-equal';
// reducers
import * as fromGrouspIndex from '../state/reducers/groupsIndexReducer';
import * as fromGroupsData from '../state/reducers/groupsDataReducer';
import * as fromGroupMenu from '../state/reducers/groupMenuReducer';
import * as fromContextId from '../state/reducers/contextIdReducer';
// constants
import {
  DEFAULT_MAX_SELECTIONS,
  TRANSLATION_NOTES,
  TN_MAX_SELECTIONS,
} from '../common/constants';

export const getGroupsIndex = (state) =>
  fromGrouspIndex.getGroupsIndex(state.tool.groupsIndexReducer);

export const getGroupsData = (state) =>
  fromGroupsData.getGroupsData(state.tool.groupsDataReducer);

export const getGroupsDataLoaded = (state) =>
  fromGroupsData.getGroupsDataLoaded(state.tool.groupsDataReducer);

export const getCurrentGroup = (state) => {
  const groupsData = getGroupsData(state);
  const contextId = getContextId(state);
  let currentGroupItem;

  if (contextId && groupsData[contextId.groupId]) {
    currentGroupItem = groupsData[contextId.groupId].find(groupData => isEqual(groupData.contextId, contextId));
  } else {
    currentGroupItem = null;
  }
  return currentGroupItem;
};

export const getGroupMenuFilters = (state) =>
  fromGroupMenu.getFilters(state.tool.groupMenuReducer);

export const getContextId = (state) =>
  fromContextId.getContext(state.tool.contextIdReducer);

export const getCommentsReducer = (state) =>
  state.tool.commentsReducer;

export const getSelectionsReducer = (state) =>
  state.tool.selectionsReducer;

export const getBookmarksReducer = (state) =>
  state.tool.bookmarksReducer;

export const getSelections = (state) =>
  state.tool.selectionsReducer.selections;

export const getProjectManifest = (ownProps) => ownProps.tc.projectDetailsReducer.manifest;
export const getGatewayLanguageCode = (ownProps) => ownProps.tc.gatewayLanguageCode || '';
export const getGatewayLanguageOwner = (ownProps) => ownProps.tc.gatewayLanguageOwner || '';
export const getCurrentToolName = (ownProps) => ownProps.tc.currentToolName;
export const getProjectPath = (ownProps) => ownProps.tc.projectSaveLocation;
export const getUserData = (ownProps) => ownProps.tc.loginReducer.userdata;
export const getGatewayLanguageBibles = (ownProps) => {
  const gatewayLanguageCode = getGatewayLanguageCode(ownProps);
  const gatewayLanguageOwner = getGatewayLanguageOwner(ownProps);
  const key = `${gatewayLanguageCode}_${gatewayLanguageOwner}`;
  return ownProps.tc.resourcesReducer.bibles[key] ||
    ownProps.tc.resourcesReducer.bibles[gatewayLanguageCode] || [];
};
export const getBookName = (ownProps) => ownProps.tc.project.getBookName();
export const getTargetBible = (ownProps) => ownProps.tc.resourcesReducer.bibles.targetLanguage.targetBible;
export const getTranslationHelpsArticle = (ownProps, contextId = {}) => {
  const article = ownProps.tc.resourcesReducer.translationHelps[ownProps.tc.currentToolName];
  const { groupId = '' } = contextId;

  return article && groupId ? article[groupId] : '';
};
export const getMaximumSelections = toolName => (toolName === TRANSLATION_NOTES) ? TN_MAX_SELECTIONS : DEFAULT_MAX_SELECTIONS;
export const getResourcesReducer = (ownProps) => ownProps.tc.resourcesReducer;
export const getBibles = (ownProps) => ownProps.tc.resourcesReducer.bibles;
export const getTranslationHelps = (ownProps) => {
  const resourcesReducer = ownProps.tc.resourcesReducer;
  return resourcesReducer['translationHelps'] ? resourcesReducer['translationHelps'] : {};
};
export const getProjectDetailsReducer = (ownProps) => ownProps.tc.projectDetailsReducer;
export const getTcState = (ownProps) => ownProps.tc;
export const getToolApi = (ownProps) => ownProps.toolApi;
export const getTranslateState = (ownProps) => ownProps.translate;
export const getCurrentPaneSettings = (ownProps) => {
  const { ScripturePane } = ownProps.tc.settingsReducer.toolsSettings;
  return ScripturePane ? ScripturePane.currentPaneSettings : [];
};
export const getToolsSettings = (ownProps) => {
  const { toolsSettings } = ownProps.tc.settingsReducer;
  return toolsSettings ? toolsSettings : {};
};
export const getUsername = (ownProps) => ownProps.tc.username;

/**
 * Returns a chapter in the target language bible
 * @param {object} state
 * @param {object} ownProps
 * @param {number} chapter - the chapter number
 */
export const getTargetChapter = (state, ownProps, chapter) => {
  const contextId = getContextId(state);

  if (!chapter && contextId) {
    const { reference: { chapter: _chapter } } = contextId;
    chapter = _chapter;
  } else if (!chapter && !contextId) {
    return null;
  }

  return ownProps.tc.resourcesReducer.bibles.targetLanguage.targetBible[chapter + ''];
};

/**
 * Returns the currently selected verse in the target language bible
 * @param {object} state
 * @param {object} ownProps
 * @return {*}
 */
export const getSelectedTargetVerse = (state, ownProps) => {
  const contextId = getContextId(state);

  if (!contextId) {
    return null;
  }

  const { reference: { chapter, verse } } = contextId;
  const targetChapter = getTargetChapter(state, ownProps, chapter);

  if (targetChapter) {
    return targetChapter[verse + ''];
  } else {
    return null;
  }
};

/**
 * Returns a chapter in the original language bible
 * @param {object} state
 * @param {object} ownProps
 * @param {number} chapter - the chapter number
 * @return {*}
 */
export const getSourceChapter = (state, ownProps, chapter) => {
  const { sourceBook } = ownProps.tc;
  const contextId = getContextId(state);

  if (!chapter && contextId) {
    const { reference: { chapter: _chapter } } = contextId;
    chapter = _chapter;
  } else if (!chapter && !contextId) {
    return null;
  }

  return sourceBook && sourceBook[chapter + ''];
};

/**
 * Returns the currently selected verse in the original language bible
 * @param {object} state
 * @param {object} ownProps
 * @return {*}
 */
export const getSelectedSourceVerse = (state, ownProps) => {
  const contextId = getContextId(state);

  if (!contextId) {
    return null;
  }

  const { reference: { chapter, verse } } = contextId;
  const sourceChapter = getSourceChapter(state, ownProps, chapter);

  if (sourceChapter) {
    return sourceChapter[verse + ''];
  } else {
    return null;
  }
};
