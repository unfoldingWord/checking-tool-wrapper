/* eslint-env jest */
import * as verseHelpers from '../src/helpers/verseHelpers';

describe('verseHelpers.getBestVerse', () => {
  test('Should find verse bridge', () => {
    //given
    const chapter = '1';
    const verses = ['1', '2', '1-2', 'front'];
    const currentBible = createChapterWithVerses(chapter, verses);
    const lookupVerse = '1-2';
    const expectedVerseData = currentBible[chapter][lookupVerse];

    //when
    const verseData = verseHelpers.getBestVerse(currentBible, chapter, lookupVerse);

    //then
    expect(verseData).toEqual(expectedVerseData);
  });

  test('Should find starting verse within verse bridge', () => {
    //given
    const chapter = '1';
    const verses = ['1-2', 'front'];
    const currentBible = createChapterWithVerses(chapter, verses);
    const lookupVerse = '1';
    const expectedVerse = '1-2';
    const expectedVerseData = currentBible[chapter][expectedVerse];

    //when
    const verseData = verseHelpers.getBestVerse(currentBible, chapter, lookupVerse);

    //then
    expect(verseData).toEqual(expectedVerseData);
  });

  test('Should find ending verse within verse bridge', () => {
    //given
    const chapter = '1';
    const verses = ['1-2', 'front'];
    const currentBible = createChapterWithVerses(chapter, verses);
    const lookupVerse = '2';
    const expectedVerse = '1-2';
    const expectedVerseData = currentBible[chapter][expectedVerse];

    //when
    const verseData = verseHelpers.getBestVerse(currentBible, chapter, lookupVerse);

    //then
    expect(verseData).toEqual(expectedVerseData);
  });

  test('Should find exact match', () => {
    //given
    const chapter = '1';
    const verses = ['1', '2', '1-2', 'front'];
    const currentBible = createChapterWithVerses(chapter, verses);
    const lookupVerse = '2';
    const expectedVerseData = currentBible[chapter][lookupVerse];

    //when
    const verseData = verseHelpers.getBestVerse(currentBible, chapter, lookupVerse);

    //then
    expect(verseData).toEqual(expectedVerseData);
  });

  test('Should return empty string if no match for verse', () => {
    //given
    const chapter = '1';
    const verses = ['1', '2', '1-2', 'front'];
    const currentBible = createChapterWithVerses(chapter, verses);
    const lookupVerse = '3';
    const expectedVerseData = '';

    //when
    const verseData = verseHelpers.getBestVerse(currentBible, chapter, lookupVerse);

    //then
    expect(verseData).toEqual(expectedVerseData);
  });

  test('Should return empty string if no match for chapter', () => {
    //given
    const chapter = '1';
    const verses = ['1', '2', '1-2', 'front'];
    const currentBible = createChapterWithVerses(chapter, verses);
    const lookupVerse = '1';
    const lookupChapter = '3';
    const expectedVerseData = '';

    //when
    const verseData = verseHelpers.getBestVerse(currentBible, lookupChapter, lookupVerse);

    //then
    expect(verseData).toEqual(expectedVerseData);
  });

  test('Should return empty string if no bible', () => {
    //given
    const currentBible = undefined;
    const lookupVerse = '1';
    const lookupChapter = '3';
    const expectedVerseData = '';

    //when
    const verseData = verseHelpers.getBestVerse(currentBible, lookupChapter, lookupVerse);

    //then
    expect(verseData).toEqual(expectedVerseData);
  });
});


//
// helpers
//

/**
 * create dummy content for verse
 * @param {string} verse
 * @return {string}
 */
function createVerseContent(verse) {
  return `${verse}-Content`;
}

/**
 * create dummy Bible with given chapter and verses
 * @param {string} chapter
 * @param {array} verses
 * @return {object}
 */
function createChapterWithVerses(chapter, verses) {
  const chapterData = {};

  for (let verse of verses) {
    chapterData[verse] = createVerseContent(verse);
  }

  return { [chapter]: chapterData };
}
