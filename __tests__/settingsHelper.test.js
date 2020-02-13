/* eslint-env jest */
import * as settingsHelper from '../src/helpers/settingsHelper';
import { TRANSLATION_WORDS } from '../src/common/constants';

const bibles = {
  hi: { ulb: [] },
  en: { ult: [] },
};

describe('settingsHelper.loadCorrectPaneSettings', () => {
  test('Should change the pane settings to render English ULT if Enslish is selected as the GL', () => {
    const gatewayLanguage = 'en';
    const currentPaneSettings = [
      {
        languageId: 'hi',
        bibleId: 'ulb',
      },
    ];
    const expectedResult = [
      {
        languageId: 'en',
        bibleId: 'ult',
      },
    ];

    settingsHelper.loadCorrectPaneSettings((toolNamespace, settingsLabel, paneSettings) => {
      expect(paneSettings).toEqual(expectedResult);
    }, bibles, gatewayLanguage, currentPaneSettings);
  });

  test('Should change the pane settings to render Hindi ULB if Hindi is selected as the GL', () => {
    const currentPaneSettings = [
      {
        languageId: 'en',
        bibleId: 'ult',
      },
    ];
    const gatewayLanguage = 'hi';
    const expectedResult = [
      {
        languageId: 'hi',
        bibleId: 'ulb',
      },
    ];

    settingsHelper.loadCorrectPaneSettings((toolNamespace, settingsLabel, paneSettings) => {
      expect(paneSettings).toEqual(expectedResult);
    }, bibles, gatewayLanguage, currentPaneSettings);
  });

  test('Should render both Hindi ULB and English ULT if they are both currently in the pane settings', () => {
    const bothHindiAndEnglish = [
      {
        languageId: 'en',
        bibleId: 'ult',
      },
      {
        languageId: 'hi',
        bibleId: 'ulb',
      },
    ];
    const gatewayLanguage = 'en';
    const currentPaneSettings = bothHindiAndEnglish;
    const expectedResult = bothHindiAndEnglish;

    settingsHelper.loadCorrectPaneSettings((toolNamespace, settingsLabel, paneSettings) => {
      expect(paneSettings).toEqual(expectedResult);
    }, bibles, gatewayLanguage, currentPaneSettings);
  });

  test('Should render the English ULT if the pane settings is empty and English is selected as the GL', () => {
    const expectedResult = [
      {
        languageId: 'en',
        bibleId: 'ult',
      },
      {
        languageId: 'targetLanguage',
        bibleId: 'targetBible',
      },
    ];
    const gatewayLanguage = 'en';
    const currentPaneSettings = [];

    settingsHelper.loadCorrectPaneSettings((toolNamespace, settingsLabel, paneSettings) => {
      expect(paneSettings).toEqual(expectedResult);
    }, bibles, gatewayLanguage, currentPaneSettings);
  });

  test('Should render the Hindi ULB if the pane settings is empty and Hindi is selected as the GL', () => {
    const expectedResult = [
      {
        languageId: 'hi',
        bibleId: 'ulb',
      },
      {
        languageId: 'targetLanguage',
        bibleId: 'targetBible',
      },
    ];
    const gatewayLanguage = 'hi';
    const currentPaneSettings = [];

    settingsHelper.loadCorrectPaneSettings((toolNamespace, settingsLabel, paneSettings) => {
      expect(paneSettings).toEqual(expectedResult);
    }, bibles, gatewayLanguage, currentPaneSettings);
  });

  test('Should render the English ULT if the pane settings is empty and English is selected as the GL', () => {
    const expectedResult = [
      {
        languageId: 'en',
        bibleId: 'ult',
      },
      {
        languageId: 'targetLanguage',
        bibleId: 'targetBible',
      },
    ];
    const gatewayLanguage = 'en';
    const currentPaneSettings = [];

    settingsHelper.loadCorrectPaneSettings((toolNamespace, settingsLabel, paneSettings) => {
      expect(paneSettings).toEqual(expectedResult);
    }, bibles, gatewayLanguage, currentPaneSettings);
  });

  test('Should add the English ULT and target language in a fresh install if English is selected as the GL', () => {
    const expectedResult = [
      {
        languageId: 'en',
        bibleId: 'ult',
      },
      {
        languageId: 'targetLanguage',
        bibleId: 'targetBible',
      },
    ];
    const gatewayLanguage = 'en';

    settingsHelper.loadCorrectPaneSettings((toolNamespace, settingsLabel, paneSettings) => {
      expect(paneSettings).toEqual(expectedResult);
    }, bibles, gatewayLanguage);
  });

  test('Should add the Hindi ULB and target language in a fresh install if Hindi is selected as the GL', () => {
    const expectedResult = [
      {
        languageId: 'hi',
        bibleId: 'ulb',
      },
      {
        languageId: 'targetLanguage',
        bibleId: 'targetBible',
      },
    ];
    const gatewayLanguage = 'hi';

    settingsHelper.loadCorrectPaneSettings((toolNamespace, settingsLabel, paneSettings) => {
      expect(paneSettings).toEqual(expectedResult);
    }, bibles, gatewayLanguage);
  });
});
