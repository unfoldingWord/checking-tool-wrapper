import { createSelector } from 'reselect';
import {
  getLegacyToolsReducerState,
  getResourcesReducerState,
  getActionsState,
} from '../';

export const getTranslationHelpsState = createSelector(
  [
    getLegacyToolsReducerState, getResourcesReducerState, getActionsState,
  ],
  (legacyToolsReducer, resourcesReducer, actions) => ({
    toolsReducer: legacyToolsReducer,
    resourcesReducer,
    actions,
  })
);
