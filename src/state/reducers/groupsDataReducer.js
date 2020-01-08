import {
  CLEAR_PREVIOUS_GROUPS_DATA,
  LOAD_GROUPS_DATA_FROM_FS,
  TOGGLE_VERSE_EDITS_IN_GROUPDATA,
} from '../actions/actionTypes';
import { getToggledGroupData } from '../../helpers/groupDataHelpers';

const initialState = {
  groupsData: {},
  loadedFromFileSystem: false,
};

const groupsDataReducer = (state = initialState, action) => {
  switch (action.type) {
  case LOAD_GROUPS_DATA_FROM_FS:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        ...action.groupsData,
      },
      loadedFromFileSystem: true,
    };
  case TOGGLE_VERSE_EDITS_IN_GROUPDATA:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        [action.contextId.groupId]: getToggledGroupData(state, action, 'verseEdits'),
      },
    };
  // TODO: Add missing toggle action cases.
  case CLEAR_PREVIOUS_GROUPS_DATA:
    return initialState;
  default:
    return state;
  }
};

export const getGroupsData = (state) =>
  state.groupsData;

export default groupsDataReducer;
