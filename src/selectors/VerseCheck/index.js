import { createSelector } from 'reselect';
import isEqual from 'deep-equal';
import {
  getTranslateState,
  getManifestState,
  getSelectedToolName,
  getTargetBibleState,
  getContextIdState,
  getGroupsDataState,
  getBiblesState,
  getActionsState,
  getCommentsReducerState,
  getSelectionsReducerState,
  getRemindersReducerState,
  getToolsSelectedGLsState,
} from '../';
import { getMaximumSelections } from '../../helpers/selectionHelpers';
import { getVerseText } from '../../helpers/verseHelpers';
import { getAlignedGLText } from '../../helpers/checkAreaHelpers';

const getAlignedGLTextState = createSelector([
  getContextIdState,
  getToolsSelectedGLsState,
  getBiblesState,
  getSelectedToolName,
], (contextId, toolsSelectedGLs, bibles, selectedToolName) => {
  let alignedGLText = getAlignedGLText(
    toolsSelectedGLs,
    contextId,
    bibles,
    selectedToolName,
  );
  return alignedGLText;
});

const getSelectedGL = createSelector(
  [getToolsSelectedGLsState, getSelectedToolName],
  (toolsSelectedGLs, selectedToolName) => {
    const selectedGL = toolsSelectedGLs && toolsSelectedGLs[selectedToolName];
    return selectedGL;
  }
);

const getCurrentGroup = createSelector(
  [getGroupsDataState, getContextIdState],
  (groupsData, contextId) => {
    let currentGroupItem;

    if (contextId && groupsData[contextId.groupId]) {
      currentGroupItem = groupsData[contextId.groupId].find(groupData => isEqual(groupData.contextId, contextId));
    } else {
      currentGroupItem = null;
    }
    return currentGroupItem;
  }
);

export const getVerseCheckState = createSelector(
  [
    getTranslateState,
    getSelectedToolName,
    getManifestState,
    getTargetBibleState,
    getContextIdState,
    getAlignedGLTextState,
    getCurrentGroup,
    getActionsState,
    getCommentsReducerState,
    getSelectionsReducerState,
    getRemindersReducerState,
    getSelectedGL,
  ],
  (translate, selectedToolName, manifest, targetBible,
    contextId, alignedGLText, currentGroupItem, actions, commentsReducer,
    selectionsReducer, remindersReducer, selectedGL
  ) => {
    const { verseText, unfilteredVerseText } = getVerseText(targetBible, contextId);
    const isVerseEdited = !!(currentGroupItem && currentGroupItem.verseEdits);
    const isVerseInvalidated = !!(currentGroupItem && currentGroupItem.invalidated);
    return {
      translate,
      manifest,
      targetBible,
      contextId,
      verseText,
      unfilteredVerseText,
      isVerseEdited,
      isVerseInvalidated,
      alignedGLText,
      maximumSelections: getMaximumSelections(selectedToolName),
      actions,
      commentsReducer,
      selectionsReducer,
      remindersReducer,
      selectedGL,
    };
  }
);


