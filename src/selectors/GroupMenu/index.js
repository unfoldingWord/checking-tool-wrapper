import { createSelector } from 'reselect';
import {
  getTcState, getGroupsDataState, getGroupsIndexState, getTranslateState,
} from '../';

export const getGroupMenuState = createSelector(
  [getTcState, getGroupsDataState, getGroupsIndexState, getTranslateState],
  (tc, groupsData, groupsIndex, translate) => ({
    tc, groupsData, groupsIndex, translate,
  })
);