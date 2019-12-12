import { createSelector } from 'reselect';
import { getActionsState } from '../';
// import { getMaximumSelections } from '../../helpers/selectionHelpers';
// import { getVerseText } from '../../helpers/verseHelpers';
// // TODO: use the other getAlignedGLText from gatewayLanguageHelpers
// import { getAlignedGLText } from '../../helpers/checkAreaHelpers';

// const getAlignedGLTextState = createSelector([
//   getContextIdState,
//   getToolsSelectedGLsState,
//   getBiblesState,
//   getSelectedToolName,
// ], (contextId, toolsSelectedGLs, bibles, selectedToolName) => {
//   // TODO: use the other getAlignedGLText from gatewayLanguageHelpers
//   let alignedGLText = getAlignedGLText(
//     toolsSelectedGLs,
//     contextId,
//     bibles,
//     selectedToolName,
//   );
//   return alignedGLText;
// });

// const getSelectedGL = createSelector(
//   [getToolsSelectedGLsState, getSelectedToolName],
//   (toolsSelectedGLs, selectedToolName) => {
//     const selectedGL = toolsSelectedGLs && toolsSelectedGLs[selectedToolName];
//     return selectedGL;
//   }
// );

// const getCurrentGroup = createSelector(
//   [getGroupsDataState, getContextIdState],
//   (groupsData, contextId) => {
//     let currentGroupItem;

//     if (contextId && groupsData[contextId.groupId]) {
//       currentGroupItem = groupsData[contextId.groupId].find(groupData => isEqual(groupData.contextId, contextId));
//     } else {
//       currentGroupItem = null;
//     }
//     return currentGroupItem;
//   }
// );

export const getVerseCheckState = createSelector(
  [getActionsState],
  (actions) => ({ actions })
);


