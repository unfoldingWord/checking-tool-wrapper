/* eslint-env jest */
import fs from 'fs-extra';
import {
  getAlignedTargetWords,
  getAlignmentChapterPath,
  getQuoteWords,
  getVerseAlignments,
} from '../src/utils/alignmentHistoryUtils';

const reference = {
  bookId: 'tit', chapter: 1, verse: 2,
};
const verseText = 'Tenemos la fe en Dios y la fe.';
const top = (word, occurrence = 1) => ({
  word, occurrence, occurrences: 1,
});
const bottom = (word, occurrence = 1) => ({
  word, occurrence, occurrences: 2, type: 'bottomWord',
});
const alignments = [
  { topWords: [top('ἔχομεν')], bottomWords: [bottom('Tenemos')] },
  { topWords: [top('πίστιν')], bottomWords: [bottom('la'), bottom('fe')] },
  { topWords: [top('θεοῦ'), top('καὶ')], bottomWords: [bottom('Dios')] },
  { topWords: [top('πίστιν', 2)], bottomWords: [bottom('la', 2), bottom('fe', 2)] },
];

describe('getQuoteWords', () => {
  test('a one-word quote takes the check occurrence', () => {
    expect(getQuoteWords({ quote: 'πίστιν', occurrence: 2 })).toEqual([{ word: 'πίστιν', occurrence: 2 }]);
  });

  test('a quote array keeps each word occurrence', () => {
    expect(getQuoteWords({ quote: [{ word: 'τοῦ', occurrence: 2 }, { word: 'θεοῦ' }, {}] }))
      .toEqual([{ word: 'τοῦ', occurrence: 2 }, { word: 'θεοῦ', occurrence: 1 }]);
  });

  test('a multi-word string counts repeated words, split on spaces and &', () => {
    expect(getQuoteWords({ quote: 'καὶ θεοῦ & καὶ', occurrence: 1 })).toEqual([
      { word: 'καὶ', occurrence: 1 }, { word: 'θεοῦ', occurrence: 1 }, { word: 'καὶ', occurrence: 2 },
    ]);
  });

  test('a multi-word string at a later occurrence cannot be placed', () => {
    expect(getQuoteWords({ quote: 'καὶ θεοῦ', occurrence: 2 })).toBeNull();
  });
});

describe('getAlignedTargetWords', () => {
  const contextId = (quote, occurrence = 1) => ({
    reference, quote, occurrence,
  });

  test('gives the aligned words in verse order with their occurrences', () => {
    expect(getAlignedTargetWords(contextId('πίστιν'), verseText, alignments, 'es-419')).toEqual({
      text: 'la fe',
      words: 'la fe',
      selections: [{
        text: 'la', occurrence: 1, occurrences: 2,
      }, {
        text: 'fe', occurrence: 1, occurrences: 2,
      }],
    });
  });

  test('marks a later occurrence in the text, not in the words', () => {
    const result = getAlignedTargetWords(contextId('πίστιν', 2), verseText, alignments, 'es-419');
    expect(result.text).toBe('la:2 fe:2');
    expect(result.words).toBe('la fe');
    expect(result.selections.map(s => s.occurrence)).toEqual([2, 2]);
  });

  test('words that are not next to each other are kept in verse order', () => {
    const split = [{ topWords: [top('πίστιν')], bottomWords: [bottom('fe'), bottom('Tenemos')] }];
    expect(getAlignedTargetWords(contextId('πίστιν'), verseText, split, 'es-419').text).toBe('Tenemos fe');
  });

  test('a quote aligned together with other original words gives null', () => {
    expect(getAlignedTargetWords(contextId('θεοῦ'), verseText, alignments, 'es-419')).toBeNull();
  });

  test('a quote that is not aligned gives null', () => {
    expect(getAlignedTargetWords(contextId('χάριν'), verseText, alignments, 'es-419')).toBeNull();
    expect(getAlignedTargetWords(contextId('πίστιν'), verseText, null, 'es-419')).toBeNull();
  });

  test('an aligned word missing from the verse gives null', () => {
    expect(getAlignedTargetWords(contextId('πίστιν'), 'Tenemos fe en Dios.', alignments, 'es-419')).toBeNull();
  });

  test('an answer longer than maxWords gives null', () => {
    expect(getAlignedTargetWords(contextId('πίστιν'), verseText, alignments, 'es-419', 1)).toBeNull();
    expect(getAlignedTargetWords(contextId('ἔχομεν'), verseText, alignments, 'es-419', 1).text).toBe('Tenemos');
  });
});

describe('getVerseAlignments', () => {
  const projectPath = '/projects/es-419_glt_tit_book';

  beforeEach(() => {
    fs.__resetMockFS();
  });

  test('reads the verse from the chapter file and caches the chapter', () => {
    const chapterPath = getAlignmentChapterPath(projectPath, 'tit', 1);
    expect(chapterPath).toBe('/projects/es-419_glt_tit_book/.apps/translationCore/alignmentData/tit/1.json');
    fs.outputJsonSync(chapterPath, { 2: { alignments, wordBank: [] } });
    const chapters = {};

    expect(getVerseAlignments(projectPath, 'tit', reference, chapters)).toEqual(alignments);
    fs.outputJsonSync(chapterPath, {});
    expect(getVerseAlignments(projectPath, 'tit', reference, chapters)).toEqual(alignments);
    expect(getVerseAlignments(projectPath, 'tit', { chapter: 1, verse: 3 }, chapters)).toBeNull();
  });

  test('a chapter with no file gives null and is cached as empty', () => {
    const chapters = {};
    expect(getVerseAlignments(projectPath, 'tit', { chapter: 3, verse: 1 }, chapters)).toBeNull();
    expect(chapters[3]).toEqual({});
  });

  test('uses the reader it is given', () => {
    const readJson = jest.fn(() => ({ 2: { alignments } }));
    const chapters = {};

    expect(getVerseAlignments(projectPath, 'tit', reference, chapters, readJson)).toEqual(alignments);
    getVerseAlignments(projectPath, 'tit', reference, chapters, readJson);
    expect(readJson).toHaveBeenCalledTimes(1);
    expect(readJson).toHaveBeenCalledWith(getAlignmentChapterPath(projectPath, 'tit', 1));
  });
});
