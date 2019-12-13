import { createSelector } from 'reselect';
import { getActionsState } from '../';

export const getScripturePaneState = createSelector(
  [getActionsState],
  (actions) => {
    const {
      showPopover, editTargetVerse, getLexiconData, setToolSettings,
      getAvailableScripturePaneSelections, makeSureBiblesLoadedForTool,
    } = actions;
    return {
      showPopover,
      editTargetVerse,
      getLexiconData,
      setToolSettings,
      getAvailableScripturePaneSelections,
      makeSureBiblesLoadedForTool,
    };
  }
);
