function isVerseMatch(checkRef, contextIdRef) {
  return (checkRef.chapter === contextIdRef.chapter) &&
    (checkRef.verse === contextIdRef.verse);
}

/**
* @description gets the group data for the current verse from groupsDataReducer
* @param {Object} groupsData
* @param {Object} contextId
* @return {object} group data object.
*/
export function getGroupDataForVerse(groupsData, groupItemKeys, contextId) {
  const filteredGroupData = {};

  for (let i = groupItemKeys.length - 1; i >= 0; i--) {
    const groupItemKey = groupItemKeys[i];
    const groupItem = groupsData[groupItemKey];

    if (groupItem) {
      for (let j = groupItem.length - 1; j >= 0; j--) {
        const check = groupItem[j];
        try {
          if (isVerseMatch(check.contextId.reference, contextId.reference)) {
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
