/* eslint-disable object-curly-newline */
import { combineReducers } from 'redux';
// reducers
import contextIdReducer from './contextIdReducer';
import groupsIndexReducer from './groupsIndexReducer';
import groupsDataReducer from './groupsDataReducer';
import commentsReducer from './commentsReducer';
import selectionsReducer from './selectionsReducer';
import bookmarksReducer from './bookmarksReducer';
import invalidatedReducer from './invalidatedReducer';

export default combineReducers({
  contextIdReducer,
  groupsIndexReducer,
  groupsDataReducer,
  commentsReducer,
  selectionsReducer,
  bookmarksReducer,
  invalidatedReducer,
});
