import {
  CLEAR_PREVIOUS_GROUPS_DATA,
  SET_BOOKMARKS_IN_GROUPDATA,
  SET_REMINDERS_IN_GROUPDATA,
  SET_INVALIDATION_IN_GROUPDATA,
  LOAD_GROUPS_DATA_FROM_FS,
  TOGGLE_VERSE_EDITS_IN_GROUPDATA,
  TOGGLE_BOOKMARKS_IN_GROUPDATA,
  TOGGLE_COMMENTS_IN_GROUPDATA,
  TOGGLE_SELECTIONS_IN_GROUPDATA,
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
  case TOGGLE_BOOKMARKS_IN_GROUPDATA:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        [action.contextId.groupId]: getToggledGroupData(state, action, 'reminders'),
      },
    };
  case TOGGLE_COMMENTS_IN_GROUPDATA:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        [action.contextId.groupId]: getToggledGroupData(state, action, 'comments'),
      },
    };
  case TOGGLE_SELECTIONS_IN_GROUPDATA:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        [action.contextId.groupId]: getToggledGroupData(state, action, 'selections'),
      },
    };
  case TOGGLE_VERSE_EDITS_IN_GROUPDATA:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        [action.contextId.groupId]: getToggledGroupData(state, action, 'verseEdits'),
      },
    };
  case SET_INVALIDATION_IN_GROUPDATA:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        [action.contextId.groupId]: getToggledGroupData(state, action, 'invalidated'),
      },
    };
  case SET_REMINDERS_IN_GROUPDATA:
  case SET_BOOKMARKS_IN_GROUPDATA:
    return {
      ...state,
      groupsData: {
        ...state.groupsData,
        [action.contextId.groupId]: getToggledGroupData(state, action, 'reminders'),
      },
    };
  case CLEAR_PREVIOUS_GROUPS_DATA:
    return initialState;
  default:
    return state;
  }
};

export const getGroupsData = (state) =>
  state.groupsData;

export const getGroupsDataLoaded = (state) =>
  state.loadedFromFileSystem;

export default groupsDataReducer;
