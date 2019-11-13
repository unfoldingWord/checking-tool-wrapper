import { ADD_GROUP_DATA, LOAD_GROUPS_DATA_FROM_FS } from '../actions/actionTypes';
import { loadProjectGroupData } from '../../helpers/groupDataHelpers';

/**
 * Adds a groupId as a property to the groups object and assigns payload as its value.
 * @param {string} groupId - groupId of object ex. figs_metaphor.
 * @param {array} groupsData - Array of objects containing group data.
 */
export const addGroupData = (groupId, groupsData) => ({
  type: ADD_GROUP_DATA,
  groupId,
  groupsData,
});

/**
 * Loads all of a tool's group data from the project.
 * @param {string} toolName - the name of the tool who's helps will be loaded.
 * @param {string} projectDir - the absolute path to the project.
 */
export const loadGroupsData = (toolName, projectDir) => (dispatch) => {
  const groupsData = loadProjectGroupData(toolName, projectDir);

  dispatch({
    type: LOAD_GROUPS_DATA_FROM_FS,
    groupsData,
  });
};




