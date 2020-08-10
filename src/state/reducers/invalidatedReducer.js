import {
  SET_INVALIDATED,
  SET_INVALIDATED_CHECKS_TOTAL,
  SET_INVALIDATED_ALIGNMENTS_TOTAL,
  SET_VERSE_EDITS_TOTAL,
} from '../actions/actionTypes';

const initialState = {
  invalidated: false,
  username: null,
  modifiedTimestamp: null,
  gatewayLanguageCode: null,
  gatewayLanguageQuote: null,
  invalidatedChecksTotal: null,
  verseEditsTotal: null,
  invalidatedAlignmentsTotal: null,
};

const invalidatedReducer = (state = initialState, action) => {
  switch (action.type) {
  case SET_INVALIDATED:
    return {
      ...state,
      username: action.username,
      modifiedTimestamp: action.modifiedTimestamp,
      gatewayLanguageCode: action.gatewayLanguageCode,
      gatewayLanguageQuote: action.gatewayLanguageQuote,
      invalidated: action.invalidated,
    };
  case SET_INVALIDATED_CHECKS_TOTAL:
    return {
      ...state,
      invalidatedChecksTotal: action.invalidatedChecksTotal,
    };
  case SET_INVALIDATED_ALIGNMENTS_TOTAL:
    return {
      ...state,
      invalidatedAlignmentsTotal: action.invalidatedAlignmentsTotal,
    };
  case SET_VERSE_EDITS_TOTAL:
    return {
      ...state,
      verseEditsTotal: action.verseEditsTotal,
    };
  default:
    return state;
  }
};

export default invalidatedReducer;
