import { ADD_COMMENT } from '../actions/actionTypes';

const initialState = {
  text: null,
  username: null,
  activeBook: null,
  activeChapter: null,
  activeVerse: null,
  modifiedTimestamp: null,
  gatewayLanguageCode: null,
  gatewayLanguageQuote: null,
};

export default (state = initialState, action) => {
  switch (action.type) {
  case ADD_COMMENT:
    return {
      ...state,
      text: action.text,
      username: action.username,
      activeBook: action.activeBook,
      activeChapter: action.activeChapter,
      activeVerse: action.activeVerse,
      modifiedTimestamp: action.modifiedTimestamp,
      gatewayLanguageCode: action.gatewayLanguageCode,
      gatewayLanguageQuote: action.gatewayLanguageQuote,
    };
  default:
    return state;
  }
};
