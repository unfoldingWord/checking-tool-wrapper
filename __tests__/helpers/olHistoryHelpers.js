/**
 * Helpers for Step 1 of plans/original-language-history.md: original-language (OL) words in the
 * case files, and OL-keyed histories built from them.
 *
 * The case files keep only each case's `olWords` (the quote's words with lemma, Strong's number and
 * morphology). The OL history of a case is built when needed from the cases before it in the same
 * group of the same file ({@link buildOlHistories}), as the GL `history` was built from the checks
 * before it. That avoids a second copy of every history in the files.
 *
 * Node's `fs` is used because `fs-extra` is mocked globally.
 */
import fs from 'fs';
import path from 'path';
import {
  getOrigLangId, getOlKeys, getQuoteOlWords,
} from '../../src/utils/originalLanguageUtils';
import { getSelectionHistoryKey } from '../../src/utils/checkingSuggestionsUtils';

/** the OL bibles read from `<translationCore>/resources/<lang>/bibles/<id>/` */
export const OL_BIBLES = { 'el-x-koine': 'ugnt', 'hbo': 'uhb' };
export const OL_BIBLE_OWNER = 'unfoldingWord';

/**
 * Loads books of the newest unfoldingWord OL bible, caching them.
 * @param {string} tcHome - translationCore folder
 * @returns {{getBook: function(string): (object|null), versionOf: function(string): (string|null)}} -
 *   `getBook(bookId)` gives `{ chapter: { verse: { verseObjects } } }`, null when the book is missing
 */
export function makeOlBibleLoader(tcHome) {
  const books = {};
  const versions = {};

  const versionOf = bookId => {
    const langId = getOrigLangId(bookId);

    if (!(langId in versions)) {
      const folder = path.join(tcHome, 'resources', langId, 'bibles', OL_BIBLES[langId]);
      versions[langId] = getNewestOwnerVersion(folder, OL_BIBLE_OWNER);
    }
    return versions[langId] ? `${OL_BIBLES[langId]}/${versions[langId]}` : null;
  };

  const getBook = bookId => {
    if (!(bookId in books)) {
      const version = versionOf(bookId);
      const folder = version && path.join(tcHome, 'resources', getOrigLangId(bookId), 'bibles', version, bookId);
      books[bookId] = folder && fs.existsSync(folder) ? readBookFolder(folder) : null;
    }
    return books[bookId];
  };
  return { getBook, versionOf };
}

/**
 * The newest `v<version>_<owner>` folder name in a folder.
 * @param {string} folder
 * @param {string} owner
 * @returns {string|null}
 */
export function getNewestOwnerVersion(folder, owner) {
  if (!fs.existsSync(folder)) {
    return null;
  }

  const suffix = `_${owner}`;
  const numbers = name => name.slice(1, -suffix.length).split('.').map(Number);
  const versions = fs.readdirSync(folder)
    .filter(name => name.endsWith(suffix) && /^v[\d.]+$/.test(name.slice(0, -suffix.length)))
    .sort((a, b) => {
      const pa = numbers(a);
      const pb = numbers(b);

      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) {
          return (pa[i] || 0) - (pb[i] || 0);
        }
      }
      return 0;
    });
  return versions.pop() || null;
}

function readBookFolder(folder) {
  const book = {};

  for (const file of fs.readdirSync(folder).filter(name => /^\d+\.json$/.test(name))) {
    book[parseInt(file, 10)] = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
  }
  return book;
}

/**
 * The OL words of a case's quote, from the OL bible.
 * @param {object} contextId
 * @param {function(string): (object|null)} getBook - from {@link makeOlBibleLoader}
 * @returns {Array<object>|null} - see `getQuoteOlWords`
 */
export function getCaseOlWords(contextId, getBook) {
  const {
    bookId, chapter, verse,
  } = contextId?.reference || {};
  const verseObjects = getBook(bookId)?.[chapter]?.[verse]?.verseObjects;
  return verseObjects ? getQuoteOlWords(contextId, verseObjects) : null;
}

/**
 * Adds `olWords` to every case that has a `contextId`, right after `contextId`; cases whose quote
 * is not found get `olWords: null`. Other fields and their order are kept.
 * @param {Array<object>} entries
 * @param {function(string): (object|null)} getBook
 * @returns {{entries: Array<object>, found: number, notFound: number}}
 */
export function addOlWordsToCases(entries, getBook) {
  let found = 0;
  let notFound = 0;
  const result = entries.map(entry => {
    if (!entry?.contextId) {
      return entry;
    }

    const olWords = getCaseOlWords(entry.contextId, getBook);

    if (olWords) {
      found++;
    } else {
      notFound++;
    }

    const out = {};

    for (const [key, value] of Object.entries(entry)) {
      if (key !== 'olWords') {
        out[key] = value;
      }

      if (key === 'contextId') {
        out.olWords = olWords;
      }
    }
    return out;
  });
  return {
    entries: result, found, notFound,
  };
}

/**
 * The target-language rendering of a case's answer, as the history counts it.
 * @param {object} entry - with `selections` and `targetLang`
 * @returns {string}
 */
export function getCaseRendering(entry) {
  return getSelectionHistoryKey((entry.selections || []).map(selection => selection.text).join(' '), entry.targetLang);
}

function increment(tally, key, rendering) {
  if (!key) {
    return;
  }
  tally[key] = tally[key] || {};
  tally[key][rendering] = (tally[key][rendering] || 0) + 1;
}

/**
 * Builds, for every case of one case file, histories from the cases before it in the same group
 * (in file order, which is the order of the group's checks):
 *  - `lemma`: `{ lemmaKey: { rendering: count } }`
 *  - `form`: `{ formKey: { rendering: count } }`
 *  - `gl`: `{ glPhrase: { rendering: count } }` from the same earlier cases, for comparing like with
 *    like: the file's `history` also counts the group's first checks, which have no case of their own
 *  - `glForm`: `{ 'glPhrase|formKey': { rendering: count } }`, the GL phrase and the OL form together
 * Cases without `olWords` add nothing to the OL tallies.
 * @param {Array<object>} entries - one file's cases
 * @returns {Map<string, {lemma: object, form: object, gl: object, glForm: object,
 *   keys: object|null}>} - by case id; `keys` is the case's own OL keys (`getOlKeys`)
 */
export function buildOlHistories(entries) {
  const byGroup = new Map();
  const result = new Map();

  for (const entry of entries) {
    if (!entry?.contextId) {
      continue;
    }

    const groupId = entry.groupId || entry.contextId.groupId;

    if (!byGroup.has(groupId)) {
      byGroup.set(groupId, {
        lemma: {}, form: {}, gl: {}, glForm: {},
      });
    }

    const tallies = byGroup.get(groupId);
    const keys = getOlKeys(entry.olWords, entry.contextId.reference?.bookId);

    result.set(entry.id, {
      lemma: cloneTally(tallies.lemma),
      form: cloneTally(tallies.form),
      gl: cloneTally(tallies.gl),
      glForm: cloneTally(tallies.glForm),
      keys,
    });

    const rendering = getCaseRendering(entry);
    increment(tallies.lemma, keys?.lemma, rendering);
    increment(tallies.form, keys?.form, rendering);
    const glKey = getSelectionHistoryKey(entry.glPhrase || '', entry.glLang);
    increment(tallies.gl, glKey, rendering);
    increment(tallies.glForm, keys && getGlFormKey(glKey, keys), rendering);
  }
  return result;
}

/**
 * The key of the `glForm` tally.
 * @param {string} glKey - lowercased GL phrase
 * @param {{form: string}} olKeys
 * @returns {string}
 */
export function getGlFormKey(glKey, olKeys) {
  return `${glKey}|${olKeys.form}`;
}

function cloneTally(tally) {
  const copy = {};

  for (const [key, renderings] of Object.entries(tally)) {
    copy[key] = { ...renderings };
  }
  return copy;
}

/** names of the counters {@link measureOlHistory} keeps */
export const OL_MEASURES = [
  'cases', 'olWordsFound',
  'glExact', 'glExactHasAnswer', 'anyKeyHasAnswer',
  'glSameExact', 'glSameExactHasAnswer', 'sameAnyKeyHasAnswer',
  'lemmaExact', 'lemmaExactHasAnswer', 'lemmaTop', 'glSameTop',
  'formExact', 'formExactHasAnswer',
  'glOrLemmaExactHasAnswer', 'lemmaOnlyHasAnswer', 'glSameOnlyHasAnswer',
  ...['glForm', 'glSame', 'form', 'lemma', 'pool'].flatMap(name => [`${name}InVerse`, `${name}InVerseRight`]),
];

/**
 * Orders of keys tried by {@link measureOlHistory}'s in-verse proxy: the first key with a rendering
 * in the verse gives the answer. `glSame,pool` is close to today's algorithm (exact GL key, else
 * every rendering of the group).
 */
export const OL_KEY_ORDERS = [
  'glSame,pool',
  'lemma,glSame,pool',
  'glSame,lemma,pool',
  'glSame,form,pool',
  'form,glSame,lemma,pool',
  'glSame,form,lemma,pool',
  'glForm,glSame,form,lemma,pool',
];
OL_MEASURES.push(...OL_KEY_ORDERS.map(order => `order:${order}`));

/**
 * Counts, for the cases of one file, how often each key of the history is exact for the case and
 * how often the case's answer is a rendering under it:
 *  - `gl*`: the file's `history` and the case's GL phrase (what the algorithm uses today);
 *  - `glSame*`: GL phrase, history from the same earlier cases as the OL histories;
 *  - `lemma*`, `form*`: the OL histories;
 *  - `*Top`: the answer is the most counted rendering under the exact key (ties count as top);
 *  - `lemmaOnlyHasAnswer` / `glSameOnlyHasAnswer`: the answer is under one exact key but not the other;
 *  - `<key>InVerse` / `<key>InVerseRight`, a rough proxy for the algorithm, which only suggests
 *    renderings it finds in the verse: some rendering under the exact key (`pool`: under any key) is
 *    in the verse (lowercased text contains it), and the most counted of those is the answer alone;
 *  - `order:<keys>`: the in-verse proxy trying the keys in that order ({@link OL_KEY_ORDERS}).
 * @param {Array<object>} entries - one file's cases, with `olWords`
 * @returns {object} - counters named in {@link OL_MEASURES}
 */
export function measureOlHistory(entries) {
  const counts = Object.fromEntries(OL_MEASURES.map(name => [name, 0]));
  const histories = buildOlHistories(entries);

  for (const entry of entries) {
    const built = entry?.contextId && histories.get(entry.id);

    if (!built) {
      continue;
    }

    const rendering = getCaseRendering(entry);
    const glKey = getSelectionHistoryKey(entry.glPhrase || '', entry.glLang);
    const history = entry.history || {};
    const has = (tally, key) => Boolean(key && tally[key] && rendering in tally[key]);

    const isTop = (tally, key) => {
      const renderings = key && tally[key];

      if (!renderings || !(rendering in renderings)) {
        return false;
      }
      return renderings[rendering] === Math.max(...Object.values(renderings));
    };

    const anyHas = tally => Object.values(tally).some(renderings => rendering in renderings);
    const verse = getSelectionHistoryKey(entry.verse || '', entry.targetLang);
    const pool = {};

    for (const renderings of Object.values(built.gl)) {
      for (const [text, count] of Object.entries(renderings)) {
        pool[text] = (pool[text] || 0) + count;
      }
    }

    const inVerse = {
      glForm: inVerseTop(built.glForm, built.keys && getGlFormKey(glKey, built.keys), verse, rendering),
      glSame: inVerseTop(built.gl, glKey, verse, rendering),
      form: inVerseTop(built.form, built.keys?.form, verse, rendering),
      lemma: inVerseTop(built.lemma, built.keys?.lemma, verse, rendering),
      pool: inVerseTop({ pool }, 'pool', verse, rendering),
    };

    for (const [name, result] of Object.entries(inVerse)) {
      counts[`${name}InVerse`] += result === null ? 0 : 1;
      counts[`${name}InVerseRight`] += result ? 1 : 0;
    }

    for (const order of OL_KEY_ORDERS) {
      const first = order.split(',').map(name => inVerse[name]).find(result => result !== null);
      counts[`order:${order}`] += first ? 1 : 0;
    }

    counts.cases++;
    counts.olWordsFound += built.keys ? 1 : 0;
    counts.glExact += glKey in history ? 1 : 0;
    counts.glExactHasAnswer += has(history, glKey) ? 1 : 0;
    counts.anyKeyHasAnswer += anyHas(history) ? 1 : 0;
    counts.glSameExact += glKey in built.gl ? 1 : 0;
    counts.glSameExactHasAnswer += has(built.gl, glKey) ? 1 : 0;
    counts.glSameTop += isTop(built.gl, glKey) ? 1 : 0;
    counts.sameAnyKeyHasAnswer += anyHas(built.gl) ? 1 : 0;
    counts.lemmaExact += built.keys && built.keys.lemma in built.lemma ? 1 : 0;
    counts.lemmaExactHasAnswer += has(built.lemma, built.keys?.lemma) ? 1 : 0;
    counts.lemmaTop += isTop(built.lemma, built.keys?.lemma) ? 1 : 0;
    counts.formExact += built.keys && built.keys.form in built.form ? 1 : 0;
    counts.formExactHasAnswer += has(built.form, built.keys?.form) ? 1 : 0;

    const lemmaHas = has(built.lemma, built.keys?.lemma);
    const glHas = has(built.gl, glKey);
    counts.glOrLemmaExactHasAnswer += lemmaHas || glHas ? 1 : 0;
    counts.lemmaOnlyHasAnswer += lemmaHas && !glHas ? 1 : 0;
    counts.glSameOnlyHasAnswer += glHas && !lemmaHas ? 1 : 0;
  }
  return counts;
}

/**
 * The in-verse proxy for one key: whether the most counted rendering under `key` that is in the
 * verse is the answer, and the only one with that count.
 * @param {object} tally - `{ key: { rendering: count } }`
 * @param {string|null} key
 * @param {string} verse - lowercased verse text
 * @param {string} rendering - the answer
 * @returns {boolean|null} - null when no rendering under the key is in the verse
 */
function inVerseTop(tally, key, verse, rendering) {
  const found = Object.entries((key && tally[key]) || {}).filter(([text]) => text && verse.includes(text));

  if (!found.length) {
    return null;
  }

  const best = Math.max(...found.map(([, count]) => count));
  const top = found.filter(([, count]) => count === best);
  return top.length === 1 && top[0][0] === rendering;
}

/**
 * Adds counters together.
 * @param {object} total - changed in place
 * @param {object} counts
 * @returns {object} total
 */
export function addCounts(total, counts) {
  for (const name of OL_MEASURES) {
    total[name] = (total[name] || 0) + (counts[name] || 0);
  }
  return total;
}
