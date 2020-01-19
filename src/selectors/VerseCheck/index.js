import { createSelector } from 'reselect';
import { getActionsState } from '../';

export const getVerseCheckState = createSelector(
  [getActionsState],
  (actions) => ({ actions })
);


