/**
 * Prompt variants for single AI requests, for the experiments of plans/improve-single-prompt.md.
 *
 * Each variant is a builder: it gets the request `getBestTWordSelectionWithConfidenceFromLlm` was
 * given (`wordList`, `targetLangCode`, `glPhrase`, `glLangCode`, `previousTranslationData`,
 * `contextId`, `algorithmBestSelections`, `glVerseText`, `lmOptions`) and returns `{ messages }`, the chat
 * messages to send, without `/no_think` (`queryAiAPI` adds it). `installPromptVariant` puts a
 * variant in place with `setSinglePromptOverrideForEval`, so it goes through the app's own code
 * path (`getBestSelections`), answer parsing included.
 *
 * `baseline` is the app's prompt as it is; a unit test checks it sends exactly what the app sends.
 * Add each variant of the plan here under its id (X1, S3, N1, ...), and record its results in the
 * plan, adopted or not.
 *
 * This folder is in jest's `testPathIgnorePatterns`, so this file is not run as a test.
 */
import {
  buildChatMessages,
  buildTranslationOptionsPrompt,
  cleanGlQuote,
  formatPreviousTranslations,
  setSinglePromptOverrideForEval,
} from '../../src/utils/checkingSuggestionsUtils';

/** the app's single-request system prompt, which the variants edit */
export const APP_SINGLE_SYSTEM_PROMPT = buildTranslationOptionsPrompt('a', 'xx', 'a', 'en', {}).systemPrompt;

/**
 * Applies exact text replacements to a prompt, so a variant is written as its changes to the
 * app's prompt.
 * @param {string} text
 * @param {Array<[string, string]>} replacements - `[old, new]`; each `old` must occur exactly once
 * @returns {string}
 * @throws {Error} when an `old` text is missing or repeated (the app's prompt changed)
 */
export function editPrompt(text, replacements) {
  return replacements.reduce((result, [oldText, newText]) => {
    const count = result.split(oldText).length - 1;

    if (count !== 1) {
      throw new Error(`editPrompt: expected 1 occurrence, found ${count}, of: ${oldText.slice(0, 80)}`);
    }
    return result.replace(oldText, () => newText);
  }, text);
}

/**
 * The request text in the app's layout (`buildTranslationOptionsPrompt`), with the given history
 * lines.
 * @param {object} request - the request given to `getBestTWordSelectionWithConfidenceFromLlm`
 * @param {string} historyLines - history lines joined by `\n`; '' leaves the block out
 * @returns {string}
 */
export function buildRequestText(request, historyLines) {
  const lines = [`\nTARGET VERSE (${request.targetLangCode}): ${request.wordList.join(' ')}`];

  if (historyLines) {
    lines.push(`\nPREVIOUS TRANSLATIONS:\n${historyLines}`);
  }
  lines.push(`\nGATEWAY PHRASE (${request.glLangCode}): ${request.glPhrase}`);
  lines.push('\nAnswer:');
  return lines.join('\n');
}

/**
 * The app's single-request prompt: its system prompt and request text, as two messages.
 * @param {object} request - the request given to `getBestTWordSelectionWithConfidenceFromLlm`
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildBaseline(request) {
  const { systemPrompt, input } = buildTranslationOptionsPrompt(
    request.wordList.join(' '),
    request.targetLangCode,
    request.glPhrase,
    request.glLangCode,
    request.previousTranslationData,
  );
  return { messages: buildChatMessages(systemPrompt, input) };
}

/**
 * X1 system prompt: the app's, with history lines marked against the verse (see `buildX1`). Rule 3
 * and rule 5 refer to the marks, and both examples show the marks the code gives their input:
 * Example 1 loses "las iglesias", which the app never sends next to lines found in the verse, and
 * Example 2's rendering is "Gläubige", which `wordSimilarity` links to "Gläubigen" (it does not
 * link "Glaube").
 */
export const X1_SYSTEM_PROMPT = editPrompt(APP_SINGLE_SYSTEM_PROMPT, [
  [
    'PREVIOUS TRANSLATIONS - how the phrase was translated before, most used first (may be missing).',
    'PREVIOUS TRANSLATIONS - how the phrase was translated before, most used first (may be missing). ' +
      'Each ends with what TARGET VERSE has: "in verse" (all its words are there), "verse has" (the verse ' +
      'words that are another form of it), or "not in verse".',
  ],
  [
    '3. If a previous translation is in TARGET VERSE word for word, it is usually the answer. ' +
      'Copy exactly those words: do not add or drop small words.',
    '3. A previous translation marked "in verse" is usually the answer. Copy exactly its words: do not ' +
      'add or drop small words. If none is "in verse" but one has "verse has", answer with the verse ' +
      'words it shows. Ignore lines marked "not in verse".',
  ],
  [
    '90 or more only when a previous translation is in the verse word for word, 60 to 89 for another ' +
      'form of a previous translation or a clear meaning match',
    '90 or more only for a previous translation marked "in verse", 60 to 89 for one with "verse has" ' +
      'or a clear meaning match',
  ],
  [
    '"iglesia" (chosen 7 times for "church")\n"la iglesia" (chosen 3 times for "the church")\n' +
      '"las iglesias" (chosen 31 time for "the churches")\n',
    '"iglesia" (chosen 7 times for "church") - in verse\n"la iglesia" (chosen 3 times for "the church") - in verse\n',
  ],
  [
    '"Glaube" (chosen 5 times for "faith")\n',
    '"Gläubige" (chosen 5 times for "believer") - verse has "Gläubigen"\n',
  ],
]);

/**
 * X1: each history line ends with what the code found in the verse (`markVerseFit` of
 * `formatPreviousTranslations`), so the model copies instead of searching (weaknesses W3, W4).
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildX1(request) {
  const verse = request.wordList.join(' ');
  const history = formatPreviousTranslations(request.previousTranslationData, request.glPhrase,
    request.glLangCode, verse, request.targetLangCode, { markVerseFit: true });
  return { messages: buildChatMessages(X1_SYSTEM_PROMPT, buildRequestText(request, history)) };
}

/**
 * X4 system prompt: the app's, with a POSSIBLE ANSWERS block (see `buildX4`) described, a sentence
 * on it added to rule 3, and Example 1 showing the block with what the algorithm answers for
 * Example 1's input ("iglesia", then "la iglesia"). Example 2 has no block, since the algorithm
 * gives no option for its input, so the examples also show the block left out.
 */
export const X4_SYSTEM_PROMPT = editPrompt(APP_SINGLE_SYSTEM_PROMPT, [
  [
    'GATEWAY PHRASE - the phrase to find in the verse.',
    'POSSIBLE ANSWERS - verse words a matching program found from the previous translations, best first ' +
      '(may be missing, and may be wrong).\nGATEWAY PHRASE - the phrase to find in the verse.',
  ],
  [
    'Copy exactly those words: do not add or drop small words.',
    'Copy exactly those words: do not add or drop small words. POSSIBLE ANSWERS are often right: check ' +
      'them first, but answer with other verse words when none of them means GATEWAY PHRASE.',
  ],
  [
    '"las iglesias" (chosen 31 time for "the churches")\n\nGATEWAY PHRASE (en): church',
    '"las iglesias" (chosen 31 time for "the churches")\n\nPOSSIBLE ANSWERS:\n"iglesia"\n"la iglesia"\n\n' +
      'GATEWAY PHRASE (en): church',
  ],
]);

/**
 * The algorithm's options as POSSIBLE ANSWERS lines, best first: the words of each option in verse
 * order, without occurrence or confidence.
 * @param {Array<{selections: Array<{text: string}>}>} [options] - `algorithmBestSelections`
 * @returns {string} - lines joined by `\n`, '' when there are none
 */
export function formatPossibleAnswers(options) {
  const texts = (options || []).slice(0, 3)
    .map(option => (option.selections || []).map(selection => selection.text).join(' ').trim())
    .filter(Boolean);
  return [...new Set(texts)].map(text => `"${text}"`).join('\n');
}

/**
 * X4: the algorithm's options (`algorithmBestSelections`, which the AI is asked about only when
 * the algorithm is not certain) as a POSSIBLE ANSWERS block before GATEWAY PHRASE, so the model
 * chooses rather than searches. Left out when the algorithm has none.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildX4(request) {
  const { input } = buildTranslationOptionsPrompt(request.wordList.join(' '), request.targetLangCode,
    request.glPhrase, request.glLangCode, request.previousTranslationData);
  const possible = formatPossibleAnswers(request.algorithmBestSelections);
  const gatewayLine = `\nGATEWAY PHRASE (${request.glLangCode}):`;
  const text = possible ?
    editPrompt(input, [[gatewayLine, `\nPOSSIBLE ANSWERS:\n${possible}\n${gatewayLine}`]]) :
    input;
  return { messages: buildChatMessages(X4_SYSTEM_PROMPT, text) };
}

/**
 * X6 system prompt: the app's, with a TERM line (see `buildX6`) described and shown in both
 * examples, right under GATEWAY PHRASE: Example 1's term is `church`, Example 2's `believe` (the
 * translationWords article for "believers").
 */
export const X6_SYSTEM_PROMPT = editPrompt(APP_SINGLE_SYSTEM_PROMPT, [
  [
    'GATEWAY PHRASE - the phrase to find in the verse.',
    'GATEWAY PHRASE - the phrase to find in the verse.\nTERM - the Bible term the phrase is an example of ' +
      '(a hint to its meaning; may be missing).',
  ],
  ['GATEWAY PHRASE (en): church\n\nAnswer:', 'GATEWAY PHRASE (en): church\nTERM: church\n\nAnswer:'],
  ['GATEWAY PHRASE (en): believers\n\nAnswer:', 'GATEWAY PHRASE (en): believers\nTERM: believe\n\nAnswer:'],
]);

/**
 * X6: the translationWords term of the check (`contextId.groupId`, e.g. `holyplace`) on a TERM
 * line under GATEWAY PHRASE, as a hint to the meaning when the GL phrase is an inflected or
 * idiomatic form. Left out when the check has no group id.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildX6(request) {
  const { input } = buildTranslationOptionsPrompt(request.wordList.join(' '), request.targetLangCode,
    request.glPhrase, request.glLangCode, request.previousTranslationData);
  const term = request.contextId?.groupId;
  const text = term ? editPrompt(input, [['\n\nAnswer:', `\nTERM: ${term}\n\nAnswer:`]]) : input;
  return { messages: buildChatMessages(X6_SYSTEM_PROMPT, text) };
}

/**
 * X4b: X4 only for requests where the algorithm has options; the others get the app's prompt
 * unchanged. X4 lowered the 4B's top-1 without history (34.0% to 30.1% on DEV-NOHIST), where only
 * its system prompt differed, and the 1.7B's and 4B's on DEV requests with no options. The cost is
 * a second fixed system prompt, which the server caches separately.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildX4b(request) {
  return formatPossibleAnswers(request.algorithmBestSelections) ? buildX4(request) : buildBaseline(request);
}

/**
 * The comparison keys of one word of a gateway-language verse: the word cleaned as the app cleans GL
 * quotes (`cleanGlQuote`), lowercased; one word can give several keys ("God’s" gives "god", "s").
 * @param {string} word
 * @returns {Array<string>}
 */
function glWordKeys(word) {
  return cleanGlQuote(word).toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The gateway-language verse with the GL phrase in [brackets], for X3. The braces ULT puts around
 * implied words are removed, and dashes are spaced so words joined by them can be bracketed alone.
 * The phrase (already cleaned with `cleanGlQuote`) is matched word by word against the verse words
 * cleaned the same way, in order with gaps allowed (e.g. for a quote split by "…"), in the shortest
 * stretch of the verse; each run of verse words holding a match is bracketed. When not every phrase
 * word is found, the verse is returned without brackets.
 * @param {string} glVerse - plain verse text (`verseDataToText`)
 * @param {string} glPhrase
 * @returns {{text: string, marked: boolean}}
 */
export function markGlPhraseInVerse(glVerse, glPhrase) {
  const words = (glVerse || '').replace(/[{}]/g, '').replace(/\s*([—–])\s*/g, ' $1 ')
    .split(/\s+/).filter(Boolean);
  // one entry per key, with the index of the verse word it is from
  const keys = words.flatMap((word, wordIndex) => glWordKeys(word).map(key => ({ key, wordIndex })));
  const phraseKeys = (glPhrase || '').split(/[\s…]+/).flatMap(glWordKeys);
  let best = null;

  for (let start = 0; phraseKeys.length && start < keys.length; start++) {
    if (keys[start].key !== phraseKeys[0]) {
      continue;
    }

    const found = [start];

    for (let i = start + 1; i < keys.length && found.length < phraseKeys.length; i++) {
      if (keys[i].key === phraseKeys[found.length]) {
        found.push(i);
      }
    }

    if (found.length === phraseKeys.length) {
      const span = found[found.length - 1] - start;

      if (!best || span < best.span) {
        best = { words: new Set(found.map(i => keys[i].wordIndex)), span };
      }
    }
  }

  if (!best) {
    return { text: words.join(' '), marked: false };
  }

  const text = words.map((word, i) => {
    const inPhrase = best.words.has(i);
    const open = inPhrase && !best.words.has(i - 1) ? '[' : '';
    const close = inPhrase && !best.words.has(i + 1) ? ']' : '';
    return `${open}${word}${close}`;
  }).join(' ');
  return { text, marked: true };
}

/** X3's description of the GATEWAY VERSE line, added after the GATEWAY PHRASE line */
const X3_FIELD = 'GATEWAY VERSE - the same verse in the gateway language, with GATEWAY PHRASE in ' +
  '[brackets] (may be missing). It shows what the phrase means in the verse.';

/** X3's edits to a system prompt: the field described, and both examples given a GATEWAY VERSE */
const X3_EDITS = [
  ['GATEWAY PHRASE - the phrase to find in the verse.', `GATEWAY PHRASE - the phrase to find in the verse.\n${X3_FIELD}`],
  ['GATEWAY PHRASE (en): church\n', 'GATEWAY VERSE (en): to the [church] in Ephesus\nGATEWAY PHRASE (en): church\n'],
  ['GATEWAY PHRASE (en): believers\n', 'GATEWAY VERSE (en): all the [believers] were together\nGATEWAY PHRASE (en): believers\n'],
];

/** X3 system prompt for requests without POSSIBLE ANSWERS: the app's, with the GATEWAY VERSE line */
export const X3_SYSTEM_PROMPT = editPrompt(APP_SINGLE_SYSTEM_PROMPT, X3_EDITS);
/** X3 system prompt for requests with POSSIBLE ANSWERS: X4's, with the GATEWAY VERSE line */
export const X3_X4_SYSTEM_PROMPT = editPrompt(X4_SYSTEM_PROMPT, X3_EDITS);

/**
 * X3: X4b plus the gateway-language verse with the phrase in brackets (`glVerseText` of the
 * request, from the case's `glVerse`), on a GATEWAY VERSE line right before GATEWAY PHRASE, so the
 * model sees what the phrase means in context, above all when there is no history. Left out when
 * the request has no GL verse.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildX3(request) {
  const withOptions = !!formatPossibleAnswers(request.algorithmBestSelections);
  const { messages } = withOptions ? buildX4(request) : buildBaseline(request);

  if (!request.glVerseText) {
    return { messages };
  }

  const { text } = markGlPhraseInVerse(request.glVerseText, request.glPhrase);
  const gatewayLine = `\nGATEWAY PHRASE (${request.glLangCode}):`;
  const user = messages[messages.length - 1];
  const content = editPrompt(user.content, [[gatewayLine, `\nGATEWAY VERSE (${request.glLangCode}): ${text}${gatewayLine}`]]);
  return { messages: buildChatMessages(withOptions ? X3_X4_SYSTEM_PROMPT : X3_SYSTEM_PROMPT, content) };
}

/** X5's edits to a system prompt: the OCCURRENCE line described, with a rule for it */
const X5_EDITS = [
  [
    'GATEWAY PHRASE - the phrase to find in the verse.',
    'GATEWAY PHRASE - the phrase to find in the verse.\nOCCURRENCE - when the phrase comes more than once ' +
      'in the verse, which time this is (2 = the second time; may be missing).',
  ],
  [
    '6. If no words in TARGET VERSE fit',
    '6. When OCCURRENCE is given, answer with the words that translate that occurrence of the phrase.\n' +
      '7. If no words in TARGET VERSE fit',
  ],
  ['7. Do not include reasoning in answer.', '8. Do not include reasoning in answer.'],
  ['8. Answer only as CSV rows', '9. Answer only as CSV rows'],
];

/** X5 system prompt for requests without POSSIBLE ANSWERS */
export const X5_SYSTEM_PROMPT = editPrompt(APP_SINGLE_SYSTEM_PROMPT, X5_EDITS);
/** X5 system prompt for requests with POSSIBLE ANSWERS (X4's) */
export const X5_X4_SYSTEM_PROMPT = editPrompt(X4_SYSTEM_PROMPT, X5_EDITS);

/**
 * Whether a word of the algorithm's options or of the history renderings occurs more than once in
 * the verse (compared lowercased), so the check's occurrence matters.
 * @param {object} request
 * @returns {boolean}
 */
export function hasRepeatedCandidateWord(request) {
  const lower = word => word.toLowerCase();
  const counts = new Map();

  for (const word of request.wordList.map(lower)) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  const optionWords = (request.algorithmBestSelections || [])
    .flatMap(option => (option.selections || []).flatMap(selection => selection.text.split(/\s+/)));
  const historyWords = Object.values(request.previousTranslationData || {})
    .flatMap(renderings => Object.keys(renderings || {}))
    .flatMap(rendering => rendering.split(/\s+/));
  return [...optionWords, ...historyWords].some(word => word && counts.get(lower(word)) > 1);
}

/**
 * X5: X4b plus `OCCURRENCE: n` under GATEWAY PHRASE when the check's `contextId.occurrence` is
 * above 1 and a candidate word repeats in the verse ({@link hasRepeatedCandidateWord}), with a rule
 * to answer with the words for that occurrence. The model cannot give an occurrence (the parser
 * drops `word:n`, and `moveSelectionsToOccurrence` places the answer), so it can only change which
 * words are chosen. Otherwise it is X4b.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildX5(request) {
  const occurrence = request.contextId?.occurrence || 1;

  if (occurrence <= 1 || !hasRepeatedCandidateWord(request)) {
    return buildX4b(request);
  }

  const withOptions = !!formatPossibleAnswers(request.algorithmBestSelections);
  const { messages } = withOptions ? buildX4(request) : buildBaseline(request);
  const user = messages[messages.length - 1];
  const content = editPrompt(user.content, [['\n\nAnswer:', `\nOCCURRENCE: ${occurrence}\n\nAnswer:`]]);
  return { messages: buildChatMessages(withOptions ? X5_X4_SYSTEM_PROMPT : X5_SYSTEM_PROMPT, content) };
}

/**
 * Whether a request has no history (no rendering for any GL key).
 * @param {object} request
 * @returns {boolean}
 */
export function hasNoHistory(request) {
  return !Object.values(request.previousTranslationData || {}).some(renderings => Object.keys(renderings || {}).length);
}

/**
 * N4: X3's GATEWAY VERSE line only for requests with no history, where it helped most (X3 on
 * DEV-NOHIST); every other request is X4b. Without history the algorithm has no options, so N4
 * sends X3's prompt there.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildN4(request) {
  return hasNoHistory(request) ? buildX3(request) : buildX4b(request);
}

/**
 * N1: with no history, `PREVIOUS TRANSLATIONS: none` where the block would be, so the layout
 * matches the examples (the app leaves the block out); with history it is X4b. The system prompt
 * is unchanged.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildN1(request) {
  const { messages } = buildX4b(request);

  if (!hasNoHistory(request)) {
    return { messages };
  }

  const user = messages[messages.length - 1];
  const gatewayLine = `\nGATEWAY PHRASE (${request.glLangCode}):`;
  const content = editPrompt(user.content, [[gatewayLine, `\nPREVIOUS TRANSLATIONS: none\n${gatewayLine}`]]);
  return { messages: buildChatMessages(messages[0].content, content) };
}

/**
 * Whether the request has history but none of its renderings fits the verse, by the app's own
 * verse fit (`formatPreviousTranslations`, which then sends up to 5 lines that do not fit): the
 * `noRelatedWordInHistory` situation.
 * @param {object} request
 * @returns {boolean}
 */
export function hasOnlyUnrelatedHistory(request) {
  if (hasNoHistory(request)) {
    return false;
  }

  const lines = formatPreviousTranslations(request.previousTranslationData, request.glPhrase,
    request.glLangCode, request.wordList.join(' '), request.targetLangCode, { markVerseFit: true });
  return !!lines && lines.split('\n').every(line => line.endsWith(' - not in verse'));
}

/**
 * N6: when no history line fits the verse, the request is sent as if it had no history (X4b's
 * prompt without the PREVIOUS TRANSLATIONS block; any algorithm options are kept); otherwise X4b.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildN6(request) {
  return buildX4b(hasOnlyUnrelatedHistory(request) ? { ...request, previousTranslationData: {} } : request);
}

/** N2's third example: no history, the answer a meaning match at 65, in Swahili (in no eval set) */
export const N2_EXAMPLE = 'Example 3:\nTARGET VERSE (sw): Yesu aliwaponya wagonjwa wengi\n\n' +
  'GATEWAY PHRASE (en): the sick\n\nAnswer:\n"wagonjwa",65\n\n';

/** N2's edit to a system prompt: Example 3 after Example 2, before the wrong answers */
const N2_EDITS = [['Wrong answer for Example 1:', `${N2_EXAMPLE}Wrong answer for Example 1:`]];

/** N2 system prompt for requests without POSSIBLE ANSWERS */
export const N2_SYSTEM_PROMPT = editPrompt(APP_SINGLE_SYSTEM_PROMPT, N2_EDITS);
/** N2 system prompt for requests with POSSIBLE ANSWERS (X4's) */
export const N2_X4_SYSTEM_PROMPT = editPrompt(X4_SYSTEM_PROMPT, N2_EDITS);

/**
 * N2: X4b with a third worked example with no history whose answer is a meaning match at 65, in a
 * language other than the examples' (Swahili). Every request sees it, so it must pass D5 on DEV
 * too; answers repeating its words ("wagonjwa", "Yesu") show copying (W10).
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildN2(request) {
  const withOptions = !!formatPossibleAnswers(request.algorithmBestSelections);
  const { messages } = buildX4b(request);
  return { messages: buildChatMessages(withOptions ? N2_X4_SYSTEM_PROMPT : N2_SYSTEM_PROMPT, messages[1].content) };
}

/**
 * N3's system prompt for requests with no history: the app's layout and output rules, with nothing
 * about previous translations, a confidence ceiling of 70, and examples with no history (Example
 * 1 the app's verse; Example 2 the app's inflected form, now a meaning match; Example 3 N2's).
 */
export const N3_SYSTEM_PROMPT = [
  'You find the words in a Bible verse that translate a phrase.',
  '',
  'You are given:',
  'TARGET VERSE - the words of the verse, in order.',
  'GATEWAY PHRASE - the phrase to find in the verse.',
  '',
  'Rules:',
  '1. Answer only with words copied from TARGET VERSE, spelled exactly as written there.',
  '2. Choose the fewest words that carry the meaning of GATEWAY PHRASE, kept in verse order.',
  '3. Find the verse words with the same meaning as GATEWAY PHRASE. They may be another form of the word, ' +
    'or a different word with that meaning.',
  '4. Give 1 to 3 options, best first, one per line, written as: "words",confidence',
  '5. confidence is a whole number from 0 to 70: 60 to 70 for a clear meaning match, below 60 for a guess.',
  '6. If no words in TARGET VERSE fit, answer: "",0',
  '7. Do not include reasoning in answer.',
  '8. Answer only as CSV rows: no header, no explanation, no markdown fences.',
  '',
  'Required output format:',
  '"word word",confidence',
  '',
  'Example 1:',
  'TARGET VERSE (es-419): para la iglesia de Éfeso',
  '',
  'GATEWAY PHRASE (en): church',
  '',
  'Answer:',
  '"iglesia",70',
  '"la iglesia",55',
  '',
  'Example 2:',
  'TARGET VERSE (de): alle Gläubigen waren zusammen',
  '',
  'GATEWAY PHRASE (en): believers',
  '',
  'Answer:',
  '"Gläubigen",65',
  '',
  'Example 3:',
  'TARGET VERSE (sw): Yesu aliwaponya wagonjwa wengi',
  '',
  'GATEWAY PHRASE (en): the sick',
  '',
  'Answer:',
  '"wagonjwa",65',
  '',
  'Wrong answer for Example 1:',
  '"church",70 - gateway words are not in TARGET VERSE',
  '"congregación",70 - word is not in TARGET VERSE',
  'iglesia,70 - missing the quotes',
].join('\n');

/**
 * N3: a separate fixed system prompt for requests with no history (`N3_SYSTEM_PROMPT`; the server
 * caches it as a second prompt), with the app's request text; X4b otherwise.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildN3(request) {
  const { messages } = buildX4b(request);
  return hasNoHistory(request) ? { messages: buildChatMessages(N3_SYSTEM_PROMPT, messages[1].content) } : { messages };
}

/** N34's edits to N3's prompt: X3's GATEWAY VERSE field, and a GATEWAY VERSE in each example */
const N34_EDITS = [
  ...X3_EDITS,
  ['GATEWAY PHRASE (en): the sick\n', 'GATEWAY VERSE (en): Jesus healed many of [the sick]\nGATEWAY PHRASE (en): the sick\n'],
];

/** N34's system prompt for requests with no history: N3's, with X3's GATEWAY VERSE line */
export const N34_SYSTEM_PROMPT = editPrompt(N3_SYSTEM_PROMPT, N34_EDITS);

/**
 * N3 + N4: for requests with no history, N3's separate system prompt with X3's GATEWAY VERSE line
 * (in the prompt and in the request, as N4 sends it); X4b otherwise.
 * @param {object} request
 * @returns {{messages: Array<{role: string, content: string}>}}
 */
function buildN34(request) {
  if (!hasNoHistory(request)) {
    return buildX4b(request);
  }

  const { messages } = buildX3(request);
  return { messages: buildChatMessages(N34_SYSTEM_PROMPT, messages[messages.length - 1].content) };
}

/*
 * Step 4 variants (S1-S6): instruction length and structure, each on X4b. X4b has two fixed system
 * prompts (the app's, and X4's for requests with POSSIBLE ANSWERS), so each S variant is a function
 * of the system prompt applied to both, plus, for some, a change to the request text.
 */

/**
 * The parts of X4b's prompt for a request.
 * @param {object} request
 * @returns {{system: string, user: string, withOptions: boolean}}
 */
function x4bParts(request) {
  const withOptions = !!formatPossibleAnswers(request.algorithmBestSelections);
  const { messages } = buildX4b(request);
  return {
    system: messages[0].content, user: messages[1].content, withOptions,
  };
}

/**
 * The text of a system prompt between two markers.
 * @param {string} text
 * @param {string} start - included
 * @param {string} end - not included; '' for the end of the text
 * @returns {string}
 * @throws {Error} when a marker is missing
 */
function sliceBetween(text, start, end) {
  const from = text.indexOf(start);
  const to = end ? text.indexOf(end, from) : text.length;

  if (from < 0 || to < 0) {
    throw new Error(`sliceBetween: marker not found: ${from < 0 ? start : end}`);
  }
  return text.slice(from, to);
}

/**
 * The worked examples of a system prompt (not the wrong-answer list), each as its request text in
 * the request layout and its answer rows.
 * @param {string} system
 * @returns {Array<{request: string, answer: string}>}
 */
export function getPromptExamples(system) {
  const section = sliceBetween(system, 'Example 1:\n', '\n\nWrong answer for Example 1:');
  return section.split(/(?:^|\n\n)Example \d+:\n/).filter(Boolean).map(example => {
    const [body, answer] = example.split('\n\nAnswer:\n');
    return { request: `\n${body}\n\nAnswer:`, answer: answer.trim() };
  });
}

/** S5's reminder line, before `Answer:`: the rule broken most (answers not copied from the verse) */
export const S5_REMINDER = 'Answer only with words copied exactly from TARGET VERSE.';

/**
 * S1 system prompt: intro, one line per field, 4 rules, Example 1 only, no wrong-answer list.
 * @param {string} system - the app's or X4's system prompt
 * @returns {string}
 */
function toShortSystemPrompt(system) {
  const withOptions = system.includes('POSSIBLE ANSWERS');
  const fields = sliceBetween(system, 'You are given:\n', '\n\nRules:');
  const example1 = sliceBetween(system, 'Example 1:\n', '\n\nExample 2:');
  const rules = [
    'Rules:',
    '1. Answer only with words copied exactly from TARGET VERSE: the fewest words that mean GATEWAY PHRASE, in verse order.',
    `2. If a previous translation is in TARGET VERSE word for word, answer exactly those words.${withOptions ?
      ' Check POSSIBLE ANSWERS first: they are often right, but may be wrong.' : ''}`,
    '3. Give 1 to 3 options, best first, one per line, as CSV rows only: "words",confidence. If no words fit, answer: "",0',
    '4. confidence is 0 to 100: 90 or more for a previous translation found word for word, 60 to 89 for another ' +
      'form of one or a clear meaning match, below 60 for a guess.',
  ].join('\n');
  return [
    'You find the words in a Bible verse that translate a phrase.', fields, rules,
    example1.replace('Example 1:', 'Example:'),
  ].join('\n\n');
}

/**
 * S2 system prompt: the rules replaced by steps followed in order, each with its confidence range;
 * the rest (fields, output format, examples, wrong answers) as before.
 * @param {string} system
 * @returns {string}
 */
function toProcedureSystemPrompt(system) {
  const withOptions = system.includes('POSSIBLE ANSWERS');
  const rules = sliceBetween(system, 'Rules:\n', '\n\nRequired output format:');
  const steps = [
    'Steps - follow them in order and stop at the first that gives an answer:',
    ...(withOptions ? ['Check POSSIBLE ANSWERS first: they are often right, but answer with other verse words when none of them means GATEWAY PHRASE.'] : []),
    '1. If a previous translation is in TARGET VERSE word for word, answer exactly those words, with confidence 90 or more.',
    '2. Else if a previous translation is in TARGET VERSE as another form of its words, answer those verse words, with confidence 60 to 89.',
    '3. Else answer the fewest verse words that carry the meaning of GATEWAY PHRASE: confidence 60 to 89 for a clear meaning match, below 60 for a guess.',
    '4. If no words in TARGET VERSE fit, answer: "",0',
    '',
    'Always:',
    '- Answer only with words copied from TARGET VERSE, spelled exactly as written there, kept in verse order.',
    '- Give 1 to 3 options, best first, one per line, written as: "words",confidence',
    '- Do not include reasoning in answer.',
    '- Answer only as CSV rows: no header, no explanation, no markdown fences.',
  ].join('\n');
  return editPrompt(system, [[rules, steps]]);
}

/**
 * S4 system prompt: the system prompt without its worked examples (they go in chat turns); the
 * wrong-answer list stays, as rules.
 * @param {string} system
 * @returns {string}
 */
function toRulesOnlySystemPrompt(system) {
  const examples = sliceBetween(system, 'Example 1:\n', 'Wrong answer for Example 1:');
  return editPrompt(system, [[examples, ''], ['Wrong answer for Example 1:', 'Wrong answers for the first example:']]);
}

/** S6's field order: GATEWAY PHRASE, TARGET VERSE, the history, the algorithm's options */
const S6_ORDER = ['GATEWAY PHRASE', 'TARGET VERSE', 'PREVIOUS TRANSLATIONS', 'POSSIBLE ANSWERS'];

/**
 * Puts the blocks of a request text (blocks separated by blank lines, each starting with its
 * label, `Answer:` last) in S6's order.
 * @param {string} text - a request text, starting with `\n`
 * @returns {string}
 */
export function reorderRequestBlocks(text) {
  const blocks = text.replace(/^\n/, '').split('\n\n').filter(Boolean);

  const rank = block => {
    const index = S6_ORDER.findIndex(label => block.startsWith(label));
    return index < 0 ? S6_ORDER.length : index;
  };

  const sorted = blocks.map((block, index) => ({ block, index }))
    .sort((a, b) => (rank(a.block) - rank(b.block)) || (a.index - b.index));
  return `\n${sorted.map(({ block }) => block).join('\n\n')}`;
}

/**
 * S6 system prompt: the field list and the examples in S6's order.
 * @param {string} system
 * @returns {string}
 */
function toReorderedSystemPrompt(system) {
  const fields = sliceBetween(system, 'You are given:\n', '\n\nRules:');
  const lines = fields.split('\n').slice(1);
  const rank = line => S6_ORDER.findIndex(label => line.startsWith(label));
  const reorderedFields = ['You are given:', ...[...lines].sort((a, b) => rank(a) - rank(b))].join('\n');
  const edits = [[fields, reorderedFields]];

  for (const { request } of getPromptExamples(system)) {
    const body = request.slice(1, -'\n\nAnswer:'.length);
    edits.push([body, reorderRequestBlocks(`\n${body}`).slice(1)]);
  }
  return editPrompt(system, edits);
}

/** S1-S6 system prompts, for requests without and with POSSIBLE ANSWERS */
export const S_SYSTEM_PROMPTS = Object.fromEntries([
  ['S1', toShortSystemPrompt], ['S2', toProcedureSystemPrompt], ['S4', toRulesOnlySystemPrompt],
  ['S6', toReorderedSystemPrompt],
].map(([id, transform]) => [id, { plain: transform(APP_SINGLE_SYSTEM_PROMPT), options: transform(X4_SYSTEM_PROMPT) }]));

/**
 * A builder that sends X4b's request text with one of S_SYSTEM_PROMPTS.
 * @param {string} id
 * @returns {function(object): {messages: Array<object>}}
 */
function withSystemPrompt(id) {
  return request => {
    const { user, withOptions } = x4bParts(request);
    const prompts = S_SYSTEM_PROMPTS[id];
    return { messages: buildChatMessages(withOptions ? prompts.options : prompts.plain, user) };
  };
}

/**
 * S3: no system message; X4b's system prompt and request text in one user message (`/no_think`
 * then goes only at its start).
 * @param {object} request
 * @returns {{messages: Array<object>}}
 */
function buildS3(request) {
  const { system, user } = x4bParts(request);
  return { messages: [{ role: 'user', content: `${system.trimEnd()}\n${user}` }] };
}

/**
 * S4: the worked examples as chat turns (each example's request as a user turn, its answer as an
 * assistant turn) after a system prompt with the rules only, then the real request.
 * @param {object} request
 * @returns {{messages: Array<object>}}
 */
function buildS4(request) {
  const {
    system, user, withOptions,
  } = x4bParts(request);
  const turns = getPromptExamples(system).flatMap(example => [
    { role: 'user', content: example.request },
    { role: 'assistant', content: example.answer },
  ]);
  const prompts = S_SYSTEM_PROMPTS.S4;
  return {
    messages: [
      { role: 'system', content: withOptions ? prompts.options : prompts.plain },
      ...turns,
      { role: 'user', content: user },
    ],
  };
}

/**
 * S5: X4b with a reminder line ({@link S5_REMINDER}) right before `Answer:`.
 * @param {object} request
 * @returns {{messages: Array<object>}}
 */
function buildS5(request) {
  const { system, user } = x4bParts(request);
  return { messages: buildChatMessages(system, editPrompt(user, [['\n\nAnswer:', `\n\n${S5_REMINDER}\nAnswer:`]])) };
}

/**
 * S6: X4b with GATEWAY PHRASE first, then TARGET VERSE, the history and the options, so the evidence
 * is right before `Answer:`; the field list and examples of the system prompt in the same order.
 * @param {object} request
 * @returns {{messages: Array<object>}}
 */
function buildS6(request) {
  const { user, withOptions } = x4bParts(request);
  const prompts = S_SYSTEM_PROMPTS.S6;
  return { messages: buildChatMessages(withOptions ? prompts.options : prompts.plain, reorderRequestBlocks(user)) };
}

/** builders by variant id */
/*
 * Span variants of plans/prompt-span-experiments.md (Step 3): C0 (rule 2 deleted, diagnostic),
 * C1 (rule 2 covers the whole phrase), C2 (C1 + a multi-word example), C5 (C1 + an example of one
 * GL word rendered by several target words), C3 (history lines for another GL key marked), and
 * C13/C23/C53 (C3 combined with C1, C2 or C5; Step 3 runs only the one of the best part).
 */

const APP_RULE_2 = '2. Choose the fewest words that carry the meaning of GATEWAY PHRASE, kept in verse order.\n';

/** C1's rule 2: the verse words for all of the phrase, small words included, and no others */
export const C1_RULE_2 = '2. Choose the verse words that translate all of GATEWAY PHRASE, including any small words in it, ' +
  'and no other words. Keep them in verse order.\n';

/** the end of Example 2 in the app's prompt, after which C2 and C5 put their Example 3 */
const EXAMPLE_2_END = '"Gläubigen",75\n';

/** C2's Example 3: a multi-word GL phrase whose history covers only part of it */
export const C2_EXAMPLE_3 = `
Example 3:
TARGET VERSE (de): wir beten für die Gemeinde in Rom

PREVIOUS TRANSLATIONS:
"Gemeinde" (chosen 6 times for "church")

GATEWAY PHRASE (en): for the church

Answer:
"für die Gemeinde",80
`;

/**
 * C5's Example 3: one GL word (Russian genitive "of the king") that the target language says with
 * several words. NEW-DEV's errors have this pattern (English targets, Russian or Arabic GL), but
 * none of its words.
 */
export const C5_EXAMPLE_3 = `
Example 3:
TARGET VERSE (en): they went into the house of the king

PREVIOUS TRANSLATIONS:
"king" (chosen 4 times for "царь")

GATEWAY PHRASE (ru): царя

Answer:
"of the king",80
`;

/** C0 system prompt: the app's without rule 2, the later rules renumbered */
export const C0_SYSTEM_PROMPT = editPrompt(APP_SINGLE_SYSTEM_PROMPT, [
  [APP_RULE_2, ''],
  ...[3, 4, 5, 6, 7, 8].map(n => [`\n${n}. `, `\n${n - 1}. `]),
]);

/** C1 system prompt: the app's with C1's rule 2 */
export const C1_SYSTEM_PROMPT = editPrompt(APP_SINGLE_SYSTEM_PROMPT, [[APP_RULE_2, C1_RULE_2]]);

/** C2 system prompt: C1's with C2's Example 3 */
export const C2_SYSTEM_PROMPT = editPrompt(C1_SYSTEM_PROMPT, [[EXAMPLE_2_END, EXAMPLE_2_END + C2_EXAMPLE_3]]);

/** C5 system prompt: C1's with C5's Example 3 */
export const C5_SYSTEM_PROMPT = editPrompt(C1_SYSTEM_PROMPT, [[EXAMPLE_2_END, EXAMPLE_2_END + C5_EXAMPLE_3]]);

/** the mark C3 puts on a history line for another GL key (`markOtherKey` of `formatPreviousTranslations`) */
const OTHER_KEY_MARK = ' - for another phrase';

/**
 * C3's edits of a system prompt: the PREVIOUS TRANSLATIONS line explains the mark, and every
 * example history line for another GL key shows it, as the code marks it (`markOtherKey`).
 * @param {string} prompt - the app's prompt, or C1's, C2's or C5's
 * @returns {string}
 */
export function withOtherKeyMarks(prompt) {
  const lines = [
    '"la iglesia" (chosen 3 times for "the church")',
    '"las iglesias" (chosen 31 time for "the churches")',
    '"Glaube" (chosen 5 times for "faith")',
    '"Gemeinde" (chosen 6 times for "church")',
    '"king" (chosen 4 times for "царь")',
  ].filter(line => prompt.includes(`${line}\n`));

  return editPrompt(prompt, [
    [
      'PREVIOUS TRANSLATIONS - how the phrase was translated before, most used first (may be missing).',
      'PREVIOUS TRANSLATIONS - how the phrase was translated before, most used first (may be missing). ' +
        `A line marked "${OTHER_KEY_MARK.slice(3)}" was chosen for a different phrase than GATEWAY PHRASE, ` +
        'so the answer may need more or fewer verse words.',
    ],
    ...lines.map(line => [`${line}\n`, `${line}${OTHER_KEY_MARK}\n`]),
  ]);
}

/**
 * A builder that sends the app's request text with the given system prompt.
 * @param {string} systemPrompt
 * @param {object} [historyOptions] - options for `formatPreviousTranslations`, e.g. `{ markOtherKey: true }`
 * @returns {function(object): {messages: Array<{role: string, content: string}>}}
 */
function withSpanPrompt(systemPrompt, historyOptions = {}) {
  return request => {
    const history = formatPreviousTranslations(request.previousTranslationData, request.glPhrase,
      request.glLangCode, request.wordList.join(' '), request.targetLangCode, historyOptions);
    return { messages: buildChatMessages(systemPrompt, buildRequestText(request, history)) };
  };
}

export const SPAN_SYSTEM_PROMPTS = {
  C0: C0_SYSTEM_PROMPT,
  C1: C1_SYSTEM_PROMPT,
  C2: C2_SYSTEM_PROMPT,
  C5: C5_SYSTEM_PROMPT,
  C3: withOtherKeyMarks(APP_SINGLE_SYSTEM_PROMPT),
  C13: withOtherKeyMarks(C1_SYSTEM_PROMPT),
  C23: withOtherKeyMarks(C2_SYSTEM_PROMPT),
  C53: withOtherKeyMarks(C5_SYSTEM_PROMPT),
};

const SPAN_VARIANTS = Object.fromEntries(Object.entries(SPAN_SYSTEM_PROMPTS).map(([id, prompt]) =>
  [id, withSpanPrompt(prompt, ['C3', 'C13', 'C23', 'C53'].includes(id) ? { markOtherKey: true } : {})]));

export const PROMPT_VARIANTS = {
  baseline: buildBaseline, X1: buildX1, X3: buildX3, X4: buildX4, X4b: buildX4b, X5: buildX5, X6: buildX6, N1: buildN1, N2: buildN2, N3: buildN3, N4: buildN4, N34: buildN34, S1: withSystemPrompt('S1'), S2: withSystemPrompt('S2'), S3: buildS3, S4: buildS4, S5: buildS5, S6: buildS6, N6: buildN6, ...SPAN_VARIANTS,
};

/**
 * Makes single AI requests use a variant's prompt until the returned function is called.
 * @param {string} id - a key of {@link PROMPT_VARIANTS}
 * @returns {function(): void} - puts the app's prompt back
 * @throws {Error} for an unknown id
 */
export function installPromptVariant(id) {
  const builder = PROMPT_VARIANTS[id];

  if (!builder) {
    throw new Error(`unknown prompt variant "${id}"; known: ${Object.keys(PROMPT_VARIANTS).join(', ')}`);
  }
  setSinglePromptOverrideForEval(builder);
  return () => setSinglePromptOverrideForEval(null);
}

/**
 * The variant named by `LLM_PROMPT_VARIANT`, checked, or '' when it is not set (the app's prompt,
 * with no override).
 * @param {object} [env=process.env]
 * @returns {string}
 * @throws {Error} for an unknown id
 */
export function getPromptVariantFromEnv(env = process.env) {
  const id = (env.LLM_PROMPT_VARIANT || '').trim();

  if (id && !PROMPT_VARIANTS[id]) {
    throw new Error(`unknown LLM_PROMPT_VARIANT "${id}"; known: ${Object.keys(PROMPT_VARIANTS).join(', ')}`);
  }
  return id;
}
