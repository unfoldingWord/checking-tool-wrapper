import { createSelector } from 'reselect';
import {
  getTranslateState,
  getToolsSelectedGLsState,
  getLegacyToolsReducerState,
  getResourcesReducerState,
  getContextIdReducerState,
  getActionsState,
} from '../';

export const getTranslationHelpsState = createSelector(
  [
    getTranslateState, getToolsSelectedGLsState, getLegacyToolsReducerState,
    getResourcesReducerState, getContextIdReducerState, getActionsState,
  ],
  (
    translate, toolsSelectedGLs, legacyToolsReducer,
    resourcesReducer, contextIdReducer, actions
  ) => ({
    translate,
    toolsSelectedGLs,
    toolsReducer: legacyToolsReducer,
    resourcesReducer,
    contextIdReducer,
    actions,
  })
);