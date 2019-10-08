import { createSelector } from 'reselect';
import {
  getTranslateState, getManifestState, getBiblesState, getContextIdState,
  getSelectionsState, getCurrentPaneSettingsState, getActionsState, getProjectDetailsReducerState,
} from '../';

export const getScripturePaneState = createSelector(
  [
    getTranslateState, getManifestState, getSelectionsState, getCurrentPaneSettingsState,
    getBiblesState, getContextIdState, getProjectDetailsReducerState, getActionsState,
  ],
  (
    translate, manifest, selections, currentPaneSettings, bibles,
    contextId, projectDetailsReducer, actions
  ) => {
    const {
      showPopover, editTargetVerse, getLexiconData, setToolSettings,
      getAvailableScripturePaneSelections, makeSureBiblesLoadedForTool,
    } = actions;
    return {
      translate,
      manifest,
      selections,
      currentPaneSettings,
      bibles,
      contextId,
      projectDetailsReducer,
      showPopover,
      editTargetVerse,
      getLexiconData,
      setToolSettings,
      getAvailableScripturePaneSelections,
      makeSureBiblesLoadedForTool,
    };
  }
);