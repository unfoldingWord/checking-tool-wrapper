
import { createSelector } from 'reselect';
import {
  getTranslateState, getGroupsIndexState, getContextIdState, getResourcesReducerState,
} from '../';

export const getCheckInfoCardState = createSelector(
  [
    getTranslateState,
    getResourcesReducerState,
    getGroupsIndexState,
    getContextIdState,
  ],
  (
    translate,
    resourcesReducer,
    groupsIndex,
    contextId
  ) => ({
    translate,
    translationHelps: resourcesReducer['translationHelps'] ? resourcesReducer['translationHelps'] : {},
    groupsIndex,
    contextId,
    resourcesReducer,
  })
);