import { createSelector } from 'reselect';
import {
  getTranslateState, getManifestState, getBiblesState,
  getSelectionsState, getCurrentPaneSettingsState, getActionsState, getProjectDetailsReducerState,
} from '../';

export const getScripturePaneState = createSelector(
  [
    getTranslateState, getManifestState, getSelectionsState, getCurrentPaneSettingsState,
    getBiblesState, getProjectDetailsReducerState, getActionsState,
  ],
  (
    translate, manifest, selections, currentPaneSettings, bibles, projectDetailsReducer, actions
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
