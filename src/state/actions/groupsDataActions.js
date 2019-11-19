import { LOAD_GROUPS_DATA_FROM_FS } from '../actions/actionTypes';
import { loadProjectGroupData } from '../../helpers/groupDataHelpers';

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
