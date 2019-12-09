import { createSelector } from 'reselect';
import {
  getTranslateState,
  getToolsSelectedGLsState,
  getLegacyToolsReducerState,
  getResourcesReducerState,
  getActionsState,
} from '../';

export const getTranslationHelpsState = createSelector(
  [
    getTranslateState, getToolsSelectedGLsState, getLegacyToolsReducerState,
    getResourcesReducerState, getActionsState,
  ],
  (
    translate, toolsSelectedGLs, legacyToolsReducer,
    resourcesReducer, actions
  ) => ({
    translate,
    toolsSelectedGLs,
    toolsReducer: legacyToolsReducer,
    resourcesReducer,
    actions,
  })
);
