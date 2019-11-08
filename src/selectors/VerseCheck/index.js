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
  getOnInvalidCheck,
} from '../';
import { getMaximumSelections } from '../../helpers/selectionHelpers';
import { getVerseText } from '../../helpers/verseHelpers';
import {
  getAlignedGLText,
  showInvalidCheck,
  getInvalidQuoteMessage,
} from '../../helpers/checkAreaHelpers';

const getAlignedGLTextState = createSelector([
  getContextIdState,
  getToolsSelectedGLsState,
  getBiblesState,
  getSelectedToolName,
  getTranslateState,
  getOnInvalidCheck,
], (contextId, toolsSelectedGLs, bibles, selectedToolName, translate, onInvalidCheck) => {
  let alignedGLText = getAlignedGLText(
    toolsSelectedGLs,
    contextId,
    bibles,
    selectedToolName,
  );

  if (!alignedGLText) { // if check is invalid
    showInvalidCheck(contextId, toolsSelectedGLs, selectedToolName, onInvalidCheck);
    alignedGLText = getInvalidQuoteMessage(contextId, translate);
  }
  return alignedGLText;
});

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


