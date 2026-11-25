/* eslint-env jest */
/* eslint-disable no-console */
/**
 * Builds the evaluation sets of Step 4 of `plans/alignment-history.md`: copies of prompt-eval sets
 * (`llmTrainingData/promptEval/<set>.json`) whose history also holds alignment history, made with
 * the app's `getSuggestionHistory`.
 *
 * Skipped unless `LLM_AH_BUILD=1`. Run it with
 *   LLM_AH_BUILD=1 npx jest __tests__/buildAlignmentHistoryCases.test.js --silent=false
 *
 * The projects behind the sets are not on this computer, so the alignment entries come from the
 * training files they were built from (`llmTrainingData/<project>_<glOwner>_<glLang>.json`). Each
 * training case holds a check's aligned answer, GL phrase and reference: the same words
 * `fetchAlignmentHistoryEntries` gives for that check (520 of 520 on the projects here, Step 2).
 * Those files leave out the first check of each group and groups with few aligned checks, so the
 * history here is somewhat smaller than the app's would be.
 *
 * For a case of set S, the entries are the training cases of the same group in every training
 * file with the same target language, resource id and GL (owner and language). As in the app:
 *  - entries of the case's own verse in its own project are left out;
 *  - in a set with history, the case's history stands for the selections already saved: the
 *    earlier checks of its own training file. Those entries are marked as selected, so they are
 *    not counted twice (a saved selection wins over an alignment). In a no-history set nothing is
 *    selected, as when checking starts on an aligned book.
 *
 * Writes, for each set in `LLM_AH_SETS` (default `ftdev ftdev-nohist newdev newdev-nohist`):
 *  - `<set>-ah.json`: entries from every testament (the app's default);
 *  - `<set>-ahst.json`: entries from the case's testament only (Decision 2).
 * The cases keep their ids and order, so results can be paired with the set's own results.
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because
 * `fs-extra` is mocked globally.
 */
import fs from 'fs';
import path from 'path';
import { getSuggestionHistory } from '../src/utils/alignmentHistoryUtils';
import { isNT } from '../src/common/booksOfTheBible';

const env = process.env;
const DATA_DIR = path.resolve(__dirname, '..', 'llmTrainingData');
const EVAL_DIR = path.join(DATA_DIR, 'promptEval');
const SETS = (env.LLM_AH_SETS || 'ftdev ftdev-nohist newdev newdev-nohist').split(/\s+/).filter(Boolean);

/**
 * Splits a training file name like `vi_glt_luk_book_ru_gl_ru` into its project and GL parts.
 * @param {string} fileName - training file name without `.json`
 * @returns {{project: string, languageId: string, resourceId: string, bookId: string, gl: string}}
 */
export function parseTrainingFileName(fileName) {
  const parts = fileName.split('_');
  return {
    project: parts.slice(0, 4).join('_'),
    languageId: parts[0],
    resourceId: parts[1],
    bookId: parts[2],
    gl: parts.slice(4).join('_'),
  };
}

/**
 * Loads every training file, grouped by language, resource, GL and group id.
 * @returns {Map<string, Array<{file: string, index: number, testCase: object}>>}
 */
function loadTrainingPool() {
  const pool = new Map();

  for (const file of fs.readdirSync(DATA_DIR).filter(name => name.endsWith('.json')).sort()) {
    const fileName = file.slice(0, -5);
    const {
      languageId, resourceId, gl,
    } = parseTrainingFileName(fileName);
    const cases = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));

    cases.forEach((testCase, index) => {
      const key = [languageId, resourceId, gl, testCase.groupId].join('|');

      if (!pool.has(key)) {
        pool.set(key, []);
      }
      pool.get(key).push({
        file: fileName, index, testCase,
      });
    });
  }
  return pool;
}

/**
 * The alignment history entries for one evaluation case (see the file header).
 * @param {object} evalCase - a prompt-eval case, with `sourceFile`, `sourceId`, `groupId`, `contextId`
 * @param {Map} pool - from {@link loadTrainingPool}
 * @param {boolean} withHistory - the set has history (earlier checks count as selected)
 * @param {boolean} sameTestamentOnly - keep only entries of the case's testament
 * @returns {Array<object>} - entries as `fetchAlignmentHistoryEntries` returns them
 */
export function getEntriesForCase(evalCase, pool, withHistory, sameTestamentOnly) {
  const {
    languageId, resourceId, gl,
  } = parseTrainingFileName(evalCase.sourceFile);
  const candidates = pool.get([languageId, resourceId, gl, evalCase.groupId].join('|')) || [];
  const own = candidates.find(item => item.file === evalCase.sourceFile && item.testCase.id === evalCase.sourceId);
  const caseNT = isNT(evalCase.contextId.reference.bookId);
  const entries = [];

  if (!own) {
    throw new Error(`${evalCase.id}: not found in its training file ${evalCase.sourceFile}`);
  }

  for (const {
    file, index, testCase,
  } of candidates) {
    const reference = testCase.contextId.reference;

    if (sameTestamentOnly && isNT(reference.bookId) !== caseNT) {
      continue;
    }

    const words = (testCase.selections || []).map(selection => selection.text).join(' ');

    entries.push({
      key: `${file}|${testCase.id}`,
      projectName: parseTrainingFileName(file).project,
      bookId: reference.bookId,
      chapter: reference.chapter,
      verse: reference.verse,
      glPhrase: testCase.glPhrase,
      words,
      source: 'alignment',
      // the case's own history already counts the earlier checks of its file
      hasSelection: withHistory && file === evalCase.sourceFile && index < own.index,
    });
  }
  return entries;
}

/**
 * Counts the renderings in a history.
 * @param {object} history - `{ glPhrase: { rendering: count } }`
 * @returns {number}
 */
const countRenderings = history => Object.values(history || {}).reduce((sum, renderings) => sum + Object.keys(renderings).length, 0);

/**
 * Whether an expected answer is a rendering of the history, ignoring case and `:n` occurrences.
 * @param {object} testCase
 * @returns {boolean}
 */
function answerInHistory(testCase) {
  const normalize = text => text.replace(/:\d+/g, '').toLowerCase().trim();
  const renderings = new Set(Object.values(testCase.history || {}).flatMap(r => Object.keys(r)).map(normalize));
  return (testCase.expected || []).some(answer => renderings.has(normalize(answer)));
}

const describeIfBuild = env.LLM_AH_BUILD ? describe : describe.skip;

describeIfBuild('build alignment history evaluation sets', () => {
  let pool;

  beforeAll(() => {
    pool = loadTrainingPool();
  });

  test.each(SETS)('%s', set => {
    const cases = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, `${set}.json`), 'utf8'));
    const withHistory = !set.endsWith('-nohist');
    const lines = [`${set} (${cases.length} cases):`];
    const pct = (n, of) => `${(100 * n / (of || 1)).toFixed(1)}%`;

    lines.push(`  A (as now): mean renderings ${(cases.reduce((s, c) => s + countRenderings(c.history), 0) / cases.length).toFixed(1)}, ` +
      `answer in history ${pct(cases.filter(answerInHistory).length, cases.length)}`);

    for (const [suffix, sameTestamentOnly] of [['ah', false], ['ahst', true]]) {
      const built = cases.map(evalCase => {
        const entries = getEntriesForCase(evalCase, pool, withHistory, sameTestamentOnly);
        const history = getSuggestionHistory(evalCase.history || {}, entries,
          parseTrainingFileName(evalCase.sourceFile).project, evalCase.contextId);
        return { ...evalCase, history };
      });
      const changed = built.filter((c, i) => JSON.stringify(c.history) !== JSON.stringify(cases[i].history || {})).length;

      fs.writeFileSync(path.join(EVAL_DIR, `${set}-${suffix}.json`), `${JSON.stringify(built, null, 2)}\n`);
      lines.push(`  B ${suffix}: changed ${changed} (${pct(changed, cases.length)}), mean renderings ` +
        `${(built.reduce((s, c) => s + countRenderings(c.history), 0) / built.length).toFixed(1)}, ` +
        `answer in history ${pct(built.filter(answerInHistory).length, built.length)}`);
    }
    console.log(lines.join('\n'));
  });
});
