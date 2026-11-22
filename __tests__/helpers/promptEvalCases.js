/**
 * Chooses the evaluation cases of plans/improve-single-prompt.md (D3) from the training data in
 * `llmTrainingData/*.json`. Used by `__tests__/buildPromptEvalCases.test.js`.
 *
 * - DEV: a seeded random sample of the cases the app sends to the AI (algorithm top confidence
 *   below `ALGORITHM_CERTAIN_CONFIDENCE`), from projects other than the fine-tune's test projects,
 *   with no target language over a share of the sample.
 * - DEV-NOHIST: the first half of DEV (in its random order) with the history removed.
 * - TEST: every case of the fine-tune's held-out test files (`testFiles` of
 *   `llmTrainingData/finetune-d3/manifest.json`), as Step 6 (b) of plans/fine-tune-qwen3.md scored
 *   them; TEST-NOHIST: the same with the history removed.
 *
 * This folder is in jest's `testPathIgnorePatterns`, so this file is not run as a test.
 */

/**
 * The fine-tune's held-out test files (`testFiles` in `llmTrainingData/finetune-d3/manifest.json`,
 * which is git-ignored, so they are written out here). Their projects are left out of DEV.
 */
export const FINETUNE_TEST_FILES = [
  'bn_glt_eph_book_unfoldingWord_en',
  'en_ult_tit_book_BSOJ_ar',
  'en_ult_tit_book_bahtraku_id',
  'en_ult_tit_book_es-419_gl_es-419',
  'en_ult_tit_book_fa_gl_fa',
  'en_ult_tit_book_ru_gl_ru',
  'es-419_est_rut_book_unfoldingWord_en',
  'ne_glt_2co_book_unfoldingWord_en',
  'ne_glt_tit_book_es-419_gl_es-419',
];

/** settings of the sets as built for the plan; change them only on purpose, and say so in the plan */
export const PROMPT_EVAL_DEFAULTS = {
  seed: 20261122,
  devSize: 1500,
  maxLanguageShare: 0.25,
  noHistoryShare: 0.5,
};

/**
 * The project a training data file is from: its name before `_book`, e.g. `vi_glt_luk` for
 * `vi_glt_luk_book_unfoldingWord_en`.
 * @param {string} fileBase - file name without `.json`
 * @returns {string}
 */
export function projectOfFile(fileBase) {
  const index = fileBase.indexOf('_book');
  return index > 0 ? fileBase.slice(0, index) : fileBase;
}

/**
 * Seeded pseudo-random numbers in [0, 1) (mulberry32), so a set can be rebuilt exactly.
 * @param {number} seed - 32-bit integer
 * @returns {function(): number}
 */
export function seededRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle of a copy, with a seeded random source.
 * @param {Array} items
 * @param {number} seed
 * @returns {Array} - a new array
 */
export function seededShuffle(items, seed) {
  const random = seededRandom(seed);
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * A case for an evaluation set: its id made unique across files (the same verse and check can be
 * in several files, one per GL), with the file it came from.
 * @param {object} testCase - a training case
 * @param {string} fileBase - its file name without `.json`
 * @returns {object} - a copy with `id` `<fileBase>/<id>`, `sourceId` and `sourceFile`
 */
export function toEvalCase(testCase, fileBase) {
  return {
    ...testCase, id: `${fileBase}/${testCase.id}`, sourceId: testCase.id, sourceFile: fileBase,
  };
}

/**
 * A copy of a case with no history; its id gets `#nohist` so results of the two sets never mix.
 * @param {object} evalCase
 * @returns {object}
 */
export function withoutHistory(evalCase) {
  return {
    ...evalCase, id: `${evalCase.id}#nohist`, history: {},
  };
}

/**
 * Chooses DEV: goes through the candidates in a seeded random order and keeps those the app sends
 * to the AI, until `size` are kept, with at most `maxLanguageShare` of `size` from one target
 * language. The language cap is checked first, so the algorithm runs only on cases that could be
 * kept.
 * @param {Array<object>} candidates - eval cases (see {@link toEvalCase})
 * @param {object} options
 * @param {number} options.seed
 * @param {number} options.size
 * @param {number} options.maxLanguageShare - e.g. 0.25
 * @param {function(object): Promise<boolean>} options.isSentToAi - true when the app would ask the
 *   AI (the algorithm's top confidence is below `ALGORITHM_CERTAIN_CONFIDENCE`)
 * @returns {Promise<{cases: Array<object>, examined: number, certain: number}>} - the cases in
 *   their random order; how many candidates the algorithm was run on; how many of those it was
 *   certain about (left out)
 */
export async function selectDevCases(candidates, {
  seed, size, maxLanguageShare, isSentToAi,
}) {
  const cap = Math.floor(size * maxLanguageShare);
  const perLanguage = new Map();
  const cases = [];
  let examined = 0;
  let certain = 0;

  for (const candidate of seededShuffle(candidates, seed)) {
    if (cases.length >= size) {
      break;
    }

    const count = perLanguage.get(candidate.targetLang) || 0;

    if (count >= cap) {
      continue;
    }

    examined++;

    // eslint-disable-next-line no-await-in-loop
    if (!(await isSentToAi(candidate))) {
      certain++;
      continue;
    }
    perLanguage.set(candidate.targetLang, count + 1);
    cases.push(candidate);
  }
  return {
    cases, examined, certain,
  };
}

/**
 * Counts cases by a key.
 * @param {Array<object>} cases
 * @param {function(object): string} keyOf
 * @returns {Object<string, number>} - sorted by count, largest first
 */
export function countBy(cases, keyOf) {
  const counts = new Map();

  for (const item of cases) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}
