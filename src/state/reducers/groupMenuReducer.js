import {
  GROUP_MENU_EXPAND_SUBMENU,
  TOGGLE_MENU_DRAWER,
  GROUP_MENU_SET_FILTER,
  CLEAR_PREVIOUS_FILTERS,
} from '../actions/actionTypes';

const initialState = {
  menuVisibility: true,
  isSubMenuExpanded: true,
  filters: {
    invalidated: false,
    reminders: false,
    selections: false,
    noSelections: false,
    verseEdits: false,
    comments: false,
  },
};

const groupMenuReducer = (state = initialState, action) => {
  switch (action.type) {
  case GROUP_MENU_EXPAND_SUBMENU:
    return {
      ...state,
      isSubMenuExpanded: action.isSubMenuExpanded,
    };
  case TOGGLE_MENU_DRAWER:
    return { ...state, menuVisibility: !state.menuVisibility };
  case GROUP_MENU_SET_FILTER:
    return {
      ...state,
      filters: {
        ...state.filters,
        [action.name]: action.value,
      },
    };
  case CLEAR_PREVIOUS_FILTERS:
    return {
      ...state,
      filters: initialState.filters,
    };
  default:
    return state;
  }
};

export default groupMenuReducer;
