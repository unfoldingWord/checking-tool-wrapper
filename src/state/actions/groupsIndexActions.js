import { loadProjectGroupIndex } from '../../helpers/groupsIndexHelpers';
import {
  LOAD_GROUPS_INDEX,
  UPDATE_REFRESH_COUNT_GROUPS_INDEX,
} from './actionTypes';

/**
 * @description This action sends all of the group Ids and
 * group names to the groupsIndexReducer
 * @param {string} groupIndex - The object of group indecies
 * @return {object} action object.
 */
export const loadGroupsIndex = (language, toolName, projectDir, translate) => ((dispatch) => {
  // const groupsIndex = loadProjectGroupIndex(language, toolName, projectDir, translate);

  dispatch({
    type: LOAD_GROUPS_INDEX,
    groupsIndex: [{ id: '1', name: '1' }, { id: '2', name: '2' }, { id: '3', name: '3' }],
  });
});

export const updateRefreshCount = () => ((dispatch) => {
  dispatch({ type: UPDATE_REFRESH_COUNT_GROUPS_INDEX });
});
