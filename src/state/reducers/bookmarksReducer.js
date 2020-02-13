import {
  SET_BOOKMARK,
  TOGGLE_BOOKMARK,
} from '../actions/actionTypes';

const initialState = {
  enabled: false,
  username: null,
  modifiedTimestamp: null,
  gatewayLanguageCode: null,
  gatewayLanguageQuote: null,
};

const bookmarksReducer = (state = initialState, action) => {
  switch (action.type) {
  case TOGGLE_BOOKMARK:
    return {
      ...state,
      enabled: !state.enabled,
      username: action.username,
      modifiedTimestamp: action.modifiedTimestamp,
      gatewayLanguageCode: action.gatewayLanguageCode,
      gatewayLanguageQuote: action.gatewayLanguageQuote,
    };
  case SET_BOOKMARK:
    return {
      ...state,
      enabled: action.enabled,
      username: action.username,
      modifiedTimestamp: action.modifiedTimestamp,
      gatewayLanguageCode: action.gatewayLanguageCode,
      gatewayLanguageQuote: action.gatewayLanguageQuote,
    };
  default:
    return state;
  }
};

export default bookmarksReducer;
