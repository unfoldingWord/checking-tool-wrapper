/* eslint-env jest */
/**
 * Step 4 of plans/original-language-history.md: original-language (OL) history from a project's
 * other books.
 *
 * For each case file, the other books of the same target language and resource id (same testament,
 * as the app's selection history; one case file per book as the source of its checks) are re-keyed
 * with the case file's GL bible from `~/translationCore/resources`, as `fetchPreviousSelectionData`
 * re-keys other projects with the current GL. Checks the GL bible cannot key (no such book, no
 * aligned text) are the history the app loses today. Writes `olCrossBookCoverage.txt`: per file, the
 * other-book history kept and lost, and the cases whose answer is only in the lost history.
 *
 * With LLM_OL_CROSS_ALGO=1 it also runs the algorithm three ways on the cases with other-book
 * history and writes `olCrossBookAlgo.txt` (top-1 and exact McNemar p, tune and held-out test):
 *   A: GL history (the case's own plus the other books' keyed checks), as the app has;
 *   C: A + OL history from the same project (Step 2);
 *   B: C + OL history from every other book, keyed or not.
 *
 *   npm run measure:ol-cross-book                         (LLM_OL_CROSS=1, coverage only)
 *   LLM_OL_CROSS_ALGO=1 npm run measure:ol-cross-book     (also the algorithm, ~10 minutes)
 *   OUT_DIR=<folder>                                      (default llmTrainingData/results)
 *
 * Skipped in `npm test`. Node's `fs` is used because `fs-extra` is mocked globally.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { isNT } from '../src/common/booksOfTheBible';
import { getAlignedTextFromBible } from '../src/helpers/gatewayLanguageHelpers';
import { getOlKeys } from '../src/utils/originalLanguageUtils';
import {
  cleanGlQuote, getBestSelections, getSelectionHistoryKey,
} from '../src/utils/checkingSuggestionsUtils';
import { buildOlHistories, getCaseRendering } from './helpers/olHistoryHelpers';
import {
  normalizePhrase, optionText, testCaseToSelectionOptions,
} from './helpers/suggestionsHelpers';
import { DEFAULT_CALIBRATION_TEST_PROJECTS, matchesProject } from './helpers/algorithmCalibrationHelpers';

const RUN_ALGO = process.env.LLM_OL_CROSS_ALGO === '1';

const addTo = (tally, key, rendering) => {
  if (key) {
    tally[key] = tally[key] || {};
    tally[key][rendering] = (tally[key][rendering] || 0) + 1;
  }
};

const clone = t => JSON.parse(JSON.stringify(t || {}));

const binomP = (w, l) => { // exact two-sided McNemar
  const n = w + l; const k = Math.min(w, l);
  let p = 0; let c = 1;

  for (let i = 0; i <= k; i++) {
    p += c; c = c * (n - i) / (i + 1);
  }
  return Math.min(1, 2 * p / 2 ** n);
};

const RUN = process.env.LLM_OL_CROSS === '1';
const DATA = path.join(__dirname, '../llmTrainingData');
const OUT_DIR = process.env.OUT_DIR || path.join(DATA, 'results');
const RES = path.join(os.homedir(), 'translationCore/resources');

function readBook(folder) {
  if (!fs.existsSync(folder)) {
    return null;
  }

  const book = {};

  for (const f of fs.readdirSync(folder).filter(n => /^\d+\.json$/.test(n))) {
    book[parseInt(f, 10)] = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'));
  }
  return book;
}

(RUN ? describe : describe.skip)('OL history from other books', () => {
  test('counts kept and lost history, and runs the algorithm', async () => {
    const files = fs.readdirSync(DATA).filter(n => n.endsWith('.json'));
    const meta = files.map(name => {
      const cases = JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
      const [lang, res, book] = name.split('_');
      const gl = cases[0].source.replace(/^.*, GL /, ''); // e.g. 'en ult/v91_unfoldingWord'
      const [glLang, bibleVer] = gl.split(' ');
      return {
        name, cases, project: `${lang}_${res}`, book, glLang, bibleVer,
      };
    });
    // one file per (project, book) as the source of that book's checks: the largest
    const bookSource = {};

    for (const m of meta) {
      const k = `${m.project}|${m.book}`;

      if (!bookSource[k] || m.cases.length > bookSource[k].cases.length) {
        bookSource[k] = m;
      }
    }

    const glBooks = {};

    const getGlBook = (glLang, bibleVer, book) => {
      const k = `${glLang}/${bibleVer}/${book}`;

      if (!(k in glBooks)) {
        glBooks[k] = readBook(path.join(RES, glLang, 'bibles', bibleVer, book));
      }
      return glBooks[k];
    };

    const rows = [];
    const total = {
      cases: 0, withOther: 0, kept: 0, lost: 0, casesAllLost: 0, casesSomeLost: 0,
      answerInKept: 0, answerOnlyInLost: 0, answerInLostFormOnly: 0,
    };

    for (const m of meta) {
      const others = Object.values(bookSource).filter(s => s.project === m.project && s.book !== m.book &&
        isNT(s.book) === isNT(m.book));
      // per group: [{rendering, kept, form}]
      const byGroup = {};
      const missingBooks = [];

      for (const s of others) {
        const glBook = getGlBook(m.glLang, m.bibleVer, s.book);

        if (!glBook) {
          missingBooks.push(s.book);
        }

        for (const c of s.cases) {
          const glText = glBook && getAlignedTextFromBible(c.contextId, glBook);
          const keys = getOlKeys(c.olWords, s.book);

          (byGroup[c.groupId] = byGroup[c.groupId] || []).push({
            rendering: getCaseRendering(c),
            kept: !!glText,
            glKey: glText ? getSelectionHistoryKey(cleanGlQuote(glText), m.glLang) : null,
            form: keys?.form,
            lemma: keys?.lemma,
          });
        }
      }

      const t = {
        cases: 0, withOther: 0, kept: 0, lost: 0, casesAllLost: 0, casesSomeLost: 0,
        answerInKept: 0, answerOnlyInLost: 0, answerInLostFormOnly: 0,
      };

      for (const c of m.cases) {
        t.cases++;
        const items = byGroup[c.groupId] || [];

        if (!items.length) {
          continue;
        }
        t.withOther++;
        const kept = items.filter(i => i.kept);
        const lost = items.filter(i => !i.kept);
        t.kept += kept.length;
        t.lost += lost.length;

        if (!kept.length) {
          t.casesAllLost++;
        } else if (lost.length) {
          t.casesSomeLost++;
        }

        const answer = getCaseRendering(c);
        const form = getOlKeys(c.olWords, m.book)?.form;

        if (kept.some(i => i.rendering === answer)) {
          t.answerInKept++;
        } else if (lost.some(i => i.rendering === answer)) {
          t.answerOnlyInLost++;

          if (lost.some(i => i.rendering === answer && i.form === form)) {
            t.answerInLostFormOnly++;
          }
        }
      }

      if (RUN_ALGO) {
        m.byGroup = byGroup;
      }

      for (const k of Object.keys(total)) {
        total[k] += t[k];
      }
      rows.push({
        name: m.name, others: others.map(s => s.book).join(','), missingBooks: missingBooks.join(','), ...t,
      });
    }

    const out = rows.filter(r => r.others).map(r => [r.name, r.others, r.missingBooks || '-', r.cases, r.withOther,
      r.kept, r.lost, r.casesAllLost, r.answerInKept, r.answerOnlyInLost, r.answerInLostFormOnly].join('\t'));
    const text = ['file\tother books\tmissing in GL\tcases\twithOther\tkept\tlost\tcasesAllLost\tansInKept\tansOnlyLost\tansOnlyLostSameForm',
      ...out, `TOTAL ${JSON.stringify(total)}`].join('\n');
    fs.writeFileSync(path.join(OUT_DIR, 'olCrossBookCoverage.txt'), text);
    console.log(text);

    if (!RUN_ALGO) {
      return;
    }

    // A: GL history (same project + other books the GL bible keys); C: A + OL from the same project;
    // B: A + OL from the same project and every other book (kept or lost)
    const res = { tune: [], test: [] };

    for (const m of meta) {
      const split = matchesProject(m.name.split('_').slice(0, 3).join('_'), DEFAULT_CALIBRATION_TEST_PROJECTS) ? 'test' : 'tune';
      const olSame = buildOlHistories(m.cases);

      for (const c of m.cases) {
        const items = m.byGroup?.[c.groupId] || [];

        if (!items.length || !c.expected?.length) {
          continue;
        }

        const history = clone(c.history);
        items.filter(i => i.kept).forEach(i => addTo(history, i.glKey, i.rendering));
        const same = olSame.get(c.id);
        const cross = {
          lemma: clone(same?.lemma), form: clone(same?.form), keys: same?.keys,
        };

        items.forEach(i => {
          addTo(cross.lemma, i.lemma, i.rendering);
          addTo(cross.form, i.form, i.rendering);
        });

        const expected = c.expected.map(normalizePhrase);

        const run = async olHistory => {
          const [r] = await getBestSelections({
            ...testCaseToSelectionOptions({ ...c, history }),
            algorithmOptions: olHistory?.keys ? { olHistory } : undefined,
          });
          const top = r?.bestSelections?.[0];
          return !!top && expected.includes(normalizePhrase(optionText(top)));
        };

        // eslint-disable-next-line no-await-in-loop
        const a = await run(null);
        // eslint-disable-next-line no-await-in-loop
        const cc = await run(same);
        // eslint-disable-next-line no-await-in-loop
        const b = await run(cross);

        res[split].push({
          a, c: cc, b, lost: items.some(i => !i.kept), file: m.name,
        });
      }
    }

    const lines = [];

    const cmp = (rows, x, y) => {
      const w = rows.filter(r => r[x] && !r[y]).length;
      const l = rows.filter(r => !r[x] && r[y]).length;
      return `${x} vs ${y}: ${w} won / ${l} lost, p=${binomP(w, l).toPrecision(2)}`;
    };

    for (const split of ['tune', 'test']) {
      for (const [label, rows] of [['all', res[split]], ['with lost history', res[split].filter(r => r.lost)]]) {
        const n = rows.length;
        const top = k => `${rows.filter(r => r[k]).length} (${(100 * rows.filter(r => r[k]).length / (n || 1)).toFixed(1)}%)`;

        lines.push(`${split} ${label}: ${n} cases; top-1 A ${top('a')}, C ${top('c')}, B ${top('b')}; `
          + `${cmp(rows, 'b', 'c')}; ${cmp(rows, 'c', 'a')}; ${cmp(rows, 'b', 'a')}`);
      }
    }

    const byFile = {};

    [...res.tune, ...res.test].forEach(r => {
      const f = byFile[r.file] = byFile[r.file] || { bWins: 0, bLoses: 0 };
      f.bWins += r.b && !r.c ? 1 : 0;
      f.bLoses += !r.b && r.c ? 1 : 0;
    });
    lines.push('', 'B vs C by file (won/lost):', ...Object.entries(byFile).filter(([, f]) => f.bWins || f.bLoses)
      .map(([name, f]) => `${name}\t${f.bWins}\t${f.bLoses}`));
    fs.writeFileSync(path.join(OUT_DIR, 'olCrossBookAlgo.txt'), lines.join('\n') + '\n');
    console.log(lines.join('\n'));
  });
});
