/* eslint-env jest */
import {
  getSelectionHistoryKey,
  getSelectionsForBook,
  updatedPreviousSelectionsData,
} from '../src/utils/checkingSuggestionsUtils';
import { NT_ORIG_LANG } from '../src/common/constants';

// a GL book whose verses 1:1-1:3 align 'faith' to πίστιν
const glVerse = {
  verseObjects: [{
    tag: 'zaln', type: 'milestone', content: 'πίστιν', occurrence: 1, occurrences: 1,
    children: [{
      tag: 'w', type: 'word', text: 'faith', occurrence: 1, occurrences: 1,
    }],
    endTag: 'zaln-e\\*',
  }],
};
// verse 4 aligns 'Faith', as at the start of a sentence
const glVerseCapital = {
  verseObjects: [{
    ...glVerse.verseObjects[0],
    children: [{ ...glVerse.verseObjects[0].children[0], text: 'Faith' }],
  }],
};
const glBook = {
  1: {
    1: glVerse, 2: glVerse, 3: glVerse, 4: glVerseCapital,
  },
};
const check = (verse, words) => ({
  contextId: {
    reference: {
      bookId: 'tit', chapter: 1, verse,
    },
    quote: 'πίστιν',
    occurrence: 1,
  },
  selections: words.map(text => ({ text, occurrence: 1 })),
});

describe('selection history keys are lowercase', () => {
  test('getSelectionHistoryKey lowercases with the language rules', () => {
    expect(getSelectionHistoryKey('Bởi đức tin', 'vi')).toBe('bởi đức tin');
    expect(getSelectionHistoryKey('Işık', 'tr')).toBe('ışık');
    expect(getSelectionHistoryKey('Işık', 'en')).toBe('işık');
    expect(getSelectionHistoryKey('', 'es-419')).toBe('');
  });

  test('getSelectionsForBook counts selections lowercased when given the target language', () => {
    const checks = [check(1, ['Fe']), check(2, ['fe']), check(3, ['La', 'Fe'])];
    const byQuote = {};

    expect(getSelectionsForBook(checks, 'en', null, glBook, {}, byQuote, NT_ORIG_LANG, 'es-419'))
      .toEqual({ faith: { 'fe': 2, 'la fe': 1 } });
    expect(byQuote).toEqual({ 'πίστιν': { 'fe': 2, 'la fe': 1 } });
  });

  test('getSelectionsForBook lowercases the GL phrase when given the target language', () => {
    expect(getSelectionsForBook([check(1, ['fe']), check(4, ['Fe'])], 'en', null, glBook, {}, null, NT_ORIG_LANG, 'es-419'))
      .toEqual({ faith: { fe: 2 } });
  });

  test('getSelectionsForBook keeps the case without a target language (training data builders)', () => {
    expect(getSelectionsForBook([check(1, ['Fe']), check(2, ['fe']), check(4, ['fe'])], 'en', null, glBook, {}))
      .toEqual({ faith: { Fe: 1, fe: 1 }, Faith: { fe: 1 } });
  });

  test('updatedPreviousSelectionsData moves a count between lowercase keys', () => {
    const saved = { church: { iglesia: 2 } };

    updatedPreviousSelectionsData([{ text: 'Iglesia', occurrence: 1 }], saved, 'church',
      [{ text: 'La', occurrence: 1 }, { text: 'Iglesia', occurrence: 1 }], 'es-419');
    expect(saved).toEqual({ church: { 'iglesia': 1, 'la iglesia': 1 } });

    updatedPreviousSelectionsData([{ text: 'la', occurrence: 1 }, { text: 'iglesia', occurrence: 1 }], saved, 'church',
      [{ text: 'IGLESIA', occurrence: 1 }], 'es-419');
    expect(saved).toEqual({ church: { iglesia: 2 } });
  });

  test('updatedPreviousSelectionsData lowercases the GL phrase when given the GL language', () => {
    const saved = { faith: { fe: 1 } };

    updatedPreviousSelectionsData([{ text: 'fe', occurrence: 1 }], saved, 'Faith',
      [{ text: 'la', occurrence: 1 }, { text: 'fe', occurrence: 1 }], 'es-419', 'en');
    expect(saved).toEqual({ faith: { 'la fe': 1 } });

    // without it the key is used as given
    updatedPreviousSelectionsData(null, saved, 'Faith', [{ text: 'fe', occurrence: 1 }], 'es-419');
    expect(saved).toEqual({ faith: { 'la fe': 1 }, Faith: { fe: 1 } });
  });
});
