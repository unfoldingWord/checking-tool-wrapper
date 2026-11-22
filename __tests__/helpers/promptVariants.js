/**
 * Prompt variants for single AI requests, for the experiments of plans/improve-single-prompt.md.
 *
 * Each variant is a builder: it gets the request `getBestTWordSelectionWithConfidenceFromLlm` was
 * given (`wordList`, `targetLangCode`, `glPhrase`, `glLangCode`, `previousTranslationData`,
 * `contextId`, `algorithmBestSelections`, `lmOptions`) and returns `{ messages }`, the chat
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

/** builders by variant id */
export const PROMPT_VARIANTS = {
  baseline: buildBaseline, X1: buildX1, X4: buildX4, X4b: buildX4b, X6: buildX6,
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
