import { createSelector } from 'reselect';
import { getActionsState } from '../';

export const getTranslationHelpsState = createSelector(
  [getActionsState],
  (actions) => ({ actions })
);
