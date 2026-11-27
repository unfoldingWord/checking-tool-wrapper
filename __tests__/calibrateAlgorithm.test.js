/* eslint-env jest */
/**
 * Measures how well the algorithm's suggestion confidences match how often the suggestions are right,
 * on the training data (plans/algorithm-confidence.md, Step 0).
 *
 * Runs every case in `llmTrainingData/*.json` through `getBestSelections` on the algorithm path, as
 * `runLlmTrainingData` does, so the options are the ones the app shows. Projects are split into
 * `tune` (for choosing a calibration) and `test` (held out, for checking it). Prints, per split:
 * top-1, expected calibration error (ECE) and Brier score for the top option and for all options
 * shown, wrong options at confidence 80 or more, accuracy at 100 and why the wrong ones at 100 were
 * wrong, accuracy by confidence band, and per-project accuracy at 100 and 80-99. Also counts the cases
 * whose answer differs from the saved `results/<file>_Algorithm.results.json`, so a change meant to
 * keep the answers the same can be checked.
 *
 * Writes `llmTrainingData/results/algorithmCalibration.jsonl` (one row per option shown: case id,
 * file, project, split, the check's occurrence, rank, confidence, right, and the option's `features`,
 * which `getBestSelections` returns for a job with `explainAlgorithm`) and `algorithmCalibration.report.txt`.
 *
 * Skipped unless `LLM_ALGO_CALIBRATE=1`; run it with `npm run calibrate:algorithm`. The unit tests of
 * the measuring helpers always run.
 *
 * Environment variables:
 *   LLM_ALGO_CALIBRATE        set to 1 to run
 *   LLM_ALGO_DATA_DIR         folder of training data files (default llmTrainingData)
 *   LLM_ALGO_TEST_PROJECTS    test projects, space-separated, `*` allowed (default
 *                             `DEFAULT_CALIBRATION_TEST_PROJECTS`)
 *   LLM_ALGO_OPTIONS          JSON object of extra algorithm options, passed as the job's
 *                             `algorithmOptions`, e.g. '{"fuzzyPassBelow":90}'; the rows and report
 *                             then go to files named with an `.options` suffix
 *   LLM_ALGO_OL               set to 1 to give each case its original-language history
 *                             (plans/original-language-history.md, Step 2), built from the earlier
 *                             cases of its group with `buildOlHistories` (the files need `olWords`,
 *                             `npm run add:ol-words`); the rows and report then go to files named with
 *                             an `.ol` suffix. `LLM_ALGO_OPTIONS` can then hold `olKeyWeights`
 *
 * jest is used because it is the repo's only babel runner; Node's `fs` is used because `fs-extra` is
 * mocked globally.
 */
import fs from 'fs';
import path from 'path';
import { getBestSelections } from '../src/utils/checkingSuggestionsUtils';
import {
  normalizePhrase, optionText, testCaseToSelectionOptions,
} from './helpers/suggestionsHelpers';
import {
  DEFAULT_CALIBRATION_TEST_PROJECTS, accuracyByBand, areaUnderCurve, brierScore, calibrationBand, calibrationByProject,
  expectedCalibrationError, matchesProject, projectOfFile, summarizeCalibration, wrongKind,
} from './helpers/algorithmCalibrationHelpers';
import { buildOlHistories } from './helpers/olHistoryHelpers';

const env = process.env;
const RUN = env.LLM_ALGO_CALIBRATE === '1';
const DATA_DIR = path.resolve(__dirname, '..', env.LLM_ALGO_DATA_DIR || 'llmTrainingData');
const TEST_PROJECTS = (env.LLM_ALGO_TEST_PROJECTS || '').split(/\s+/).filter(Boolean);
const ALGO_OPTIONS = env.LLM_ALGO_OPTIONS ? JSON.parse(env.LLM_ALGO_OPTIONS) : undefined;
const USE_OL = env.LLM_ALGO_OL === '1';
const OUTPUT_NAME = `algorithmCalibration${USE_OL ? '.ol' : ''}${ALGO_OPTIONS ? '.options' : ''}`;

/** words of an option or expected answer, normalized, without `:2` occurrence suffixes */
const plainWords = text => normalizePhrase(text).split(/\s+/).map(word => word.replace(/:\d+$/, '')).join(' ');

/** same answer (words, occurrences and confidences of every option) as a saved result */
/** same options (words and occurrences, in order) as a saved result, whatever their confidences */
const sameOptions = (a, b) => JSON.stringify((a || []).map(({ selections }) => selections))
  === JSON.stringify((b || []).map(({ selections }) => selections));

const sameAnswer = (a, b) => JSON.stringify((a || []).map(({ selections, confidence }) => [selections, confidence]))
  === JSON.stringify((b || []).map(({ selections, confidence }) => [selections, confidence]));

const percent = (part, whole) => (whole ? `${(100 * part / whole).toFixed(1)}%` : '-');

/**
 * Report lines for one split's summary.
 * @param {string} name - split name
 * @param {object} s - from summarizeCalibration
 * @returns {Array<string>}
 */
function reportSplit(name, s) {
  const lines = [
    `== ${name}: ${s.cases} cases, ${s.options} options shown, no suggestion ${s.noSuggestion}`,
    `top-1 ${s.top1} (${percent(s.top1, s.cases)})`,
    `ECE top ${s.eceTop.toFixed(1)}, all options ${s.eceAll.toFixed(1)}; Brier top ${s.brierTop.toFixed(3)}, all ${s.brierAll.toFixed(3)}; AUC all ${s.aucAll.toFixed(3)}`,
    `wrong at >= 80: top option ${s.wrongTopAt80}, any option ${s.wrongAnyAt80}`,
    `at 100: ${s.at100}, right ${percent(s.rightAt100, s.at100)}; wrong at 100 by kind ${JSON.stringify(s.wrongKindsAt100)}`,
    'band      top: options right    lower options: options right',
  ];

  s.bandsTop.forEach((top, i) => {
    const lower = s.bandsLower[i];

    if (top.count || lower.count) {
      lines.push(`${top.band.padEnd(8)}  ${String(top.count).padStart(8)} ${percent(top.right, top.count).padStart(6)}`
        + `    ${String(lower.count).padStart(8)} ${percent(lower.right, lower.count).padStart(6)}`);
    }
  });
  return lines;
}

describe('algorithm calibration helpers', () => {
  const rows = [
    { confidence: 100, right: true },
    { confidence: 100, right: false },
    { confidence: 50, right: true },
    { confidence: 55, right: false },
  ];

  test('expectedCalibrationError weights each bin by its rows', () => {
    // bin 100: confidence 100, accuracy 50 -> 50; bin 50: confidence 52.5, accuracy 50 -> 2.5
    expect(expectedCalibrationError(rows)).toBeCloseTo((50 * 2 + 2.5 * 2) / 4);
    expect(expectedCalibrationError([])).toBe(0);
  });

  test('areaUnderCurve is the chance a right option outranks a wrong one', () => {
    // right 100 and 50 against wrong 100 and 55: 100-100 ties (0.5), 100-55 wins (1), 50 loses both
    expect(areaUnderCurve(rows)).toBeCloseTo(1.5 / 4);
    expect(areaUnderCurve([{ confidence: 90, right: true }, { confidence: 10, right: false }])).toBe(1);
    expect(areaUnderCurve([{ confidence: 90, right: true }])).toBe(0.5);
  });

  test('brierScore is the mean squared error of confidence as a probability', () => {
    expect(brierScore(rows)).toBeCloseTo((0 + 1 + 0.25 + 0.3025) / 4);
  });

  test('bands and projects', () => {
    expect(calibrationBand(100)).toBe('100');
    expect(calibrationBand(94)).toBe('90-94');
    expect(calibrationBand(0)).toBe('0');
    expect(accuracyByBand(rows).find(({ band }) => band === '40-59')).toEqual({
      band: '40-59', count: 2, right: 1,
    });
    expect(projectOfFile('vi_glt_luk_book_ru_gl_ru.json')).toBe('vi_glt_luk');
    expect(projectOfFile('es-419_est_rut_book_unfoldingWord_en')).toBe('es-419_est_rut');
    expect(matchesProject('ne_glt_2co', ['ne_glt_*'])).toBe(true);
    expect(matchesProject('vi_glt_luk', DEFAULT_CALIBRATION_TEST_PROJECTS)).toBe(false);
  });

  test('wrongKind compares whole words', () => {
    expect(wrongKind('la fe', 'la fe')).toBe('otherOccurrence');
    expect(wrongKind('fe', 'la fe')).toBe('expectedLonger');
    expect(wrongKind('la fe', 'fe')).toBe('expectedShorter');
    expect(wrongKind('fe', 'feliz')).toBe('differentWords');
  });

  test('summarizeCalibration and calibrationByProject', () => {
    const cases = [
      {
        project: 'a', hasSuggestion: true, topRight: true, topConfidence: 100,
      },
      {
        project: 'a', hasSuggestion: true, topRight: false, topConfidence: 100, topWrongKind: 'expectedLonger',
      },
      {
        project: 'b', hasSuggestion: true, topRight: false, topConfidence: 85, topWrongKind: 'differentWords',
      },
      { project: 'b', hasSuggestion: false },
    ];
    const optionRows = [
      {
        rank: 0, confidence: 100, right: true,
      },
      {
        rank: 0, confidence: 100, right: false,
      },
      {
        rank: 1, confidence: 90, right: false,
      },
      {
        rank: 0, confidence: 85, right: false,
      },
    ];
    const summary = summarizeCalibration(cases, optionRows);

    expect(summary).toMatchObject({
      cases: 4, noSuggestion: 1, top1: 1, options: 4, wrongTopAt80: 2, wrongAnyAt80: 3,
      at100: 2, rightAt100: 1, wrongKindsAt100: { expectedLonger: 1 },
    });
    expect(calibrationByProject(cases)).toEqual([
      {
        project: 'a', at100: 2, rightAt100: 1, at80: 0, rightAt80: 0,
      },
      {
        project: 'b', at100: 0, rightAt100: 0, at80: 1, rightAt80: 0,
      },
    ]);
  });
});

(RUN ? describe : describe.skip)('calibrate the algorithm on the training data', () => {
  test('measures confidence against accuracy', async () => {
    const testProjects = TEST_PROJECTS.length ? TEST_PROJECTS : DEFAULT_CALIBRATION_TEST_PROJECTS;
    const files = fs.readdirSync(DATA_DIR).filter(name => name.endsWith('.json')).sort();
    const resultsDir = path.join(DATA_DIR, 'results');
    const casesBySplit = { tune: [], test: [] };
    const rowsBySplit = { tune: [], test: [] };
    const rowLines = [];
    let differsFromSaved = 0;
    let optionsDifferFromSaved = 0;
    let comparedWithSaved = 0;

    for (const file of files) {
      const base = file.replace(/\.json$/, '');
      const project = projectOfFile(base);
      const split = matchesProject(project, testProjects) ? 'test' : 'tune';
      const testCases = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      const savedPath = path.join(resultsDir, `${base}_Algorithm.results.json`);
      const saved = fs.existsSync(savedPath) ? JSON.parse(fs.readFileSync(savedPath, 'utf8')) : null;
      const savedById = new Map((saved || []).map(item => [item.id, item.result?.bestSelections]));
      const olHistories = USE_OL ? buildOlHistories(testCases) : null;

      for (const testCase of testCases) {
        const olHistory = olHistories?.get(testCase.id);
        const algorithmOptions = olHistory ? { ...ALGO_OPTIONS, olHistory } : ALGO_OPTIONS;
        // eslint-disable-next-line no-await-in-loop
        const [result] = await getBestSelections({
          ...testCaseToSelectionOptions(testCase), explainAlgorithm: true, algorithmOptions,
        });
        const options = result?.bestSelections || [];

        if (savedById.has(testCase.id)) {
          comparedWithSaved++;
          differsFromSaved += sameAnswer(options, savedById.get(testCase.id)) ? 0 : 1;
          optionsDifferFromSaved += sameOptions(options, savedById.get(testCase.id)) ? 0 : 1;
        }

        if (!testCase.expected?.length) {
          continue; // nothing to score against
        }

        const expected = testCase.expected.map(normalizePhrase);
        const isRight = option => expected.includes(normalizePhrase(optionText(option)));
        const top = options[0];
        const topRight = !!top && isRight(top);

        casesBySplit[split].push({
          project,
          hasSuggestion: !!top,
          topRight,
          topConfidence: top?.confidence,
          topWrongKind: top && !topRight ? wrongKind(plainWords(optionText(top)), plainWords(testCase.expected[0])) : undefined,
        });

        options.forEach((option, rank) => {
          const row = {
            rank, confidence: option.confidence, right: isRight(option),
          };
          rowsBySplit[split].push(row);
          rowLines.push(JSON.stringify({
            id: testCase.id, file: base, project, split, occurrence: testCase.contextId?.occurrence || 1, ...row, features: option.features,
          }));
        });
      }
    }

    const lines = [
      `${files.length} files; test projects: ${testProjects.join(' ')}`
        + (ALGO_OPTIONS ? `; algorithm options ${JSON.stringify(ALGO_OPTIONS)}` : '')
        + (USE_OL ? '; with original-language history' : ''),
      `answers differing from the saved algorithm results: ${differsFromSaved} of ${comparedWithSaved}`
        + ` (options or their order: ${optionsDifferFromSaved}; the rest differ only in confidence)`,
    ];

    for (const split of ['tune', 'test']) {
      lines.push('', ...reportSplit(split, summarizeCalibration(casesBySplit[split], rowsBySplit[split])));
    }

    lines.push('', 'project       at 100: cases right    at 80-99: cases right');

    for (const p of calibrationByProject([...casesBySplit.tune, ...casesBySplit.test])) {
      lines.push(`${p.project.padEnd(16)} ${String(p.at100).padStart(6)} ${percent(p.rightAt100, p.at100).padStart(6)}`
        + `    ${String(p.at80).padStart(6)} ${percent(p.rightAt80, p.at80).padStart(6)}`);
    }

    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, `${OUTPUT_NAME}.jsonl`), rowLines.join('\n') + '\n');
    fs.writeFileSync(path.join(resultsDir, `${OUTPUT_NAME}.report.txt`), lines.join('\n') + '\n');
    console.log(lines.join('\n'));
    expect(casesBySplit.tune.length + casesBySplit.test.length).toBeGreaterThan(0);
  }, 60 * 60 * 1000);
});
