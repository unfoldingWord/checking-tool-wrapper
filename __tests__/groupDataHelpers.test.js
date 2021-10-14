/* eslint-env jest */
import * as groupDataHelpers from '../src/helpers/groupDataHelpers';

describe('groupDataHelpers.getVerseSpans', () => {
  test('should find the verse spans', () => {
    //given
    const chapter = '1';
    const verses = ['4', '5', '1-3', 'front'];
    const targetBook = createChapterWithVerses(chapter, verses);
    const expectedResults = {
      [chapter]: {
        1: '1-3',
        2: '1-3',
        3: '1-3',
      },
    };

    //when
    const verseSpans = groupDataHelpers.getVerseSpans(targetBook);

    //then
    expect(verseSpans).toEqual(expectedResults);
  });
});

describe('groupDataHelpers.isSameVerse', () => {
  test('Should match identical string', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: '1',
        verse: '5',
      },
    };
    const contextId2 = {
      reference: {
        chapter: '1',
        verse: '5',
      },
    };
    const expectedResults = true;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should match identical numbers', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: 1,
        verse: 5,
      },
    };
    const contextId2 = {
      reference: {
        chapter: 1,
        verse: 5,
      },
    };
    const expectedResults = true;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should match identical numbers to strings', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: 1,
        verse: 5,
      },
    };
    const contextId2 = {
      reference: {
        chapter: '1',
        verse: '5',
      },
    };
    const expectedResults = true;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should match identical strings to numbers', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: '1',
        verse: '5',
      },
    };
    const contextId2 = {
      reference: {
        chapter: 1,
        verse: 5,
      },
    };
    const expectedResults = true;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should not match differing numbers to strings', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: 1,
        verse: 5,
      },
    };
    const contextId2 = {
      reference: {
        chapter: '1',
        verse: '6',
      },
    };
    const expectedResults = false;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should not match differing strings to numbers', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: '1',
        verse: '5',
      },
    };
    const contextId2 = {
      reference: {
        chapter: 1,
        verse: 6,
      },
    };
    const expectedResults = false;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should not match differing chapters numbers to strings', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: 1,
        verse: 5,
      },
    };
    const contextId2 = {
      reference: {
        chapter: '2',
        verse: '5',
      },
    };
    const expectedResults = false;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should not match differing chapters strings to numbers', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: '1',
        verse: '5',
      },
    };
    const contextId2 = {
      reference: {
        chapter: 2,
        verse: 5,
      },
    };
    const expectedResults = false;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should match string in verse span', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: '1',
        verse: '5',
      },
    };
    const contextId2 = {
      reference: {
        chapter: '1',
        verse: '4-5',
      },
    };
    const expectedResults = true;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should match number in verse span', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: 1,
        verse: 4,
      },
    };
    const contextId2 = {
      reference: {
        chapter: 1,
        verse: '4-5',
      },
    };
    const expectedResults = true;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should not match invalid verse span - before', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: 1,
        verse: 4,
      },
    };
    const contextId2 = {
      reference: {
        chapter: 1,
        verse: 'front',
      },
    };
    const expectedResults = false;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should not match invalid verse span - "1-"', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: 1,
        verse: 4,
      },
    };
    const contextId2 = {
      reference: {
        chapter: 1,
        verse: '1-',
      },
    };
    const expectedResults = false;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });

  test('Should not match invalid verse span - "-5"', () => {
    //given
    const contextId1 = {
      reference: {
        chapter: 1,
        verse: 4,
      },
    };
    const contextId2 = {
      reference: {
        chapter: 1,
        verse: '-5',
      },
    };
    const expectedResults = false;

    //when
    const matched = groupDataHelpers.isSameVerse(contextId1, contextId2);

    //then
    expect(matched).toEqual(expectedResults);
  });
});

describe('groupDataHelpers.isVerseWithinVerseSpan', () => {
  test('Should return false on undefined verse span', () => {
    //given
    const verseSpan = undefined;
    const lookupVerse = '1-2';
    const expectedResults = false;

    //when
    const verseData = groupDataHelpers.isVerseWithinVerseSpan(verseSpan, lookupVerse);

    //then
    expect(verseData).toEqual(expectedResults);
  });

  test('Should return false if outside of verse span', () => {
    //given
    const verseSpan = '2-5';
    const lookupVerse = 1;
    const expectedResults = false;

    //when
    const verseData = groupDataHelpers.isVerseWithinVerseSpan(verseSpan, lookupVerse);

    //then
    expect(verseData).toEqual(expectedResults);
  });

  test('Should return false if string outside of verse span', () => {
    //given
    const verseSpan = '2-5';
    const lookupVerse = '1';
    const expectedResults = false;

    //when
    const verseData = groupDataHelpers.isVerseWithinVerseSpan(verseSpan, lookupVerse);

    //then
    expect(verseData).toEqual(expectedResults);
  });

  test('Should return false if number outside of verse span', () => {
    //given
    const verseSpan = '2-5';
    const lookupVerse = 1;
    const expectedResults = false;

    //when
    const verseData = groupDataHelpers.isVerseWithinVerseSpan(verseSpan, lookupVerse);

    //then
    expect(verseData).toEqual(expectedResults);
  });

  test('Should return true if string inside of verse span', () => {
    //given
    const verseSpan = '2-5';
    const lookupVerse = '3';
    const expectedResults = true;

    //when
    const verseData = groupDataHelpers.isVerseWithinVerseSpan(verseSpan, lookupVerse);

    //then
    expect(verseData).toEqual(expectedResults);
  });

  test('Should return true if number inside of verse span', () => {
    //given
    const verseSpan = '2-5';
    const lookupVerse = 3;
    const expectedResults = true;

    //when
    const verseData = groupDataHelpers.isVerseWithinVerseSpan(verseSpan, lookupVerse);

    //then
    expect(verseData).toEqual(expectedResults);
  });

  test('Should return false if invalid verse span - before', () => {
    //given
    const verseSpan = 'front';
    const lookupVerse = 3;
    const expectedResults = false;

    //when
    const verseData = groupDataHelpers.isVerseWithinVerseSpan(verseSpan, lookupVerse);

    //then
    expect(verseData).toEqual(expectedResults);
  });

  test('Should return false if invalid verse span - "1-"', () => {
    //given
    const verseSpan = '1-';
    const lookupVerse = 3;
    const expectedResults = false;

    //when
    const verseData = groupDataHelpers.isVerseWithinVerseSpan(verseSpan, lookupVerse);

    //then
    expect(verseData).toEqual(expectedResults);
  });

  test('Should return false if invalid verse span "-4"', () => {
    //given
    const verseSpan = '-4';
    const lookupVerse = 3;
    const expectedResults = false;

    //when
    const verseData = groupDataHelpers.isVerseWithinVerseSpan(verseSpan, lookupVerse);

    //then
    expect(verseData).toEqual(expectedResults);
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
