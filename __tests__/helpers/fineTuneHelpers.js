/**
 * Builds the fine-tuning data of `plans/fine-tune-qwen3.md` (Steps 2 and 3): each training case
 * (`llmTrainingData/*.json`) becomes the exact `messages` the app sends for it, plus an assistant
 * answer built from `expected`, split by target project into train, validation and test sets and
 * written as JSONL in the conversational `messages` format that `mlx_lm.lora` and Unsloth / TRL read.
 *
 * The prompt is built with the app's own functions (`buildTranslationOptionsPrompt`,
 * `applyThinkingDirective`), so it cannot drift from what `queryAiAPI` sends; the parity test in
 * `buildFineTuneData.test.js` checks that.
 *
 * With `promptVariant` (plans/improve-single-prompt.md, Step 7) the messages come from that variant's
 * builder in `promptVariants.js`, given the request `getBestSelections` gives it (with the
 * algorithm's options and the GL verse), then `applyThinkingDirectiveToMessages`, as `queryAiAPI`
 * sends them; the parity test checks that too.
 *
 * Node's `fs` is used because `fs-extra` is mocked in the tests.
 */
import fs from 'fs';
import path from 'path';
import {
  ALGORITHM_CERTAIN_CONFIDENCE,
  applyThinkingDirective,
  applyThinkingDirectiveToMessages,
  buildTranslationOptionsPrompt,
  getWordList,
  moveSelectionsToOccurrence,
  normalizeForCompare,
  parseLlmSelectionOptions,
  wordSimilarity,
} from '../../src/utils/checkingSuggestionsUtils';
import {
  findUnhelpfulTrainingCases,
  getAnswerLengthLimits,
  normalizePhrase,
  optionText,
  testCaseToSelectionOptions,
} from './suggestionsHelpers';
import { addGlVerses } from './promptEvalCases';
import { PROMPT_VARIANTS } from './promptVariants';

/** Step 2 confidence labels, following rule 5 of the system prompt */
export const LABEL_CONFIDENCE = {
  historyVerbatim: 95, // the answer is a history rendering, word for word
  historyRelated: 75, // a history rendering covers some answer words, or is another form of them
  noHistory: 55, // nothing usable in the history: a guess
};

/**
 * Target projects never trained on (Step 3, proposed in Q2): `ne` is a target language with no
 * other training data, and `en_ult_tit` is the English target with five GLs. `ar_avd_luk` (added
 * 2026-11-25) is the first Arabic-target test project; it was never in the training data. Its
 * words appear as GL phrases in the Arabic-GL Luke files (`vi_glt_luk_book_BSOJ_ar`,
 * `ru_rlob_luk_book_BSOJ_ar`, from the same AVD text), though never as answers. Added 2026-11-25 so
 * every main training language has a test project: `ru_rlob_gen`, `vi_glt_heb`, `fa_glt_1ti`,
 * `id_glt_1ti`, then `te_glt_1co`, `bn_glt_2co`, `en_ult_gal` (moved out of training; models trained
 * before then saw them; `te_glt_tit` was a test project for a few hours and is training again).
 */
export const DEFAULT_TEST_PROJECTS = [
  // Nepali was in no training project until 2026-11-26 (ne_glt_*); then ne_glt_gal, ne_glt_1jn and
  // ne_glt_rut went into training, so these three are listed by name and Nepali is no longer unseen
  'ne_glt_2co', 'ne_glt_tit', 'ne_glt_eph',
  'bn_glt_eph', 'es-419_est_rut', 'en_ult_tit', 'ar_avd_luk',
  'ru_rlob_gen', 'vi_glt_heb', 'fa_glt_1ti', 'id_glt_1ti',
  'gu_glt_1co', // Gujarati, added 2026-11-25 with gu_glt_luk for training
  // rebalanced 2026-11-25: te_glt_1co replaces te_glt_tit (back in training); bn_glt_2co, en_ult_gal
  'te_glt_1co', 'bn_glt_2co', 'en_ult_gal',
  // rebalanced 2026-11-26: Hindi and Odia (new; their other projects train) and Vietnamese
  'hi_glt_1co', 'or_glt_1co', 'vi_glt_1co',
  // added 2026-11-27 as test-only languages (in no training project): Tamil (Arabic GL) and Tajik
  'ta_irv_1co', 'ta_irv_act', 'ta_irv_heb', 'ta_irv_jhn', 'ta_irv_luk', 'tg_ult_3jn',
];

/**
 * History groups of `findUnhelpfulTrainingCases`, as a case's category. `passes` has none of
 * these reasons. The base set is `passes` and `onlyOtherFormsInHistory`; the other two are the
 * experiments of Step 4B.
 */
export const CASE_CATEGORIES = ['passes', 'onlyOtherFormsInHistory', 'someExpectedWordsNotInHistory', 'noRelatedWordInHistory'];
export const BASE_CATEGORIES = ['passes', 'onlyOtherFormsInHistory'];

/** reasons from `findUnhelpfulTrainingCases` that always drop a case */
const DROP_REASONS = ['noExpected', 'emptyGlPhrase', 'expectedNotInVerse', 'duplicate'];

export const DEFAULT_BUILD_OPTIONS = {
  seed: 3407,
  testProjects: DEFAULT_TEST_PROJECTS,
  validPercent: 5,
  /** extra categories trained on besides `BASE_CATEGORIES` (Step 4B runs D2 and D3) */
  includeCategories: [],
  /** share of the algorithm-certain-and-right cases kept, so the model still learns to copy history */
  certainRightKeep: 0.2,
  projectCap: 2000,
  groupCap: 40,
  /** negative examples (`"",0`) as a share of the train set */
  negativeShare: 0.03,
  /** drop `unusuallyLongAnswer` cases; off because about half of them look right on review */
  dropLongAnswers: false,
  /**
   * prompt variant of `promptVariants.js` the examples are built with; '' for the app's prompt
   * (plans/improve-single-prompt.md, Step 7)
   */
  promptVariant: '',
  /**
   * share of the kept train and valid examples also added with no history (`history: {}`), labelled
   * as `LABEL_CONFIDENCE.noHistory` (plans/improve-single-prompt.md, Q4); 0 for none
   */
  noHistoryShare: 0,
  /** translationCore folder with the GL bibles, for the `glVerse` of a variant that uses it */
  tcHome: '',
};

/**
 * Seeded random numbers (mulberry32), so a build gives the same split and sample every time.
 * @param {number} seed
 * @returns {function(): number} - returns a number in [0, 1)
 */
export function makeRandom(seed) {
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
 * Shuffles a copy of a list with a seeded random function (Fisher-Yates).
 * @param {Array} list
 * @param {function(): number} random - from {@link makeRandom}
 * @returns {Array} - the shuffled copy
 */
export function shuffle(list, random) {
  const copy = [...list];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * 32-bit FNV-1a hash of a string, for a split that depends only on the key, not on file order.
 * @param {string} text
 * @returns {number}
 */
export function hashString(text) {
  let hash = 0x811c9dc5;

  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Target project of a training data file: the name before `_book_`.
 * @param {string} fileName - e.g. `vi_glt_luk_book_ru_gl_ru.json`
 * @returns {string} - e.g. `vi_glt_luk`
 */
export function getTargetProject(fileName) {
  return path.basename(fileName, '.json').replace(/_book(_.*)?$/, '');
}

/**
 * Whether a project matches one of the test-project patterns (`*` matches any text).
 * @param {string} project - e.g. `ne_glt_2co`
 * @param {Array<string>} patterns - e.g. `['ne_glt_*', 'bn_glt_eph']`
 * @returns {boolean}
 */
export function isTestProject(project, patterns) {
  return patterns.some(pattern => {
    const source = pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${source}$`).test(project);
  });
}

/**
 * Split of a case: `test` for a test project, else `valid` for `validPercent` of the
 * (project, group) pairs, chosen by hash, else `train`. Splitting by project and group keeps the
 * same verse under different GLs, and the checks of one group, in a single split.
 * @param {string} project - target project
 * @param {string} groupId - translationWords group
 * @param {object} options - `testProjects` and `validPercent`
 * @returns {'train'|'valid'|'test'}
 */
export function getSplit(project, groupId, { testProjects, validPercent }) {
  if (isTestProject(project, testProjects)) {
    return 'test';
  }
  return (hashString(`${project}|${groupId}`) % 100) < validPercent ? 'valid' : 'train';
}

/**
 * Key of a verse and group, for leaving the suitability suite's cases out of training.
 * @param {string} project - target project, e.g. `vi_glt_heb`
 * @param {number|string} chapter
 * @param {number|string} verse
 * @param {string} groupId
 * @returns {string}
 */
export function verseGroupKey(project, chapter, verse, groupId) {
  return `${project}|${chapter}|${verse}|${groupId}`;
}

/**
 * Verse and group keys of the cases in `__fixtures__/llmEval/realCases.json`, from their
 * `source` (`vi_glt_heb_book 7:26, tW sin`).
 * @param {Array<{source: string}>} realCases
 * @returns {Set<string>} - keys from {@link verseGroupKey}
 */
export function getEvalCaseKeys(realCases) {
  const keys = new Set();

  for (const { source } of realCases || []) {
    const match = (source || '').match(/^(\S+?)_book (\d+):(\d+), tW (\S+)/);

    if (match) {
      keys.add(verseGroupKey(match[1], match[2], match[3], match[4]));
    }
  }
  return keys;
}

/**
 * Expected answer without `:n` occurrence suffixes. The app places an answer at its first match and
 * `getBestSelections` moves it to the check's occurrence, so the model answers plain words.
 * @param {string} expected - e.g. `Chúa:3 Cứu:2 Thế`
 * @returns {string} - e.g. `Chúa Cứu Thế`
 */
export function stripOccurrences(expected) {
  return (expected || '').split(/\s+/).filter(Boolean)
    .map(word => word.replace(/:\d+$/, ''))
    .join(' ');
}

/**
 * Whether `words` appear in `wordList` as one contiguous run.
 * @param {Array<string>} words
 * @param {Array<string>} wordList
 * @returns {boolean}
 */
function containsRun(words, wordList) {
  if (!words.length) {
    return false;
  }

  for (let i = 0; i + words.length <= wordList.length; i++) {
    if (words.every((word, j) => wordList[i + j] === word)) {
      return true;
    }
  }
  return false;
}

/**
 * Confidence label for an answer (Step 2, item 4), following rule 5 of the system prompt.
 * Words are compared with `normalizeForCompare` in the target language, and other forms with
 * `wordSimilarity`.
 * @param {string} answer - answer words, without occurrence suffixes
 * @param {object} history - `{ glKey: { rendering: count } }`
 * @param {Array<string>} wordList - verse words
 * @param {string} lang - target language code
 * @returns {{confidence: number, historyInVerseButDiffers: boolean}} - the label, and whether a
 *   history rendering is in the verse word for word while the answer is not a history rendering
 *   (the case contradicts rule 3 of the single-request prompt)
 */
export function labelConfidence(answer, history, wordList, lang) {
  const normalize = word => normalizeForCompare(word, lang);
  const answerWords = getWordList(answer).map(normalize);
  const verseWords = wordList.map(normalize);
  const renderings = Object.values(history || {})
    .flatMap(counts => Object.keys(counts || {}))
    .map(rendering => getWordList(rendering).map(normalize))
    .filter(words => words.length);
  const answerKey = answerWords.join(' ');

  if (renderings.some(words => words.join(' ') === answerKey)) {
    return { confidence: LABEL_CONFIDENCE.historyVerbatim, historyInVerseButDiffers: false };
  }

  const historyInVerseButDiffers = renderings.some(words => containsRun(words, verseWords));
  const historyWords = [...new Set(renderings.flat())];
  const related = answerWords.some(word => historyWords.some(historyWord => wordSimilarity(word, historyWord) > 0));

  return {
    confidence: related ? LABEL_CONFIDENCE.historyRelated : LABEL_CONFIDENCE.noHistory,
    historyInVerseButDiffers,
  };
}

/**
 * The system and user messages the app sends for a case with one request per query: the verse
 * cleaned as the runners clean it, `buildTranslationOptionsPrompt`, then `applyThinkingDirective`
 * with thinking off, as `getBestSelections` and `queryAiAPI` do.
 * @param {object} testCase - a training case
 * @param {string} [verseText] - use this cleaned verse instead of the case's (for negatives)
 * @param {object} [prompt]
 * @param {string} [prompt.variant] - a key of `PROMPT_VARIANTS`; leave out for the app's prompt
 * @param {Array<object>} [prompt.algorithmBestSelections] - the algorithm's options for the case, which
 *   `getBestSelections` gives the variant's builder
 * @returns {{messages: Array<{role: string, content: string}>, wordList: Array<string>, occurrence: number}}
 */
export function buildSingleRequestMessages(testCase, verseText, prompt = {}) {
  const options = testCaseToSelectionOptions(testCase);
  const wordList = getWordList(verseText ?? options.verseText);

  if (prompt.variant) {
    const builder = PROMPT_VARIANTS[prompt.variant];

    if (!builder) {
      throw new Error(`unknown prompt variant "${prompt.variant}"`);
    }

    // the request `getBestSelections` gives `getBestTWordSelectionWithConfidenceFromLlm`
    const { messages } = builder({
      wordList,
      targetLangCode: options.targetLanguageDetails.id,
      glPhrase: options.alignedGLText,
      glLangCode: options.gatewayLanguageCode,
      previousTranslationData: options.selectionsData?.selections,
      contextId: options.contextId,
      algorithmBestSelections: prompt.algorithmBestSelections || [],
      glVerseText: options.glVerseText,
    });

    return {
      messages: applyThinkingDirectiveToMessages(messages, false),
      wordList,
      occurrence: options.contextId.occurrence || 1,
    };
  }

  const appPrompt = buildTranslationOptionsPrompt(
    wordList.join(' '),
    options.targetLanguageDetails.id,
    options.alignedGLText,
    options.gatewayLanguageCode,
    options.selectionsData?.selections,
  );
  const { systemPrompt, query } = applyThinkingDirective({ systemPrompt: appPrompt.systemPrompt, query: appPrompt.input }, false);

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ],
    wordList,
    occurrence: options.contextId.occurrence || 1,
  };
}

/**
 * One CSV answer row, as rule 4 of the system prompt asks.
 * @param {string} words
 * @param {number} confidence
 * @returns {string}
 */
export function formatAnswerRow(words, confidence) {
  return `"${words}",${confidence}`;
}

/**
 * Decodes an assistant answer as the app does (`parseLlmSelectionOptions`, then
 * `moveSelectionsToOccurrence` for an occurrence above 1) and returns the top option's text,
 * in the `word word:2` form of `expected`.
 * @param {string} answer - assistant answer
 * @param {Array<string>} wordList - verse words
 * @param {number} occurrence - the check's occurrence
 * @param {string} lang - target language code
 * @returns {string} - '' when the answer decodes to no option
 */
export function decodeAnswer(answer, wordList, occurrence, lang) {
  const [top] = parseLlmSelectionOptions(answer, wordList);

  if (!top) {
    return '';
  }

  const selections = occurrence > 1 ? moveSelectionsToOccurrence(top.selections, wordList, occurrence, lang) : top.selections;
  return optionText({ selections });
}

/**
 * Builds the training example for one case: the messages, the answer and its confidence label,
 * and the round-trip check (Step 2, item 5): the answer, decoded as the app decodes it, must give
 * `expected[0]` as `summarizeTestResults` scores it.
 * @param {object} testCase - a training case
 * @param {object} [prompt] - see {@link buildSingleRequestMessages}
 * @returns {{messages: Array, answer: string, confidence: number, historyInVerseButDiffers: boolean,
 *   roundTrip: boolean, decoded: string}}
 */
export function buildSingleExample(testCase, prompt = {}) {
  const lang = testCase.targetLang || '';
  const {
    messages, wordList, occurrence,
  } = buildSingleRequestMessages(testCase, undefined, prompt);
  const words = stripOccurrences(testCase.expected?.[0]);
  const { confidence, historyInVerseButDiffers } = labelConfidence(words, testCase.history, wordList, lang);
  const answer = formatAnswerRow(words, confidence);
  const decoded = words ? decodeAnswer(answer, wordList, occurrence, lang) : '';

  return {
    messages: [...messages, { role: 'assistant', content: answer }],
    answer,
    confidence,
    historyInVerseButDiffers,
    roundTrip: !!words && normalizePhrase(decoded) === normalizePhrase(testCase.expected[0]),
    decoded,
  };
}

/**
 * Category of a case from its `findUnhelpfulTrainingCases` reasons (one of `CASE_CATEGORIES`).
 * @param {Array<string>} reasons
 * @returns {string}
 */
export function getCategory(reasons) {
  return CASE_CATEGORIES.find(category => reasons.includes(category)) || 'passes';
}

/**
 * Whether none of a case's answer or history words are in a verse, exactly or as another form,
 * so the verse can be a negative example (`"",0`) for the case's GL phrase and history.
 * @param {object} testCase - the case giving the GL phrase, history and answer
 * @param {Array<string>} verseWords - the other verse's words, through `normalizeForCompare`
 * @returns {boolean}
 */
export function verseHasNoCaseWords(testCase, verseWords) {
  const lang = testCase.targetLang || '';
  const caseWords = [
    ...getWordList(stripOccurrences(testCase.expected?.[0])),
    ...Object.values(testCase.history || {}).flatMap(counts => Object.keys(counts || {})).flatMap(getWordList),
  ].map(word => normalizeForCompare(word, lang));
  const unique = [...new Set(caseWords)].filter(Boolean);

  return !!unique.length && !unique.some(word => verseWords.some(verseWord => wordSimilarity(word, verseWord) > 0));
}

/**
 * Caps a list of examples per target project and per (project, group), keeping a random sample
 * of each, so large projects and common groups (`god`, `jesus`) do not dominate.
 * @param {Array<object>} examples - with `meta.project` and `meta.groupId`
 * @param {object} caps - `projectCap` and `groupCap`
 * @param {function(): number} random
 * @returns {{kept: Array<object>, dropped: {groupCap: number, projectCap: number}}}
 */
export function capExamples(examples, { projectCap, groupCap }, random) {
  const groupCounts = new Map();
  const projectCounts = new Map();
  const kept = [];
  const dropped = { groupCap: 0, projectCap: 0 };

  for (const example of shuffle(examples, random)) {
    const { project, groupId } = example.meta;
    const groupKey = `${project}|${groupId}`;

    if ((groupCounts.get(groupKey) || 0) >= groupCap) {
      dropped.groupCap++;
    } else if ((projectCounts.get(project) || 0) >= projectCap) {
      dropped.projectCap++;
    } else {
      groupCounts.set(groupKey, (groupCounts.get(groupKey) || 0) + 1);
      projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
      kept.push(example);
    }
  }
  return { kept, dropped };
}

/**
 * Reads the algorithm's results for a training data file (`results/<file>_Algorithm.results.json`,
 * from `npm run run:llm-training-data`) and returns its top option by case id.
 * @param {string} dataDir - folder of the training data files
 * @param {string} fileName - training data file name
 * @param {Array<object>} testCases - the file's cases, to check the results match them
 * @returns {Map<string, {confidence: number, text: string, bestSelections: Array<object>}>|null} - null
 *   when there are no results or they do not match the cases (rerun the algorithm)
 */
export function readAlgorithmTopOptions(dataDir, fileName, testCases) {
  const resultsPath = path.join(dataDir, 'results', `${path.basename(fileName, '.json')}_Algorithm.results.json`);

  if (!fs.existsSync(resultsPath)) {
    return null;
  }

  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const byId = new Map(results.map(({ id, result }) => [id, {
    confidence: result?.bestSelections?.[0]?.confidence || 0,
    text: optionText(result?.bestSelections?.[0]),
    bestSelections: result?.bestSelections || [],
  }]));

  if (byId.size !== testCases.length || testCases.some(({ id }) => !byId.has(id))) {
    return null;
  }
  return byId;
}

/**
 * Builds the negative examples: a train case's GL phrase and history with another verse of the same
 * file and split that contains none of its answer or history words, answered `"",0` (rule 6).
 * The builder drops unaligned checks, so without these the model never sees rule 6.
 * @param {Array<object>} sources - kept train examples, with `testCase` and `meta`
 * @param {Map<string, Array<{testCase: object, verseText: string, verseWords: Array<string>}>>} versesByFile
 *   - candidate verses by file name
 * @param {number} count - number of negatives to make
 * @param {function(): number} random
 * @param {object} [prompt] - see {@link buildSingleRequestMessages}; built with no algorithm options
 *   (assumed: the verse has none of the case's history words, so the algorithm should find nothing)
 * @returns {Array<object>} - examples with `messages` and `meta`
 */
export function buildNegativeExamples(sources, versesByFile, count, random, prompt = {}) {
  const negatives = [];
  const used = new Set();
  const MAX_TRIES = 30;

  for (const source of shuffle(sources, random)) {
    if (negatives.length >= count) {
      break;
    }

    const candidates = versesByFile.get(source.meta.file) || [];

    for (let tries = 0; tries < MAX_TRIES && candidates.length; tries++) {
      const other = candidates[Math.floor(random() * candidates.length)];
      const key = `${source.testCase.id}|${other.testCase.id}`;

      if (other.testCase.verse !== source.testCase.verse && !used.has(key) &&
        verseHasNoCaseWords(source.testCase, other.verseWords)) {
        used.add(key);
        const { messages } = buildSingleRequestMessages(source.testCase, other.verseText, { variant: prompt.variant });

        negatives.push({
          messages: [...messages, { role: 'assistant', content: formatAnswerRow('', 0) }],
          meta: {
            ...source.meta,
            id: `${source.testCase.id}-neg-${other.testCase.id}`,
            kind: 'negative',
            label: 0,
            algorithmConfidence: undefined,
            algorithmRight: undefined,
          },
        });
        break;
      }
    }
  }
  return negatives;
}

/**
 * Builds the no-history examples (plans/improve-single-prompt.md, Q4): a random `share` of the
 * kept examples again with `history: {}`, so the model learns the request the app sends when a
 * project has no earlier selections. With no history the algorithm has no options, so the request
 * has none. Labelled by {@link labelConfidence} (`LABEL_CONFIDENCE.noHistory`); cases whose
 * answer does not round-trip are skipped.
 * @param {Array<object>} kept - kept examples, with `testCase` and `meta`
 * @param {number} share - 0 to 1
 * @param {function(): number} random
 * @param {object} [prompt] - see {@link buildSingleRequestMessages}
 * @returns {{examples: Array<object>, roundTripFailed: number}}
 */
export function buildNoHistoryExamples(kept, share, random, prompt = {}) {
  const sources = shuffle(kept, random).slice(0, Math.round(kept.length * (share || 0)));
  const examples = [];
  let roundTripFailed = 0;

  for (const source of sources) {
    const testCase = {
      ...source.testCase, id: `${source.testCase.id}#nohist`, history: {},
    };
    const example = buildSingleExample(testCase, { variant: prompt.variant, algorithmBestSelections: [] });

    if (!example.roundTrip) {
      roundTripFailed++;
      continue;
    }
    examples.push({
      messages: example.messages,
      testCase,
      meta: {
        ...source.meta,
        id: testCase.id,
        kind: 'single-nohist',
        label: example.confidence,
        historyInVerseButDiffers: false,
        algorithmConfidence: 0,
        algorithmRight: false,
      },
    });
  }
  return { examples, roundTripFailed };
}

/**
 * Counts examples by a key.
 * @param {Array<object>} examples
 * @param {function(object): string} keyOf
 * @returns {Object<string, number>}
 */
function countBy(examples, keyOf) {
  const counts = {};

  for (const example of examples) {
    const key = keyOf(example);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * Builds the fine-tuning data (Steps 2 and 3 of `plans/fine-tune-qwen3.md`) from every training
 * data file and writes `train.jsonl`, `valid.jsonl`, `test.jsonl`, the matching `*.meta.jsonl`
 * (one line per example, same order; `mlx-lm` reads only the first three) and `manifest.json`.
 *
 * - test: every case of a test project that the app sends to the AI (algorithm not certain) and
 *   that passes the round-trip check, with no caps or category filter;
 * - train and valid: cases of the categories trained on, minus the algorithm-certain ones (except
 *   a `certainRightKeep` share of the certain-and-right), the suitability suite's verses, failed
 *   round trips and the `DROP_REASONS`; capped per project and group; train also gets negatives.
 *
 * @param {object} params
 * @param {string} params.dataDir - folder of training data files (`llmTrainingData`)
 * @param {string} params.outDir - output folder (`llmTrainingData/finetune`)
 * @param {Array<object>} [params.realCases] - the suitability suite's real cases, left out of training
 * @param {object} [params.options] - overrides of {@link DEFAULT_BUILD_OPTIONS}
 * @returns {object} - the manifest that was written
 */
export function buildFineTuneData({
  dataDir, outDir, realCases = [], options: overrides = {},
}) {
  const options = { ...DEFAULT_BUILD_OPTIONS, ...overrides };
  const random = makeRandom(options.seed);
  const included = new Set([...BASE_CATEGORIES, ...options.includeCategories]);
  const evalKeys = getEvalCaseKeys(realCases);
  const fileNames = fs.readdirSync(dataDir).filter(name => name.endsWith('.json')).sort();
  const files = fileNames.map(fileName => ({
    fileName,
    file: path.basename(fileName, '.json'),
    project: getTargetProject(fileName),
    testCases: JSON.parse(fs.readFileSync(path.join(dataDir, fileName), 'utf8')),
  }));
  const prompt = { variant: options.promptVariant || '' };

  if (prompt.variant && !PROMPT_VARIANTS[prompt.variant]) {
    throw new Error(`unknown prompt variant "${prompt.variant}"; known: ${Object.keys(PROMPT_VARIANTS).join(', ')}`);
  }

  // the GL verse, for variants that send it (X3, N4, N34); the app's prompt does not use it
  const glVerses = prompt.variant && options.tcHome ?
    addGlVerses(files.flatMap(({ testCases }) => testCases), options.tcHome) : null;
  const answerLengthLimits = getAnswerLengthLimits(files.flatMap(({ testCases }) => testCases));
  const missingAlgorithmResults = [];
  const drops = {};

  const drop = (reason) => {
    drops[reason] = (drops[reason] || 0) + 1;
  };

  const candidates = {
    train: [], valid: [], test: [],
  };
  const versesByFile = new Map();
  const longAnswers = [];
  const contradictsRule3 = [];
  const roundTripFailures = [];

  for (const {
    fileName, file, project, testCases,
  } of files) {
    const algorithm = readAlgorithmTopOptions(dataDir, fileName, testCases);

    if (!algorithm) {
      missingAlgorithmResults.push(fileName);
      continue;
    }

    const reasonsByIndex = new Map(findUnhelpfulTrainingCases(testCases, { answerLengthLimits })
      .map(item => [item.index, item]));
    const fileVerses = [];

    testCases.forEach((testCase, index) => {
      const unhelpful = reasonsByIndex.get(index);
      const reasons = unhelpful?.reasons || [];
      const { reference = {}, groupId = testCase.groupId } = testCase.contextId || {};
      const split = getSplit(project, groupId, options);
      const top = algorithm.get(testCase.id);
      const certain = top.confidence >= ALGORITHM_CERTAIN_CONFIDENCE;
      const algorithmRight = !!top.text && (testCase.expected || []).map(normalizePhrase).includes(normalizePhrase(top.text));
      const category = getCategory(reasons);

      if (split !== 'test') {
        const verseText = testCaseToSelectionOptions(testCase).verseText;
        const verseWords = getWordList(verseText).map(word => normalizeForCompare(word, testCase.targetLang));

        fileVerses.push({
          testCase, verseText, verseWords, split,
        });
      }

      const dropReason = reasons.find(reason => DROP_REASONS.includes(reason));

      if (dropReason) {
        return drop(`${split}:${dropReason}`);
      }

      if (split !== 'test' && evalKeys.has(verseGroupKey(project, reference.chapter, reference.verse, groupId))) {
        return drop(`${split}:suitabilitySuiteVerse`);
      }

      if (certain && (split === 'test' || !algorithmRight)) {
        return drop(`${split}:${algorithmRight ? 'algorithmCertainRight' : 'algorithmCertainWrong'}`);
      }

      if (certain && random() >= options.certainRightKeep) {
        return drop(`${split}:algorithmCertainRight`);
      }

      if (split !== 'test' && !included.has(category)) {
        return drop(`${split}:category:${category}`);
      }

      const longAnswer = reasons.includes('unusuallyLongAnswer');

      if (longAnswer && split !== 'test') {
        longAnswers.push({
          id: testCase.id, file, expected: testCase.expected[0], glPhrase: testCase.glPhrase, ...unhelpful.longAnswer,
        });

        if (options.dropLongAnswers) {
          return drop(`${split}:unusuallyLongAnswer`);
        }
      }

      const example = buildSingleExample(testCase, { ...prompt, algorithmBestSelections: top.bestSelections });

      if (!example.roundTrip) {
        roundTripFailures.push({
          id: testCase.id, file, split, expected: testCase.expected[0], answer: example.answer, decoded: example.decoded,
        });
        return drop(`${split}:roundTripFailed`);
      }

      if (example.historyInVerseButDiffers && split !== 'test') {
        contradictsRule3.push({
          id: testCase.id, file, category, expected: testCase.expected[0], answer: example.answer,
        });
      }

      candidates[split].push({
        messages: example.messages,
        testCase,
        meta: {
          id: testCase.id,
          file,
          project,
          targetLang: testCase.targetLang,
          glLang: testCase.glLang,
          groupId,
          split,
          kind: certain ? 'single-certain' : 'single',
          category,
          label: example.confidence,
          historyInVerseButDiffers: example.historyInVerseButDiffers,
          longAnswer,
          algorithmConfidence: top.confidence,
          algorithmRight,
        },
      });
      return undefined;
    });
    versesByFile.set(file, fileVerses);
  }

  if (missingAlgorithmResults.length) {
    throw new Error(`No algorithm results matching the cases of ${missingAlgorithmResults.join(', ')}: ` +
      'run `npm run run:llm-training-data` (without LLM_TRAINING_URL) first');
  }

  const capped = {
    train: capExamples(candidates.train, options, random),
    valid: capExamples(candidates.valid, options, random),
  };
  const trainVerses = new Map([...versesByFile].map(([file, verses]) => [file, verses.filter(v => v.split === 'train')]));
  const negatives = buildNegativeExamples(capped.train.kept, trainVerses,
    Math.round(capped.train.kept.length * options.negativeShare), random, prompt);
  const noHistory = {
    train: buildNoHistoryExamples(capped.train.kept, options.noHistoryShare, random, prompt),
    valid: buildNoHistoryExamples(capped.valid.kept, options.noHistoryShare, random, prompt),
  };
  const splits = {
    train: shuffle([...capped.train.kept, ...negatives, ...noHistory.train.examples], random),
    valid: [...capped.valid.kept, ...noHistory.valid.examples],
    test: candidates.test,
  };

  fs.mkdirSync(outDir, { recursive: true });

  const toJsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';

  for (const [split, examples] of Object.entries(splits)) {
    const dataFile = path.join(outDir, `${split}.jsonl`);
    const metaFile = path.join(outDir, `${split}.meta.jsonl`);

    if (!examples.length) {
      // an empty split (e.g. no test projects) gets no file: mlx-lm skips a missing split but fails on an empty one
      fs.rmSync(dataFile, { force: true });
      fs.rmSync(metaFile, { force: true });
      continue;
    }
    fs.writeFileSync(dataFile, toJsonl(examples.map(({ messages }) => ({ messages }))));
    fs.writeFileSync(metaFile, toJsonl(examples.map(({ meta }) => meta)));
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    dataDir,
    options,
    counts: Object.fromEntries(Object.entries(splits).map(([split, examples]) => [split, examples.length])),
    capDrops: { train: capped.train.dropped, valid: capped.valid.dropped },
    negatives: negatives.length,
    noHistory: {
      train: noHistory.train.examples.length,
      valid: noHistory.valid.examples.length,
      roundTripFailed: noHistory.train.roundTripFailed + noHistory.valid.roundTripFailed,
    },
    glVerses: glVerses && { added: glVerses.added, missing: glVerses.missing.length },
    drops,
    byProject: Object.fromEntries(Object.entries(splits).map(([split, examples]) =>
      [split, countBy(examples, ({ meta }) => meta.project)])),
    byCategory: Object.fromEntries(Object.entries(splits).map(([split, examples]) =>
      [split, countBy(examples, ({ meta }) => `${meta.kind}:${meta.category}`)])),
    byLabel: Object.fromEntries(Object.entries(splits).map(([split, examples]) =>
      [split, countBy(examples, ({ meta }) => String(meta.label))])),
    byGlLanguage: Object.fromEntries(Object.entries(splits).map(([split, examples]) =>
      [split, countBy(examples, ({ meta }) => meta.glLang)])),
    testFiles: [...new Set(splits.test.map(({ meta }) => meta.file))],
    roundTripFailures,
    unusuallyLongAnswers: longAnswers,
    contradictsRule3,
  };

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
