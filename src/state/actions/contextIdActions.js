import { CHANGE_CONTEXT_ID } from './actionTypes';

export const changeContextId = contextId => ({
  type: CHANGE_CONTEXT_ID,
  contextId,
});
