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
 * And for plans/prompt-span-experiments.md (D4):
 * - FT-DEV: the cases of D3's validation split (`llmTrainingData/finetune-d3/valid.meta.jsonl`)
 *   that the app sends to the AI, taken from the current data files; FT-DEV-NOHIST: the same with
 *   no history.
 * - NEW-DEV: a seeded random sample of the cases the app sends to the AI from the new projects
 *   (`NEW_DEV_FILES`), with no file over a share of the sample; NEW-DEV-NOHIST: all of NEW-DEV
 *   with no history.
 *
 * This folder is in jest's `testPathIgnorePatterns`, so this file is not run as a test.
 */
import fs from 'fs';
import path from 'path';
import { getBestVerseFromChapter } from '../../src/helpers/verseHelpers';

/**
 * The fine-tune's held-out test files (`testFiles` in `llmTrainingData/finetune-d3/manifest.json`,
 * which is git-ignored, so they are written out here), plus `ar_avd_luk_book_unfoldingWord_en` and
 * `ar_avd_luk_book_ru_gl_ru` (added 2026-11-25, the first Arabic-target test files; add new ones to an existing TEST with
 * `LLM_PROMPT_EVAL_SETS=testadd`). Their projects are left out of DEV and of fine-tune training
 * (`DEFAULT_TEST_PROJECTS` in `fineTuneHelpers.js`).
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
  'ar_avd_luk_book_unfoldingWord_en',
  'ar_avd_luk_book_ru_gl_ru',
  // moved from training to test 2026-11-25, one project per main training language
  'ru_rlob_gen_book_unfoldingWord_en',
  'vi_glt_heb_book_unfoldingWord_en',
  'fa_glt_1ti_book_unfoldingWord_en',
  'fa_glt_1ti_book_ru_gl_ru',
  'id_glt_1ti_book_unfoldingWord_en',
  'ne_glt_eph_book_unfoldingWord_en', // added 2026-11-25 (Nepali, a language in no training project)
  'gu_glt_1co_book_unfoldingWord_en', // added 2026-11-25 (Gujarati; gu_glt_luk is in training)
  'gu_glt_1co_book_ru_gl_ru',
  // rebalanced 2026-11-25: te_glt_1co replaces te_glt_tit (back in training); Bengali 2 Corinthians and
  // English Galatians (also in NEW_DEV_FILES, which was built before; NEW-DEV overlaps TEST there)
  'te_glt_1co_book_unfoldingWord_en',
  'bn_glt_2co_book_unfoldingWord_en',
  'bn_glt_2co_book_BSOJ_ar',
  'en_ult_gal_book_BSOJ_ar',
  // rebalanced 2026-11-26: 1 Corinthians in Hindi, Odia and Vietnamese
  'hi_glt_1co_book_unfoldingWord_en',
  'or_glt_1co_book_ru_gl_ru',
  'vi_glt_1co_book_unfoldingWord_en',
  'vi_glt_1co_book_ru_gl_ru',
];

/** settings of the sets as built for the plan; change them only on purpose, and say so in the plan */
export const PROMPT_EVAL_DEFAULTS = {
  seed: 20261122,
  devSize: 1500,
  maxLanguageShare: 0.25,
  noHistoryShare: 0.5,
};

/** the new-project files of NEW-DEV (plans/prompt-span-experiments.md, D4), unseen by every model */
export const NEW_DEV_FILES = [
  'en_ult_gal_book_BSOJ_ar',
  'en_ult_jos_book_ru_gl_ru',
  'en_ult_luk_book_ru_gl_ru',
  // es-419_est_est_book_unfoldingWord_en when NEW-DEV was built (its cases keep that name); the
  // project was renamed es-419_glt_est_book, whose file has the same 140 cases
  'es-419_glt_est_book_unfoldingWord_en',
];

/** settings of NEW-DEV as built for the span plan; change them only on purpose, and say so in the plan */
export const NEW_DEV_DEFAULTS = {
  seed: 20261124,
  size: 1000,
  maxFileShare: 0.4,
};

/**
 * The cases of a fine-tune split from its meta file (one JSON object per line, with `file` and
 * `id`), in file order.
 * @param {string} metaText - the contents of e.g. `valid.meta.jsonl`
 * @returns {Array<{file: string, id: string}>}
 */
export function readSplitCaseIds(metaText) {
  return metaText.split('\n').filter(line => line.trim())
    .map(line => JSON.parse(line))
    .map(({ file, id }) => ({ file, id }));
}

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
 * language (or from one group of `groupOf`, e.g. one file for NEW-DEV). The cap is checked first,
 * so the algorithm runs only on cases that could be kept.
 * @param {Array<object>} candidates - eval cases (see {@link toEvalCase})
 * @param {object} options
 * @param {number} options.seed
 * @param {number} options.size
 * @param {number} options.maxLanguageShare - e.g. 0.25
 * @param {function(object): string} [options.groupOf] - what the cap counts by (default the
 *   target language)
 * @param {function(object): Promise<boolean>} options.isSentToAi - true when the app would ask the
 *   AI (the algorithm's top confidence is below `ALGORITHM_CERTAIN_CONFIDENCE`)
 * @returns {Promise<{cases: Array<object>, examined: number, certain: number}>} - the cases in
 *   their random order; how many candidates the algorithm was run on; how many of those it was
 *   certain about (left out)
 */
export async function selectDevCases(candidates, {
  seed, size, maxLanguageShare, isSentToAi, groupOf = candidate => candidate.targetLang,
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

    const group = groupOf(candidate);
    const count = perLanguage.get(group) || 0;

    if (count >= cap) {
      continue;
    }

    examined++;

    // eslint-disable-next-line no-await-in-loop
    if (!(await isSentToAi(candidate))) {
      certain++;
      continue;
    }
    perLanguage.set(group, count + 1);
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

/**
 * The plain text of a verse from a bible book file: string verses as they are, verse objects
 * (aligned bibles) as their words and text in order, without footnotes or USFM markers, with
 * whitespace collapsed.
 * @param {string|{verseObjects: Array<object>}} verseData
 * @returns {string}
 */
export function verseDataToText(verseData) {
  const parts = [];

  const walk = objects => {
    for (const object of objects || []) {
      if (object.type === 'footnote' || object.tag === 'f' || object.tag === 'fe') {
        continue;
      }

      if (object.children) {
        walk(object.children);
      } else if (typeof object.text === 'string') {
        parts.push(object.text);
      }

      if (object.type === 'paragraph' || object.type === 'quote') {
        parts.push(' ');
      }
    }
  };

  if (typeof verseData === 'string') {
    parts.push(verseData);
  } else {
    walk(verseData?.verseObjects);
  }
  return parts.join('')
    .replace(/\\[a-z0-9-]+\*?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Adds `glVerse` to cases in place: the plain text of the case's verse in the GL bible its GL
 * phrase came from (named at the end of `source`, e.g. `GL en ult/v91_unfoldingWord`), read from
 * `<tcHome>/resources/<glLang>/bibles/<bible>/<book>/<chapter>.json`. For X3 of
 * plans/improve-single-prompt.md, and for fine-tune data built with a variant that uses it.
 * Uses Node's `fs` (`fs-extra` is mocked globally in jest).
 * @param {Array<object>} cases
 * @param {string} tcHome - translationCore folder with the GL bibles
 * @returns {{added: number, missing: Array<string>}} - ids of cases with no GL verse found
 */
export function addGlVerses(cases, tcHome) {
  const chapters = new Map();
  const missing = [];
  let added = 0;

  for (const evalCase of cases) {
    const bible = (evalCase.source || '').split(' GL ')[1]?.split(' ')[1];
    const {
      bookId, chapter, verse,
    } = evalCase.contextId?.reference || {};
    const file = bible && path.join(tcHome, 'resources', evalCase.glLang, 'bibles', bible, bookId, `${chapter}.json`);

    if (file && !chapters.has(file)) {
      chapters.set(file, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
    }

    const chapterData = file && chapters.get(file);
    const text = chapterData ? verseDataToText(getBestVerseFromChapter(chapterData, verse)) : '';

    if (text) {
      evalCase.glVerse = text;
      added++;
    } else {
      missing.push(evalCase.id);
    }
  }
  return { added, missing };
}
