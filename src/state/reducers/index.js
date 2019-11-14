/* eslint-disable object-curly-newline */
import { combineReducers } from 'redux';
// reducers
import contextIdReducer from './contextIdReducer';
import groupsIndexReducer from './groupsIndexReducer';
import groupsDataReducer from './groupsDataReducer';
import commentsReducer from './commentsReducer';

export default combineReducers({
  contextIdReducer,
  groupsIndexReducer,
  groupsDataReducer,
  commentsReducer,
});
