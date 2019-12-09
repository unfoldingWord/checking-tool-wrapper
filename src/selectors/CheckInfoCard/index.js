
import { createSelector } from 'reselect';
import {
  getTranslateState, getGroupsIndexState, getResourcesReducerState,
} from '../';

export const getCheckInfoCardState = createSelector(
  [
    getTranslateState,
    getResourcesReducerState,
    getGroupsIndexState,
  ],
  (
    translate,
    resourcesReducer,
    groupsIndex,
  ) => ({
    translate,
    translationHelps: resourcesReducer['translationHelps'] ? resourcesReducer['translationHelps'] : {},
    groupsIndex,
    resourcesReducer,
  })
);
