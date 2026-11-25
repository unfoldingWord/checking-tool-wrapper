/* eslint-env jest */
import fs from 'fs-extra';
import {
  fetchAlignmentHistoryEntries,
  getAlignedTargetWords,
  getAlignmentChapterPath,
  getAlignmentCheckKey,
  getQuoteWords,
  getSuggestionHistory,
  getVerseAlignments,
  updateAlignmentEntrySelection,
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

describe('alignment history', () => {
  const projectsFolder = '/tc/projects';
  const current = 'es-419_glt_tit_book';
  const glVerse = (quote, glWord) => ({
    verseObjects: [{
      tag: 'zaln', type: 'milestone', content: quote, occurrence: 1, occurrences: 1,
      children: [{
        tag: 'w', type: 'word', text: glWord, occurrence: 1, occurrences: 1,
      }],
      endTag: 'zaln-e\\*',
    }],
  });
  const glBooks = {
    tit: { 1: { 1: glVerse('πίστιν', 'faith'), 2: glVerse('πίστιν', 'faith'), 3: glVerse('πίστιν', 'faith') } },
    phm: { 1: { 5: glVerse('πίστιν', 'faith') } },
    rut: { 1: { 1: glVerse('אֱמוּנָה', 'faithfulness') } },
  };
  const loadGlBook = jest.fn((folder, bookId) => glBooks[bookId] || null);
  const check = (bookId, chapter, verse, quote, selections = false) => ({
    selections,
    contextId: {
      reference: {
        bookId, chapter, verse,
      },
      tool: 'translationWords', groupId: 'faith', quote, occurrence: 1, checkId: `${bookId}${verse}`,
    },
  });
  const align = (quote, words) => ({ alignments: [{ topWords: [top(quote)], bottomWords: words.map(word => bottom(word)) }] });

  /** writes a project: its group index, target verses and alignments */
  function writeProject(name, bookId, checks, verses, alignmentsByVerse) {
    const projectPath = `${projectsFolder}/${name}`;
    fs.outputJsonSync(`${projectPath}/.apps/translationCore/index/translationWords/${bookId}/faith.json`, checks);
    fs.outputJsonSync(`${projectPath}/${bookId}/1.json`, verses);
    fs.outputJsonSync(getAlignmentChapterPath(projectPath, bookId, 1), alignmentsByVerse);
  }

  const fetchEntries = (options = {}) => fetchAlignmentHistoryEntries(`${projectsFolder}/${current}`, { ult: {} },
    'translationWords', 'faith', 'en', 'unfoldingWord', {}, { loadGlBook, ...options });

  beforeEach(() => {
    fs.__resetMockFS();
    writeProject(current, 'tit', [
      check('tit', 1, 1, 'πίστιν'), // aligned, no selection
      check('tit', 1, 2, 'πίστιν', [{ text: 'fe', occurrence: 1, occurrences: 1 }]), // aligned and selected
      check('tit', 1, 3, 'πίστιν'), // not aligned
    ], { 1: 'Por la fe vivimos.', 2: 'Tenemos fe.', 3: 'Sin nada.' },
    { 1: align('πίστιν', ['la', 'fe']), 2: align('πίστιν', ['fe']) });
    writeProject('es-419_glt_phm_book', 'phm', [check('phm', 1, 5, 'πίστιν')],
      { 5: 'Oímos de su fe.' }, { 5: align('πίστιν', ['su', 'fe']) });
    // other testament: its saved selection is not in the selection history, so it is used here
    writeProject('es-419_glt_rut_book', 'rut', [check('rut', 1, 1, 'אֱמוּנָה', [{ text: 'fidelidad', occurrence: 1, occurrences: 1 }])],
      { 1: 'Con fidelidad.' }, {});
    // another resource and another language are left out
    writeProject('es-419_ulb_phm_book', 'phm', [check('phm', 1, 5, 'πίστιν')], { 5: 'Oímos de su fe.' }, { 5: align('πίστιν', ['fe']) });
    writeProject('fr_glt_phm_book', 'phm', [check('phm', 1, 5, 'πίστιν')], { 5: 'Oímos de su fe.' }, { 5: align('πίστιν', ['fe']) });
  });

  test('gathers aligned words and other-testament selections from matching projects', () => {
    const entries = fetchEntries();
    const summary = entries.map(e => [e.projectName, `${e.bookId} ${e.chapter}:${e.verse}`, e.glPhrase, e.words, e.source, e.hasSelection]);

    expect(summary.sort()).toEqual([
      ['es-419_glt_phm_book', 'phm 1:5', 'faith', 'su fe', 'alignment', false],
      ['es-419_glt_rut_book', 'rut 1:1', 'faithfulness', 'fidelidad', 'selection', false],
      [current, 'tit 1:1', 'faith', 'la fe', 'alignment', false],
      [current, 'tit 1:2', 'faith', 'fe', 'alignment', true],
    ]);
    expect(entries.find(e => e.verse === 1 && e.bookId === 'tit').key)
      .toBe(getAlignmentCheckKey(current, check('tit', 1, 1, 'πίστιν').contextId));
  });

  test('allTestaments false keeps only projects of the current testament', () => {
    expect(fetchEntries({ allTestaments: false }).map(e => e.bookId).sort()).toEqual(['phm', 'tit', 'tit']);
  });

  test('a check with no GL phrase is left out', () => {
    const noPhmText = (folder, bookId) => (bookId === 'phm' ? { 1: {} } : glBooks[bookId]);
    const entries = fetchEntries({ loadGlBook: noPhmText });
    expect(entries.some(e => e.bookId === 'phm')).toBe(false);
    expect(entries.some(e => e.bookId === 'tit')).toBe(true);
  });

  test('the history adds the entries but not the check\'s own verse or counted selections', () => {
    const selections = { faith: { fe: 2 } };
    const entries = fetchEntries();
    const forVerse1 = getSuggestionHistory(selections, entries, current, check('tit', 1, 1, 'πίστιν').contextId);

    expect(forVerse1).toEqual({ faith: { fe: 2, 'su fe': 1 }, faithfulness: { fidelidad: 1 } });
    expect(selections).toEqual({ faith: { fe: 2 } }); // not changed
    expect(getSuggestionHistory(selections, entries, current, check('tit', 1, 3, 'πίστιν').contextId))
      .toEqual({ faith: { fe: 2, 'la fe': 1, 'su fe': 1 }, faithfulness: { fidelidad: 1 } });
  });

  test('the same verse in another project is not left out', () => {
    const entries = fetchEntries();
    expect(getSuggestionHistory({}, entries, current, check('phm', 1, 5, 'πίστιν').contextId).faith)
      .toEqual({ 'la fe': 1, 'su fe': 1 });
  });

  test('with no entries the selection history is used as it is', () => {
    const selections = { faith: { fe: 2 } };
    expect(getSuggestionHistory(selections, null, current, check('tit', 1, 1, 'πίστιν').contextId)).toBe(selections);
    expect(getSuggestionHistory(selections, [], current, check('tit', 1, 1, 'πίστιν').contextId)).toBe(selections);
  });

  test('saving or clearing a selection switches the check\'s alignment off or on', () => {
    const entries = fetchEntries();
    const contextId = check('tit', 1, 3, 'πίστιν').contextId;
    const history = () => getSuggestionHistory({}, entries, current, contextId).faith;

    expect(updateAlignmentEntrySelection(entries, current, check('tit', 1, 1, 'πίστιν').contextId, [{ text: 'fe' }])).toBe(true);
    expect(history()).toEqual({ 'su fe': 1 });
    updateAlignmentEntrySelection(entries, current, check('tit', 1, 2, 'πίστιν').contextId, []);
    expect(history()).toEqual({ fe: 1, 'su fe': 1 });
    expect(updateAlignmentEntrySelection(entries, current, contextId, [{ text: 'nada' }])).toBe(false);
  });
});
