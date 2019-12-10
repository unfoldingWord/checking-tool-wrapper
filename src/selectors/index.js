import * as fromGrouspIndex from '../state/reducers/groupsIndexReducer';
import * as fromGroupsData from '../state/reducers/groupsDataReducer';
import * as fromContextId from '../state/reducers/contextIdReducer';

export const getGroupsIndex = (state) =>
  fromGrouspIndex.getGroupsIndex(state.tool.groupsIndexReducer);

export const getGroupsData = (state) =>
  fromGroupsData.getGroupsData(state.tool.groupsDataReducer);

export const getContextId = (state) =>
  fromContextId.getContext(state.tool.contextIdReducer);

export const getProjectManifest = (state) => state.tc.projectDetailsReducer.manifest;
export const getGatewayLanguage = (state) => state.tc.gatewayLanguage;
export const getToolName = (state) => state.tc.selectedToolName;
export const getProjectPath = (state) => state.tc.projectSaveLocation;
export const getUserData = (state) => state.tc.loginReducer.userdata;
export const getGatewayLanguageBibles = (state) => state.tc.resourcesReducer.bibles[getGatewayLanguage(state)];
export const getBookName = (state) => state.tc.project.getBookName();
export const getTcState = (state) => state.tc;
export const getTranslateState = (state) => state.translate;


export const getTranslationHelpsArticle = (state, contextId) => {
  const article = state.tc.resourcesReducer.translationHelps[state.tc.selectedToolName];
  contextId = contextId || {};
  console.log('getTranslationHelpsArticle contextId', contextId);
  const { groupId = '' } = contextId;
  console.log('groupId', groupId);

  return article && groupId ? article[groupId] : '';
};


// TODO: Cleanup selector below
export const getBiblesState = (state) =>
  state.resourcesReducer.bibles;
export const getGroupsDataState = (state) => state.tc.groupsDataReducer.groupsData;
export const getGroupsIndexState = (state) => state.tc.groupsIndexReducer.groupsIndex;
export const getSelectedToolName = (state) => state.tc.selectedToolName;
export const getManifestState = (state) => state.projectDetailsReducer.manifest;
export const getContextIdState = (state) => state.contextIdReducer.contextId;
export const getToolsSelectedGLsState = (state) => state.projectDetailsReducer.manifest.toolsSelectedGLs;
export const getSelectionsState = (state) => state.selectionsReducer.selections;
export const getCurrentPaneSettingsState = (state) => {
  const { ScripturePane } = state.settingsReducer.toolsSettings;
  return ScripturePane ? ScripturePane.currentPaneSettings : [];
};
export const getTargetBibleState = (state) => state.tc.resourcesReducer.bibles.targetLanguage.targetBible;
export const getActionsState = (state) => state.tc.actions;
export const getCommentsReducerState = (state) => state.tc.commentsReducer;
export const getSelectionsReducerState = (state) => state.tc.selectionsReducer;
export const getRemindersReducerState = (state) => state.tc.remindersReducer;
export const getLegacyToolsReducerState = (state) => ({ currentToolName: state.tc.selectedToolName });
export const getResourcesReducerState = (state) => state.tc.resourcesReducer;
export const getContextIdReducerState = (state) => state.contextIdReducer;
export const getProjectDetailsReducerState = (state) => state.projectDetailsReducer;
