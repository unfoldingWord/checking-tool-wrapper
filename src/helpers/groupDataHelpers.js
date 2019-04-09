import isEqual from 'deep-equal';

/**
* @description gets the group data for the current verse from groupsDataReducer
* @param {Object} groupsData
* @param {Object} contextId
* @return {object} group data object.
*/
export function getGroupDataForVerse(groupsData, contextId) {
  const filteredGroupData = {};
  for (let groupItemKey of Object.keys(groupsData)) {
    const groupItem = groupsData[groupItemKey];
    if (groupItem) {
      for (let check of groupItem) {
        try {
          if (isEqual(check.contextId.reference, contextId.reference)) {
            if (!filteredGroupData[groupItemKey]) {
              filteredGroupData[groupItemKey] = [];
            }
            filteredGroupData[groupItemKey].push(check);
          }
        } catch (e) {
          console.warn(`Corrupt check found in group "${groupItemKey}"`, check);
        }
      }
    }
  }
  return filteredGroupData;
}
