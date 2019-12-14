import {
  GROUP_MENU_EXPAND_SUBMENU,
  GROUP_MENU_SET_FILTER,
} from './actionTypes';
import { changeCurrentContextId } from './contextIdActions';

/**
 * This action expands/collapses the submenu in the group menu
 * @param {bool} isSubMenuExpanded - true or false
 */
export const expandSubMenu = isSubMenuExpanded => ({
  type: GROUP_MENU_EXPAND_SUBMENU,
  isSubMenuExpanded,
});

/**
 * Changes the group in the group menu
 * @param {Object} contextId
 * @param {*} projectSaveLocation
 * @param {*} glBibles
 * @param {*} userData
 */
export const changeGroup = (contextId, projectSaveLocation, glBibles, userData) => dispatch => {
  dispatch(changeCurrentContextId(contextId, projectSaveLocation, glBibles, userData));
  dispatch(expandSubMenu(true));
};

/**
 * Sets filter for what items to show.
 * @param {string} name - name of filter to toggle.
 */
export const setFilter = (name, value) => ({
  type: GROUP_MENU_SET_FILTER,
  name,
  value,
});
