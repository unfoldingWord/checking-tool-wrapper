/**
 * Measures how well the algorithm's suggestion confidences match how often the suggestions are right
 * (plans/algorithm-confidence.md). Used by `__tests__/calibrateAlgorithm.test.js`; the functions are
 * pure, so the unit tests in that file run in `npm test`.
 *
 * A "row" is one suggestion option shown for a case: `{ project, split, rank, confidence, right }`,
 * with `rank` 0 for the top option. "Right" means the option's words and occurrences equal one of the
 * case's expected answers, scored as `summarizeTestResults` scores them (`normalizePhrase` of
 * `optionText`).
 */

/** projects held out for checking a calibration: the broader held-out test of plans/fine-tune-qwen3.md */
export const DEFAULT_CALIBRATION_TEST_PROJECTS = [
  'ne_glt_*', 'bn_glt_eph', 'es-419_est_rut', 'en_ult_tit',
  'vi_glt_heb', 'ru_rlob_luk', 'te_glt_luk', 'ar_avd_heb', 'fa_glt_jas', 'id_glt_1ti',
];

/** confidence bands of the report, highest first; a confidence is in the first band whose `min` it reaches */
export const CALIBRATION_BANDS = [
  { band: '100', min: 100 },
  { band: '95-99', min: 95 },
  { band: '90-94', min: 90 },
  { band: '85-89', min: 85 },
  { band: '80-84', min: 80 },
  { band: '70-79', min: 70 },
  { band: '60-69', min: 60 },
  { band: '40-59', min: 40 },
  { band: '1-39', min: 1 },
  { band: '0', min: 0 },
];

/**
 * Band of a confidence in {@link CALIBRATION_BANDS}.
 * @param {number} confidence - 0-100
 * @returns {string} - e.g. '90-94'
 */
export function calibrationBand(confidence) {
  return CALIBRATION_BANDS.find(({ min }) => confidence >= min)?.band || '0';
}

/**
 * Target project of a training data file name: the part before `_book`.
 * @param {string} fileName - e.g. 'vi_glt_luk_book_ru_gl_ru' or 'vi_glt_luk_book_ru_gl_ru.json'
 * @returns {string} - e.g. 'vi_glt_luk'
 */
export function projectOfFile(fileName) {
  return fileName.replace(/\.json$/, '').replace(/_book(_.*)?$/, '');
}

/**
 * Whether a project matches one of the patterns (`*` matches any text).
 * @param {string} project - e.g. 'ne_glt_2co'
 * @param {Array<string>} patterns - e.g. ['ne_glt_*', 'vi_glt_heb']
 * @returns {boolean}
 */
export function matchesProject(project, patterns) {
  return patterns.some(pattern => {
    const source = pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${source}$`).test(project);
  });
}

/**
 * Expected calibration error: the mean distance between confidence and accuracy, over 10-point bins
 * of confidence (100 is its own bin), weighted by how many rows each bin has.
 * @param {Array<{confidence: number, right: boolean}>} rows
 * @returns {number} - in percentage points; 0 for no rows
 */
export function expectedCalibrationError(rows) {
  const bins = new Map();

  for (const row of rows) {
    const bin = Math.min(10, Math.floor(row.confidence / 10));
    const entry = bins.get(bin) || {
      count: 0, confidence: 0, right: 0,
    };
    entry.count++;
    entry.confidence += row.confidence;
    entry.right += row.right ? 1 : 0;
    bins.set(bin, entry);
  }

  let total = 0;

  for (const {
    count, confidence, right,
  } of bins.values()) {
    total += Math.abs(confidence / count - 100 * right / count) * count;
  }
  return rows.length ? total / rows.length : 0;
}

/**
 * Brier score: the mean squared difference between confidence (as a probability) and the outcome.
 * @param {Array<{confidence: number, right: boolean}>} rows
 * @returns {number} - 0 (perfect) to 1; 0 for no rows
 */
export function brierScore(rows) {
  const total = rows.reduce((sum, row) => sum + (row.confidence / 100 - (row.right ? 1 : 0)) ** 2, 0);
  return rows.length ? total / rows.length : 0;
}

/**
 * Area under the ROC curve: the chance that a right option has a higher confidence than a wrong one
 * (ties count half). 0.5 is no better than chance, 1 separates them perfectly.
 * @param {Array<{confidence: number, right: boolean}>} rows
 * @returns {number} - 0-1; 0.5 when every row is right or every row is wrong
 */
export function areaUnderCurve(rows) {
  const sorted = [...rows].sort((a, b) => a.confidence - b.confidence);
  let rightCount = 0;
  let rankSum = 0;

  for (let start = 0; start < sorted.length;) {
    let end = start;

    while (end < sorted.length && sorted[end].confidence === sorted[start].confidence) {
      end++;
    }

    const averageRank = (start + end + 1) / 2; // 1-based ranks, ties share the average

    for (let i = start; i < end; i++) {
      if (sorted[i].right) {
        rightCount++;
        rankSum += averageRank;
      }
    }
    start = end;
  }

  const wrongCount = sorted.length - rightCount;
  return rightCount && wrongCount ? (rankSum - rightCount * (rightCount + 1) / 2) / (rightCount * wrongCount) : 0.5;
}

/**
 * Rows and accuracy per {@link CALIBRATION_BANDS} band.
 * @param {Array<{confidence: number, right: boolean}>} rows
 * @returns {Array<{band: string, count: number, right: number}>} - every band, highest first
 */
export function accuracyByBand(rows) {
  const bands = CALIBRATION_BANDS.map(({ band }) => ({
    band, count: 0, right: 0,
  }));

  for (const row of rows) {
    const entry = bands.find(({ band }) => band === calibrationBand(row.confidence));
    entry.count++;
    entry.right += row.right ? 1 : 0;
  }
  return bands;
}

/**
 * Why a wrong option was wrong, comparing its words with the first expected answer, occurrences
 * left out: the same words (so another occurrence), the expected answer is longer and contains them,
 * it is shorter and inside them, or different words.
 * @param {string} optionWords - normalized words of the option, without occurrence suffixes
 * @param {string} expectedWords - normalized words of the expected answer, without occurrence suffixes
 * @returns {'otherOccurrence'|'expectedLonger'|'expectedShorter'|'differentWords'}
 */
export function wrongKind(optionWords, expectedWords) {
  if (optionWords === expectedWords) {
    return 'otherOccurrence';
  }

  const contains = (outer, inner) => ` ${outer} `.includes(` ${inner} `);

  if (contains(expectedWords, optionWords)) {
    return 'expectedLonger';
  }

  if (contains(optionWords, expectedWords)) {
    return 'expectedShorter';
  }
  return 'differentWords';
}

/**
 * Summary of one split: the numbers of plans/algorithm-confidence.md section 2.
 * @param {Array<object>} cases - per case: `{ project, hasSuggestion, topRight, topConfidence,
 *   topWrongKind }` (`topWrongKind` set when the top option is wrong)
 * @param {Array<{rank: number, confidence: number, right: boolean}>} rows - every option shown
 * @returns {object} - counts, top-1, ECE and Brier score for the top option and for all options,
 *   wrong options at confidence 80 or more, accuracy at 100, and why the top option at 100 was wrong
 */
export function summarizeCalibration(cases, rows) {
  const top = rows.filter(row => row.rank === 0);
  const at100 = cases.filter(item => item.hasSuggestion && item.topConfidence === 100);
  const wrongKindsAt100 = {};

  for (const item of at100) {
    if (!item.topRight) {
      wrongKindsAt100[item.topWrongKind] = (wrongKindsAt100[item.topWrongKind] || 0) + 1;
    }
  }

  return {
    cases: cases.length,
    noSuggestion: cases.filter(item => !item.hasSuggestion).length,
    top1: cases.filter(item => item.topRight).length,
    options: rows.length,
    eceTop: expectedCalibrationError(top),
    eceAll: expectedCalibrationError(rows),
    brierTop: brierScore(top),
    brierAll: brierScore(rows),
    aucAll: areaUnderCurve(rows),
    wrongTopAt80: top.filter(row => !row.right && row.confidence >= 80).length,
    wrongAnyAt80: rows.filter(row => !row.right && row.confidence >= 80).length,
    at100: at100.length,
    rightAt100: at100.filter(item => item.topRight).length,
    wrongKindsAt100,
    bandsTop: accuracyByBand(top),
    bandsLower: accuracyByBand(rows.filter(row => row.rank > 0)),
  };
}

/**
 * Top-option accuracy at 100 and at 80-99, per project.
 * @param {Array<{project: string, hasSuggestion: boolean, topRight: boolean, topConfidence: number}>} cases
 * @returns {Array<{project: string, at100: number, rightAt100: number, at80: number, rightAt80: number}>} -
 *   sorted by accuracy at 100, lowest first
 */
export function calibrationByProject(cases) {
  const byProject = new Map();

  for (const item of cases) {
    if (!item.hasSuggestion) {
      continue;
    }

    const entry = byProject.get(item.project) || {
      project: item.project, at100: 0, rightAt100: 0, at80: 0, rightAt80: 0,
    };

    if (item.topConfidence === 100) {
      entry.at100++;
      entry.rightAt100 += item.topRight ? 1 : 0;
    } else if (item.topConfidence >= 80) {
      entry.at80++;
      entry.rightAt80 += item.topRight ? 1 : 0;
    }
    byProject.set(item.project, entry);
  }

  const rate = (right, count) => (count ? right / count : 1);
  return [...byProject.values()].sort((a, b) => rate(a.rightAt100, a.at100) - rate(b.rightAt100, b.at100));
}
