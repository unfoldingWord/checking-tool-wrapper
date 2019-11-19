import * as fromGrouspIndex from '../state/reducers/groupsIndexReducer';
import * as fromGroupsData from '../state/reducers/groupsDataReducer';

export const getGroupsIndex = (state) =>
  fromGrouspIndex.getGroupsIndex(state.tool.groupsIndexReducer);

export const getGroupsData = (state) =>
  fromGroupsData.getGroupsData(state.tool.groupsDataReducer);

export const getProjectManifest = (state) =>
  state.tc.projectDetailsReducer.manifest;

export const getBiblesState = (state) =>
  state.resourcesReducer.bibles;


// TODO:
export const getTcState = (state) => state.tc;
export const getGroupsDataState = (state) => state.tc.groupsDataReducer.groupsData;
export const getGroupsIndexState = (state) => state.tc.groupsIndexReducer.groupsIndex;
export const getTranslateState = (state) => state.translate;
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
