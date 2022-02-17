import { getBibleElement } from './bibleHelpers';

export const loadCorrectPaneSettings = (setToolSettings, bibles, gatewayLanguage, currentPaneSettings = []) => {
  const paneSettingsIncludeGLandUlbOrUlt = (paneSetting) => paneSetting.languageId === gatewayLanguage && (paneSetting.bibleId === 'ulb' || paneSetting.bibleId === 'ult');

  // make sure bibles in currentPaneSettings are found in the bibles object in the resourcesReducer
  currentPaneSettings = currentPaneSettings ? currentPaneSettings.filter((paneSetting) => isPaneSettingFoundInBibles(bibles, paneSetting)) : currentPaneSettings;

  // making sure the right ult or ulb language is displayed in the scripture pane
  if (currentPaneSettings && !currentPaneSettings.some(paneSettingsIncludeGLandUlbOrUlt) && currentPaneSettings.length > 0) {
    const newCurrentPaneSettings = currentPaneSettings.map((paneSetting) => {
      const isUlbOrUlt = paneSetting.bibleId === 'ult' || paneSetting.bibleId === 'ulb';

      if (isUlbOrUlt && gatewayLanguage === 'en') {
        paneSetting.languageId = gatewayLanguage;
        paneSetting.bibleId = 'ult';
      } else if (isUlbOrUlt && gatewayLanguage === 'hi') {
        paneSetting.languageId = gatewayLanguage;
        paneSetting.bibleId = 'ulb';
      }
      return paneSetting;
    });
    setToolSettings('ScripturePane', 'currentPaneSettings', newCurrentPaneSettings);
  }

  if (currentPaneSettings.length === 0) {
    // initializing the ScripturePane settings if not found.
    let bibleId;

    if (gatewayLanguage === 'en') {
      bibleId = 'ult';
    } else { // for hindi is ulb
      bibleId = 'ulb';
    }

    const initialCurrentPaneSettings = [
      {
        languageId: gatewayLanguage,
        bibleId,
      },
      {
        languageId: 'targetLanguage',
        bibleId: 'targetBible',
      },
    ];
    setToolSettings('ScripturePane', 'currentPaneSettings', initialCurrentPaneSettings);
  }
};

/**
 * check for pane
 * @param {object} bibles
 * @param {object} paneSetting
 * @return {boolean}
 */
function isPaneSettingFoundInBibles(bibles, paneSetting) {
  const bible = getBibleElement(bibles, paneSetting.languageId, paneSetting.bibleId, paneSetting.owner);
  return !!bible;
}
