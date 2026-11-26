/* eslint-env jest */
/**
 * Step 1 of plans/original-language-history.md: original-language (OL) words in the case files,
 * and how often an OL-keyed history matches a check compared with the GL-keyed one.
 *
 * The unit tests always run. Two jobs run only when asked:
 *
 *   npm run add:ol-words        (LLM_OL_ADD_WORDS=1)
 *     Adds `olWords` (the quote's words with lemma, Strong's number and morphology, from the newest
 *     unfoldingWord `ugnt`/`uhb` in the translationCore resources) to every case of every `.json`
 *     case file in `LLM_OL_DIRS`. Nothing else in the files changes, so results already saved stay
 *     comparable. A case whose quote is not found in the OL verse gets `olWords: null`.
 *
 *   npm run measure:ol-history  (LLM_OL_MEASURE=1)
 *     For every case file in `LLM_OL_DATA_DIR`, builds each case's OL histories from the cases
 *     before it in the same group (`buildOlHistories`) and counts how often each key is exact for
 *     the case and holds its answer (`measureOlHistory`). Prints the counts by target language and
 *     in total, and writes them to `<LLM_OL_DATA_DIR>/results/olHistoryMeasure.json` and `.txt`.
 *     Run `add:ol-words` first.
 *
 * Environment variables:
 *   LLM_OL_TC_HOME   translationCore folder with the OL bibles (default ~/translationCore)
 *   LLM_OL_DIRS      folders whose case files get `olWords`, space-separated (default
 *                    llmTrainingData llmTrainingData/promptEval)
 *   LLM_OL_DATA_DIR  training data folder to measure (default llmTrainingData)
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because
 * `fs-extra` is mocked globally.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getBaseStrong, getLooseOlForm, getOlKeys, getOlVerseWords, getQuoteOlWords,
} from '../src/utils/originalLanguageUtils';
import {
  addCounts, addOlWordsToCases, buildOlHistories, makeOlBibleLoader, measureOlHistory, OL_MEASURES,
} from './helpers/olHistoryHelpers';

const env = process.env;
const ROOT = path.resolve(__dirname, '..');
const TC_HOME = env.LLM_OL_TC_HOME || path.join(os.homedir(), 'translationCore');
const ADD_WORDS = env.LLM_OL_ADD_WORDS === '1';
const MEASURE = env.LLM_OL_MEASURE === '1';

const word = (text, strong, lemma, morph = '') => ({
  type: 'word', text, strong, lemma, morph,
});

describe('originalLanguageUtils', () => {
  const greekVerse = [
    word('Παῦλος', 'G39720', 'Παῦλος'),
    { type: 'text', text: ', ' },
    word('δοῦλος', 'G14010', 'δοῦλος'),
    word('Θεοῦ', 'G23160', 'θεός', 'Gr,N,,,,,GMS,'),
    {
      tag: 'k', type: 'milestone', children: [word('Θεοῦ', 'G23160', 'θεός'), word('πατρὸς', 'G39620', 'πατήρ')],
    },
  ];
  const hebrewVerse = [
    word('וַ⁠יְהִ֗י', 'c:H1961', 'הָיָה'),
    word('בִּ⁠ימֵי֙', 'b:H3117', 'יוֹם'),
  ];

  test('getOlVerseWords opens milestones', () => {
    expect(getOlVerseWords(greekVerse).map(w => w.text)).toEqual(['Παῦλος', 'δοῦλος', 'Θεοῦ', 'Θεοῦ', 'πατρὸς']);
  });

  test('getQuoteOlWords finds a word by its occurrence', () => {
    const contextId = {
      reference: { bookId: 'tit' }, quote: 'Θεοῦ', occurrence: 2,
    };

    expect(getQuoteOlWords(contextId, greekVerse)).toEqual([{
      word: 'Θεοῦ', occurrence: 2, lemma: 'θεός', strong: 'G23160', morph: '',
    }]);
  });

  test('getQuoteOlWords finds every word of a multi-word quote', () => {
    const contextId = {
      reference: { bookId: 'tit' },
      quote: [{ word: 'Θεοῦ', occurrence: 2 }, { word: 'πατρὸς', occurrence: 1 }],
    };
    expect(getQuoteOlWords(contextId, greekVerse).map(w => w.lemma)).toEqual(['θεός', 'πατήρ']);
  });

  test('getQuoteOlWords matches loosely when accents or word joiners differ', () => {
    expect(getQuoteOlWords({ reference: { bookId: 'tit' }, quote: 'θεου' }, greekVerse)?.[0].lemma).toBe('θεός');
    expect(getQuoteOlWords({ reference: { bookId: 'rut' }, quote: 'וַיְהִ֗י' }, hebrewVerse)?.[0].strong).toBe('c:H1961');
    expect(getQuoteOlWords({ reference: { bookId: 'rut' }, quote: 'בִּ⁠ימֵי֙' }, hebrewVerse)?.[0].lemma).toBe('יוֹם');
  });

  test('getQuoteOlWords gives null when a word or occurrence is missing', () => {
    expect(getQuoteOlWords({ reference: { bookId: 'tit' }, quote: 'πίστις' }, greekVerse)).toBeNull();
    expect(getQuoteOlWords({
      reference: { bookId: 'tit' }, quote: 'Θεοῦ', occurrence: 3,
    }, greekVerse)).toBeNull();
    expect(getQuoteOlWords({ reference: { bookId: 'tit' }, quote: '' }, greekVerse)).toBeNull();
    expect(getQuoteOlWords({ reference: { bookId: 'tit' }, quote: 'Θεοῦ' }, [])).toBeNull();
  });

  test('getLooseOlForm drops accents, points and word joiners', () => {
    expect(getLooseOlForm('Θεοῦ', 'el-x-koine')).toBe('θεου');
    expect(getLooseOlForm('בִּ⁠ימֵי֙', 'hbo')).toBe('בימי');
  });

  test('getBaseStrong drops Hebrew prefixes', () => {
    expect(getBaseStrong('b:H3117')).toBe('H3117');
    expect(getBaseStrong('c:d:H0776')).toBe('H0776');
    expect(getBaseStrong('G23160')).toBe('G23160');
    expect(getBaseStrong(undefined)).toBe('');
  });

  test('getOlKeys gives the lemma key and the form key', () => {
    expect(getOlKeys([{ word: 'Θεοῦ', lemma: 'θεός' }, { word: 'Πατρὸς', lemma: 'πατήρ' }], 'tit'))
      .toEqual({ lemma: 'θεός πατήρ', form: 'θεου πατρος' });
    expect(getOlKeys([{ word: 'Παῦλος', lemma: 'Παῦλος' }], 'tit')).toEqual({ lemma: 'παῦλος', form: 'παυλος' });
    expect(getOlKeys([{ word: 'Θεοῦ', lemma: '' }], 'tit')).toEqual({ lemma: 'θεου', form: 'θεου' });
    expect(getOlKeys(null, 'tit')).toBeNull();
  });
});

describe('olHistoryHelpers', () => {
  const makeCase = (id, glPhrase, quoteWord, lemma, text) => ({
    id,
    targetLang: 'es',
    glLang: 'en',
    groupId: 'god',
    glPhrase,
    history: {},
    selections: [{ text, occurrence: 1 }],
    contextId: {
      reference: {
        bookId: 'tit', chapter: 1, verse: 1,
      }, groupId: 'god', quote: quoteWord,
    },
    olWords: lemma ? [{ word: quoteWord, lemma }] : null,
  });
  const cases = [
    makeCase('a', 'God', 'Θεοῦ', 'θεός', 'Dios'),
    makeCase('b', 'of God', 'Θεοῦ', 'θεός', 'Dios'),
    makeCase('c', 'God', 'Θεὸς', 'θεός', 'Dios'),
    makeCase('d', 'divine', 'θεῖος', null, 'divino'),
  ];

  test('addOlWordsToCases puts olWords after contextId and keeps the rest', () => {
    const book = { 1: { 1: { verseObjects: [word('Θεοῦ', 'G23160', 'θεός')] } } };
    const entry = {
      id: 'x', contextId: {
        reference: {
          bookId: 'tit', chapter: 1, verse: 1,
        }, quote: 'Θεοῦ',
      }, tags: [],
    };
    const missing = {
      ...entry, id: 'y', contextId: { ...entry.contextId, quote: 'πίστις' },
    };
    const result = addOlWordsToCases([entry, missing, { note: 'no contextId' }], () => book);
    expect(Object.keys(result.entries[0])).toEqual(['id', 'contextId', 'olWords', 'tags']);
    expect(result.entries[0].olWords[0].lemma).toBe('θεός');
    expect(result.entries[1].olWords).toBeNull();
    expect(result.entries[2]).toEqual({ note: 'no contextId' });
    expect(result).toMatchObject({ found: 1, notFound: 1 });
  });

  test('buildOlHistories counts only the earlier cases of the group', () => {
    const histories = buildOlHistories(cases);

    expect(histories.get('a')).toMatchObject({
      lemma: {}, form: {}, gl: {},
    });
    expect(histories.get('c').lemma).toEqual({ 'θεός': { dios: 2 } });
    expect(histories.get('c').form).toEqual({ 'θεου': { dios: 2 } });
    expect(histories.get('c').gl).toEqual({ 'god': { dios: 1 }, 'of god': { dios: 1 } });
    // a case without olWords adds nothing to the OL tallies, but its GL phrase still counts
    expect(histories.get('d').keys).toBeNull();
  });

  test('measureOlHistory counts exact keys and answers under them', () => {
    const counts = measureOlHistory(cases);
    expect(Object.keys(counts)).toEqual(OL_MEASURES);
    expect(counts).toMatchObject({
      cases: 4,
      olWordsFound: 3,
      lemmaExact: 2, // b and c
      lemmaExactHasAnswer: 2,
      glSameExact: 1, // c ('god' after a)
      glSameExactHasAnswer: 1,
      formExact: 1, // b ('θεου' after a); c is 'θεος'
      lemmaOnlyHasAnswer: 1, // b
      glSameOnlyHasAnswer: 0,
      glOrLemmaExactHasAnswer: 2,
    });
    expect(addCounts({}, counts)).toEqual(counts);
  });

  test('measureOlHistory counts the in-verse proxy', () => {
    const inVerse = (id, glPhrase, lemma, text, verse) => ({ ...makeCase(id, glPhrase, 'Θεοῦ', lemma, text), verse });
    const counts = measureOlHistory([
      inVerse('a', 'God', 'θεός', 'Dios', 'Dios es'),
      inVerse('b', 'God', 'θεός', 'Señor', 'el Señor'),
      // 'god' and 'θεός' each hold Dios and Señor once: a tie, so not right
      inVerse('c', 'God', 'θεός', 'Dios', 'Dios y Señor'),
      // only Dios is in this verse
      inVerse('d', 'of God', 'θεός', 'Dios', 'de Dios'),
    ]);

    expect(counts).toMatchObject({
      'glSameInVerse': 1, // c; b's verse lacks Dios, d has no 'of god' history
      'lemmaInVerse': 2, // c, d
      'lemmaInVerseRight': 1, // d
      'poolInVerseRight': 1, // d
      'order:glSame,pool': 1, // d through the pool
    });
  });
});

const describeIfAdd = ADD_WORDS ? describe : describe.skip;

describeIfAdd('add olWords to the case files', () => {
  test('adds olWords to every case', () => {
    const { getBook, versionOf } = makeOlBibleLoader(TC_HOME);
    const dirs = (env.LLM_OL_DIRS || 'llmTrainingData llmTrainingData/promptEval').split(/\s+/).filter(Boolean);
    const lines = [];

    for (const dir of dirs) {
      const folder = path.resolve(ROOT, dir);

      for (const name of fs.readdirSync(folder).filter(file => file.endsWith('.json')).sort()) {
        const file = path.join(folder, name);
        const entries = JSON.parse(fs.readFileSync(file, 'utf8'));

        if (!Array.isArray(entries)) {
          continue;
        }

        const result = addOlWordsToCases(entries, getBook);
        expect(result.entries.map(entry => entry?.id)).toEqual(entries.map(entry => entry?.id));
        fs.writeFileSync(file, `${JSON.stringify(result.entries, null, 2)}\n`);
        const books = [...new Set(entries.map(entry => entry?.contextId?.reference?.bookId).filter(Boolean))];
        lines.push(`${dir}/${name}: ${result.found} found, ${result.notFound} not found (${books.map(versionOf).join(', ')})`);
      }
    }
    console.log(`olWords added:\n${lines.join('\n')}`);
  });
});

const describeIfMeasure = MEASURE ? describe : describe.skip;

describeIfMeasure('measure OL history', () => {
  test('counts exact keys and answers for every case file', () => {
    const dataDir = path.resolve(ROOT, env.LLM_OL_DATA_DIR || 'llmTrainingData');
    const total = {};
    const byLanguage = {};
    const byFile = {};
    let missingOlWords = 0;

    for (const name of fs.readdirSync(dataDir).filter(file => file.endsWith('.json')).sort()) {
      const entries = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));

      if (!Array.isArray(entries) || !entries.length) {
        continue;
      }
      missingOlWords += entries.filter(entry => entry?.contextId && !('olWords' in entry)).length;

      const counts = measureOlHistory(entries);
      const language = entries[0].targetLang;
      byFile[name.replace(/\.json$/, '')] = counts;
      addCounts(total, counts);
      byLanguage[language] = addCounts(byLanguage[language] || {}, counts);
    }

    expect(missingOlWords).toBe(0); // run `npm run add:ol-words` first

    const report = formatReport(total, byLanguage);
    const outDir = path.join(dataDir, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'olHistoryMeasure.json'), `${JSON.stringify({
      createdAt: new Date().toISOString(), total, byLanguage, byFile,
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, 'olHistoryMeasure.txt'), report);
    console.log(report);
  });
});

/**
 * The report table: one row per measure, a column for the total and for each target language,
 * as a percentage of the cases.
 * @param {object} total
 * @param {object} byLanguage
 * @returns {string}
 */
function formatReport(total, byLanguage) {
  const columns = [['all', total], ...Object.entries(byLanguage).sort(([a], [b]) => a.localeCompare(b))];
  const pct = (counts, name) => (counts.cases ? `${(100 * counts[name] / counts.cases).toFixed(1)}%` : '-');
  const rows = [
    ['', ...columns.map(([name]) => name)],
    ['cases', ...columns.map(([, counts]) => String(counts.cases))],
    ...OL_MEASURES.filter(name => name !== 'cases').map(name => [name, ...columns.map(([, counts]) => pct(counts, name))]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map(row => row[i].length)));
  return `${rows.map(row => row.map((cell, i) => cell.padStart(i ? widths[i] : 0).padEnd(i ? 0 : widths[0])).join('  ')).join('\n')}\n`;
}
