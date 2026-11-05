/* eslint-env jest */
import fs from 'fs-extra';
import path from 'path-extra';
import Lexer from 'wordmap-lexer';
import { normalizer } from 'string-punctuation-tokenizer';
import { isBibleBookId, isNT } from '../common/booksOfTheBible';
import {
  getDetailsFromProjectNameMini,
  getMostRecentVersionInFolderMajor,
  readHelpsFolder,
  readJsonFile,
} from '../helpers/fileHelpers';
import * as gatewayLanguageHelpers from '../helpers/gatewayLanguageHelpers';

const AI_API_URL = 'http://192.168.142.70:1234';
/** most previous-translation entries sent in an AI prompt, strongest evidence first */
const MAX_PROMPT_PREVIOUS_TRANSLATIONS = 20;

/**
 * Identifies one check in a checking tool. The same shape is used for the current check
 * (`state.tool.contextId`) and for the `contextId` saved with each check record in
 * `.apps/translationCore/index/{toolName}/{bookId}/{groupId}.json`.
 * The same typedef is in `src/helpers/gatewayLanguageHelpers.js`; keep both in sync.
 *
 * @typedef {object} ContextId
 * @property {object} reference - where the check is
 * @property {string} reference.bookId - book id (e.g. 'tit')
 * @property {number|string} reference.chapter - chapter number; sometimes saved as a string
 *   (e.g. '12')
 * @property {number|string} reference.verse - verse number. It can also be a string: a number
 *   (e.g. '1'), 'front' for a chapter introduction, or a verse range (e.g. '3-4')
 * @property {string} tool - checking tool name (e.g. 'translationWords', 'translationNotes')
 * @property {string} groupId - check group id: a translationWords entry (e.g. 'humble') or a
 *   translationNotes category (e.g. 'figs-metaphor')
 * @property {string} [checkId] - short id of the check from the helps TSV (e.g. 'xrq8')
 * @property {string|Array<{word: string, occurrence: number}>} [quote] - original-language
 *   words being checked. translationWords usually uses a single string (e.g. 'πραΰτητα').
 *   translationNotes usually uses an array of words, each with its occurrence in the verse,
 *   including separators such as '־'.
 * @property {string} [quoteString] - `quote` as a single string
 * @property {number} [occurrence] - which occurrence of `quote` in the verse this check is for
 *   (1-based)
 * @property {string} [glQuote] - gateway-language quote from the helps TSV; often `''`
 * @property {string} [occurrenceNote] - note text for this check (translationNotes); `''` for
 *   translationWords
 * @property {string} [verseSpan] - verse range when the check spans verses (e.g. '3-4'); same
 *   as `reference.verse`
 * @example
 * // translationWords
 * {
 *   checkId: 'xrq8',
 *   occurrenceNote: '',
 *   reference: { bookId: 'tit', chapter: 3, verse: 2 },
 *   tool: 'translationWords',
 *   groupId: 'humble',
 *   quote: 'πραΰτητα',
 *   quoteString: 'πραΰτητα',
 *   glQuote: '',
 *   occurrence: 1,
 * }
 * @example
 * // translationNotes, spanning two verses
 * {
 *   checkId: 'whh9',
 *   occurrenceNote: 'If it would be more natural in your language, ...',
 *   reference: { bookId: 'jos', chapter: 3, verse: '3-4' },
 *   tool: 'translationNotes',
 *   groupId: 'figs-infostructure',
 *   quote: [{ word: 'אַֽל', occurrence: 1 }, { word: '־', occurrence: 1 }, ...],
 *   quoteString: '...',
 *   glQuote: '',
 *   occurrence: 1,
 *   verseSpan: '3-4',
 * }
 */

//////////////////////////////
// Testing Support functions
//////////////////////////////

/**
 * Streams a chat completion request to an LM Studio server and accumulates the response.
 *
 * This function sends a POST request to the OpenAI-compatible chat completions endpoint with streaming
 * enabled, then reads the Server-Sent Events (SSE) stream to accumulate the full response text.
 * It handles both standard content and reasoning content (thinking mode) from the AI model.
 *
 * The function processes the SSE stream line by line, parsing JSON chunks and extracting text
 * from either `delta.content` or `delta.reasoning_content` fields. It accumulates partial lines
 * in a buffer to handle chunks that arrive split across multiple reads.
 *
 * @param {object} options - Configuration options for the chat completion request
 * @param {string} [options.apiToken] - Bearer token sent as the `Authorization` header when set
 * @param {string} options.baseUrl - Base URL of the OpenAI-compatible server (e.g., 'http://localhost:1234')
 * @param {string} options.model - Model identifier as configured in OpenAI-compatible (e.g., 'local-model')
 * @param {string} options.systemPrompt - System prompt that sets the AI's behavior and context
 * @param {string} options.query - User query/prompt to send to the model
 * @param {number} options.temperature - Sampling temperature (0.0-1.0); higher values increase randomness
 * @param {number} options.maxTokens - Maximum number of tokens to generate in the response
 * @param {boolean} options.enable_thinking - Whether to enable thinking mode via chat_template_kwargs
 * @returns {Promise<{replyText: string, reasoningText: string, actualModel: string}>} Object containing:
 *   - replyText: Complete accumulated answer text from the model, or its reasoning text when
 *     the model gave no separate answer
 *   - reasoningText: Complete accumulated reasoning text from the model
 *   - actualModel: Actual model name reported by the server (may differ from requested model)
 * @throws {Error} If the server is unreachable, returns a non-OK status, or the response is malformed
 * @example
 * const result = await streamChatMessage({
 *   baseUrl: 'http://localhost:1234',
 *   model: 'local-model',
 *   systemPrompt: 'You are a helpful assistant.',
 *   query: 'What is the capital of France?',
 *   temperature: 0.7,
 *   maxTokens: 2048,
 *   enable_thinking: false,
 * });
 * console.log(result.replyText); // "The capital of France is Paris."
 *
 * @see {@link queryAiAPI} - Higher-level wrapper function that calls this internally
 */
async function streamChatMessage(options) {
  const {
    apiToken, baseUrl, model, systemPrompt, query, temperature, maxTokens, enable_thinking,
  } = options;
  const url = `${baseUrl}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  let response;

  if (apiToken) { // hosted OpenAI-compatible servers require a bearer token
    headers.Authorization = `Bearer ${apiToken}`;
  }

  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: true,
        chat_template_kwargs: { enable_thinking },
      }),
    });
  } catch (error) {
    const message1 = `Failed to reach OpenAI-compatible server at ${url}: ${error.message}`;
    console.error(message1);
    throw new Error(message1);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const message = `AI request failed (${response.status}): ${errorText}`;
    throw new Error(message);
  }

  // Read the SSE stream and accumulate the full response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let replyText = '';
  let reasoningText = '';
  let buffer = '';
  let actualModel = '';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();

    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep incomplete last line in buffer

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || !trimmed.startsWith('data: ')) {
        continue;
      }

      const dataStr = trimmed.slice(6);

      if (dataStr === '[DONE]') {
        break;
      }

      try {
        const chunk = JSON.parse(dataStr);
        actualModel = actualModel || chunk?.model || '';
        const delta = chunk?.choices?.[0]?.delta;

        if (delta?.content) {
          replyText += delta.content;
        }

        // reasoning is kept apart so it does not get mixed into the answer
        const reasoning = delta?.reasoning_content || delta?.reasoning;

        if (reasoning) {
          reasoningText += reasoning;
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }
  // a model that put everything in its reasoning still gets parsed
  return {
    replyText: replyText, reasoningText, actualModel,
  };
}

/**
 * Sends a text query to a locally running OpenAI-compatible server and returns the model's response text
 * along with timing information.
 *
 * This function provides a unified interface for querying AI models through OpenAI-compatible, supporting
 * both Electron-based desktop applications and web-based environments. LM Studio exposes an
 * OpenAI-compatible API (chat completions endpoint) once "Local Server" is started from the
 * OpenAI-compatible app (default port 1234).
 *
 * The function automatically detects the execution environment:
 * - In Electron apps: uses the IPC bridge (window.AiAPIs.query) for optimized performance
 * - In web/Node environments: makes direct HTTP requests via streamChatMessage
 *
 * Thinking mode control:
 * When `enable_thinking` is false, the function appends '/no_think' to the query to disable
 * the model's chain-of-thought reasoning output, which can reduce response verbosity for
 * simple queries.
 *
 * @param {string} query - The text prompt/question to send to the model
 * @param {object} [options={}] - Optional configuration overrides
 * @param {string} [options.apiToken] - Bearer token sent as the `Authorization` header when set
 * @param {string} [options.baseUrl='http://localhost:1234'] - Base URL of the OpenAI-compatible server;
 *   defaults to AI_API_URL constant
 * @param {string} [options.model='local-model'] - Model identifier as loaded in OpenAI-compatible; the actual
 *   model used may differ and will be reported in the response
 * @param {number} [options.temperature=0.7] - Sampling temperature (0.0-1.0); higher values increase
 *   randomness and creativity, lower values make output more deterministic
 * @param {number} [options.maxTokens=4096] - Maximum number of tokens to generate in the response;
 *   longer responses may be truncated
 * @param {boolean} [options.enable_thinking=false] - Whether to enable thinking mode in chat template;
 *   when false, '/no_think' is appended to the query
 * @param {string} [options.systemPrompt='You are a helpful assistant.'] - System prompt that sets the
 *   AI's behavior and context for the conversation
 * @returns {Promise<{response: string, elapsedStr: string, model: string}>} Object containing:
 *   - **response**: The complete text of the model's reply
 *   - **elapsedStr**: Elapsed time in seconds as a string with 2 decimal places (e.g., "2.35")
 *   - **model**: The actual model name used by the server (may differ from the requested model identifier)
 * @throws {Error} If the server is unreachable, returns an error status, or the response is empty
 * @example
 * // Basic usage with defaults
 * const { response, elapsedStr, model } = await queryAiAPI('What is the capital of France?');
 * console.log(response); // "The capital of France is Paris."
 * console.log(elapsedStr); // "1.23"
 * console.log(model); // "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF"
 *
 * @example
 * // Custom configuration
 * const result = await queryAiAPI('Explain quantum physics', {
 *   temperature: 0.9,
 *   maxTokens: 2048,
 *   enable_thinking: true,
 *   systemPrompt: 'You are a physics professor.'
 * });
 * console.log(`Response took ${result.elapsedStr}s using ${result.model}`);
 *
 * @see {@link streamChatMessage} - Lower-level function for direct HTTP streaming
 * @see {@link getBestTWordSelectionWithConfidenceFromLlm} - Example usage in translation workflows
 */
export async function queryAiAPI(query, options = {}) {
  const {
    apiToken,
    // baseUrl = 'http://localhost:1234',
    baseUrl = AI_API_URL, // use local server
    model = 'local-model',
    temperature = 0.7,
    maxTokens = 4096,
    enable_thinking = false,
    systemPrompt = 'You are a helpful assistant.',
  } = options;
  const startTime = Date.now();

  const finalQuery = enable_thinking ? query : `/no_think\n${query}`;
  const finalSystemPrompt = enable_thinking ? systemPrompt : `/no_think\n${systemPrompt}`;

  let replyText_ = null;
  let reasoningText_ = null;
  let actualModel_ = null;

  const lmQueryOptions = {
    apiToken,
    baseUrl,
    enable_thinking,
    maxTokens,
    model,
    query: finalQuery,
    systemPrompt: finalSystemPrompt,
    temperature,
  };

  const isAiAPIQueryAvailable =
    typeof window !== 'undefined' &&
    typeof window.AiAPIs?.query === 'function';

  // console.log('queryAiAPI - starting fetch isAiAPIQueryAvailable', isAiAPIQueryAvailable);
  let error = false;

  if (isAiAPIQueryAvailable) { // calling Electron process
    try {
      const answer = await window.AiAPIs.query(query, lmQueryOptions);
      // console.log(answer);
      replyText_ = answer.replyText || answer.reasoningText;
      reasoningText_ = answer.reasoningText;
      actualModel_ = answer.actualModel;
      error = answer.error;
    } catch (e) {
      console.error(`queryAiAPI - window.AiAPIs.query error`, e);
      error = true;
    }
  } else { // no electron process
    try {
      const {
        replyText,
        reasoningText,
        actualModel,
      } = await streamChatMessage(lmQueryOptions);
      replyText_ = replyText || reasoningText;
      reasoningText_ = reasoningText;
      actualModel_ = actualModel;
    } catch (e) {
      console.error(`queryAiAPI - streamChatMessage error`, e);
      error = true;
    }
  }

  const elapsedStr = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(
    `Query using model "${actualModel_ || model}" took ${elapsedStr}s, response`,
    { replyText_, reasoningText_ }
  );

  if (error || !replyText_) {
    const message = `Unexpected OpenAI-compatible response shape: received error or empty content`;
    console.warn(`${message}, response`, { replyText_, reasoningText_ });
    throw new Error(message);
  }

  return {
    response: replyText_,
    reasoningText: reasoningText_,
    elapsedStr,
    model: actualModel_ || model,
  };
}

/**
 * Filters and extracts sorted model identifiers from a list of model objects.
 *
 * Evaluates model entries from an OpenAI-compatible or LM Studio models endpoint,
 * retaining objects that possess a valid `id` (either explicitly typed as `'model'`
 * or lacking an `object` type specifier), and returns their IDs sorted alphabetically.
 *
 * @param {Array<object>} models - Array of raw model objects from the API response
 * @returns {Array<string>} Alphabetically sorted array of model ID strings
 */
function extractModels(models) {
  // filter response by model objects
  // {id: 'liquid/lfm2-24b-a2b', object: 'model', owned_by: 'organization_owner'}
  return models.filter(model => {
    let validModel = model.object === 'model' && model.id; // LmStudio format

    if (!validModel) {
      validModel = !model.object && model.id;
    }
    return validModel;
  }).map(model => (model.id)).sort();
}

/**
 * Queries a running OpenAI-compatible server for the list of available AI models.
 * LM Studio exposes an OpenAI-compatible models endpoint once "Local Server" is started.
 *
 * @param {object} [options] - optional overrides
 * @param {string} [options.baseUrl='http://localhost:1234'] - base URL of the OpenAI-compatible server
 * @returns {Promise<Array<string>>} - available model identifiers returned by OpenAI-compatible
 * @throws {Error} - if the server is unreachable or returns an error status
 * @example
 * const models = await queryAiAPIModels();
 * console.log(models.map(model => model.id));
 */
export async function queryAiAPIModels(options = {}) {
  const {
    // baseUrl = 'http://localhost:1234',
    baseUrl = AI_API_URL,
  } = options;

  const url = `${baseUrl}/v1/models`;
  let response;

  const isAiAPIModelsAvailable =
    typeof window !== 'undefined' &&
    typeof window.AiAPIs?.query === 'function';

  // console.log('isAiAPIModelsAvailable', isAiAPIModelsAvailable);
  let answer;

  if (isAiAPIModelsAvailable) { // calling Electron process
    try {
      const llmOptions = { ...options, baseUrl };
      answer = await window.AiAPIs.getAvailableModels(llmOptions);
      // console.log('getAvailableModels answer', answer);
    } catch (error) {
      const message = `Failed to reach OpenAI-compatible server at ${url}: ${error.message}`;
      console.error(message);
      throw new Error(message);
    }
  } else {
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = `Failed to reach OpenAI-compatible server at ${url}: ${error.message}`;
      console.error(message);
      throw new Error(message);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const message = `AI models request failed (${response.status}): ${errorText}`;
      throw new Error(message);
    }

    answer = await response.json();
  }

  let models = answer;

  if (!Array.isArray(models)) {
    const message = 'Unexpected OpenAI-compatible models response shape';
    console.log(message, answer);
    throw new Error(message);
  }
  models = extractModels(models);
  return models;
}

/**
 * Builds the AI prompt for matching a gateway language phrase to the
 * best corresponding word(s) in a target-language verse, returning
 * results as CSV rows of `"word:occurrence ..."`,confidence.
 *
 * @param {string} verseContent - the target-language verse text
 * @param {string} targetLangCode - language code of the verse (e.g. 'es-419')
 * @param {string} phrase - gateway language phrase to match (e.g. 'your old age')
 * @param {string} phraseLangCode - language code of the phrase (e.g. 'en')
 * @returns {{systemPrompt: string, query: string}} - object containing systemPrompt and query text
 */
export function buildVerseMatchPrompt(verseContent, targetLangCode, phrase, phraseLangCode) {
  const systemPrompt = `You are an expert in biblical linguistics and cross-language word alignment.

Your task is to locate the exact word token(s) in the TARGET VERSE that correspond semantically to the GATEWAY PHRASE.

CRITICAL RULE:
You must NEVER output the gateway phrase, a translation of the gateway phrase, or any word that does not occur exactly in the TARGET VERSE.
The "matched words" field must contain only exact word forms copied from the TARGET VERSE.

Definitions:
- TARGET VERSE: the verse text provided by the user under "Target Verse".
- GATEWAY PHRASE: the source phrase provided by the user under "Gateway Phrase".
- Your answer must identify the TARGET VERSE word(s) that express the meaning of the GATEWAY PHRASE.

Instructions:
1. Treat the TARGET VERSE and GATEWAY PHRASE as literal text, including quotation marks, punctuation, or special characters.
2. Tokenize only the TARGET VERSE into words in reading order.
3. Strip surrounding punctuation from target-verse tokens, including quotation marks, but preserve the original spelling, accents, and casing of each word.
4. Analyze the semantic meaning of the GATEWAY PHRASE.
5. Find the exact TARGET VERSE word(s) that best correspond to that meaning.
6. The match may be one word or multiple words. Prefer the tightest/closest grouping when equally valid.
7. Copy each matched word exactly as it appears in the TARGET VERSE, keeping its accents and casing.
8. If multiple TARGET VERSE words are matched, join them with a single space, for example: tu vejez.
9. Before answering, verify that every matched word appears exactly as a token in the TARGET VERSE.
10. If any proposed matched word comes from the GATEWAY PHRASE instead of the TARGET VERSE, discard it and find the corresponding TARGET VERSE word instead.
11. If more than one plausible matching set of target-verse words exists, output each candidate as its own CSV row, ordered from highest to lowest confidence.
12. "confidence level" is an integer 0-100 reflecting certainty that the match is correct in context.
13. If no reasonable match exists in the TARGET VERSE, output a single row with an empty "matched words" field and confidence level 0.
14. Output ONLY the CSV data, with no header row. No commentary, no markdown fences, no extra text.

Required output format:
"word word",confidence

Output requirements:
- The first CSV field, "matched words", must contain only exact word forms copied from the TARGET VERSE, separated by spaces.
- Do NOT add a colon or number to any word.
- Do NOT output bare words without quotes.
- Do NOT output the gateway phrase in the "matched words" field.
- Do NOT output an English phrase unless that exact English word appears in the TARGET VERSE.
- Do NOT translate, paraphrase, summarize, or alter target-verse word forms.
- The second CSV field, "confidence level", must be a plain integer with no quotes.
- Wrap only the matched words field in double quotes.
- Do not output a CSV header row.

Correct output example:
If the TARGET VERSE contains:
\`porque tu nuera sustentador de tu vejez\`

And the GATEWAY PHRASE is:
\`your old age\`

A valid answer is:
"tu vejez",95

Invalid answers:
vejez,95
"tu vejez","95"
"tu:6 vejez:7",95
`;

  const query = `Target Verse language: ${targetLangCode}

Target Verse:
\`\`\`
${verseContent}
\`\`\`

Gateway Phrase language: ${phraseLangCode}

Gateway Phrase:
\`\`\`
${phrase}
\`\`\``;

  return { systemPrompt, query };
}

/**
 * Normalizes a word for loose comparison. `normalizer` leaves case alone, and matching a
 * rendering against a verse word has to survive that word being capitalized at the start
 * of the verse, so lowercasing is added. Accents stay significant: a rendering differing by
 * an accent is a different word form, and `normalizer` does not fold accents either.
 *
 * @param {string} word
 * @returns {string}
 */
export function normalizeForCompare(word) {
  return normalizer(word || '').toLowerCase();
}

/**
 * Formats and filters previous translation data for AI prompt inclusion.
 *
 * This function processes historical translation data to prepare it for use in AI prompts.
 * It performs two levels of filtering to provide the most relevant previous translations:
 *
 * 1. **Verse-level filtering**: For each gateway-language phrase, it filters to include only
 *    target-language renderings whose words all appear in the current verse. This ensures
 *    the AI only considers renderings that are actually possible given the verse's vocabulary.
 *
 * 2. **Phrase-level filtering** (optional): When `filter` is true, it further narrows results
 *    to only include gateway-language phrases whose words are all present in `glPhrase`. This
 *    helps focus on the most relevant translation history when the gateway phrase is a subset
 *    of previous phrases.
 *
 * The function normalizes all words for comparison using case-insensitive, punctuation-free
 * matching, ensuring that capitalization and punctuation differences don't prevent matches.
 *
 * After filtering, entries are sorted by usage count (descending) to prioritize the most
 * frequently used translations, helping the AI make suggestions based on strongest evidence.
 *
 * @param {object} previousTranslationData - Prior translation history in nested format
 *   `{glPhrase: {targetRendering: count}}` or flat format `{targetRendering: count}`
 * @param {string} glPhrase - Current gateway-language phrase being translated; used for
 *   phrase-level filtering when `filter` is true
 * @param {string} verseContent - Target-language verse text (space-separated words) to check
 *   which renderings are possible in this verse
 * @param {boolean} [filter=false] - If true, applies phrase-level filtering to only include
 *   gateway phrases whose words are all present in `glPhrase`
 * @returns {string} JSON string containing filtered and sorted translation entries in format
 *   `[{phrase: string, rendering: string, usageCount: number}, ...]`, or empty string `""`
 *   if no valid translations are found
 * @example
 * const data = {
 *   'the church': { 'la iglesia': 5, 'la congregación': 2 },
 *   'church': { 'iglesia': 10 }
 * };
 * const result = formatPreviousTranslations(
 *   data,
 *   'church',
 *   'para la iglesia de Éfeso',
 *   true  // enable phrase filtering
 * );
 * // Returns JSON string (prettified for readability):
 * // [
 * //   {"phrase": "church", "rendering": "iglesia", "usageCount": 10}
 * // ]
 * // Note: 'the church' renderings are filtered out because 'the' is not in 'church'
 *
 * @example
 * // Without phrase filtering
 * const result = formatPreviousTranslations(
 *   data,
 *   'church',
 *   'para la iglesia de Éfeso',
 *   false  // no phrase filtering
 * );
 * // Returns all renderings whose words appear in verse, sorted by usage count:
 * // [
 * //   {"phrase": "church", "rendering": "iglesia", "usageCount": 10},
 * //   {"phrase": "the church", "rendering": "la iglesia", "usageCount": 5}
 * // ]
 */
function formatPreviousTranslations(previousTranslationData, glPhrase, verseContent, filter = false) {
  const data = previousTranslationData || {};

  // Default to using data directly as counts map
  let filteredMatches = {};
  const keys = Object.keys(data);
  const normalizedVerseWords = new Set(verseContent.split(' ').map(word => normalizeForCompare(word)));

  for (const glPhrase of keys) {
    const translations = data[glPhrase];

    if (!translations || typeof translations !== 'object') {
      continue;
    }

    const translationKeys = Object.keys(translations);
    const filteredMatchesEntries = {};

    for (const translation of translationKeys) {
      const translationWords = translation.split(/\s+/).filter(Boolean);
      const exactMatch = translationWords.every(word => normalizedVerseWords.has(normalizeForCompare(word)));

      if (exactMatch) {
        filteredMatchesEntries[translation] = data[glPhrase][translation];
      }
    }

    if (Object.keys(filteredMatchesEntries).length) {
      // Use only translations whose words are all present in this verse
      filteredMatches[glPhrase] = filteredMatchesEntries;
    }
  }

  if (!Object.keys(filteredMatches).length) {
    filteredMatches = data;
  }

  // Convert counts object to array of {phrase, rendering, usageCount} entries,
  // filter out empty phrases or zero counts,
  // and sort by count descending (strongest evidence first)

  let entries = [];

  for (const glPhrase of Object.keys(filteredMatches)) {
    const translations = filteredMatches[glPhrase];

    for (const translation of Object.keys(translations)) {
      entries.push({
        phrase: glPhrase,
        rendering: translation,
        usageCount: translations[translation],
      });
    }
  }

  entries = entries.sort((a, b) => b.usageCount - a.usageCount);

  if (entries.length && filter) {
    // Filter entries removing any lines where the phrase contains words not in glPhrase
    const glPhraseWords = glPhrase.split(/\s+/).filter(Boolean).map(word => normalizeForCompare(word));
    const glPhraseWordSet = new Set(glPhraseWords);

    const filteredEntries = entries.filter(entry => {
      const phraseWords = entry.phrase.split(/\s+/).filter(Boolean).map(word => normalizeForCompare(word));
      return phraseWords.every(word => glPhraseWordSet.has(word));
    });

    if (filteredEntries.length) {
      entries = filteredEntries;
    }
  }

  // Keep only the strongest evidence - every entry adds prompt tokens, and when nothing matched
  // the verse `entries` falls back to the whole history, which slows every request
  entries = entries.slice(0, MAX_PROMPT_PREVIOUS_TRANSLATIONS);

  // one plain line per rendering - easier for small models to read than JSON, and fewer tokens
  return entries.map(({
    phrase, rendering, usageCount,
  }) =>
    `"${rendering}" (chosen ${usageCount} time${usageCount === 1 ? '' : 's'} for "${phrase}")`)
    .join('\n');
}

/**
 * Renders the verse as `word:position` tokens, which is exactly the format the answer
 * must use. Handing the AI the positions removes the need for it to count words - which
 * small models do unreliably - so producing the answer becomes a copy operation.
 *
 * `verseContent` is `wordList.join(' ')`, so splitting on whitespace recovers the same
 * tokens and the same 1-based indexes that `parseResponseRow` resolves against `wordList`.
 *
 * @param {string} verseContent - the target-language verse text without punctuation
 * @returns {string} - e.g. `para:1 la:2 iglesia:3 de:4 Éfeso:5`
 */
function formatNumberedVerse(verseContent) {
  return (verseContent || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => `${word}:${index + 1}`)
    .join(' ');
}

/**
 * Saves translation alignment data to `translation_data.json` in the base tCore folder.
 *
 * The saved data is keyed by `data.quoteString`. If `quoteString` is missing or empty,
 * the data is stored under an empty-string key.
 *
 * @param {string} projectPath - Path to the current project directory.
 * @param {Object<string, object>} previousData - Existing alignment data keyed by quote string.
 * @param {object} data - Alignment data to save.
 * @param {string} [data.quoteString] - Quote string used as the key for the saved alignment data.
 * @returns {void}
 */
export function saveAlignmentData(projectPath, previousData, data) {
  const dataFilePath = getTcorePathFromProjectPath(projectPath, `translation_data.json`);
  previousData[data.quoteString || ''] = data;

  //logIfContainsOpeningBrace(previousData);

  try {
    fs.outputJsonSync(dataFilePath, previousData, { spaces: 2 });
  } catch (error) {
    console.error(`Could not save TranslationData to ${dataFilePath}`, error);
  }
}

/**
 * Builds the AI prompt for selecting the best target-language translation option(s)
 * for a gateway-language phrase, using only words found in the target-language verse.
 *
 * The system prompt holds no per-call data, so its text is identical on every call and
 * the LM Studio server can reuse its cached prompt prefix across the whole run.
 *
 * @param {string} verseContent - the target-language verse text without punctuation
 * @param {string} targetLangCode - language code of the target words, e.g. 'es-419'
 * @param {string} glPhrase - gateway-language phrase to translate, e.g. 'church'
 * @param {string} glLangCode - language code of the gateway phrase, e.g. 'en'
 * @param {object} previousTranslationData - prior translation-count object; only the
 *   entries for `glPhrase` are sent to the AI
 * @returns {{systemPrompt: string, input: string}} - the fully populated prompt data
 */
export function buildTranslationOptionsPrompt(
  verseContent,
  targetLangCode,
  glPhrase,
  glLangCode,
  previousTranslationData = {},
) {
  // Kept short and literal for small models: plain-language rules, worked examples in exactly
  // the layout of the real input, and the input ending in "Answer:" so the reply is a completion.
  const systemPrompt = `You find the words in a Bible verse that translate a phrase.

You are given:
TARGET VERSE - the words of the verse, in order.
PREVIOUS TRANSLATIONS - how the phrase was translated before, most used first (may be missing).
GATEWAY PHRASE - the phrase to find in the verse.

Rules:
1. Answer only with words copied from TARGET VERSE, spelled exactly as written there.
2. Choose the fewest words that carry the meaning of GATEWAY PHRASE, kept in verse order.
3. A previous translation whose words are all in TARGET VERSE is usually the right answer. Ignore any that use words not in TARGET VERSE.
4. Give 1 to 3 options, best first, one per line, written as: "words",confidence
5. confidence is a whole number from 0 to 100 for how sure you are that the option is right in this verse.
6. If no words in TARGET VERSE fit, answer: "",0
7. Do not include reasoning in answer.
8. Answer only as CSV rows: no header, no explanation, no markdown fences.

Required output format:
"word word",confidence

Example:
TARGET VERSE (es-419): para la iglesia de Éfeso

PREVIOUS TRANSLATIONS:
"iglesia" (chosen 7 times for "church")
"la iglesia" (chosen 3 times for "the church")
"las iglesias" (chosen 31 time for "the churches")

GATEWAY PHRASE (en): church

Answer:
"iglesia",98
"la iglesia",70

Wrong answer for Example:
"church",98 - gateway words are not in TARGET VERSE
"congregación",90 - word is not in TARGET VERSE
iglesia,98 - missing the quotes
`;

  const previousTranslations = formatPreviousTranslations(previousTranslationData, glPhrase, verseContent, true);
  // console.log(`previousTranslations string length= ${previousTranslations.length}`);

  // one labeled field per line, in the same order as the examples above
  const lines = [`\nTARGET VERSE (${targetLangCode}): ${verseContent}`];

  if (previousTranslations) {
    lines.push(`\nPREVIOUS TRANSLATIONS:\n${previousTranslations}`);
  }

  lines.push(`\nGATEWAY PHRASE (${glLangCode}): ${glPhrase}`);
  lines.push('\nAnswer:');

  return { systemPrompt, input: lines.join('\n') };
}

/**
 * Lowest confidence cap for a rendering reached only through a history key that is not the exact GL
 * phrase. Kept above the 80 cutoff that triggers fuzzy target-word matching, so a verbatim target
 * match found through any key still wins over target-side fuzzy matching.
 */
const PARTIAL_GL_MATCH_CAP_MIN = 82;
/** highest confidence cap for a rendering reached through a closely related (but not exact) GL key */
const PARTIAL_GL_MATCH_CAP_MAX = 95;
/** highest confidence for any candidate that needed fuzzy target-word matching */
const FUZZY_TARGET_MAX_CONFIDENCE = 90;
/** weight of a gateway-language word shorter than `MIN_FUZZY_WORD_LENGTH` - usually a function word */
const SHORT_GL_WORD_WEIGHT = 0.2;
/** gateway-language words this long (code points) or longer count fully */
const FULL_GL_WORD_WEIGHT_LENGTH = 5;

/**
 * Splits a gateway-language phrase into normalized, lower-cased words for fuzzy comparison.
 *
 * @param {string} phrase - gateway-language phrase
 * @returns {Array<string>} - non-empty words
 */
function getNormalizedGlWords(phrase) {
  return normalizer(phrase || '').toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * How much a gateway-language word counts when comparing GL phrases. Length is used as a
 * language-neutral stand-in for "function word" ('the', 'of', 'de', 'la', 'से'), so no per-language
 * stop list is needed. History frequency is not used: the history only holds one translationWords
 * group, so the concept word itself ('holy') is the most frequent word in it.
 *
 * @param {string} word - normalized gateway-language word
 * @returns {number} - weight in (0, 1]
 */
function glWordWeight(word) {
  const length = Array.from(word).length;

  if (length < MIN_FUZZY_WORD_LENGTH) {
    return SHORT_GL_WORD_WEIGHT;
  }
  return Math.min(1, length / FULL_GL_WORD_WEIGHT_LENGTH);
}

/**
 * Weighted share of `fromWords` that has a similar word in `toWords`.
 *
 * @param {Array<string>} fromWords - normalized words being looked for
 * @param {Array<string>} toWords - normalized words being searched
 * @returns {number} - in [0, 1]
 */
function getWeightedWordCoverage(fromWords, toWords) {
  let covered = 0;
  let total = 0;

  for (const fromWord of fromWords) {
    let best = 0;

    for (const toWord of toWords) {
      best = Math.max(best, wordSimilarity(fromWord, toWord));
    }

    const weight = glWordWeight(fromWord);
    covered += best * weight;
    total += weight;
  }

  return total ? covered / total : 0;
}

/**
 * Scores every history key against `glPhrase`. A key equal to the phrase (exactly, or ignoring case
 * and Unicode form) is the exact key. Any other key gets a relatedness in [0, 1]: the F1 of how much
 * of the phrase the key covers and how much of the key the phrase covers, word by word, with short
 * words down-weighted (`glWordWeight`) and inflections matched by `wordSimilarity`.
 *
 * @param {object} previousTranslationData - nested `{glPhrase: {rendering: count}}`, or flat `{rendering: count}`
 * @param {string} glPhrase - gateway-language phrase being translated
 * @returns {Array<{counts: object, relatedness: number, isExact: boolean}>} - one entry per history key
 */
function rankGlKeys(previousTranslationData, glPhrase) {
  const data = previousTranslationData || {};
  const keys = Object.keys(data);

  // data is phrase-keyed when its values are count maps rather than counts
  const isPhraseKeyed = Object.values(data).some(value => value && typeof value === 'object');

  if (!isPhraseKeyed) { // already the counts for this phrase
    return keys.length ? [{
      counts: data, relatedness: 1, isExact: true,
    }] : [];
  }

  const normalizedGl = normalizeForCompare(glPhrase).trim();
  const glWords = getNormalizedGlWords(glPhrase);

  return keys.map(key => {
    const counts = data[key] || {};

    if (key === glPhrase || normalizeForCompare(key).trim() === normalizedGl) {
      return {
        counts, relatedness: 1, isExact: true,
      };
    }

    const keyWords = getNormalizedGlWords(key);
    let relatedness = 0;

    if (glWords.length && keyWords.length) {
      const recall = getWeightedWordCoverage(glWords, keyWords);
      const precision = getWeightedWordCoverage(keyWords, glWords);
      relatedness = (recall + precision) ? (2 * recall * precision) / (recall + precision) : 0;
    }

    return {
      counts, relatedness, isExact: false,
    };
  });
}

/**
 * Merges the renderings of every ranked history key. The history holds one translationWords group,
 * so every rendering in it translates the current concept whatever its GL wording; how closely its
 * key matches `glPhrase` only limits how confident the result can be (see `capForRendering`).
 * Renderings that differ only by case or Unicode form are merged: counts add up, and the rendering
 * keeps the best relatedness of any key it came from.
 *
 * @param {Array<{counts: object, relatedness: number, isExact: boolean}>} rankedKeys - from `rankGlKeys`
 * @returns {Array<{rendering: string, count: number, relatedness: number, isExact: boolean}>} - most used first
 */
function poolRenderings(rankedKeys) {
  const pool = new Map();

  for (const {
    counts, relatedness, isExact,
  } of rankedKeys) {
    for (const [rendering, count] of Object.entries(counts || {})) {
      const normalizedRendering = (rendering || '').split(/\s+/).filter(Boolean)
        .map(word => normalizeForCompare(word)).join(' ');

      if (normalizedRendering && count > 0) {
        const entry = pool.get(normalizedRendering) || {
          rendering: normalizedRendering, count: 0, relatedness: 0, isExact: false,
        };
        entry.count += count;
        entry.relatedness = Math.max(entry.relatedness, relatedness);
        entry.isExact = entry.isExact || isExact;
        pool.set(normalizedRendering, entry);
      }
    }
  }

  return [...pool.values()].sort((a, b) => b.count - a.count);
}

/**
 * Highest confidence a candidate from this rendering may report: 100 when it came from the exact GL
 * key, otherwise between `PARTIAL_GL_MATCH_CAP_MIN` and `PARTIAL_GL_MATCH_CAP_MAX` by relatedness.
 *
 * @param {{relatedness: number, isExact: boolean}} entry - pooled rendering
 * @returns {number} - confidence cap
 */
function capForRendering(entry) {
  if (entry.isExact) {
    return 100;
  }
  return Math.round(PARTIAL_GL_MATCH_CAP_MIN + (PARTIAL_GL_MATCH_CAP_MAX - PARTIAL_GL_MATCH_CAP_MIN) * entry.relatedness);
}

/**
 * Turns verse positions into the selection shape the checking tool stores, resolving each
 * word's text and occurrence exactly the way the AI path does in `resolveLlmPhraseInVerse`
 * so selections coming from either path are indistinguishable downstream.
 *
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {Array<number>} positions - ascending 0-based indexes into `wordList`
 * @returns {Array<{text: string, occurrence: number}>}
 */
function buildSelectionsFromPositions(wordList, positions) {
  return positions.map(position => {
    const text = wordList[position];
    return {
      text,
      occurrence: findOccurrenceForPos(position + 1, wordList, text),
    };
  });
}

/**
 * Finds the first run of verse words that spells `phraseWords` adjacently and in order.
 * This is the exact match: the rendering appears in the verse verbatim.
 *
 * @param {Array<string>} normalizedWordList - verse words already through `normalizeForCompare`
 * @param {Array<string>} phraseWords - normalized words of the rendering being looked for
 * @returns {Array<number>|null} - ascending 0-based positions, or `null` when no run matches
 */
function findContiguousMatchPositions(normalizedWordList, phraseWords) {
  if (!phraseWords.length || phraseWords.length > normalizedWordList.length) {
    return null;
  }

  for (let start = 0; start <= normalizedWordList.length - phraseWords.length; start++) {
    const matches = phraseWords.every((word, offset) => normalizedWordList[start + offset] === word);

    if (matches) {
      return phraseWords.map((_, offset) => start + offset);
    }
  }

  return null;
}

/**
 * Finds every word of `phraseWords` in the verse in reading order but not necessarily adjacent,
 * which is what happens when the target language slots another word into the middle of a known
 * rendering. Of all such placements it keeps the tightest one, so the selection stays as close
 * together as the verse allows.
 *
 * @param {Array<string>} normalizedWordList - verse words already through `normalizeForCompare`
 * @param {Array<string>} phraseWords - normalized words of the rendering being looked for
 * @returns {Array<number>|null} - ascending 0-based positions, or `null` when some word is absent
 */
function findBestOrderedMatchPositions(normalizedWordList, phraseWords) {
  if (!phraseWords.length) {
    return null;
  }

  const positionsPerWord = phraseWords.map(word => {
    const positions = [];

    for (let i = 0; i < normalizedWordList.length; i++) {
      if (normalizedWordList[i] === word) {
        positions.push(i);
      }
    }
    return positions;
  });

  return findTightestOrderedPlacement(positionsPerWord);
}

/**
 * Picks one position per word so the positions increase in word order and their span is as small as
 * possible (earliest start on ties). For a fixed first position, taking the earliest possible position
 * for each following word is optimal, so trying each start of the first word finds the tightest
 * placement in polynomial time - O(starts x words x log positions) - instead of enumerating every
 * placement, which is exponential when the verse repeats rendering words.
 *
 * @param {Array<Array<number>>} positionsPerWord - for each word, its ascending candidate positions
 * @returns {Array<number>|null} - ascending positions, one per word, or `null` when no ordered placement exists
 */
function findTightestOrderedPlacement(positionsPerWord) {
  if (!positionsPerWord.length || positionsPerWord.some(positions => !positions?.length)) {
    return null;
  }

  let bestPositions = null;
  let bestSpan = Infinity;

  for (const start of positionsPerWord[0]) {
    const placement = [start];
    let lastPosition = start;

    for (let wordIndex = 1; wordIndex < positionsPerWord.length; wordIndex++) {
      const next = firstPositionAfter(positionsPerWord[wordIndex], lastPosition);

      if (next === undefined) {
        break;
      }
      placement.push(next);
      lastPosition = next;
    }

    if (placement.length < positionsPerWord.length) {
      break; // a later start can only push every following word later still, so it cannot complete either
    }

    const span = lastPosition - start;

    if (span < bestSpan) {
      bestSpan = span;
      bestPositions = placement;
    }
  }

  return bestPositions;
}

/**
 * Binary search for the first position greater than `after`.
 *
 * @param {Array<number>} positions - ascending positions
 * @param {number} after - position to move past
 * @returns {number|undefined} - first position greater than `after`, or `undefined` when there is none
 */
function firstPositionAfter(positions, after) {
  let low = 0;
  let high = positions.length;

  while (low < high) {
    const middle = (low + high) >> 1;

    if (positions[middle] > after) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return positions[low];
}

/**
 * Finds the best ordered subset of a previous rendering whose words are present in the verse.
 * The subset is scored later against the full rendering length, so confidence is reduced when
 * some words from the previous translation are missing from `wordList`.
 *
 * @param {Array<string>} normalizedWordList - verse words already through `normalizeForCompare`
 * @param {Array<string>} phraseWords - normalized words of the full previous rendering
 * @returns {Array<number>|null} - ascending 0-based positions, or `null` when no word is present
 */
function findBestAvailableOrderedMatchPositions(normalizedWordList, phraseWords) {
  let bestPositions = null;
  let bestMatchedCount = 0;
  let bestSpan = Infinity;

  function considerSubset(start, length) {
    const positions = findBestOrderedMatchPositions(
      normalizedWordList,
      phraseWords.slice(start, start + length),
    );

    if (!positions) {
      return;
    }

    const span = positions[positions.length - 1] - positions[0];

    if (length > bestMatchedCount || (length === bestMatchedCount && span < bestSpan)) {
      bestPositions = positions;
      bestMatchedCount = length;
      bestSpan = span;
    }
  }

  for (let subLength = phraseWords.length - 1; subLength >= 1; subLength--) {
    for (let start = 0; start + subLength <= phraseWords.length; start++) {
      considerSubset(start, subLength);
    }

    if (bestPositions) {
      break;
    }
  }

  return bestPositions;
}

/**
 * Scores how good a match is, 0-100, standing in for the AI's confidence.
 *
 * Only a complete rendering found adjacently and in order scores 100 - that is the exact match.
 * Every weaker match is capped at 99 so a caller applying a confidence threshold can tell an
 * exact hit from a fallback, built from:
 * - coverage: how much of the rendering was found, worth up to 60
 * - completeness: 20 more when every word of the rendering was found
 * - adjacency: 15 more when the matched words are adjacent in the verse
 * - compactness: up to 10 for a gapped match, shrinking as the words spread further apart
 * - usage: up to 5 for how often this rendering was chosen before, relative to the most-used one
 *
 * @param {number} matchedWordCount - words of the rendering located in the verse
 * @param {number} phraseWordCount - words in the full rendering
 * @param {boolean} isContiguous - whether the matched words are adjacent in the verse
 * @param {number} span - distance between the first and last matched position
 * @param {number} count - times this rendering was used before
 * @param {number} maxCount - times the most-used rendering of this phrase was used
 * @returns {number} - 100 for an exact match, otherwise 1-99
 */
function scoreAlgorithmicMatch(matchedWordCount, phraseWordCount, isContiguous, span, count, maxCount) {
  const isFullMatch = matchedWordCount === phraseWordCount;

  if (isFullMatch && isContiguous) {
    return 100;
  }

  const coverageScore = Math.round((matchedWordCount / phraseWordCount) * 60);
  const fullMatchBonus = isFullMatch ? 20 : 0;
  const contiguousBonus = isContiguous ? 15 : 0;
  const gap = span - (matchedWordCount - 1);
  const compactnessBonus = isContiguous ? 0 : Math.max(0, 10 - gap);
  const usageBonus = maxCount > 0 ? Math.round((count / maxCount) * 5) : 0;
  const score = coverageScore + fullMatchBonus + contiguousBonus + compactnessBonus + usageBonus;

  return Math.max(1, Math.min(99, score));
}

/**
 * Computes a similarity score between two strings in the range [0, 1] using the
 * Levenshtein edit distance. A score of 1 means the strings are identical; 0 means
 * they share nothing in common relative to their lengths.
 *
 * @param {string} a - first string (already normalized)
 * @param {string} b - second string (already normalized)
 * @returns {number} - similarity in [0, 1]
 */
function fuzzyStringSimilarity(a, b) {
  if (a === b) {
    return 1;
  }

  // compare code points, not UTF-16 units, so characters outside the BMP count once
  const aChars = Array.from(a);
  const bChars = Array.from(b);

  if (!aChars.length || !bChars.length) {
    return 0;
  }

  const maxLen = Math.max(aChars.length, bChars.length);
  const dist = levenshteinDistance(aChars, bChars);
  return 1 - dist / maxLen;
}

/**
 * lowest similarity (0..1) `wordSimilarity` accepts as a match: about one edit per three code points.
 * All lengths below are in NFKD code points (what `normalizeForCompare` produces), which vary by
 * script - Hangul decomposes to 2-3 jamo per syllable, Chinese characters do not decompose.
 */
const WORD_FUZZY_THRESHOLD = 0.65;
/** words shorter than this (in code points) only ever match exactly - mostly function words */
const MIN_FUZZY_WORD_LENGTH = 4;
/** a word at least this long that is a whole prefix or suffix of the other counts as related (compounds) */
const MIN_AFFIX_LENGTH = 6;

/**
 * Language-neutral similarity of two words already through `normalizeForCompare`, for matching
 * inflected or compound forms without any word lists. Character-level, so it works for any script.
 * - identical words score 1
 * - words shorter than `MIN_FUZZY_WORD_LENGTH` otherwise score 0, since a single edit changes them too much
 * - otherwise the Levenshtein similarity, raised when the shorter word (at least `MIN_AFFIX_LENGTH`
 *   long) is a whole prefix or suffix of the longer one, e.g. 'kirche' in 'kirchengemeinde'
 * - anything under `WORD_FUZZY_THRESHOLD` scores 0
 *
 * @param {string} a - normalized word
 * @param {string} b - normalized word
 * @returns {number} - 0, or a similarity in [`WORD_FUZZY_THRESHOLD`, 1]
 */
function wordSimilarity(a, b) {
  if (a === b) {
    return 1;
  }

  const aLength = Array.from(a || '').length;
  const bLength = Array.from(b || '').length;

  if (aLength < MIN_FUZZY_WORD_LENGTH || bLength < MIN_FUZZY_WORD_LENGTH) {
    return 0;
  }

  let similarity = fuzzyStringSimilarity(a, b);
  const shorterLength = Math.min(aLength, bLength);
  const longerLength = Math.max(aLength, bLength);
  const [shorter, longer] = aLength <= bLength ? [a, b] : [b, a];

  if (shorterLength >= MIN_AFFIX_LENGTH && (longer.startsWith(shorter) || longer.endsWith(shorter))) {
    similarity = Math.max(similarity, 0.5 + 0.5 * shorterLength / longerLength);
  }

  return similarity >= WORD_FUZZY_THRESHOLD ? similarity : 0;
}

/**
 * Computes the Levenshtein edit distance between two strings. The distance is the
 * minimum number of single-character edits (insertions, deletions, substitutions)
 * needed to transform `a` into `b`. [[1]](https://medium.com/@art3330/levenshtein-distance-fundamentals-817b6f7f1718)
 *
 * Uses a space-optimised two-row approach, so memory usage is O(min(|a|,|b|)).
 *
 * @param {string|Array<string>} a - first string, or its characters (pass `Array.from(str)` to
 *   compare by code point rather than UTF-16 unit)
 * @param {string|Array<string>} b - second string, or its characters
 * @returns {number} - non-negative integer edit distance
 */
function levenshteinDistance(a, b) {
  // Ensure `a` is the shorter string to minimise memory
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;

  // prev[j] = edit distance between a[0..i-1] and b[0..j-1] from the previous row
  let prev = Array.from({ length: aLen + 1 }, (_, i) => i);
  let curr = new Array(aLen + 1);

  for (let j = 1; j <= bLen; j++) {
    curr[0] = j;

    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      curr[i] = Math.min(
        curr[i - 1] + 1, // insertion
        prev[i] + 1, // deletion
        prev[i - 1] + cost, // substitution
      );
    }
    ;[prev, curr] = [curr, prev];
  }

  return prev[aLen];
}

/**
 * Algorithmic stand-in for `getBestTWordSelectionWithConfidenceFromLlm`: same parameters, same return
 * shape, no AI call.
 *
 * Without a model there is no way to translate the gateway phrase from scratch, so how this
 * phrase was rendered before is the only evidence available. The history holds one translationWords
 * group, so every history key is scored against `glPhrase` (`rankGlKeys`) and the renderings of all
 * keys are pooled (`poolRenderings`). Each pooled rendering is looked for in the verse, strongest
 * usage count first:
 * - found adjacently and in order through the exact GL key: 100 (the only way to reach 100)
 * - found adjacently and in order through a related GL key: 82-95, higher the more weighted GL words
 *   the key shares with the phrase (`capForRendering`)
 * - found in order with other verse words in between: below 100, by compactness (and under the key's cap)
 * - when the whole rendering is not there, its sub-phrases are tried and score lower still,
 *   by how much of the rendering they cover and how tightly they sit together
 * - found only by fuzzy word matching (inflection, compound, accent): at most 90, scaled by average
 *   word similarity (`wordSimilarity`)
 *
 * The same verse words can be reached from more than one rendering (`iglesia` is both its own
 * rendering and part of `de la iglesia`), so a candidate keeps the best score any rendering
 * earns for it rather than whichever was examined first.
 *
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {string} targetLangCode - language code of the verse, e.g. 'es-419'; unused, kept so this
 *   function is interchangeable with the AI version
 * @param {string} glPhrase - gateway-language phrase to translate, e.g. 'church'
 * @param {string} glLangCode - language code of the gateway phrase; unused, see `targetLangCode`
 * @param {object} previousTranslationData - prior translation counts, nested `{glPhrase: {target: count}}`
 *   or flat `{target: count}`
 * @param {boolean} [enable_thinking] - unused, accepted so callers can swap the two functions freely
 * @returns {Promise<Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>>} -
 *   up to 3 options, best first; empty when this phrase has no history or nothing in it fits the verse
 * @example
 * await getBestTWordSelectionWithConfidenceAlgorithm(
 *   ['para', 'la', 'iglesia', 'de', 'Éfeso'],
 *   'es-419',
 *   'church',
 *   'en',
 *   { church: { 'la iglesia': 7, 'congregación': 2 } },
 * )
 * // 'la iglesia' is in the verse verbatim, so it is the exact match; 'congregación' is not
 * // in the verse at all, so it yields nothing:
 * // [ { selections: [ { text: 'la', occurrence: 1 }, { text: 'iglesia', occurrence: 1 } ],
 * //     confidence: 100 } ]
 */
// eslint-disable-next-line require-await
export async function getBestTWordSelectionWithConfidenceAlgorithm(
  wordList,
  targetLangCode,
  glPhrase,
  glLangCode,
  previousTranslationData,
) {
  // Initialize wordList, defaulting to empty array if null/undefined
  const words = wordList || [];
  // Score every history key against the GL phrase and pool their renderings, most used first, so the
  // strongest evidence claims its words before weaker renderings. Each rendering remembers how closely
  // its GL key matched, which caps its confidence.
  const countEntries = poolRenderings(rankGlKeys(previousTranslationData, glPhrase));

  // Early exit if no previous translations exist or verse has no words
  if (!countEntries.length || !words.length) {
    console.log('algorithm response: no usable previous translations', { glPhrase });
    return [];
  }

  // Store the highest usage count for relative scoring later
  const maxCount = countEntries[0].count;
  // Normalize all verse words for case-insensitive, punctuation-free comparison
  const normalizedWordList = words.map(word => normalizeForCompare(word));
  // Map to store candidates, keyed by position string (e.g. "2:3:5") to deduplicate same words
  const candidates = new Map(); // keyed by matched positions, so the same words appear once

  // Helper function to evaluate and store a candidate match
  function considerCandidate(positions, phraseWordCount, entry) {
    // Skip if no positions found
    if (!positions?.length) {
      return;
    }

    // Calculate span (distance between first and last matched word)
    const span = positions[positions.length - 1] - positions[0];
    // Check if words are adjacent (contiguous) in the verse
    const isContiguous = span === positions.length - 1;
    // Calculate confidence score (0-100) based on match quality
    const { count } = entry;
    // capped here, before candidates are compared, so ordering reflects the reported confidence
    const confidence = Math.min(
      scoreAlgorithmicMatch(positions.length, phraseWordCount, isContiguous, span, count, maxCount),
      capForRendering(entry),
    );
    // Create unique key from positions for deduplication
    const key = positions.join(':');
    const existing = candidates.get(key);

    // Keep only the best match for these positions (highest confidence, then highest count)
    // These words may already have been matched by another rendering - keep the stronger reading
    if (existing && (existing.confidence > confidence
      || (existing.confidence === confidence && existing.count >= count))) {
      return;
    }

    // Store or update the candidate with its metadata
    candidates.set(key, {
      selections: buildSelectionsFromPositions(words, positions),
      confidence,
      count,
      span,
      matchedWordCount: positions.length,
    });
  }

  // Try to match each previous translation against the verse, from most-used to least-used
  for (const entry of countEntries) {
    // Normalize the previous translation into individual words
    const phraseWords = entry.rendering.split(/\s+/).filter(Boolean).map(word => normalizeForCompare(word));

    // Skip empty translations
    if (!phraseWords.length) {
      continue;
    }

    // First attempt: find exact verbatim match (all words adjacent and in order)
    const exactPositions = findContiguousMatchPositions(normalizedWordList, phraseWords);

    if (exactPositions) { // verbatim match, nothing weaker from this rendering can beat it
      considerCandidate(exactPositions, phraseWords.length, entry);
      continue;
    }

    // Second attempt: find all words in order but possibly with gaps between them
    const orderedPositions = findBestOrderedMatchPositions(normalizedWordList, phraseWords);

    if (orderedPositions) { // all the words, but the verse spreads them out
      considerCandidate(orderedPositions, phraseWords.length, entry);
      continue;
    }

    // Fallback: find the best subset of the translation that exists in the verse
    // Fall back to the best ordered subset of the rendering that the verse actually contains.
    // It is still scored against the full previous translation length, so confidence is reduced
    // when one or more words from the previous translation are missing from wordList.
    const availablePositions = findBestAvailableOrderedMatchPositions(normalizedWordList, phraseWords);
    considerCandidate(availablePositions, phraseWords.length, entry);
  }

  const minimumConfidenceLevel = 80;
  const haveConfidentCandidate = [...candidates.values()]
    .some(candidate => candidate.confidence > minimumConfidenceLevel);

  if (!haveConfidentCandidate) {
    // Use fuzzy compares to do closest matches for translated target words in word list and calculate confidence
    // For each previous translation, try fuzzy matching each phrase word against verse words
    for (const entry of countEntries) {
      const { count } = entry;
      const phraseWords = entry.rendering.split(/\s+/).filter(Boolean).map(word => normalizeForCompare(word));

      if (!phraseWords.length) {
        continue;
      }

      const matchedPositions = [];
      let totalSimilarity = 0;

      for (const phraseWord of phraseWords) {
        let bestPos = -1;
        let bestSim = -1;

        for (let i = 0; i < normalizedWordList.length; i++) {
          const sim = wordSimilarity(phraseWord, normalizedWordList[i]);

          if (sim > bestSim) {
            bestSim = sim;
            bestPos = i;
          }
        }

        if (bestPos >= 0 && bestSim > 0) { // wordSimilarity already rejects dissimilar and short words
          matchedPositions.push(bestPos);
          totalSimilarity += bestSim;
        }
      }

      if (matchedPositions.length) {
        // Deduplicate positions, keeping order
        const uniquePositions = [...new Set(matchedPositions)].sort((a, b) => a - b);
        const avgSimilarity = totalSimilarity / phraseWords.length;
        // Scale confidence: fuzzy matches are always weaker than exact ones (capped below 90)
        const fuzzyConfidence = Math.min(
          Math.round(avgSimilarity * FUZZY_TARGET_MAX_CONFIDENCE),
          capForRendering(entry),
        );
        const key = uniquePositions.join(':');
        const existing = candidates.get(key);

        if (!existing || existing.confidence < fuzzyConfidence) {
          candidates.set(key, {
            selections: buildSelectionsFromPositions(words, uniquePositions),
            confidence: fuzzyConfidence,
            count,
            span: uniquePositions[uniquePositions.length - 1] - uniquePositions[0],
            matchedWordCount: uniquePositions.length,
          });
        }
      }
    }

    if (candidates.size) {
      // console.log('fuzzy match response:', {
      //   wordList: formatNumberedVerse(words.join(' ')),
      //   glPhrase,
      //   candidates: [...candidates.values()],
      // });
    } else {
      console.log('algorithm response: no usable candidates for ', { glPhrase });
    }
  }

  // Sort all candidates by quality (confidence, count, matched word count, compactness)
  // and take the top 3 results
  const bestSelections = [...candidates.values()]
    .sort((a, b) => (
      b.confidence - a.confidence
      || b.count - a.count
      || b.matchedWordCount - a.matchedWordCount
      || a.span - b.span
    ))
    .slice(0, 3)
    .map(({ selections, confidence }) => ({ selections, confidence }));

  // // Log the results for debugging
  // console.log('algorithm response:', {
  //   wordList: formatNumberedVerse(words.join(' ')),
  //   glPhrase,
  //   matches: bestSelections.length,
  //   bestSelections,
  // });

  return bestSelections;
}

/** most translation options returned from one AI response, matching the algorithmic path */
const LLM_MAX_OPTIONS = 3;
/** response cap when thinking is off - the answer is a few short CSV rows, so this only stops runaway output */
const LLM_DEFAULT_MAX_TOKENS = 2048;
/** tags some models wrap their reasoning in, e.g. `<think>...</think>` */
const LLM_REASONING_TAGS = 'think|thinking|reasoning|reflection|thought';
/** keys AI models commonly use for the rendering and the confidence when they answer in JSON */
const LLM_JSON_TEXT_KEYS = ['rendering', 'text', 'translation', 'words', 'selection', 'answer', 'phrase', 'option'];
const LLM_JSON_CONFIDENCE_KEYS = ['confidence', 'score', 'probability', 'certainty'];

/**
 * Removes the noise different AI models wrap around their answer so only candidate rows remain:
 * reasoning blocks (`<think>...</think>` and similar), harmony-format channel tokens
 * (`<|channel|>final<|message|>`), echoed `/no_think` directives, markdown fences and emphasis.
 *
 * @param {string} answer - raw AI response text
 * @returns {string} - the cleaned text
 */
function cleanLlmAnswer(answer) {
  let text = String(answer || '');

  // drop complete reasoning blocks
  text = text.replace(new RegExp(`<(${LLM_REASONING_TAGS})>[\\s\\S]*?</\\1>`, 'gi'), '\n');

  // a closing tag without its opening tag (opening tag came from the chat template) - keep what follows it
  const closingTag = new RegExp(`</(${LLM_REASONING_TAGS})>`, 'gi');
  let lastClosingEnd = -1;
  let match;

  while ((match = closingTag.exec(text))) {
    lastClosingEnd = match.index + match[0].length;
  }

  if (lastClosingEnd >= 0) {
    text = text.slice(lastClosingEnd);
  }

  // harmony format (e.g. gpt-oss) - the answer is the message of the final channel
  const finalChannel = text.lastIndexOf('<|channel|>final');

  if (finalChannel >= 0) {
    const messageStart = text.indexOf('<|message|>', finalChannel);
    text = messageStart >= 0 ? text.slice(messageStart) : text.slice(finalChannel);
  }

  return text
    .replace(new RegExp(`</?(${LLM_REASONING_TAGS})>`, 'gi'), '\n') // an unclosed tag - drop just the tag
    .replace(/<\|[^|>]*\|>/g, '\n') // remaining special tokens
    .replace(/\/no_think/gi, '')
    .replace(/```[\w-]*/g, '\n')
    .replace(/[*`]/g, '');
}

/**
 * Converts a confidence value from an AI response to an integer 0-100. Accepts `98`, `"98"`,
 * `98%` and fractional scores such as `0.98`.
 *
 * @param {string|number} value - confidence as returned by the AI
 * @returns {number|null} - integer 0-100, or null when the value is not a number
 */
function normalizeLlmConfidence(value) {
  const valueStr = removeQuotes(String(value ?? '')).replace('%', '').trim();
  let confidence = parseFloat(valueStr);

  if (Number.isNaN(confidence)) {
    return null;
  }

  if (valueStr.includes('.') && confidence > 0 && confidence <= 1) { // fractional score
    confidence *= 100;
  }
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

/**
 * Pulls `{phrase, confidence}` rows out of an AI answer given as JSON, e.g.
 * `[{"rendering":"iglesia","confidence":98}]`, `{"options":[...]}` or `[["iglesia",98]]`.
 * Entries carrying `usageCount` are echoes of the PREVIOUS TRANSLATIONS and are skipped.
 *
 * @param {string} text - cleaned AI answer
 * @returns {Array<{phrase: string, confidence: number}>} - rows found, empty when not JSON
 */
function extractLlmJsonRows(text) {
  const rows = [];
  let data = null;

  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);

    if (start >= 0 && end > start) {
      try {
        data = JSON.parse(text.slice(start, end + 1));
        break;
      } catch {
        // not JSON - try the next shape
      }
    }
  }

  if (data && !Array.isArray(data) && typeof data === 'object') {
    data = Object.values(data).find(Array.isArray) || [data];
  }

  if (!Array.isArray(data)) {
    return rows;
  }

  for (const item of data) {
    let phrase = null;
    let confidence = null;

    if (Array.isArray(item) && item.length >= 2) {
      [phrase, confidence] = item;
    } else if (item && typeof item === 'object' && !('usageCount' in item)) {
      phrase = item[LLM_JSON_TEXT_KEYS.find(key => item[key] !== undefined)];
      confidence = item[LLM_JSON_CONFIDENCE_KEYS.find(key => item[key] !== undefined)];
    }

    if (Array.isArray(phrase)) {
      phrase = phrase.join(' ');
    }

    confidence = normalizeLlmConfidence(confidence);

    if (typeof phrase === 'string' && confidence !== null) {
      rows.push({ phrase, confidence });
    }
  }
  return rows;
}

/**
 * Pulls candidate `{phrase, confidence}` rows out of an AI answer, tolerating the many ways
 * different models deviate from the requested `"word word",confidence` CSV format:
 * reasoning text before the answer, JSON instead of CSV, several rows on one line, list
 * prefixes (`1.`, `-`), curly or single quotes, missing quotes, `;`/`|`/tab separators,
 * `98%` or `0.98` confidences, or the phrase and confidence on separate lines.
 *
 * When reasoning precedes the answer it can contain example rows too, so `finalRows` holds
 * just the last consecutive run of row lines - where the final answer is - while `rows`
 * holds every row found, for use when the final run turns out to be unusable.
 *
 * @param {string} answer - raw AI response text
 * @returns {{rows: Array<{phrase: string, confidence: number, strict: boolean}>,
 *   finalRows: Array<{phrase: string, confidence: number, strict: boolean}>}} - `strict` marks
 *   rows found without quotes, whose words must all be in the verse to be trusted
 */
function extractLlmRows(answer) {
  const text = cleanLlmAnswer(answer);

  if (/^\s*[[{]/.test(text)) {
    const jsonRows = extractLlmJsonRows(text);

    if (jsonRows.length) {
      return { rows: jsonRows, finalRows: jsonRows };
    }
  }

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const runs = [];
  let lastRowLine = -2;

  const addRow = (lineIndex, phrase, confidence, strict) => {
    if (lineIndex !== lastRowLine && lineIndex !== lastRowLine + 1) {
      runs.push([]); // rows are no longer consecutive - start a new run
    }
    runs[runs.length - 1].push({
      phrase, confidence, strict,
    });
    lastRowLine = lineIndex;
  };

  lines.forEach((line, lineIndex) => {
    // "phrase",98 - possibly several on one line; quotes may be straight, curly or single
    const quotedRow = /["“”„«»']([^"“”„«»\n]*?)["“”„«»']\s*[,;|\t:]\s*["']?(\d{1,3}(?:\.\d+)?)\s*%?/g;
    let found = false;
    let match;

    while ((match = quotedRow.exec(line))) {
      const confidence = normalizeLlmConfidence(match[2]);

      if (confidence !== null) {
        addRow(lineIndex, match[1], confidence, false);
        found = true;
      }
    }

    if (!found) { // phrase,98 - without quotes, optionally as a list item
      const unquotedRow = line.match(/^(?:[-•]|\d+[.)])?\s*([^,;|\t"]+?)\s*[,;|\t]\s*(\d{1,3}(?:\.\d+)?)\s*%?$/);

      if (unquotedRow) {
        addRow(lineIndex, unquotedRow[1], normalizeLlmConfidence(unquotedRow[2]), true);
      } else if (/^\d{1,3}(?:\.\d+)?\s*%?$/.test(line) && lineIndex > 0) {
        // phrase and confidence on separate lines
        const phrase = removeQuotes(lines[lineIndex - 1]);

        if (phrase && !/\d/.test(phrase)) {
          addRow(lineIndex, phrase, normalizeLlmConfidence(line), true);
        }
      }
    }
  });

  if (!runs.length && lines.length === 1 && !/\d/.test(lines[0])) {
    // just the words, without a confidence
    runs.push([{
      phrase: removeQuotes(lines[0]), confidence: 50, strict: true,
    }]);
  }

  return {
    rows: runs.flat(),
    finalRows: runs[runs.length - 1] || [],
  };
}

/**
 * Strips accents so a word an AI model re-spelled without them (`Efeso`) still finds its
 * verse word (`Éfeso`).
 * @param {string} word
 * @returns {string}
 */
function foldAccents(word) {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Locates the words of an AI-suggested phrase in the verse and turns them into selections.
 * Each word is matched exactly first, then ignoring accents, then (unless `strict`) by fuzzy
 * similarity; words that cannot be found are dropped. The matched words are then placed in
 * the verse as an adjacent run if possible, otherwise as the tightest in-order placement.
 *
 * @param {string} phrase - words suggested by the AI
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {Array<string>} normalizedWordList - `wordList` through `normalizeForCompare`
 * @param {Array<string>} foldedWordList - `normalizedWordList` through `foldAccents`
 * @param {boolean} strict - when true every word must be found, without fuzzy matching
 * @returns {Array<{text: string, occurrence: number}>|null} - selections, or null if none found
 */
function resolveLlmPhraseInVerse(phrase, wordList, normalizedWordList, foldedWordList, strict) {
  const phraseWords = (phrase || '')
    .split(/[\s,]+/)
    .map(word => normalizeForCompare(word.replace(/:\d+$/, ''))) // drop `word:3` positions
    .filter(Boolean);

  if (!phraseWords.length) {
    return null;
  }

  const verseWords = [];

  for (const word of phraseWords) {
    let verseWord = null;

    if (normalizedWordList.includes(word)) {
      verseWord = word;
    } else {
      const foldedIndex = foldedWordList.indexOf(foldAccents(word));

      if (foldedIndex >= 0) {
        verseWord = normalizedWordList[foldedIndex];
      } else if (!strict) {
        let bestSimilarity = 0.3; // minimum similarity accepted

        normalizedWordList.forEach(normalizedWord => {
          const similarity = fuzzyStringSimilarity(word, normalizedWord);

          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            verseWord = normalizedWord;
          }
        });
      }
    }

    if (verseWord) {
      verseWords.push(verseWord);
    } else if (strict) {
      return null;
    }
  }

  if (!verseWords.length) {
    return null;
  }

  let positions = findContiguousMatchPositions(normalizedWordList, verseWords) ||
    findBestOrderedMatchPositions(normalizedWordList, verseWords);

  if (!positions) { // words are out of verse order - take the first unused position of each
    const used = new Set();

    for (const word of verseWords) {
      const index = normalizedWordList.findIndex((verseWord, i) => verseWord === word && !used.has(i));

      if (index >= 0) {
        used.add(index);
      }
    }
    positions = [...used].sort((a, b) => a - b);
  }

  return positions.length ? buildSelectionsFromPositions(wordList, positions) : null;
}

/**
 * Turns an AI answer into up to `LLM_MAX_OPTIONS` translation options for the verse.
 * Rows that resolve to the same words are merged keeping the higher confidence.
 *
 * A batched answer with `### REQUEST n` markers - on their own lines or run together, e.g.
 * `###REQUEST1"quyn",98###REQUEST2"",0` - is parsed for the request at `requestIndex` only.
 *
 * @param {string} answer - raw AI response text
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {number} [requestIndex=0] - 0-based request to parse when the answer is batched
 * @returns {Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>} -
 *   options sorted by confidence, highest first; empty when nothing usable was found
 */
export function parseLlmSelectionOptions(answer, wordList, requestIndex = 0) {
  if (new RegExp(LLM_BATCH_MARKER.source, 'im').test(cleanLlmAnswer(answer))) {
    answer = splitLlmBatchAnswer(answer, requestIndex + 1)[requestIndex];
  }

  const normalizedWordList = wordList.map(word => normalizeForCompare(word));
  const foldedWordList = normalizedWordList.map(foldAccents);
  const { rows, finalRows } = extractLlmRows(answer);

  const toOptions = candidateRows => {
    const optionsByWords = new Map();

    for (const {
      phrase, confidence, strict,
    } of candidateRows) {
      const selections = resolveLlmPhraseInVerse(phrase, wordList, normalizedWordList, foldedWordList, strict);

      if (selections) {
        const key = selections.map(({ text, occurrence }) => `${text}:${occurrence}`).join(' ');
        const existing = optionsByWords.get(key);

        if (!existing || existing.confidence < confidence) {
          optionsByWords.set(key, { selections, confidence });
        }
      }
    }

    return [...optionsByWords.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, LLM_MAX_OPTIONS);
  };

  const options = toOptions(finalRows);
  return (options.length || finalRows.length === rows.length) ? options : toOptions(rows);
}

/**
 * Translates a gateway language phrase to target-language word(s) within a verse
 * using an AI model, returning an array of selection objects with confidence scores.
 *
 * This function queries an AI model (any OpenAI-compatible server) to find the
 * best target-language translation option(s) for a gateway-language phrase, using only words
 * found in the target verse. The AI is guided by previous translation history to maintain
 * consistency across the project.
 *
 * Response parsing (see {@link parseLlmSelectionOptions}) tolerates the formats different
 * models actually produce:
 * - Standard CSV: "word word",confidence
 * - Reasoning before the answer (`<think>` blocks, harmony channels, or plain text)
 * - JSON arrays/objects instead of CSV
 * - Several rows on one line, list prefixes, other quotes/separators, `98%` or `0.98`
 * - Phrase and confidence on separate lines, or just the words with no confidence
 *
 * Words are matched to the verse exactly, then ignoring accents, then by fuzzy similarity,
 * and options resolving to the same words are merged.
 *
 * Passing an array of request objects instead of one sends them all to the AI in a single
 * `queryAiAPI` call (see {@link getBestTWordSelectionsBatchFromLlm}) and resolves to an array
 * of results in the same order.
 *
 * @param {object|Array<object>} options - Request options, or an array of them to batch
 * @param {Array<string>} options.wordList - target-language verse words in reading order
 * @param {string} options.targetLangCode - language code of the verse (e.g. 'es-419')
 * @param {string} options.glPhrase - gateway language phrase to translate (e.g. 'church')
 * @param {string} options.glLangCode - language code of the gateway phrase (e.g. 'en')
 * @param {object} options.previousTranslationData - prior translation counts; can be nested
 *   `{glPhrase: {targetPhrase: count}}` or flat `{targetPhrase: count}`
 * @param {object} [options.lmOptions={enable_thinking: false}] - options passed to queryAiAPI
 * @param {boolean} [options.lmOptions.enable_thinking=false] - whether to enable AI thinking mode
 * @param {string} [options.lmOptions.baseUrl] - OpenAI-compatible server URL override
 * @param {string} [options.lmOptions.model] - AI model identifier override
 * @param {number} [options.lmOptions.temperature] - sampling temperature override
 * @param {number} [options.lmOptions.maxTokens] - max response tokens override; defaults to
 *   `LLM_DEFAULT_MAX_TOKENS` when thinking is off
 * @param {string} [options.lmOptions.apiToken] - bearer token for servers that require one
 * @returns {Promise<{error: boolean, bestSelections: Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>, elapsedStr: string, model: string}|Array<object>>} -
 *   an array of these results when `options` is an array.
 *   `bestSelections` holds up to 3 options sorted by confidence, each containing:
 *   - selections: array of {text, occurrence} objects representing matched words
 *     - text: the word exactly as it appears in the verse
 *     - occurrence: 1-based occurrence index of this word in the verse
 *   - confidence: integer 0-100 indicating match certainty
 *   `error` is true only when the AI request itself failed
 * @throws Does not throw; logs errors and returns empty bestSelections on failure
 * @example
 * const wordList = ['para', 'la', 'iglesia', 'de', 'Éfeso'];
 * const result = await getBestTWordSelectionWithConfidenceFromLlm({
 *   wordList,
 *   targetLangCode: 'es-419',
 *   glPhrase: 'church',
 *   glLangCode: 'en',
 *   previousTranslationData: { church: { 'iglesia': 7, 'la iglesia': 3 } },
 *   lmOptions: { enable_thinking: false },
 * });
 * // result.bestSelections: [
 * //   { selections: [{text: 'iglesia', occurrence: 1}], confidence: 98 },
 * //   { selections: [{text: 'la', occurrence: 1}, {text: 'iglesia', occurrence: 1}], confidence: 70 }
 * // ]
 *
 * @see {@link buildTranslationOptionsPrompt} for the prompt construction
 * @see {@link parseLlmSelectionOptions} for response parsing logic
 * @see {@link getBestTWordSelectionWithConfidenceAlgorithm} for non-AI alternative
 */
export async function getBestTWordSelectionWithConfidenceFromLlm(request) {
  if (Array.isArray(request)) {
    return getBestTWordSelectionsBatchFromLlm(request);
  }

  const {
    wordList,
    targetLangCode,
    glPhrase,
    glLangCode,
    previousTranslationData,
    lmOptions = { enable_thinking: false },
  } = request;
  const { systemPrompt, input } = buildTranslationOptionsPrompt(
    wordList.join(' '),
    targetLangCode,
    glPhrase,
    glLangCode,
    previousTranslationData,
  );
  const options = buildLlmQueryOptions(lmOptions, systemPrompt, LLM_DEFAULT_MAX_TOKENS);

  let answer = '';
  let elapsedStr = '0';
  let model = '';

  try {
    ({
      response: answer,
      elapsedStr,
      model,
    } = await queryAiAPI(input, options));
  } catch (e) {
    console.warn('AI query error', e);
    return {
      error: true,
      bestSelections: [],
      elapsedStr,
      model: '',
    };
  }

  const bestSelections = parseLlmSelectionOptions(answer, wordList);

  if (bestSelections.length) {
    return {
      error: false,
      bestSelections,
      elapsedStr,
      model,
    };
  }

  console.log('AI response ERROR decoding:', {
    wordList: formatNumberedVerse(wordList.join(' ')),
    glPhrase,
    answer,
  });
  return {
    error: false,
    bestSelections: [],
    elapsedStr,
    model: '',
  };
}

/**
 * `### REQUEST n` marker starting each answer in a batched AI response; found at the start of
 * a line or after a `#`, so markers run together on one line (`###REQUEST1"quyn",98###REQUEST2`)
 * are found too
 */
const LLM_BATCH_MARKER = /(?:^|#)[#\s]*REQUEST\s*(\d+)\s*:?/gim;

/** response tokens allowed per request when several requests share one AI query */
const LLM_BATCH_MAX_TOKENS_PER_REQUEST = 256;

/** appended to the system prompt when several requests are sent in one AI query */
const LLM_BATCH_SYSTEM_PROMPT = `
Several requests may be given, each starting with a line "### REQUEST n".
Answer every request in the same order. Start each answer with its "### REQUEST n" line, then its CSV rows.

Batch example output:
### REQUEST 1
"iglesia",98
### REQUEST 2
"",0
`;

/**
 * Builds the options passed to `queryAiAPI`: thinking off by default, and a response length
 * cap of `defaultMaxTokens` when thinking is off and no `maxTokens` was given.
 *
 * @param {object} lmOptions - caller's AI options
 * @param {string} systemPrompt - system prompt for the query
 * @param {number} defaultMaxTokens - max response tokens used when none was given
 * @returns {object} - options for `queryAiAPI`
 */
function buildLlmQueryOptions(lmOptions, systemPrompt, defaultMaxTokens) {
  const options = {
    enable_thinking: false,
    ...lmOptions,
    systemPrompt,
  };

  if (!options.maxTokens && !options.enable_thinking) {
    options.maxTokens = defaultMaxTokens;
  }
  return options;
}

/**
 * Splits a batched AI answer into the answer text for each request, keyed by its
 * `### REQUEST n` marker (see `LLM_BATCH_MARKER`). When a marker appears more than once (e.g.
 * reasoning echoed it before the final answer) the last section wins, since that is where the
 * final answer is.
 *
 * @param {string} answer - raw AI response text
 * @param {number} count - number of requests in the batch
 * @returns {Array<string>} - answer text per request, '' when the request was not answered
 */
function splitLlmBatchAnswer(answer, count) {
  const text = cleanLlmAnswer(answer);
  const sections = new Array(count).fill('');
  const marker = new RegExp(LLM_BATCH_MARKER.source, 'gim');
  const markers = [];
  let match;

  while ((match = marker.exec(text))) {
    markers.push({
      index: parseInt(match[1], 10) - 1, start: match.index, end: match.index + match[0].length,
    });
  }

  if (!markers.length) {
    if (count === 1) {
      sections[0] = text; // model ignored the markers - the whole answer is for the one request
    }
    return sections;
  }

  markers.forEach(({ index, end }, i) => {
    if (index >= 0 && index < count) {
      const next = markers[i + 1];
      sections[index] = text.slice(end, next ? next.start : text.length);
    }
  });
  return sections;
}

/**
 * Batched form of {@link getBestTWordSelectionWithConfidenceFromLlm}: sends all the requests
 * to the AI in a single `queryAiAPI` call and splits the answer back out per request.
 * The `lmOptions` of the first request are used for the shared query.
 *
 * @param {Array<object>} requests - each with the same fields as the single-request options
 * @returns {Promise<Array<{error: boolean, bestSelections: Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>, elapsedStr: string, model: string}>>} -
 *   one result per request, in the same order; `elapsedStr` is the time for the whole batch
 */
async function getBestTWordSelectionsBatchFromLlm(requests) {
  if (!requests.length) {
    return [];
  }

  let systemPrompt = '';
  const inputs = requests.map(({
    wordList, targetLangCode, glPhrase, glLangCode, previousTranslationData,
  }, i) => {
    const prompt = buildTranslationOptionsPrompt(
      wordList.join(' '),
      targetLangCode,
      glPhrase,
      glLangCode,
      previousTranslationData,
    );
    systemPrompt = prompt.systemPrompt;
    return `### REQUEST ${i + 1}${prompt.input.replace(/\n*Answer:\s*$/, '')}`;
  });
  const input = `${inputs.join('\n\n')}\n\nAnswer:`;
  const lmOptions = requests[0].lmOptions || { enable_thinking: false };
  const maxTokens = Math.max(LLM_DEFAULT_MAX_TOKENS, requests.length * LLM_BATCH_MAX_TOKENS_PER_REQUEST);
  const options = buildLlmQueryOptions(lmOptions, systemPrompt + LLM_BATCH_SYSTEM_PROMPT, maxTokens);

  let answer = '';
  let elapsedStr = '0';
  let model = '';

  try {
    ({
      response: answer,
      elapsedStr,
      model,
    } = await queryAiAPI(input, options));
  } catch (e) {
    console.warn('AI batch query error', e);
    return requests.map(() => ({
      error: true,
      bestSelections: [],
      elapsedStr,
      model: '',
    }));
  }

  const sections = splitLlmBatchAnswer(answer, requests.length);

  return requests.map(({ wordList, glPhrase }, i) => {
    const bestSelections = sections[i] ? parseLlmSelectionOptions(sections[i], wordList) : [];

    if (!bestSelections.length) {
      console.log('AI batch response ERROR decoding:', {
        request: i + 1,
        wordList: formatNumberedVerse(wordList.join(' ')),
        glPhrase,
        answer: sections[i],
      });
    }
    return {
      error: false,
      bestSelections,
      elapsedStr,
      model: bestSelections.length ? model : '',
    };
  });
}

/**
 * Strips a single pair of surrounding double quotes from a value, trimming whitespace first.
 * @param {string} value
 * @returns {string} - the value without surrounding quotes, or '' if value is falsy
 */
function removeQuotes(value) {
  return value?.trim().replace(/^"|"$/g, '') || '';
}

/**
 * Counts how many times `text` occurs in `wordList` before (and not including) `position`,
 * returning the 1-based occurrence index for the word at `position`.
 * @param {number} position - 1-based position in wordList being resolved
 * @param {Array<string>} wordList - verse words
 * @param {string} text - word text to count occurrences of
 * @returns {number} - 1-based occurrence index, defaulting to 1 if none counted
 */
function findOccurrenceForPos(position, wordList, text) {
  let occurrence = 0;

  for (let i = 0; i < position; i++) {
    if (wordList[i] === text) {
      occurrence++;
    }
  }
  occurrence = occurrence || 1; // fallback if AI got mixed up
  return occurrence;
}

/**
 * Parses one CSV response row of the form `"word:position word:position",confidence` into a
 * `{selections, confidence}` entry pushed onto `selectionWords`, converting each word's
 * position (or bare occurrence number, when positions are missing) into an occurrence index.
 * @param {string} response - one CSV row of the AI response
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {string} answer - full AI response text, used only for logging
 * @param {Array<object>} selectionWords - accumulator array the parsed entry is pushed onto
 * @returns {boolean} - true on success, false if the row was malformed or a word wasn't found
 */
function parseResponseRow(response, wordList, answer, selectionWords) {
  let error = false;
  let missingPos = false;
  const rowParts = response.split(',');

  if (rowParts.length === 2) {
    let [phraseTranslation, confidence] = rowParts;
    confidence = confidence ? parseInt(removeQuotes(confidence), 10) : 0;
    phraseTranslation = removeQuotes(phraseTranslation);
    const selections = [];
    const words = phraseTranslation.split(' ');

    for (const word of words) {
      let selectionFound = null;
      const wordParts = word.split(':');
      let [text, position] = wordParts;
      text = normalizer(text);

      if (wordParts.length === 2) {
        position = parseInt(position, 10);
        selectionFound = { text, position };
      } else if (wordParts.length === 1) {
        position = -1;
        selectionFound = { text, position };
        missingPos = true;
      } else {
        // invalid number of columns
        error = true;
      }

      if (selectionFound) {
        selections.push(selectionFound);
      } else {
        console.log('invalid response', answer);
        error = true;
      }
    }

    if (selections.length) {
      if (missingPos && !error) { // fill in missing positions
        missingPos = false; // clear before second pass

        for (let i = 0; i < selections.length; i++) {
          const selection = selections[i];

          if (selection.position < 0) {
            // look ahead for last of contiguous words
            let startPos = 0;
            let lastOfContig = 0;

            for (let j = i + 1; j < selections.length; j++) {
              const selection_ = selections[j];

              if (selection_.position >= 0) {
                startPos = selection_.position;
                lastOfContig = j;
                break;
              }
            }

            if (startPos) {
              for (let j = i; j <= lastOfContig; j++) {
                const selection_ = selections[j];
                selection_.position = startPos++;
              }
            } else {
              error = true;
              break;
            }
          }
        }
      }

      // convert positions to occurrences
      for (const selection of selections) {
        let found = false;

        if (selection.position > 0) {
          let wordlistWord = wordList[selection.position - 1];

          if (selection.text !== normalizer(wordlistWord)) {
            wordlistWord = wordList[selection.position - 2];

            if (selection.text === normalizer(wordlistWord)) { // try offset index
              selection.position--;
              found = true;
            }
          } else {
            found = true;
          }

          if (found) {
            const occurrence = findOccurrenceForPos(selection.position, wordList, selection.text);

            if (occurrence > 0) {
              delete selection.position;
              selection.occurrence = occurrence;
            }
          } else if (selection.position > 0) {
            // see if AI sent occurrence rather than position
            const matchOccurrence = selection.position;
            let occurrence = 0;

            for (let i = 0; i < wordList.length; i++) {
              const word = wordList[i];

              if (selection.text === normalizer(word)) {
                if (++occurrence >= matchOccurrence) {
                  found = true;
                  delete selection.position;
                  selection.occurrence = i + 1;
                  break;
                }
              }
            }
          }

          if (!found) {
            console.log(`word ${selection.text} not found at ${selection.position} in wordList`, wordList);
          }
        }
      }

      selectionWords.push({ selections, confidence });
    } else {
      error = true;
    }
    console.log('translation', { translation: phraseTranslation, confidence });
  } else {
    console.log('row is not in csv format', response);
    error = true;
  }
  return !error;
}

/**
 * Translates a gateway language phrase to target-language word(s) within a verse
 * using an AI model, returning an array of selection objects with confidence scores.
 *
 * @param {Array<string>} wordList - array of words from the target-language verse to search within
 * @param {string} targetLangCode - language code of the verse (e.g. 'es-419')
 * @param {string} phrase - gateway language phrase to match (e.g. 'your old age')
 * @param {string} phraseLangCode - language code of the phrase (e.g. 'en')
 * @returns {Promise<Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>>} - array of selection objects, each containing:
 *   - selections: array of {text, occurrence} objects representing matched words, where text is the word and occurrence is its 1-based occurrence index in the verse
 *   - confidence: integer 0-100 indicating match certainty
 * @throws {Error} - if the AI query fails or returns invalid data
 * @example
 * const wordList = ['Ahora', 'él', 'será', 'para', 'ti', 'un', 'restaurador', 'de', 'vida'];
 * const result = await translatePhraseWithConfidence(
 *   wordList,
 *   'es-419',
 *   'your old age',
 *   'en'
 * );
 * // Returns: [
 * //   { selections: [{text: 'tu', occurrence: 1}, {text: 'vejez', occurrence: 1}], confidence: 85 },
 * //   { selections: [{text: 'vejez', occurrence: 1}], confidence: 70 }
 * // ]
 */
export async function translatePhraseWithConfidence(wordList, targetLangCode, phrase, phraseLangCode) {
  let selectionWords = [];
  const verseWords = wordList.join(' ');
  const { systemPrompt, query } = buildVerseMatchPrompt(verseWords, targetLangCode, phrase, phraseLangCode);
  let success = true;
  let answer = '';
  let responses = null;

  try {
    const { response } = await queryAiAPI(query, { systemPrompt });
    answer = response;
    responses = answer.split('\n');
    const length = responses.length;
    let start = 0;

    if (length > 5) { // if the response was verbose, like in thinking mode, skip ahead to csv line
      for (let i = start; i < length; i++) {
        const response = responses[i];
        const parts = response?.split(',');

        if (parts?.length == 2) {
          let confidence = removeQuotes(parts[1]);
          confidence = parseInt(confidence, 10);

          if (!Number.isNaN(confidence)) {
            start = i;
            break;
          }
        }
      }
    }

    for (let i = start; i < length; i++) {
      const response = responses[i];

      if (response) {
        if (!response.includes('```')) {
          const success_ = parseResponseRow(response, wordList, answer, selectionWords);

          if (!success_) {
            success = false;
          }
        }
      }
    }
  } catch (e) {
    console.log('query failed',e);
    success = false;
  }

  if (!success) {
    if (!answer.includes(',')) {
      //handle case where AI did not use CSV format, by fields are separated by newlines
      if (responses?.length === 2) {
        selectionWords = [];
        const response = answer.replace('\n', ',');
        success = parseResponseRow(response, wordList, answer, selectionWords);
      }
    }
  }

  // remove duplicates from selections
  const seen = new Set();

  for (const option of selectionWords) {
    const uniqueSelections = [];

    for (const word of option.selections) {
      if (word.occurrence && word.text) {
        const key = word.text + ':' + word.occurrence;

        if (!seen.has(key)) {
          seen.add(key);
          uniqueSelections.push(word);
        }
      } else {
        // console.log('invalid word or occurrence found', word);
        success = false;
      }
    }

    if (option.selections.length != uniqueSelections.length) { // if changed then update
      option.selections = uniqueSelections;
    }
  }

  if (success) {
    console.log('AI response:', {
      verseWords, phrase, answer, matches: selectionWords.length,
    });
    return selectionWords;
  } else {
    console.log('AI response ERROR:', {
      verseWords, phrase, answer, matches: selectionWords.length,
    });
  }
  return [];
}

/**
 * Builds the check-data filename for a language/book pair.
 * @param {string} langId
 * @param {string} bookId
 * @returns {string} - e.g. 'en_tit.json'
 */
export function getCheckDataFilename(langId, bookId) {
  return langId + '_' + bookId + '.json';
}

/**
 * Tokenizes verse text into a list of word strings using the wordmap-lexer.
 * @param {string} verseText
 * @returns {Array<string>} - words in reading order
 */
export function getWordList(verseText) {
  const tokenList = Lexer.tokenize(verseText);
  const wordList = tokenList.map(token => (token.text));
  return wordList;
}

/**
 * Strips punctuation from gateway-language text by tokenizing it into words and rejoining.
 * @param {string} glText
 * @returns {string} - text with punctuation removed
 */
export function removePunctuation(glText) {
  const wordList = getWordList(glText);
  return wordList.join(' ');
}

/**
 * Removes brace, punctuation, and quote characters from a gateway-language quote.
 * @param {string} glQuote
 * @returns {string} - cleaned quote
 */
export function cleanQuote(glQuote) {
  const replaceChars = ['{', '}', '.', ',', ';', ':', '"', '(', ')'];
  let cleanedQuote = glQuote;

  // remove any characters in replaceChars
  for (const char of replaceChars) {
    cleanedQuote = cleanedQuote.split(char).join('');
  }
  return cleanedQuote;
}

/**
 * Cleans a gateway-language quote that may contain ellipsis (`…`) and ampersand (` & `)
 * separated parts, running `removePunctuation` on each sub-part while preserving those separators.
 * @param {string} glQuote
 * @returns {string} - cleaned quote with ellipsis/ampersand separators preserved
 */
export function cleanQuote2(glQuote) {
  const AMPERSAND = ' & ';
  const ELLIPSIS = '\u2026';
  let cleanedString = '';
  const parts = glQuote.split(ELLIPSIS);

  for (const part of parts) {
    let cleanedString2 = '';
    const parts2 = part.split(AMPERSAND);

    for (const part2 of parts2) {
      const cleanedPart2 = removePunctuation(part2);

      if (cleanedString2) {
        cleanedString2 += AMPERSAND;
      }
      cleanedString2 += cleanedPart2;
    }

    if (cleanedString) {
      cleanedString += ELLIPSIS;
    }
    cleanedString += cleanedString2;
  }
  return cleanedString;
}

/**
 * Normalizes a previous-translation-history object by running `normalizer` over every
 * gateway-language quote key and every target-language rendering key.
 * @param {object} selectionsForTWordsRaw - nested `{glQuote: {rendering: count}}` object
 * @returns {object} - same shape, with all keys normalized
 */
export function normalizeHistory(selectionsForTWordsRaw) {
  const selectionsForTWords = { };

  for (const glQuote of Object.keys(selectionsForTWordsRaw)) {
    const glQuote_ = normalizer(glQuote);
    const translations_ = {};

    const translations = selectionsForTWordsRaw[glQuote];

    for (const translation of Object.keys(translations)) {
      const translation_ = normalizer(translation);
      translations_[translation_] = translations[translation];
    }
    selectionsForTWords[glQuote_] = translations_;
  }
  return selectionsForTWords;
}

/**
 * Joins an array of selection objects into a single space-separated string of their text.
 * @param {Array<{text: string}>} selections
 * @returns {string} - the selected words joined by spaces
 */
export function selectionsToString(selections) {
  const selectionWords = selections.map( selection => (selection.text));
  return selectionWords.join(' ');
}

/**
 * Cleans a gateway-language quote by removing punctuation, normalizing the text,
 * and removing remaining brace, punctuation, and quote characters.
 * @param {string} glText - gateway-language quote to clean
 * @returns {string} - cleaned and normalized quote
 */
export function cleanGlQuote(glText) {
  return cleanQuote(removePunctuation(normalizer(glText)));
}

/**
 * Tallies each check's target-language selection against its gateway-language quote, updating
 * `selectionsForWord` in place with `{glQuote: {selectedText: count}}` counts.
 *
 * For each check, the gateway-language quote is found with
 * `gatewayLanguageHelpers.getAlignedTextFromBible()`: the gateway-language words in `bible`
 * aligned to `contextId.quote` / `contextId.occurrence` at `contextId.reference`. That text then
 * goes through {@link removePunctuation} and `normalizer`. Checks are skipped if they have no
 * `contextId` or `selections`, if `bible` is missing, or if no aligned text is found.
 *
 * Calling this once per book with the same `selectionsForWord` adds up the counts across books
 * (see {@link fetchPreviousSelectionData}).
 *
 * @param {Array<{contextId: ContextId, selections: Array<{text: string, occurrence: number}>}>} checks
 *   - checking-tool check records, e.g. the contents of
 *   `.apps/translationCore/index/{toolName}/{bookId}/{groupId}.json`; may be null or empty
 * @param {string} gatewayLanguageCode - gateway language code (currently unused)
 * @param {object} tsvRelation - TSV relation data (currently unused)
 * @param {object} bible - gateway-language book used to find the aligned text for each check
 * @param {Object<string, Object<string, number>>} selectionsForWord - accumulator in the same
 *   format as the return value; changed in place. Pass `{}` to start a new tally.
 * @returns {Object<string, Object<string, number>>} the same `selectionsForWord` object, nested
 *   two levels:
 *   - **outer key** (`glQuote`): the check's aligned gateway-language text, with punctuation
 *     removed and passed through `normalizer` (e.g. 'faith', 'by faith')
 *   - **inner key** (`selectedText`): the `text` of each of the check's selections, joined by
 *     single spaces (e.g. 'fe', 'la fe'). It is not normalized. A check whose `selections` is an
 *     empty array is counted under the key `''`.
 *   - **value**: how many checks so far had that selection for that gateway-language text
 *     (always 1 or more), including counts already in `selectionsForWord` when it was passed in
 * @example
 * const checks = [
 *   { contextId: { reference: { chapter: 2, verse: 16 }, quote: 'πίστεως', occurrence: 1 },
 *     selections: [{ text: 'fe', occurrence: 1 }] },
 *   { contextId: { reference: { chapter: 3, verse: 7 }, quote: 'πίστεως', occurrence: 1 },
 *     selections: [{ text: 'la', occurrence: 1 }, { text: 'fe', occurrence: 1 }] },
 * ];
 * const selectionsForWord = { 'faith': { 'fe': 2 } };
 * getSelectionsForBook(checks, 'en', tsvRelation, glBook, selectionsForWord);
 * // If both checks align to 'faith', selectionsForWord is now:
 * // { 'faith': { 'fe': 3, 'la fe': 1 } }
 */
export function getSelectionsForBook(checks, gatewayLanguageCode, tsvRelation, bible, selectionsForWord ) {
  if (checks?.length) {
    for (const check of checks) {
      const contextId = check?.contextId;
      const selectionsForCheck = check?.selections;

      if (selectionsForCheck && contextId) {
        let glQuote = null;

        if (!glQuote) {// need quote
          let glText = null;

          if (bible) { // if already have bible use it
            glText = gatewayLanguageHelpers.getAlignedTextFromBible(
              contextId,
              bible
            );
          }

          if (glText) {
            glText = cleanGlQuote(glText);
            glQuote = glText;
          }
        }

        // if (glQuote.includes('{')) {
        //   console.log('glQuote includes {');
        // }

        if (glQuote && selectionsForCheck) {
          const selectedText = selectionsForCheck
            ?.map(word => word?.text)
            ?.join(' ');

          let glQuoteMatches = selectionsForWord[glQuote];

          if (!glQuoteMatches) {
            glQuoteMatches = {};
            selectionsForWord[glQuote] = glQuoteMatches;
          }

          let selectedTextCount = glQuoteMatches[selectedText];

          if (!selectedTextCount) {
            glQuoteMatches[selectedText] = 1;
          } else {
            glQuoteMatches[selectedText]++;
          }

          //logIfContainsOpeningBrace(selectionsForWord);
        }
      }
    }
  }
  return selectionsForWord;
}

/**
 * Constructs the file path to a data file in the base tCore folder.
 *
 * This function navigates up two directory levels from the project path to reach
 * the base tCore folder, then appends the specified data filename. It is used
 * internally by multiple functions to build paths to various configuration and
 * data files stored at the tCore root level.
 *
 * @param {string} projectPath - The path to the current project directory (e.g., '/path/to/tCore/projects/myProject')
 * @param {string} dataFileName - The name of the data file to locate (e.g., 'checking_settings.json', 'llmMetrics.json')
 * @returns {string} The absolute path to the data file in the base tCore folder
 * @example
 * const settingsPath = getTcorePathFromProjectPath(
 *   '/path/to/tCore/projects/myProject',
 *   'checking_settings.json'
 * );
 * // Returns: '/path/to/tCore/checking_settings.json'
 *
 * @example
 * const metricsPath = getTcorePathFromProjectPath(
 *   '/path/to/tCore/projects/myProject',
 *   'llmMetrics.json'
 * );
 * // Returns: '/path/to/tCore/llmMetrics.json'
 *
 * @see {@link getSettingsPath} - Higher-level function that calls this with 'checking_settings.json'
 * @see {@link saveLlmMetrics} - Uses this function to construct the metrics file path
 * @see {@link readLlmMetrics} - Uses this function to construct the metrics file path
 */
function getTcorePathFromProjectPath(projectPath, dataFileName) {
  const baseTCoreFolder = path.join(projectPath, '../..');
  const settingFilePath = path.join(baseTCoreFolder, dataFileName);
  return settingFilePath;
}

const metricsFileName = 'llmMetrics.json';

/**
 * Saves LLM performance metrics data to a JSON file.
 *
 * Writes the provided metrics data to llmMetrics.json in the base tCore folder,
 * creating the file and any necessary parent directories if they don't exist.
 * The JSON is formatted with 2-space indentation for readability.
 *
 * This function is used to track AI model performance metrics such as response times,
 * model versions used, confidence scores, and accuracy statistics across translation
 * checking sessions.
 *
 * @param {string} projectPath - The path to the current project directory
 * @param {object} data - The metrics data object to save, typically containing fields like:
 *   - modelName: string - Name of the AI model used
 *   - responseTime: number - Average response time in seconds
 *   - queries: number - Total number of queries made
 *   - accuracy: number - Accuracy percentage if available
 * @returns {void}
 * @throws Does not throw; logs error to console if file write fails
 * @example
 * saveLlmMetrics('/path/to/project', {
 *   modelName: 'Meta-Llama-3.1-8B',
 *   avgResponseTime: 1.23,
 *   totalQueries: 42,
 *   avgConfidence: 87.5
 * });
 * // Creates/updates: /path/to/tCore/llmMetrics.json with formatted JSON
 *
 * @see {@link readLlmMetrics} - Corresponding function to read the saved metrics
 * @see {@link getTcorePathFromProjectPath} - Helper function used to construct the file path
 */
export function saveLlmMetrics(projectPath, data) {
  const metricsFilePath = getTcorePathFromProjectPath(projectPath, metricsFileName);

  try {
    fs.outputJsonSync(metricsFilePath, data, { spaces: 2 });
  } catch (error) {
    console.error(`Could not save metrics to ${metricsFilePath}`, error);
  }
}

/**
 * Updates LLM performance metrics by calculating a rolling average of elapsed times
 * for each unique URL/model combination.
 *
 * This function maintains performance statistics for AI model queries across translation
 * checking sessions. It tracks the average response time and query count for each
 * unique combination of server URL and model identifier. The metrics are stored in a
 * JSON file in the base tCore folder and updated incrementally using a rolling average
 * algorithm to avoid recalculating from all historical data.
 *
 * **Rolling Average Algorithm:**
 * For each new query, the average is updated using the formula:
 * ```
 * newAverage = oldAverage + (newValue - oldAverage) / newCount
 * ```
 * This approach maintains accurate averages while only requiring the previous average
 * and count, making it efficient for long-running sessions with many queries.
 *
 * **Metrics Structure:**
 * The metrics data is keyed by `{url}_{model}` strings, with each entry containing:
 * - `elapsedTime`: Rolling average response time in seconds
 * - `count`: Total number of queries recorded for this URL/model combination
 *
 * @param {string} projectPath - The path to the current project directory; used to locate
 *   the base tCore folder where llmMetrics.json is stored
 * @param {string} [url=''] - Base URL of the OpenAI-compatible server (e.g., 'http://localhost:1234');
 *   combined with `model` to create a unique metrics key
 * @param {string} [model=''] - AI model identifier (e.g., 'Meta-Llama-3.1-8B'); combined with
 *   `url` to create a unique metrics key
 * @param {string|number} [elapsedTime=''] - Response time for the current query; can be:
 *   - A string representing a decimal number (e.g., "1.23")
 *   - A numeric value (will be used directly or defaulted to 0 if falsy)
 * @returns {void} - Mutates the metrics file on disk; does not return a value
 * @throws Does not throw; logs errors to console if file operations fail
 * @example
 * // After a successful AI query
 * updateLlmMetrics(
 *   '/path/to/project',
 *   'http://localhost:1234',
 *   'Meta-Llama-3.1-8B',
 *   '2.35'  // 2.35 seconds elapsed
 * );
 * // Updates metrics file with new rolling average for this URL/model combination
 *
 * @example
 * // Metrics file structure after several updates:
 * // {
 * //   "http://localhost:1234_Meta-Llama-3.1-8B": {
 * //     "elapsedTime": 2.1,  // average of all queries
 * //     "count": 15          // total queries recorded
 * //   },
 * //   "http://192.168.1.100:1234_different-model": {
 * //     "elapsedTime": 3.4,
 * //     "count": 8
 * //   }
 * // }
 *
 * @see {@link readLlmMetrics} - Function to retrieve saved metrics data
 * @see {@link saveLlmMetrics} - Function to persist metrics to disk
 * @see {@link getBestSelections} - Example caller that invokes this function after AI queries
 */
export function updateLlmMetrics(projectPath, url = '', model = '', elapsedTime = '') {
  let elapsedTime_;

  if (typeof elapsedTime === 'string') {
    elapsedTime_ = parseFloat(elapsedTime);
  } else {
    elapsedTime_ = elapsedTime || 0;
  }

  // console.log('updateLlmMetrics', {
  //   projectPath,
  //   url,
  //   model,
  //   elapsedTime,
  //   elapsedTime_,
  // });

  let metrics = readLlmMetrics(projectPath);
  const key = `${url}_${model}`;

  // console.log('updateLlmMetrics initial metrics', {
  //   key,
  //   metrics,
  // });

  if (!metrics) {
    metrics = {};
  }

  let newAverage = elapsedTime_;
  let count_ = 1;

  if (!metrics[key]) {
    metrics[key] = { elapsedTime: elapsedTime_, count: 1 };
  } else {
    let { elapsedTime: averageTime, count } = metrics[key];
    count++;
    count_ = count;
    newAverage = averageTime + (elapsedTime_ - averageTime) / count;
    metrics[key] = { elapsedTime: newAverage, count };
  }

  console.log('updateLlmMetrics final metrics', {
    newAverage,
    newCount: count_,
    key,
    metrics,
  });

  saveLlmMetrics(projectPath, metrics);
}

/**
 * Reads LLM performance metrics data from a JSON file.
 *
 * Attempts to read and parse the llmMetrics.json file from the base tCore folder.
 * Returns the parsed metrics object if successful, or null if the file doesn't exist
 * or cannot be read.
 *
 * This function is used to retrieve previously saved AI model performance metrics
 * for analysis, reporting, or continued tracking across sessions.
 *
 * @param {string} projectPath - The path to the current project directory
 * @returns {object|null} The parsed metrics object containing fields like:
 *   - modelName: string - Name of the AI model used
 *   - responseTime: number - Average response time in seconds
 *   - queries: number - Total number of queries made
 *   - accuracy: number - Accuracy percentage if available
 *   Returns null if the file doesn't exist or cannot be read
 * @example
 * const metrics = readLlmMetrics('/path/to/project');
 * if (metrics) {
 *   console.log(`Average response time: ${metrics.avgResponseTime}s`);
 *   console.log(`Total queries: ${metrics.totalQueries}`);
 * } else {
 *   console.log('No metrics file found');
 * }
 * // Returns: { modelName: 'Meta-Llama-3.1-8B', avgResponseTime: 1.23, ... }
 * // or null if file doesn't exist
 *
 * @see {@link saveLlmMetrics} - Corresponding function to save metrics
 * @see {@link getTcorePathFromProjectPath} - Helper function used to construct the file path
 */
export function readLlmMetrics(projectPath) {
  const metricsFilePath = getTcorePathFromProjectPath(projectPath, metricsFileName);

  try {
    const data = fs.readJsonSync(metricsFilePath, data, { spaces: 2 });
    return data;
  } catch (error) {
    console.error(`Could not read metrics from ${metricsFilePath}`, error);
  }
  return null;
}

/**
 * Gets the file path for storing checking settings.
 *
 * Constructs the path to the checking_settings.json file by navigating up two directories
 * from the project path to the base tCore folder.
 *
 * @param {string} projectPath - The path to the current project directory
 * @returns {string} The absolute path to the checking_settings.json file
 * @example
 * const settingsPath = getSettingsPath('/path/to/tCore/projects/myProject');
 * // Returns: '/path/to/tCore/checking_settings.json'
 */
function getSettingsPath(projectPath) {
  const settingsFileName = 'checking_settings.json';
  return getTcorePathFromProjectPath(projectPath, settingsFileName);
}

/**
 * Saves checking settings data to a JSON file.
 *
 * Writes the provided settings data to checking_settings.json in the base tCore folder,
 * creating the file and any necessary parent directories if they don't exist.
 * The JSON is formatted with 2-space indentation for readability.
 *
 * @param {string} projectPath - The path to the current project directory
 * @param {object} data - The settings data object to save
 * @returns {void}
 * @throws {Error} Logs error to console if file write fails, but does not throw
 * @example
 * saveSettingsForChecking_('/path/to/project', { autoCheck: true, threshold: 80 });
 * // Creates/updates: /path/to/tCore/checking_settings.json with formatted JSON
 */
export function saveSettingsForChecking_(projectPath, data) {
  const settingFilePath = getSettingsPath(projectPath);

  try {
    fs.outputJsonSync(settingFilePath, data, { spaces: 2 });
  } catch (error) {
    console.error(`Could not save settings to ${settingFilePath}`, error);
  }
}

/**
 * Reads checking settings data from a JSON file.
 *
 * Attempts to read and parse the checking_settings.json file from the base tCore folder.
 * Returns the parsed settings object if successful, or null if the file doesn't exist
 * or cannot be read.
 *
 * @param {string} projectPath - The path to the current project directory
 * @returns {object|null} The parsed settings object, or null if reading fails
 * @example
 * const settings = readSettingsForChecking_('/path/to/project');
 * // Returns: { autoCheck: true, threshold: 80 } or null if file doesn't exist
 */
export function readSettingsForChecking_(projectPath) {
  const settingFilePath = getSettingsPath(projectPath);

  try {
    const data = fs.readJsonSync(settingFilePath, data, { spaces: 2 });
    return data;
  } catch (error) {
    console.error(`Could not read settings from ${settingFilePath}`, error);
  }
  return null;
}

/**
 * Extracts project metadata from a project save location path.
 *
 * This function parses the project directory path to extract key metadata components including
 * the project name, parent projects folder, book ID, language ID, and resource ID. It serves
 * as a convenience wrapper around path parsing and project name detail extraction.
 *
 * The function performs two main operations:
 * 1. **Path parsing**: Uses `path.parse()` to break down the full project path into its
 *    components (directory, base name, extension, etc.)
 * 2. **Name parsing**: Calls {@link getDetailsFromProjectNameMini} to extract structured
 *    metadata from the project folder name
 *
 * Project naming conventions:
 * - **New format**: `{languageId}_{resourceId}_{bookId}_book` (e.g., 'en_ult_tit_book')
 * - **Old formats**: Various legacy formats like `{languageId}_{bookId}` or
 *   `{languageId}_{resourceId}_text_reg`
 *
 * The function is commonly used at the start of project-level operations to establish context
 * for subsequent file system operations, resource lookups, and cross-project analysis.
 *
 * @param {string} projectSaveLocation - Absolute or relative path to the project directory
 *   (e.g., '/path/to/tCore/projects/en_ult_tit_book')
 * @returns {{parsed: object, projectsFolder: string, currentBookId: string, currentLanguageId: string, currentResourceId: string}}
 *   Object containing:
 *   - **parsed**: The full parsed path object from `path.parse()` with properties:
 *     - **root**: Root directory (e.g., '/' on Unix)
 *     - **dir**: Parent directory path
 *     - **base**: Full filename/folder name (the project name)
 *     - **ext**: File extension (typically empty for directories)
 *     - **name**: Filename without extension
 *   - **projectsFolder**: Absolute path to the parent projects directory
 *   - **currentBookId**: Bible book identifier (e.g., 'tit', 'gen', 'mat'); empty string if not
 *     a valid book or cannot be determined
 *   - **currentLanguageId**: Language code (e.g., 'en', 'es-419'); the first component of the
 *     project name
 *   - **currentResourceId**: Resource identifier (e.g., 'ult', 'ust', 'reg'); empty string if
 *     not present in the project name (common for old format projects)
 * @example
 * const info = getProjectInfo('/path/to/tCore/projects/en_ult_tit_book');
 * // Returns: {
 * //   parsed: {
 * //     root: '/',
 * //     dir: '/path/to/tCore/projects',
 * //     base: 'en_ult_tit_book',
 * //     ext: '',
 * //     name: 'en_ult_tit_book'
 * //   },
 * //   projectsFolder: '/path/to/tCore/projects',
 * //   currentBookId: 'tit',
 * //   currentLanguageId: 'en',
 * //   currentResourceId: 'ult'
 * // }
 *
 * @example
 * // Old format project
 * const info = getProjectInfo('/path/to/tCore/projects/aaw_php_text_reg');
 * // Returns: {
 * //   parsed: { ... },
 * //   projectsFolder: '/path/to/tCore/projects',
 * //   currentBookId: 'php',  // 'php' is recognized as book ID for Philippians
 * //   currentLanguageId: 'aaw',
 * //   currentResourceId: ''  // Old format lacks explicit resource ID
 * // }
 *
 * @see {@link getDetailsFromProjectNameMini} - Used internally to parse project name components
 * @see {@link fetchPreviousSelectionData} - Example usage in project scanning operations
 */
export function getProjectInfo(projectSaveLocation) {
  const parsed = path.parse(projectSaveLocation);
  const projectName = parsed.base;
  const projectsFolder = parsed.dir;

  const {
    bookId: currentBookId,
    languageId: currentLanguageId,
    resourceId: currentResourceId,
  } = getDetailsFromProjectNameMini(projectName);
  return {
    parsed,
    projectsFolder,
    currentBookId,
    currentLanguageId,
    currentResourceId,
  };
}

/**
 * Scans sibling projects on disk for the same language/resource/testament combination and
 * aggregates their previous target-language selections for `groupId`, using and updating
 * `glBiblesCache` to avoid re-reading the gateway-language bible for each project.
 *
 * A sibling project is included when it is in the same projects folder as the current project,
 * is a Bible book in the same testament (OT vs NT), and has the same `languageId` and
 * `resourceId`. The current project is included too. Projects are skipped if no installed
 * version of the gateway-language bible can be found for them.
 *
 * For each included project, the checks in
 * `.apps/translationCore/index/{toolName}/{bookId}/{groupId}.json` are tallied by
 * {@link getSelectionsForBook}: each check's gateway-language text (from its `contextId`) is
 * paired with the target-language words the user selected.
 *
 * @param {string} projectSaveLocation - path to the current project folder; its parent folder
 *   is scanned for sibling projects
 * @param {ContextId} contextId - context of the current check
 * @param {object} glBibles - available gateway-language bibles keyed by bible id; the first id
 *   in `bibleIdSort` order picks which gateway-language bible is loaded for each project
 * @param {object} tsvRelation - TSV relation data used to resolve aligned gateway-language text
 * @param {string} toolName - checking tool name, used to build the selections index path
 *   (e.g. 'translationWords')
 * @param {string} groupId - group id (e.g. translationWords entry like 'faith') to gather
 *   selections for
 * @param {string} gatewayLanguageCode - gateway language code (e.g. 'en')
 * @param {string} glOwnerStr - owner string for resolving the most recent gateway bible version
 * @param {object} data - data used only for logging (expects `contextId`)
 * @param {{targetLangId: string|null, resourceId: string|null, glBibleId: string|null,
 *   bibles: Object<string, object>}} glBiblesCache - cache that is changed in place and must
 *   be an object (not null). `bibles` maps book id to a loaded gateway-language book. The cache
 *   is cleared when `targetLangId`, `resourceId` or `glBibleId` no longer match the current
 *   project.
 * @returns {Object<string, Object<string, number>>} previous selections, nested two levels:
 *   - **outer key** (`glQuote`): the gateway-language text aligned to a check, with punctuation
 *     removed and then passed through `normalizer` (e.g. 'faith', 'by faith'). The inner keys
 *     are normalized.
 *   - **inner key** (`selectedText`): the target-language words the user selected for that
 *     check, joined by single spaces (e.g. 'fe', 'la fe')
 *   - **value**: how many checks across all included projects used that selection for that
 *     gateway-language text (always 1 or more)
 *
 *   Returns `{}` if no included project has checks for `groupId`.
 * @example
 * const selectionsForWord = fetchPreviousSelectionData(
 *   '/path/to/tCore/projects/es-419_glt_gal_book',
 *   contextId, glBibles, tsvRelation, 'translationWords', 'faith', 'en',
 *   'unfoldingWord', data, glBiblesCache,
 * );
 * // Returns: {
 * //   'faith': { 'fe': 12, 'la fe': 3 },
 * //   'by faith': { 'por la fe': 4 },
 * // }
 */
export function fetchPreviousSelectionData(
  projectSaveLocation,
  contextId,
  glBibles,
  tsvRelation,
  toolName,
  groupId,
  gatewayLanguageCode,
  glOwnerStr,
  data,
  glBiblesCache,
) {
  const {
    parsed,
    projectsFolder,
    currentBookId,
    currentLanguageId,
    currentResourceId,
  } = getProjectInfo(projectSaveLocation);

  const projects = fs.readdirSync(projectsFolder);

  if (
    glBiblesCache?.targetLangId !== currentLanguageId ||
    glBiblesCache?.resourceId !== currentResourceId
  ) {
    // if targetLangId or resourceId has changed, clear cache
    glBiblesCache.targetLangId = currentLanguageId;
    glBiblesCache.resourceId = currentResourceId;
    glBiblesCache.glBibleId = null;
    glBiblesCache.bibles = {};
  }

  // eslint-disable-next-line no-unused-vars
  let { bible: foundBible } = gatewayLanguageHelpers.getAlignedGLTextHelperMajor(
    contextId,
    glBibles,
    tsvRelation,
    currentLanguageId
  );

  const bibleIds = Object.keys(glBibles);
  const sortedBibleIds = bibleIds.sort(gatewayLanguageHelpers.bibleIdSort);
  const glBibleId = sortedBibleIds[0];

  const usingNT = isNT(currentBookId);
  let selectionsForWord = {};
  console.log('projects', projects);

  for (const projectName_ of projects) {
    const {
      bookId, languageId, resourceId,
    } = getDetailsFromProjectNameMini(
      projectName_
    );

    const isBible = isBibleBookId(bookId);
    const isNt = isNT(bookId);

    const matchingResource =
      isBible &&
      isNt === usingNT &&
      languageId === currentLanguageId &&
      resourceId === currentResourceId;

    if (!matchingResource) {
      continue; // skip
    }

    const projectPath = path.join(projectsFolder, projectName_);

    //    '.apps/translationCore/index/translationWords/gal/faith.json'
    const selectionsPath = path.join(
      projectPath,
      `.apps/translationCore/index/${toolName}/${bookId}/${groupId}.json`
    );

    console.log('selectionsPath', selectionsPath);

    const checks = readJsonFile(selectionsPath);
    const resourcesFolder = path.join(
      projectsFolder,
      '../resources',
      gatewayLanguageCode,
      'bibles',
      glBibleId
    );
    const mostRecent = getMostRecentVersionInFolderMajor(
      resourcesFolder,
      glOwnerStr
    );

    if (!mostRecent) {
      continue;
    }

    let foundBible = null;

    if ( glBiblesCache?.glBibleId === glBibleId) {
      foundBible = glBiblesCache?.bibles[bookId];
    }

    if (!foundBible) {
      const glBibleFolder = path.join(resourcesFolder, mostRecent, bookId);
      foundBible = readHelpsFolder(glBibleFolder);

      if (foundBible) {
        if (glBiblesCache?.glBibleId !== glBibleId) { // if bibleId has changed, clear cache
          glBiblesCache.glBibleId = glBibleId;
          glBiblesCache.bibles = {};
        }

        glBiblesCache.bibles[bookId] = foundBible;
      }
    }

    if (foundBible) {
      getSelectionsForBook(
        checks,
        gatewayLanguageCode,
        tsvRelation,
        foundBible,
        selectionsForWord
      );
    }
  }
  console.log(
    `Container ${projects?.length} projects, contextId`,
    data.contextId,
    {
      data,
      projectSaveLocation,
      parsed,
    }
  );
  return selectionsForWord;
}

/**
 * Updates the previous selections data by decrementing the count for old selections
 * and incrementing the count for new selections.
 *
 * This function maintains a history of translation selections, tracking how many times
 * each target-language rendering has been chosen for a given gateway-language phrase.
 * The data structure is nested: `{glPhrase: {targetRendering: count}}`.
 *
 * When a user changes their selection:
 * - The count for the old selection is decremented (if it exists)
 * - The count for the new selection is incremented (creating a new entry if needed)
 *
 * This selection history is used by the AI and algorithmic suggestion systems to
 * prioritize previously-used translations when making new suggestions.
 *
 * @param {Array<{text: string, occurrence: number}>} oldSelections - the previous word selections
 *   being replaced; each object contains `text` (the word) and `occurrence` (1-based index)
 * @param {object} savedSelections - the nested selection-count object being updated in place;
 *   structure: `{glPhrase: {targetRendering: count}}`
 * @param {string} alignedGLText - the gateway-language phrase (key) these selections are for
 * @param {Array<{text: string, occurrence: number}>} newSelections - the new word selections
 *   being saved; same structure as `oldSelections`
 * @returns {void} - mutates `savedSelections` in place
 * @example
 * const savedSelections = { 'church': { 'iglesia': 5, 'la iglesia': 2 } };
 * const oldSelections = [{ text: 'iglesia', occurrence: 1 }];
 * const newSelections = [{ text: 'la', occurrence: 1 }, { text: 'iglesia', occurrence: 1 }];
 *
 * updatedPreviousSelectionsData(oldSelections, savedSelections, 'church', newSelections);
 * // savedSelections is now: { 'church': { 'iglesia': 4, 'la iglesia': 3 } }
 */
export function updatedPreviousSelectionsData(
  oldSelections,
  savedSelections,
  alignedGLText,
  newSelections
) {
  if (oldSelections?.length) {
    let savedSelectionForGL = savedSelections?.[alignedGLText];

    if (savedSelectionForGL) {
      const oldSelectionsStr = oldSelections.map(s => s.text).join(' ');
      let savedSelectionForTarget = savedSelectionForGL[oldSelectionsStr];

      if (savedSelectionForTarget) {
        if (--savedSelectionForTarget > 0 ) {
          savedSelectionForGL[oldSelectionsStr] = savedSelectionForTarget;
        } else { // when zero count is reached remove entirely
          delete savedSelectionForGL[oldSelectionsStr];
        }
      }
    }
  }

  if (newSelections?.length) {
    let savedSelectionForGL = savedSelections?.[alignedGLText];

    if (!savedSelectionForGL) {
      savedSelectionForGL = {};
      savedSelections[alignedGLText] = savedSelectionForGL;
    }

    const newSelectionsStr = newSelections.map(s => s.text).join(' ');
    const translation = savedSelectionForGL[newSelectionsStr];

    if (!translation) {
      savedSelectionForGL[newSelectionsStr] = 1;
    } else {
      savedSelectionForGL[newSelectionsStr] = translation + 1;
    }
  }

  // do cleanup of empty counts
  for (const glWord of Object.keys(savedSelections)) {
    const translations = savedSelections[glWord];

    for (const translationWord of Object.keys(translations)) {
      const count = translations[translationWord];

      if (!(count > 0)) {
        delete translations[translationWord];
      }
    }
  }
}

/**
 * Finds the best target-language translation selections for a gateway-language phrase within a verse.
 *
 * This function identifies the most appropriate target-language word(s) that correspond to a gateway-language
 * phrase in the context of a specific verse. It operates in two distinct modes:
 *
 * **1. Algorithmic mode** (when `llmQueryUrl` is `null` or `undefined`):
 * - Uses historical translation data and pattern matching algorithms
 * - Suggests selections based on previous translation choices
 * - Works entirely offline without requiring an AI model
 * - Returns immediately with `elapsedStr: '0'` and `model: 'APP'`
 *
 * **2. AI-assisted mode** (when `llmQueryUrl` is provided):
 * - Queries a locally-running LM Studio server
 * - Leverages an AI language model for intelligent translation suggestions
 * - Considers both semantic meaning and translation history
 * - Returns timing information and actual model name used
 *
 * The function processes the verse text into individual words, then delegates to either
 * {@link getBestTWordSelectionWithConfidenceAlgorithm} or {@link getBestTWordSelectionWithConfidenceFromLlm}
 * depending on the mode.
 *
 * @param {object} options - Request options
 * @param {string} options.verseText - The target-language verse text to search within (may contain punctuation)
 * @param {string|null} [options.llmQueryUrl] - Base URL of the OpenAI-compatible server (e.g., 'http://localhost:1234');
 *   if `null` or `undefined`, uses algorithmic mode instead of AI
 * @param {object} options.targetLanguageDetails - Metadata about the target language
 * @param {string} options.targetLanguageDetails.id - Language code (e.g., 'es-419' for Latin American Spanish)
 * @param {string} options.alignedGLText - Gateway-language phrase to translate (e.g., 'church', 'the elders')
 * @param {string} options.gatewayLanguageCode - Language code of the gateway language (e.g., 'en' for English)
 * @param {object} options.selectionsData - Historical translation data from previous user selections
 * @param {object} options.selectionsData.selections - Nested mapping of gateway phrases to target renderings with usage counts:
 *   `{glPhrase: {targetRendering: count}}`, or flat format `{targetRendering: count}` if pre-filtered
 * @param {string} [options.model='local-model'] - AI model identifier to use (only relevant when `llmQueryUrl` is provided);
 *   the actual model used may differ and is reported in the response
 * @param {number} [options.llmTemperature=0.7] - Sampling temperature for AI model (0.0-1.0); higher values increase
 *   randomness and creativity in suggestions, lower values make output more deterministic; only applies in AI mode
 * @param {string} [options.apiToken] - Bearer token for LLM API requests when required
 * @returns {Promise<{error: boolean, bestSelections: Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>, elapsedStr: string, model: string}>}
 *   Promise resolving to an object containing:
 *   - **error**: `true` if the operation failed or no valid translations were found, `false` otherwise
 *   - **bestSelections**: Array of translation options (up to 3), sorted by confidence score (highest first). Each option contains:
 *     - **selections**: Array of word objects representing the matched phrase, each with:
 *       - **text**: The normalized word form as it appears in the verse (without punctuation)
 *       - **occurrence**: 1-based occurrence index of this word in the verse (e.g., if 'iglesia' appears twice, first is 1, second is 2)
 *     - **confidence**: Integer from 0-100 indicating match certainty (100 = exact match, lower = partial/fuzzy match)
 *   - **elapsedStr**: Elapsed time in seconds as a formatted string (e.g., "1.23" for AI mode, "0" for algorithmic mode)
 *   - **model**: Model identifier string ('APP' for algorithmic mode, actual AI model name for AI mode, empty string on error)
 *   Returns `{error: true, bestSelections: [], elapsedStr: '', model: ''}` if no valid translations are found or on error
 * @example
 * // Algorithmic mode (offline, no AI server)
 * const result = await getBestSelections({
 *   verseText: 'para la iglesia de Éfeso',
 *   llmQueryUrl: null, // no AI server URL
 *   targetLanguageDetails: { id: 'es-419' },
 *   alignedGLText: 'church',
 *   gatewayLanguageCode: 'en',
 *   selectionsData: { selections: { 'church': { 'iglesia': 7, 'la iglesia': 3 } } },
 * });
 * // Returns: {
 * //   error: false,
 * //   bestSelections: [
 * //     { selections: [{text: 'iglesia', occurrence: 1}], confidence: 98 },
 * //     { selections: [{text: 'la', occurrence: 1}, {text: 'iglesia', occurrence: 1}], confidence: 70 }
 * //   ],
 * //   elapsedStr: '0',
 * //   model: 'APP'
 * // }
 *
 * @example
 * // AI-assisted mode (requires OpenAI-compatible server running)
 * const result = await getBestSelections({
 *   verseText: 'para la iglesia de Éfeso',
 *   llmQueryUrl: 'http://localhost:1234', // OpenAI-compatible server URL
 *   targetLanguageDetails: { id: 'es-419' },
 *   alignedGLText: 'church',
 *   gatewayLanguageCode: 'en',
 *   selectionsData: { selections: { 'church': { 'iglesia': 7 } } },
 *   model: 'my-model-v1', // optional custom model identifier
 *   llmTemperature: 0.9, // optional temperature for more creative suggestions
 * });
 * // Returns: {
 * //   error: false,
 * //   bestSelections: [...], // AI-generated suggestions with confidence scores
 * //   elapsedStr: '2.35',
 * //   model: 'lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF'
 * // }
 *
 * @see {@link getBestTWordSelectionWithConfidenceAlgorithm} - Algorithmic implementation using pattern matching
 * @see {@link getBestTWordSelectionWithConfidenceFromLlm} - AI-assisted implementation using language models
 * @see {@link getWordList} - Function used to tokenize the verse text into individual words
 */
export async function getBestSelections(options = {}) {
  let jobs = [options];

  if (Array.isArray(options)) {
    jobs = options;
  }

  const jobResults = [];
  // TRICKY - llmQueryUrl assumed the same in all jobs
  const llmQueryUrl = jobs[0]?.llmQueryUrl;

  try {
    if (!llmQueryUrl) {
      for (const job of jobs) {
        let results = {
          bestSelections: [],
          elapsedStr: '',
          error: true,
          model: '',
        };

        try {
          const {
            verseText,
            targetLanguageDetails,
            alignedGLText,
            gatewayLanguageCode,
            selectionsData,
          } = job;

          const wordList = getWordList(verseText);

          // eslint-disable-next-line no-await-in-loop
          const bestSelections = await getBestTWordSelectionWithConfidenceAlgorithm(
            wordList,
            targetLanguageDetails.id,
            alignedGLText,
            gatewayLanguageCode,
            selectionsData?.selections,
            llmQueryUrl
          );

          results = {
            error: false,
            bestSelections,
            elapsedStr: '0',
            model: 'APP',
          };
        } catch (error) {
          console.error(`getBestSelections - error`, error, job);
          results = { error: true };
        }
        jobResults.push(results);
      }
    } else { // querying AI Model - all jobs are sent in a single query
      const llmRequests = jobs.map(job => {
        const {
          alignedGLText,
          apiToken,
          currentModel,
          gatewayLanguageCode,
          key,
          llmTemperature,
          selectionsData,
          targetLanguageDetails,
          verseText,
        } = job;

        return {
          wordList: getWordList(verseText),
          key,
          targetLangCode: targetLanguageDetails.id,
          glPhrase: alignedGLText,
          glLangCode: gatewayLanguageCode,
          previousTranslationData: selectionsData?.selections,
          lmOptions: {
            apiToken,
            baseUrl: llmQueryUrl,
            enable_thinking: false,
            model: currentModel,
            temperature: (llmTemperature || 0.7),
          },
        };
      });

      const llmRequests_ = llmRequests?.length > 1 ? llmRequests : llmRequests[0];
      const results = await getBestTWordSelectionWithConfidenceFromLlm(llmRequests_);

      if (Array.isArray(results)) {
        jobResults.push(...results);
      } else {
        jobResults.push(results);
      }
    }
  } catch (e) {
    console.error(`getBestSelections - error`, e);
    return jobs.map(() => ({ error: true }));
  }

  return jobResults;
}

/**
 * Compares two Unicode strings character by character and logs every difference.
 *
 * Uses `Array.from()` so surrogate pairs, such as emoji and other non-BMP code points,
 * are handled as single characters instead of separate UTF-16 code units.
 *
 * @param {string} firstString - first string to compare
 * @param {string} secondString - second string to compare
 * @returns {Array<object>} - list of differences found
 */
export function compareUnicodeStrings(firstString = '', secondString = '') {
  const firstChars = Array.from(firstString);
  const secondChars = Array.from(secondString);
  const maxLength = Math.max(firstChars.length, secondChars.length);
  const differences = [];

  for (let index = 0; index < maxLength; index++) {
    const firstChar = firstChars[index] || '';
    const secondChar = secondChars[index] || '';

    if (firstChar !== secondChar) {
      const difference = {
        index,
        first: firstChar,
        firstCodePoint: firstChar ? `U+${firstChar.codePointAt(0).toString(16).toUpperCase()}` : null,
        second: secondChar,
        secondCodePoint: secondChar ? `U+${secondChar.codePointAt(0).toString(16).toUpperCase()}` : null,
      };

      differences.push(difference);
      console.log('Unicode string difference:', difference);
    }
  }

  if (!differences.length) {
    console.log('Unicode strings match.');
  }

  return differences;
}

/**
 * Copies options with the API token masked so it is never written to the logs.
 *
 * @param {Object} [options={}] - Configuration options
 * @returns {Object} Options safe to log
 */
export function redactOptions(options = {}) {
  if (!options.apiToken) {
    return options;
  }

  return {
    ...options,
    apiToken: '***',
  };
}

