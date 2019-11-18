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
export const loadGroupsIndex = (gatewayLanguage, toolName, projectDir, translate) => ((dispatch) => {
  const groupsIndex = loadProjectGroupIndex(gatewayLanguage, toolName, projectDir, translate);

  dispatch({
    type: LOAD_GROUPS_INDEX,
    groupsIndex,
  });
});

export const updateRefreshCount = () => ((dispatch) => {
  dispatch({ type: UPDATE_REFRESH_COUNT_GROUPS_INDEX });
});
