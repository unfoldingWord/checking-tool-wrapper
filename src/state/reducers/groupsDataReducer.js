import {
  ADD_GROUP_DATA,
  CLEAR_PREVIOUS_GROUPS_DATA,
  LOAD_GROUPS_DATA_FROM_FS,
} from '../actions/actionTypes';

const initialState = {
  groupsData: {},
  loadedFromFileSystem: false,
};

const groupsDataReducer = (state = initialState, action) => {
  switch (action.type) {
  case ADD_GROUP_DATA:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        [action.groupId]: action.groupsData,
      },
    };
  case LOAD_GROUPS_DATA_FROM_FS:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        ...action.groupsData,
      },
      loadedFromFileSystem: true,
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
