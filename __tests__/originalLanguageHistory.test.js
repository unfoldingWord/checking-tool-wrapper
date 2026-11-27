/* eslint-env jest */
/**
 * The original-language history as the app reads it (plans/original-language-history.md, Step 3):
 * the OL-keyed tally of `countOlSelections`, counted through the `onBookChecks` hook of
 * `fetchPreviousSelectionData`, also for books whose GL bible is missing. `fs-extra` is mocked.
 */
import fs from 'fs-extra';
import { fetchPreviousSelectionData } from '../src/utils/checkingSuggestionsUtils';
import {
  countOlSelections, getCheckOlKeys, getOlHistoryForCheck, loadOlBookForSuggestions, newOlSelections,
} from '../src/utils/originalLanguageUtils';

const projectsFolder = '/tc/projects';
const ugntFolder = '/tc/resources/el-x-koine/bibles/ugnt';
const olWord = (text, lemma, strong) => ({
  type: 'word', text, lemma, strong, morph: 'Gr,N,,,,,AFS,',
});
const olBooks = {
  tit: { 1: { 1: { verseObjects: [olWord('πίστιν', 'πίστις', 'G41020')] }, 2: { verseObjects: [olWord('πίστει', 'πίστις', 'G41020')] } } },
  phm: { 1: { 5: { verseObjects: [olWord('πίστιν', 'πίστις', 'G41020')] } } },
};
const check = (bookId, chapter, verse, quote, selections) => ({
  selections,
  contextId: {
    reference: {
      bookId, chapter, verse,
    },
    tool: 'translationWords', groupId: 'faith', quote, occurrence: 1, checkId: `${bookId}${verse}`,
  },
});
const sel = text => [{
  text, occurrence: 1, occurrences: 1,
}];

describe('original-language history', () => {
  test('countOlSelections counts each check by lemma and form, lowercasing the renderings', () => {
    const olSelections = newOlSelections();
    const counted = countOlSelections([
      check('tit', 1, 1, 'πίστιν', sel('Fe')),
      check('tit', 1, 2, 'πίστει', sel('fe')),
      check('tit', 1, 2, 'ἐλπίς', sel('esperanza')), // not in the verse
      check('tit', 1, 1, 'πίστιν', undefined), // no selection
    ], olBooks.tit, olSelections, 'es');

    expect(counted).toBe(2);
    expect(olSelections).toEqual({
      lemma: { 'πίστις': { fe: 2 } },
      form: { 'πιστιν': { fe: 1 }, 'πιστει': { fe: 1 } },
    });
  });

  test('getCheckOlKeys and getOlHistoryForCheck find the check\'s keys, or give null', () => {
    const olSelections = { lemma: { 'πίστις': { fe: 2 } }, form: {} };
    const { contextId } = check('tit', 1, 2, 'πίστει');

    expect(getCheckOlKeys(contextId, olBooks.tit)).toEqual({ lemma: 'πίστις', form: 'πιστει' });
    expect(getCheckOlKeys(contextId, null)).toBeNull();
    expect(getOlHistoryForCheck(olSelections, contextId, olBooks.tit)).toEqual({ ...olSelections, keys: { lemma: 'πίστις', form: 'πιστει' } });
    expect(getOlHistoryForCheck(null, contextId, olBooks.tit)).toBeNull();
    expect(getOlHistoryForCheck(olSelections, check('tit', 1, 2, 'ἐλπίς').contextId, olBooks.tit)).toBeNull();
  });

  describe('read from the projects', () => {
    beforeEach(() => {
      fs.__resetMockFS();

      for (const [bookId, book] of Object.entries(olBooks)) {
        for (const [chapter, verses] of Object.entries(book)) {
          fs.outputJsonSync(`${ugntFolder}/v0.34_unfoldingWord/${bookId}/${chapter}.json`, verses);
        }
      }
      fs.outputJsonSync(`${ugntFolder}/v0.30_unfoldingWord/tit/1.json`, {});
      // the GL bible has Titus only
      fs.outputJsonSync('/tc/resources/en/bibles/ult/v1_unfoldingWord/tit/1.json', {
        1: {
          verseObjects: [{
            tag: 'zaln', type: 'milestone', content: 'πίστιν', occurrence: 1, occurrences: 1,
            children: [{
              tag: 'w', type: 'word', text: 'faith', occurrence: 1, occurrences: 1,
            }],
            endTag: 'zaln-e\\*',
          }],
        },
      });

      const index = (name, bookId, checks) => fs.outputJsonSync(
        `${projectsFolder}/${name}/.apps/translationCore/index/translationWords/${bookId}/faith.json`, checks);
      index('es-419_glt_tit_book', 'tit', [check('tit', 1, 1, 'πίστιν', sel('fe'))]);
      index('es-419_glt_phm_book', 'phm', [check('phm', 1, 5, 'πίστιν', sel('la fe'))]);
      index('es-419_ulb_phm_book', 'phm', [check('phm', 1, 5, 'πίστιν', sel('otra'))]); // another resource
    });

    test('loadOlBookForSuggestions reads the newest unfoldingWord version and caches the book', () => {
      const cache = {};
      expect(loadOlBookForSuggestions(projectsFolder, 'tit', cache)).toEqual(olBooks.tit);
      expect(loadOlBookForSuggestions(projectsFolder, 'jud', cache)).toBeNull();
      expect(Object.keys(cache).sort()).toEqual(['jud', 'tit']);
    });

    test('fetchPreviousSelectionData counts the OL history also where the GL bible has no book', () => {
      const olSelections = newOlSelections();
      const olBooksCache = {};
      const onBookChecks = jest.fn((checks, bookId, folder) =>
        countOlSelections(checks, loadOlBookForSuggestions(folder, bookId, olBooksCache), olSelections, 'es-419'));
      const { contextId } = check('tit', 1, 1, 'πίστιν');
      const glHistory = fetchPreviousSelectionData(`${projectsFolder}/es-419_glt_tit_book`, contextId, { ult: {} }, null,
        'translationWords', 'faith', 'en', 'unfoldingWord', { contextId }, {
          glBibleId: null, targetLangId: null, resourceId: null, bibles: {},
        }, { onBookChecks });

      expect(glHistory).toEqual({ faith: { fe: 1 } }); // Philemon has no GL book
      expect(onBookChecks.mock.calls.map(([, bookId]) => bookId).sort()).toEqual(['phm', 'tit']);
      expect(olSelections.lemma).toEqual({ 'πίστις': { 'fe': 1, 'la fe': 1 } });
    });
  });
});
