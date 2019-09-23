import isEqual from 'deep-equal';

/**
* @description gets the group data for the current verse from groupsDataReducer
* @param {Object} groupsData
* @param {Object} contextId
* @return {object} group data object.
*/
export function getGroupDataForVerse(groupsData, contextId) {
  const filteredGroupData = {};

  const groupItems = Object.keys(groupsData);
  for (let i = 0, l = groupItems.length; i < l; i++) {
    const groupItemKey = groupItems[i];
    const groupItem = groupsData[groupItemKey];

    if (groupItem) {
      for (let j = 0, l2 = groupItem.length; j < l2; j++) {
        const check = groupItem[j];
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
