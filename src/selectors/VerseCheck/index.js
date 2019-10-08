import { createSelector } from 'reselect';
import isEqual from 'deep-equal';
import {
  getTranslateState, getManifestState, getSelectedToolName, getTargetBibleState, getContextIdState, getGroupsDataState, getBiblesState, getActionsState, getCommentsReducerState, getSelectionsReducerState, getRemindersReducerState, getToolsSelectedGLsState,
} from '../';
import { getMaximumSelections } from '../../helpers/selectionHelpers';
import { getVerseText } from '../../helpers/verseHelpers';
import { getAlignedGLText } from '../../helpers/checkAreaHelpers';

const getAlignedGLTextState = createSelector([
  getContextIdState,
  getToolsSelectedGLsState,
  getBiblesState,
  getSelectedToolName,
  getTranslateState,
], (contextId, toolsSelectedGLs, bibles, selectedToolName, translate) => {
  const alignedGLText = getAlignedGLText(
    toolsSelectedGLs,
    contextId,
    bibles,
    selectedToolName,
    translate,
  );
  return alignedGLText;
});

const getCurrentGroup = createSelector(
  [getGroupsDataState, getContextIdState],
  (groupsData, contextId) => {
    let currentGroupItem;

    if (groupsData[contextId.groupId]) {
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
    getGroupsDataState,
    getBiblesState,
    getAlignedGLTextState,
    getCurrentGroup,
    getActionsState,
    getCommentsReducerState,
    getSelectionsReducerState,
    getRemindersReducerState,
  ],
  (translate, selectedToolName, manifest, targetBible,
    contextId, alignedGLText, currentGroupItem, actions, commentsReducer,
    selectionsReducer, remindersReducer
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
    };
  }
);


