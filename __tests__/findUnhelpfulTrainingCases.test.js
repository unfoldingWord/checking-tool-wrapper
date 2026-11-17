/* eslint-env jest */
/**
 * Finds the cases in the training data files (`llmTrainingData/*.json`) that may not help train
 * the AI, with `findUnhelpfulTrainingCases` in `helpers/suggestionsHelpers.js`. The reasons are in
 * `UNHELPFUL_REASONS`, e.g. no expected word is in the history (exactly or as another form, found
 * with the app's `wordSimilarity`), only other forms are, only some words are, or an expected word
 * is not in the verse. Of the history reasons, only `noRelatedWordInHistory` marks a case with
 * nothing to learn from the history; `onlyOtherFormsInHistory` cases teach rule 5 of the prompt.
 *
 * The unit tests at the top always run. The scan of the files is skipped unless
 * `LLM_TRAINING_CHECK=1`; run it with `npm run check:llm-training-data`, e.g.
 *   npm run check:llm-training-data
 *   LLM_TRAINING_FILES="en_ult_tit_book_ru_gl_ru vi_glt_luk_book_ru_gl_ru" npm run check:llm-training-data
 *
 * It writes `<data folder>/results/unhelpfulTrainingCases.json`:
 *   {
 *     createdAt, dataDir, reasons,                  // reasons: UNHELPFUL_REASONS
 *     summary: { total: {cases, unhelpful, byReason},
 *                files: { "<file>.json": {cases, unhelpful, byReason} } },
 *     files: { "<file>.json": [ { id, reasons, missingFromHistory, otherFormsInHistory,
 *                                 missingFromVerse, duplicateOf,
 *                                 glPhrase, expected, history, verse, source } ] }
 *   }
 * and prints a table of the counts per file.
 *
 * Environment variables:
 *   LLM_TRAINING_CHECK      set to 1 to scan the files
 *   LLM_TRAINING_DATA_DIR   folder of training data files, relative to the repo folder or absolute
 *                           (default llmTrainingData)
 *   LLM_TRAINING_FILES      space-separated file names to scan, with or without `.json`
 *                           (default: every `.json` file in the folder)
 *
 * Node's `fs` is used because `fs-extra` is mocked globally.
 */
import fs from 'fs';
import path from 'path';
import { findUnhelpfulTrainingCases, UNHELPFUL_REASONS } from './helpers/suggestionsHelpers';

const env = process.env;
const CHECK = env.LLM_TRAINING_CHECK === '1';
const DATA_DIR = path.resolve(__dirname, '..', env.LLM_TRAINING_DATA_DIR || 'llmTrainingData');
const FILES = (env.LLM_TRAINING_FILES || '').split(/\s+/).filter(Boolean)
  .map(name => (name.endsWith('.json') ? name : `${name}.json`));
const OUTPUT_FILE = 'unhelpfulTrainingCases.json';

/** a case that every check passes */
const goodCase = {
  id: 'good',
  targetLang: 'es-419',
  verse: 'Por la fe, Abraham obedeció.',
  glPhrase: 'faith',
  history: { faith: { 'fe': 3, 'la fe': 1 } },
  expected: ['fe'],
};

describe('findUnhelpfulTrainingCases', () => {
  test('passes a case whose answer is in the history and the verse', () => {
    expect(findUnhelpfulTrainingCases([goodCase])).toEqual([]);
  });

  test('finds expected words that are not in the history', () => {
    const cases = [
      {
        ...goodCase, id: 'none', history: { faith: { creer: 2 } },
      },
      {
        ...goodCase, id: 'some', expected: ['la fe'], history: { faith: { fe: 2 } },
      },
    ];
    const result = findUnhelpfulTrainingCases(cases);

    expect(result.map(({
      id, reasons, missingFromHistory,
    }) => ({
      id, reasons, missingFromHistory,
    }))).toEqual([
      {
        id: 'none', reasons: ['noRelatedWordInHistory'], missingFromHistory: ['fe'],
      },
      {
        id: 'some', reasons: ['someExpectedWordsNotInHistory'], missingFromHistory: ['la'],
      },
    ]);
  });

  test('finds expected words that are in the history only as another form', () => {
    const russian = {
      ...goodCase, targetLang: 'ru', verse: 'и Авеля и дары его', glPhrase: 'Abel',
    };
    const cases = [
      {
        ...russian, id: 'form', history: { Abel: { 'Авель': 1 } }, expected: ['Авеля'],
      },
      {
        ...russian, id: 'formAndMissing', history: { Abel: { 'Авель': 1 } }, expected: ['и Авеля'],
      },
      {
        ...russian, id: 'exactAndForm', history: { Abel: { 'и Авель': 1 } }, expected: ['и Авеля'],
      },
    ];
    const result = findUnhelpfulTrainingCases(cases);

    expect(result.map(({
      id, reasons, missingFromHistory, otherFormsInHistory,
    }) => ({
      id, reasons, missingFromHistory, otherFormsInHistory,
    }))).toEqual([
      {
        id: 'form',
        reasons: ['onlyOtherFormsInHistory'],
        missingFromHistory: [],
        otherFormsInHistory: [{
          word: 'Авеля', historyWord: 'Авель', similarity: 0.8,
        }],
      },
      {
        id: 'formAndMissing',
        reasons: ['onlyOtherFormsInHistory'],
        missingFromHistory: ['и'],
        otherFormsInHistory: [{
          word: 'Авеля', historyWord: 'Авель', similarity: 0.8,
        }],
      },
      {
        id: 'exactAndForm',
        reasons: ['someExpectedWordsNotInHistory'],
        missingFromHistory: [],
        otherFormsInHistory: [{
          word: 'Авеля', historyWord: 'Авель', similarity: 0.8,
        }],
      },
    ]);
  });

  test('does not match short words as another form', () => {
    const testCase = {
      ...goodCase, verse: 'la fe', expected: ['fe'], history: { faith: { fa: 1 } },
    };
    expect(findUnhelpfulTrainingCases([testCase])[0].reasons).toEqual(['noRelatedWordInHistory']);
  });

  test('compares words ignoring case and punctuation', () => {
    const testCase = {
      ...goodCase, verse: 'Fe, dijo.', expected: ['Fe'], history: { faith: { 'fe.': 1 } },
    };
    expect(findUnhelpfulTrainingCases([testCase])).toEqual([]);
  });

  test('uses the expected answer with the most words in the history', () => {
    const testCase = { ...goodCase, expected: ['Abraham', 'fe'] };
    expect(findUnhelpfulTrainingCases([testCase])).toEqual([]);
  });

  test('finds an expected word missing from the verse, counting occurrences', () => {
    const cases = [
      {
        ...goodCase, id: 'absent', expected: ['amor'], history: { faith: { amor: 1 } },
      },
      {
        ...goodCase, id: 'occurrence', expected: ['fe:2'],
      },
      {
        ...goodCase, id: 'second', verse: 'fe y fe', expected: ['fe:2'],
      },
    ];
    const result = findUnhelpfulTrainingCases(cases);

    expect(result.map(({
      id, reasons, missingFromVerse,
    }) => ({
      id, reasons, missingFromVerse,
    }))).toEqual([
      {
        id: 'absent', reasons: ['expectedNotInVerse'], missingFromVerse: ['amor'],
      },
      {
        id: 'occurrence', reasons: ['expectedNotInVerse'], missingFromVerse: ['fe:2'],
      },
    ]);
  });

  test('finds cases with no history, no expected answer or no GL phrase', () => {
    const cases = [
      {
        ...goodCase, id: 'noHistory', history: {},
      },
      {
        ...goodCase, id: 'noExpected', expected: [],
      },
      {
        ...goodCase, id: 'noGl', glPhrase: ' ',
      },
    ];
    const result = findUnhelpfulTrainingCases(cases);

    expect(result.map(({ id, reasons }) => ({ id, reasons }))).toEqual([
      { id: 'noHistory', reasons: ['noHistory'] },
      { id: 'noExpected', reasons: ['noExpected'] },
      { id: 'noGl', reasons: ['emptyGlPhrase'] },
    ]);
  });

  test('finds a repeat of an earlier case', () => {
    const result = findUnhelpfulTrainingCases([goodCase, { ...goodCase, id: 'again' }]);

    expect(result).toEqual([{
      index: 1,
      id: 'again',
      reasons: ['duplicate'],
      missingFromHistory: [],
      otherFormsInHistory: [],
      missingFromVerse: [],
      duplicateOf: 'good',
    }]);
  });

  test('every reason given is described', () => {
    const cases = [
      {
        ...goodCase, history: {}, expected: ['amor'],
      },
      {
        ...goodCase, glPhrase: '', expected: [],
      },
      { ...goodCase, history: { faith: { creer: 1 } } },
    ];
    const reasons = findUnhelpfulTrainingCases(cases).flatMap(item => item.reasons);

    expect(reasons.every(reason => UNHELPFUL_REASONS[reason])).toBe(true);
  });
});

const describeIfCheck = CHECK ? describe : describe.skip;

describeIfCheck(`find unhelpful training cases in ${DATA_DIR}`, () => {
  test('scans each file and saves the unhelpful cases', () => {
    const files = getFilesToCheck();
    expect(files.length).toBeGreaterThan(0);

    const output = {
      createdAt: new Date().toISOString(),
      dataDir: DATA_DIR,
      reasons: UNHELPFUL_REASONS,
      summary: {
        total: {
          cases: 0, unhelpful: 0, byReason: {},
        }, files: {},
      },
      files: {},
    };

    for (const file of files) {
      const testCases = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      const unhelpful = findUnhelpfulTrainingCases(testCases);
      const byReason = countReasons(unhelpful);

      output.files[file] = unhelpful.map(({ index, ...found }) => {
        const {
          glPhrase, expected, history, verse, source,
        } = testCases[index];
        return {
          ...found, glPhrase, expected, history, verse, source,
        };
      });
      output.summary.files[file] = {
        cases: testCases.length, unhelpful: unhelpful.length, byReason,
      };
      output.summary.total.cases += testCases.length;
      output.summary.total.unhelpful += unhelpful.length;

      for (const [reason, count] of Object.entries(byReason)) {
        output.summary.total.byReason[reason] = (output.summary.total.byReason[reason] || 0) + count;
      }
    }

    const resultsDir = path.join(DATA_DIR, 'results');
    const outputPath = path.join(resultsDir, OUTPUT_FILE);
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(formatTable(output.summary, outputPath));
    expect(Object.keys(output.files)).toEqual(files);
  });
});

/**
 * Counts how many cases have each reason (a case with two reasons counts for both).
 * @param {Array<{reasons: string[]}>} unhelpful
 * @returns {Object<string, number>}
 */
function countReasons(unhelpful) {
  const counts = {};

  for (const reason of unhelpful.flatMap(item => item.reasons)) {
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

/**
 * Training data files to scan: `LLM_TRAINING_FILES` if set, otherwise every `.json` file in the
 * folder, sorted by name.
 * @returns {string[]} file names in `DATA_DIR`
 * @throws {Error} if the folder or a named file does not exist
 */
function getFilesToCheck() {
  if (!fs.existsSync(DATA_DIR) || !fs.statSync(DATA_DIR).isDirectory()) {
    throw new Error(`training data folder not found: ${DATA_DIR}`);
  }

  if (FILES.length) {
    const missing = FILES.filter(file => !fs.existsSync(path.join(DATA_DIR, file)));

    if (missing.length) {
      throw new Error(`training data files not found in ${DATA_DIR}: ${missing.join(', ')}`);
    }
    return FILES;
  }
  return fs.readdirSync(DATA_DIR).filter(file => path.extname(file) === '.json').sort();
}

/**
 * One line per file with the number of cases, unhelpful cases and the count for each reason, and
 * a total line.
 * @param {object} summary - `{total, files}`, as saved in the output
 * @param {string} outputPath - where the output was saved
 * @returns {string}
 */
function formatTable(summary, outputPath) {
  const reasons = Object.keys(UNHELPFUL_REASONS);
  const width = Math.max(5, ...Object.keys(summary.files).map(file => file.length));
  const line = (name, {
    cases, unhelpful, byReason,
  }) => [
    name.padEnd(width),
    String(cases).padStart(6),
    `${unhelpful} (${cases ? Math.round((100 * unhelpful) / cases) : 0}%)`.padStart(12),
    ...reasons.map(reason => String(byReason[reason] || 0).padStart(reason.length)),
  ].join('  ');

  return [
    `unhelpful training cases, saved in ${outputPath}`,
    ['file'.padEnd(width), ' cases', '   unhelpful', ...reasons].join('  '),
    ...Object.entries(summary.files).map(([file, counts]) => line(file, counts)),
    line('total', summary.total),
  ].join('\n');
}
