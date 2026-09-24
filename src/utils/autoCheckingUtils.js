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


const LM_STUDIO_URL = 'http://192.168.142.70:1234';

//////////////////////////////
// Testing Support functions
//////////////////////////////

/**
 * Streams a chat completion request to an LM Studio server and accumulates the response.
 *
 * This function sends a POST request to the LM Studio chat completions endpoint with streaming
 * enabled, then reads the Server-Sent Events (SSE) stream to accumulate the full response text.
 * It handles both standard content and reasoning content (thinking mode) from the AI model.
 *
 * The function processes the SSE stream line by line, parsing JSON chunks and extracting text
 * from either `delta.content` or `delta.reasoning_content` fields. It accumulates partial lines
 * in a buffer to handle chunks that arrive split across multiple reads.
 *
 * @param {object} options - Configuration options for the chat completion request
 * @param {string} options.baseUrl - Base URL of the LM Studio server (e.g., 'http://localhost:1234')
 * @param {string} options.model - Model identifier as configured in LM Studio (e.g., 'local-model')
 * @param {string} options.systemPrompt - System prompt that sets the AI's behavior and context
 * @param {string} options.query - User query/prompt to send to the model
 * @param {number} options.temperature - Sampling temperature (0.0-1.0); higher values increase randomness
 * @param {number} options.maxTokens - Maximum number of tokens to generate in the response
 * @param {boolean} options.enable_thinking - Whether to enable thinking mode via chat_template_kwargs
 * @returns {Promise<{replyText: string, actualModel: string}>} Object containing:
 *   - replyText: Complete accumulated response text from the model
 *   - actualModel: Actual model name reported by the server (may differ from requested model)
 * @throws {Error} If the server is unreachable, returns a non-OK status, or the response is malformed
 * @example
 * const result = await streamChatMessage(
 *   'http://localhost:1234',
 *   'local-model',
 *   'You are a helpful assistant.',
 *   'What is the capital of France?',
 *   0.7,
 *   2048,
 *   false
 * );
 * console.log(result.replyText); // "The capital of France is Paris."
 * console.log(`Request took ${Date.now() - result.startTime}ms`);
 *
 * @see {@link queryLmStudio} - Higher-level wrapper function that calls this internally
 */
async function streamChatMessage(options) {
  const {
    baseUrl, model, systemPrompt, query, temperature, maxTokens, enable_thinking,
  } = options;
  const url = `${baseUrl}/v1/chat/completions`;
  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const message1 = `Failed to reach LM Studio server at ${url}: ${error.message}`;
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
      };

      const dataStr = trimmed.slice(6);

      if (dataStr === '[DONE]') {
        break;
      };

      try {
        const chunk = JSON.parse(dataStr);
        actualModel = actualModel || chunk?.model || '';
        const delta = chunk?.choices?.[0]?.delta;
        const text = delta?.content || delta?.reasoning_content;

        if (text) {
          replyText += text;
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }
  return { replyText, actualModel };
}

/**
 * Sends a text query to a locally running LM Studio server and returns the model's response text
 * along with timing information.
 *
 * This function provides a unified interface for querying AI models through LM Studio, supporting
 * both Electron-based desktop applications and web-based environments. LM Studio exposes an
 * OpenAI-compatible API (chat completions endpoint) once "Local Server" is started from the
 * LM Studio app (default port 1234).
 *
 * The function automatically detects the execution environment:
 * - In Electron apps: uses the IPC bridge (window.lmStudio.query) for optimized performance
 * - In web/Node environments: makes direct HTTP requests via streamChatMessage
 *
 * Thinking mode control:
 * When `enable_thinking` is false, the function appends '/no_think' to the query to disable
 * the model's chain-of-thought reasoning output, which can reduce response verbosity for
 * simple queries.
 *
 * @param {string} query - The text prompt/question to send to the model
 * @param {object} [options={}] - Optional configuration overrides
 * @param {string} [options.baseUrl='http://192.168.142.70:1234'] - Base URL of the LM Studio server;
 *   defaults to LM_STUDIO_URL constant
 * @param {string} [options.model='local-model'] - Model identifier as loaded in LM Studio; the actual
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
 * const { response, elapsedStr, model } = await queryLmStudio('What is the capital of France?');
 * console.log(response); // "The capital of France is Paris."
 * console.log(elapsedStr); // "1.23"
 * console.log(model); // "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF"
 *
 * @example
 * // Custom configuration
 * const result = await queryLmStudio('Explain quantum physics', {
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
export async function queryLmStudio(query, options = {}) {
  const {
    // baseUrl = 'http://localhost:1234',
    baseUrl = LM_STUDIO_URL, // use local server
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
  let actualModel_ = null;

  const lmQueryOptions = {
    baseUrl,
    enable_thinking,
    maxTokens,
    model,
    query: finalQuery,
    systemPrompt: finalSystemPrompt,
    temperature,
  };

  const isLmStudioQueryAvailable =
    typeof window !== 'undefined' &&
    typeof window.lmStudio?.query === 'function';

  console.log('queryLmStudio - starting fetch isLmStudioQueryAvailable', isLmStudioQueryAvailable);
  let error = false;

  if (isLmStudioQueryAvailable) { // calling Electron process
    try {
      const answer = await window.lmStudio.query(query, lmQueryOptions);
      console.log(answer);
      replyText_ = answer.replyText;
      actualModel_ = answer.actualModel;
      error = answer.error;
    } catch (e) {
      console.error(`queryLmStudio - window.lmStudio.query error`, e);
      error = true;
    }
  } else { // no electron process
    try {
      const {
        replyText,
        actualModel,
      } = await streamChatMessage(lmQueryOptions);
      replyText_ = replyText;
      actualModel_ = actualModel;
    } catch (e) {
      console.error(`queryLmStudio - streamChatMessage error`, e);
      error = true;
    }
  }

  const elapsedStr = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(
    `Query using model "${actualModel_ || model}" took ${elapsedStr}s`
  );

  if (error || !replyText_) {
    const message = `Unexpected LM Studio response shape: received error or empty content`;
    console.log(`${message}, replyText`, replyText_);
    throw new Error(message);
  }

  return {
    response: replyText_,
    elapsedStr,
    model: actualModel_ || model,
  };
}

/**
 * Queries a locally running LM Studio server for the list of available AI models.
 * LM Studio exposes an OpenAI-compatible models endpoint once "Local Server" is started.
 *
 * @param {object} [options] - optional overrides
 * @param {string} [options.baseUrl='http://localhost:1234'] - base URL of the LM Studio server
 * @returns {Promise<Array<object>>} - available model objects returned by LM Studio
 * @throws {Error} - if the server is unreachable or returns an error status
 * @example
 * const models = await queryLmStudioModels();
 * console.log(models.map(model => model.id));
 */
export async function queryLmStudioModels(options = {}) {
  const {
    // baseUrl = 'http://localhost:1234',
    baseUrl = LM_STUDIO_URL,
  } = options;

  const url = `${baseUrl}/v1/models`;
  let response;

  const isLmStudioModelsAvailable =
    typeof window !== 'undefined' &&
    typeof window.lmStudio?.query === 'function';

  console.log('isLmStudioModelsAvailable', isLmStudioModelsAvailable);
  let answer;

  if (isLmStudioModelsAvailable) { // calling Electron process
    try {
      answer = await window.lmStudio.getAvailableModels({ baseUrl });
      console.log('getAvailableModels answer', answer);
    } catch (error) {
      const message = `Failed to reach LM Studio server at ${url}: ${error.message}`;
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
      const message = `Failed to reach LM Studio server at ${url}: ${error.message}`;
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
    const message = 'Unexpected LM Studio models response shape';
    console.log(message, answer);
    throw new Error(message);
  }

  // filter response by model objects
  // {id: 'liquid/lfm2-24b-a2b', object: 'model', owned_by: 'organization_owner'}
  models = models.filter(model => (model.object === 'model' && model.id)).map(model => (model.id));

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
 * @returns {string} - the fully populated prompt text
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
  const wordList = verseContent.split(' ');
  const normalizedWordList = wordList.map(word => normalizeForCompare(word));

  for (const glPhrase of keys) {
    const translations = data[glPhrase];
    const translationKeys = Object.keys(translations);
    const filteredMatchesEntries = {};

    for (const translation of translationKeys) {
      const translationWords = translation.split(/\s+/).filter(Boolean);
      const matchedWords = translationWords.map(word => {
        const normalizedWord = normalizeForCompare(word);
        const matchIndex = normalizedWordList.indexOf(normalizedWord);
        return matchIndex >= 0 ? wordList[matchIndex] : null;
      });
      const exactMatch = matchedWords.every(Boolean);

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

  // Return JSON string of filtered/sorted entries, or empty string if no entries
  const resultsJson = entries.length
    ? JSON.stringify(entries)
    : '';
  return resultsJson;
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

export function saveAlignmentData(projectPath, data) {
  const metricsFilePath = getTcorePathFromProjectPath(projectPath, `translation_data.json`);

  try {
    fs.outputJsonSync(metricsFilePath, data, { spaces: 2 });
  } catch (error) {
    console.error(`Could not save metrics to ${metricsFilePath}`, error);
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
  const systemPrompt = `You are an expert in biblical linguistics and cross-language translation consistency.

Pick the word(s) of the TARGET VERSE that best translate the GATEWAY PHRASE.

The TARGET VERSE is given as plain words in reading order.

Rules:
1. Use only words of the TARGET VERSE. Never invent, translate, inflect, or re-spell a word, and never output the gateway phrase itself.
2. Copy each word exactly as the TARGET VERSE spells it, keeping its accents and its casing.
3. Output the words on their own, separated by single spaces. Never add a number, a colon, or any punctuation to a word.
4. PREVIOUS TRANSLATIONS is an array of objects. Each object has a "phrase" field (a previous GATEWAY PHRASE) a "rendering" field (a previous TARGET VERSE translation for the current GATEWAY PHRASE) and a "usageCount" field (how many times that rendering was chosen). Prefer renderings with a higher usageCount whose words all occur in the TARGET VERSE; discard any that use words the TARGET VERSE does not have. Use usageCount only to inform your confidence score — do not copy it into your output.
5. Keep the words in TARGET VERSE order, and prefer the shortest option that carries the meaning.
6. Output at most 3 rows, one per plausible option, highest confidence first. "confidence" is an integer 0-100 that YOU assign based on how well the option fits this verse; it is unrelated to the usage counts in PREVIOUS TRANSLATIONS.
7. If no words of the TARGET VERSE can express the phrase, output exactly: "",0
8. Output only CSV rows: no header, no explanation, no markdown fences.

Required output format:
"word word",confidence

Example
GATEWAY PHRASE: church
TARGET VERSE: para la iglesia de Éfeso
PREVIOUS TRANSLATIONS:
    [{"phrase":"church","rendering":"iglesia","usageCount":7},{"phrase":"the church","rendering":"la iglesia","usageCount":3},{"phrase":"the churches","rendering":"las iglesias","usageCount":1}]


Valid Response:
"iglesia",98
"la iglesia",70

Invalid Response: "church",98 | "congregación",90 | "iglesias",85 | "Iglesia",98 | "iglesia:3",98 | iglesia,98
`;

  const previousTranslations = formatPreviousTranslations(previousTranslationData, glPhrase, verseContent, true);
  console.log(`previousTranslations string length= ${previousTranslations.length}`);

  // one labeled field per line, in the same order as the example above
  const lines = [
    `GATEWAY PHRASE (${glLangCode}): ${glPhrase}`,
    `TARGET VERSE (${targetLangCode}): ${verseContent}`,
  ];

  if (previousTranslations) {
    lines.push(`PREVIOUS TRANSLATIONS: ${previousTranslations}`);
  }

  return { systemPrompt, input: lines.join('\n') };
}

/**
 * Extracts the `{targetPhrase: count}` map belonging to `glPhrase`.
 *
 * Accepts the nested, phrase-keyed shape `{glPhrase: {targetPhrase: count}}` as well as an
 * already-flat `{targetPhrase: count}` map, matching what `formatPreviousTranslations` accepts,
 * so both the AI and the algorithmic path can be handed the same object.
 *
 * @param {object} previousTranslationData - prior translation counts, nested or flat
 * @param {string} glPhrase - gateway-language phrase being translated
 * @returns {object} - `{targetPhrase: count}` for this phrase, or `{}` when it has no history
 */
function getPreviousTranslationExactMatchCounts(previousTranslationData, glPhrase) {
  const data = previousTranslationData || {};

  // data is phrase-keyed when its values are count maps rather than counts
  const isPhraseKeyed = Object.values(data).some(value => value && typeof value === 'object');

  if (!isPhraseKeyed) {
    return data;
  }

  const keys = Object.keys(data);

  // match the gateway phrase exactly, else accent- and case-insensitively
  const normalizedGL = normalizer(glPhrase).toLowerCase();
  const matchedGL = keys.find(key_ => key_ === glPhrase)
    || keys.find(key_ => normalizer(key_).toLowerCase() === normalizedGL);

  return matchedGL ? (data[matchedGL] || {}) : {};
}

/**
 * Retrieves the translation count map for a gateway language phrase, supporting both
 * exact and partial matching strategies.
 *
 * This function extracts previous translation history from a nested data structure that
 * maps gateway language phrases to their target language renderings with usage counts.
 * It handles two input formats:
 * - **Nested format**: `{glPhrase: {targetRendering: count}}` (phrase-keyed)
 * - **Flat format**: `{targetRendering: count}` (already extracted for one phrase)
 *
 * The matching strategy proceeds in two steps:
 * 1. **Exact match**: First attempts to find `glPhrase` as an exact key in the data
 * 2. **Partial match**: If no exact match is found, searches for any phrase where at least
 *    one word from `glPhrase` appears in the stored phrase
 *
 * All comparisons are performed after normalization (case-insensitive, punctuation-free)
 * to ensure that formatting differences don't prevent valid matches.
 *
 * @param {object} previousTranslationData - Historical translation data; can be:
 *   - Nested: `{glPhrase: {targetRendering: count}}` where values are count maps
 *   - Flat: `{targetRendering: count}` where values are integers
 * @param {string} glPhrase - Gateway language phrase to look up (e.g., 'the church')
 * @returns {object} Translation count map `{targetRendering: count}` for the matched phrase,
 *   or empty object `{}` if no match is found or input is invalid
 * @example
 * // Nested input with exact match
 * const data = {
 *   'the church': { 'la iglesia': 5, 'la congregación': 2 },
 *   'church': { 'iglesia': 10 }
 * };
 * getPreviousTranslationPartialMatchCounts(data, 'the church');
 * // Returns: { 'la iglesia': 5, 'la congregación': 2 }
 *
 * @example
 * // Nested input with partial match (no exact match for 'church building')
 * const data = {
 *   'the church': { 'la iglesia': 5 },
 *   'church': { 'iglesia': 10 }
 * };
 * getPreviousTranslationPartialMatchCounts(data, 'church building');
 * // Returns: { 'iglesia': 10 } (matched 'church' because it contains the word 'church')
 *
 * @example
 * // Flat input (already extracted for one phrase)
 * const data = { 'iglesia': 10, 'congregación': 3 };
 * getPreviousTranslationPartialMatchCounts(data, 'church');
 * // Returns: { 'iglesia': 10, 'congregación': 3 } (returns input as-is)
 *
 * @see {@link getPreviousTranslationExactMatchCounts} - Similar function with exact-match-only strategy
 * @see {@link normalizer} - String normalization function from string-punctuation-tokenizer
 */
function getPreviousTranslationPartialMatchCounts(
  previousTranslationData,
  glPhrase
) {
  const data = previousTranslationData || {};

  // data is phrase-keyed when its values are count maps rather than counts
  const isPhraseKeyed = Object.values(data).some(
    value => value && typeof value === 'object'
  );

  if (!isPhraseKeyed) {
    return data;
  }

  const keys = Object.keys(data);

  // match the gateway phrase exactly, else accent- and case-insensitively
  const normalizedGlWords = normalizer(glPhrase).toLowerCase().split(' ');
  const matchedGL =
    keys.find(key_ => key_ === glPhrase) ||
    keys.find(key_ => {
      const translatedWords = normalizer(key_).toLowerCase().split(' ');

      for (let i = 0; i < normalizedGlWords.length; i++) {
        if (translatedWords.includes(normalizedGlWords[i])) {
          return true;
        }
      }
      return false;
    });

  return matchedGL ? data[matchedGL] || {} : {};
}

/**
 * Turns verse positions into the selection shape the checking tool stores, resolving each
 * word's text and occurrence exactly the way the AI path does in `parseResponseRowNoPositions`
 * so selections coming from either path are indistinguishable downstream.
 *
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {Array<number>} positions - ascending 0-based indexes into `wordList`
 * @returns {Array<{text: string, occurrence: number}>}
 */
function buildSelectionsFromPositions(wordList, positions) {
  return positions.map(position => {
    const text = normalizer(wordList[position]);
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

  if (positionsPerWord.some(positions => !positions.length)) {
    return null; // a word of the rendering is not in this verse at all
  }

  let bestPositions = null;
  let bestSpan = Infinity;

  function search(wordIndex, lastPosition, currentPositions) {
    if (wordIndex === positionsPerWord.length) {
      const span = currentPositions[currentPositions.length - 1] - currentPositions[0];

      if (span < bestSpan) {
        bestSpan = span;
        bestPositions = [...currentPositions];
      }
      return;
    }

    for (const position of positionsPerWord[wordIndex]) {
      if (position > lastPosition) { // keeps the placement in reading order
        currentPositions.push(position);
        search(wordIndex + 1, position, currentPositions);
        currentPositions.pop();
      }
    }
  }

  search(0, -1, []);
  return bestPositions;
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

  if (!a.length || !b.length) {
    return 0;
  }

  const maxLen = Math.max(a.length, b.length);
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Computes the Levenshtein edit distance between two strings. The distance is the
 * minimum number of single-character edits (insertions, deletions, substitutions)
 * needed to transform `a` into `b`. [[1]](https://medium.com/@art3330/levenshtein-distance-fundamentals-817b6f7f1718)
 *
 * Uses a space-optimised two-row approach, so memory usage is O(min(|a|,|b|)).
 *
 * @param {string} a - first string
 * @param {string} b - second string
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
 * phrase was rendered before is the only evidence available. Each previous rendering of
 * `glPhrase` is looked for in the verse, strongest usage count first:
 * - found adjacently and in order - the exact match - scores 100
 * - found in order but with other words in between scores below 100
 * - when the whole rendering is not there, its sub-phrases are tried and score lower still,
 *   by how much of the rendering they cover and how tightly they sit together
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
  // Extract the translation count map for this specific gateway language phrase
  let counts = getPreviousTranslationExactMatchCounts(previousTranslationData, glPhrase);

  if (!counts?.length) { // if no exact match using original
    counts = getPreviousTranslationPartialMatchCounts(previousTranslationData, glPhrase);
  }

  // Sort previous translations by usage count (descending), filtering out empty or zero-count entries
  // Process strongest evidence first so the most-used rendering claims its words before weaker ones
  const countEntries = Object.entries(counts)
    .filter(([phrase, count]) => phrase && count > 0)
    .sort((a, b) => b[1] - a[1]);

  // Early exit if no previous translations exist or verse has no words
  if (!countEntries.length || !words.length) {
    console.log('algorithm response: no usable previous translations', { glPhrase });
    return [];
  }

  // Store the highest usage count for relative scoring later
  const maxCount = countEntries[0][1];
  // Normalize all verse words for case-insensitive, punctuation-free comparison
  const normalizedWordList = words.map(word => normalizeForCompare(word));
  // Map to store candidates, keyed by position string (e.g. "2:3:5") to deduplicate same words
  const candidates = new Map(); // keyed by matched positions, so the same words appear once

  // Helper function to evaluate and store a candidate match
  function considerCandidate(positions, phraseWordCount, count) {
    // Skip if no positions found
    if (!positions?.length) {
      return;
    }

    // Calculate span (distance between first and last matched word)
    const span = positions[positions.length - 1] - positions[0];
    // Check if words are adjacent (contiguous) in the verse
    const isContiguous = span === positions.length - 1;
    // Calculate confidence score (0-100) based on match quality
    const confidence = scoreAlgorithmicMatch(positions.length, phraseWordCount, isContiguous, span, count, maxCount);
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
  for (const [phrase, count] of countEntries) {
    // Normalize the previous translation into individual words
    const phraseWords = phrase.split(/\s+/).filter(Boolean).map(word => normalizeForCompare(word));

    // Skip empty translations
    if (!phraseWords.length) {
      continue;
    }

    // First attempt: find exact verbatim match (all words adjacent and in order)
    const exactPositions = findContiguousMatchPositions(normalizedWordList, phraseWords);

    if (exactPositions) { // verbatim match, nothing weaker from this rendering can beat it
      considerCandidate(exactPositions, phraseWords.length, count);
      continue;
    }

    // Second attempt: find all words in order but possibly with gaps between them
    const orderedPositions = findBestOrderedMatchPositions(normalizedWordList, phraseWords);

    if (orderedPositions) { // all the words, but the verse spreads them out
      considerCandidate(orderedPositions, phraseWords.length, count);
      continue;
    }

    // Fallback: find the best subset of the translation that exists in the verse
    // Fall back to the best ordered subset of the rendering that the verse actually contains.
    // It is still scored against the full previous translation length, so confidence is reduced
    // when one or more words from the previous translation are missing from wordList.
    const availablePositions = findBestAvailableOrderedMatchPositions(normalizedWordList, phraseWords);
    considerCandidate(availablePositions, phraseWords.length, count);
  }

  if (!candidates.size) {
    // Use fuzzy compares to do closest matches for translated target words in word list and calculate confidence
    // For each previous translation, try fuzzy matching each phrase word against verse words
    for (const [phrase, count] of countEntries) {
      const phraseWords = phrase.split(/\s+/).filter(Boolean).map(word => normalizeForCompare(word));

      if (!phraseWords.length) {
        continue;
      };

      const matchedPositions = [];
      let totalSimilarity = 0;

      for (const phraseWord of phraseWords) {
        let bestPos = -1;
        let bestSim = -1;

        for (let i = 0; i < normalizedWordList.length; i++) {
          const sim = fuzzyStringSimilarity(phraseWord, normalizedWordList[i]);

          if (sim > bestSim) {
            bestSim = sim;
            bestPos = i;
          }
        }

        if (bestPos >= 0 && bestSim > 0.5) { // only accept reasonably similar words
          matchedPositions.push(bestPos);
          totalSimilarity += bestSim;
        }
      }

      if (matchedPositions.length) {
        // Deduplicate positions, keeping order
        const uniquePositions = [...new Set(matchedPositions)].sort((a, b) => a - b);
        const avgSimilarity = totalSimilarity / phraseWords.length;
        // Scale confidence: fuzzy matches are always weaker than exact ones (capped below 50)
        const fuzzyConfidence = Math.round(avgSimilarity * 45);
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
      console.log('fuzzy match response:', {
        wordList: formatNumberedVerse(words.join(' ')),
        glPhrase,
        candidates: [...candidates.values()],
      });
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

  // Log the results for debugging
  console.log('algorithm response:', {
    wordList: formatNumberedVerse(words.join(' ')),
    glPhrase,
    matches: bestSelections.length,
    bestSelections,
  });

  return bestSelections;
}

/**
 * Translates a gateway language phrase to target-language word(s) within a verse
 * using an AI model, returning an array of selection objects with confidence scores.
 *
 * This function queries an LM Studio AI model to find the best target-language translation
 * option(s) for a gateway-language phrase, using only words found in the target verse.
 * The AI is guided by previous translation history to maintain consistency across the project.
 *
 * Response parsing handles multiple formats:
 * - Standard CSV: "word word",confidence
 * - Verbose responses (thinking mode): skips to the last valid CSV line
 * - Newline-separated fields: converted to CSV format
 * - Malformed responses: attempts recovery by extracting the last valid line
 *
 * The function validates all returned selections to ensure:
 * - Each word has both text and occurrence fields
 * - No duplicate word:occurrence pairs exist
 * - All words are present in the target verse
 *
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {string} targetLangCode - language code of the verse (e.g. 'es-419')
 * @param {string} glPhrase - gateway language phrase to translate (e.g. 'church')
 * @param {string} glLangCode - language code of the gateway phrase (e.g. 'en')
 * @param {object} previousTranslationData - prior translation counts; can be nested
 *   `{glPhrase: {targetPhrase: count}}` or flat `{targetPhrase: count}`
 * @param {object} [lmOptions={enable_thinking: false}] - options passed to queryLmStudio
 * @param {boolean} [lmOptions.enable_thinking=false] - whether to enable AI thinking mode
 * @param {string} [lmOptions.baseUrl] - LM Studio server URL override
 * @param {string} [lmOptions.model] - AI model identifier override
 * @param {number} [lmOptions.temperature] - sampling temperature override
 * @param {number} [lmOptions.maxTokens] - max response tokens override
 * @returns {Promise<Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>>} -
 *   array of translation options (up to 3), each containing:
 *   - selections: array of {text, occurrence} objects representing matched words
 *     - text: the normalized word form from the verse
 *     - occurrence: 1-based occurrence index of this word in the verse
 *   - confidence: integer 0-100 indicating match certainty
 *   Returns empty array [] on failure or when no valid translations are found
 * @throws Does not throw; logs errors and returns empty array on failure
 * @example
 * const wordList = ['para', 'la', 'iglesia', 'de', 'Éfeso'];
 * const result = await getBestTWordSelectionWithConfidenceFromLlm(
 *   wordList,
 *   'es-419',
 *   'church',
 *   'en',
 *   { church: { 'iglesia': 7, 'la iglesia': 3 } },
 *   { enable_thinking: false }
 * );
 * // Returns: [
 * //   { selections: [{text: 'iglesia', occurrence: 1}], confidence: 98 },
 * //   { selections: [{text: 'la', occurrence: 1}, {text: 'iglesia', occurrence: 1}], confidence: 70 }
 * // ]
 *
 * @see {@link buildTranslationOptionsPrompt} for the prompt construction
 * @see {@link parseResponseRowNoPositions} for response parsing logic
 * @see {@link getBestTWordSelectionWithConfidenceAlgorithm} for non-AI alternative
 */
export async function getBestTWordSelectionWithConfidenceFromLlm(wordList, targetLangCode, glPhrase, glLangCode, previousTranslationData, lmOptions = { enable_thinking: false }) {
  let translationOptions = [];
  const { systemPrompt, input } = buildTranslationOptionsPrompt(
    wordList.join(' '),
    targetLangCode,
    glPhrase,
    glLangCode,
    previousTranslationData,
  );
  let success = true;
  let answer = '';
  let responses = null;
  let elapsedStr = '0';
  let model = '';

  try {
    const options = {
      ...lmOptions,
      systemPrompt,
    };
    const {
      response,
      elapsedStr: elapsed,
      model: model_,
    } = await queryLmStudio(input, options);
    answer = response;
    elapsedStr = elapsed;
    model = model_;
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
          const success_ = parseResponseRowNoPositions(response, wordList, answer, translationOptions);

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
      //handle case where AI did not use CSV format, but fields are separated by newlines
      if (responses?.length === 2) {
        translationOptions = [];
        const response = answer.replace('\n', ',');
        success = parseResponseRowNoPositions(response, wordList, answer, translationOptions);
      }
    } else {
      // Handle verbose responses by retrying with the last non-empty CSV-looking line.
      const lastNonEmptyLine = responses
        ?.map(response => response?.trim())
        .filter(Boolean)
        .pop();

      if (lastNonEmptyLine) {
        const quoteParts = lastNonEmptyLine.split('"').filter(part => part.trim() !== '');

        if (quoteParts.length >= 3) {
          const phraseTranslation = quoteParts[quoteParts.length - 2];
          const confidencePart = quoteParts[quoteParts.length - 1]
            .split(',')
            .map(part => part.trim())
            .find(part => part !== '');

          const confidence = removeQuotes(confidencePart);
          const confidenceNum = parseInt(confidence, 10);

          if (Number.isNaN(confidenceNum) || confidenceNum < 0 || confidenceNum > 100) {
            success = false;
          } else {
            translationOptions = [];
            const response = `"${phraseTranslation}",${confidence}`;
            success = parseResponseRowNoPositions(response, wordList, answer, translationOptions);
          }
        }
      }
    }
  }

  for (const option of translationOptions) {
    // remove duplicates from selections
    const seen = new Set();
    const uniqueSelections = [];

    for (const word of option.selections) {
      if (word.occurrence && word.text) {
        const key = word.text + ':' + word.occurrence;

        if (!seen.has(key)) {
          seen.add(key);
          uniqueSelections.push(word);
        } else {
          // console.log('duplicate word found', word);
        }
      } else {
        // console.log('invalid word or occurrence found', word);
      }
    }

    if (!uniqueSelections.length) {
      option.selections = false;
    } else {
      if (option.selections.length != uniqueSelections.length) { // if changed then update
        option.selections = uniqueSelections;
      }
    }
  }

  translationOptions = translationOptions.filter(item => (item.selections));

  success = !!translationOptions.length;

  if (!success) {
    console.log('no selections found', translationOptions);
  }

  if (success) {
    translationOptions.sort((a, b) => b.confidence - a.confidence);
    console.log('AI response:', {
      wordList: formatNumberedVerse(wordList.join(' ')),
      glPhrase,
      answer,
      matches: translationOptions.length,
      selectionWords: translationOptions,
    });

    return {
      error: false,
      bestSelections: translationOptions,
      elapsedStr,
      model,
    };
  } else {
    console.log('AI response ERROR:', {
      wordList: formatNumberedVerse(wordList.join(' ')),
      glPhrase,
      answer,
      matches: translationOptions.length,
    });
  }
  return {
    error: true,
    bestSelections: [],
    elapsedStr,
    model: '',
  };
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
 * Parses one CSV response row of the form `"word word",confidence` (no positions) into a
 * `{selections, confidence}` entry pushed onto `selectionWords`, resolving each word's
 * occurrence by finding the tightest grouping of matching positions in `wordList`.
 * @param {string} response - one CSV row of the AI response
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {string} answer - full AI response text, used only for logging
 * @param {Array<object>} selectionWords - accumulator array the parsed entry is pushed onto
 * @returns {boolean} - true on success, false if the row was malformed or a word wasn't found
 */
function parseResponseRowNoPositions(response, wordList, answer, selectionWords) {
  let error = false;
  const rowParts = normalizer(response).split(',');

  if (rowParts.length === 2) {
    let [phraseTranslation, confidence] = rowParts;
    confidence = confidence ? parseInt(removeQuotes(confidence), 10) : 0;
    phraseTranslation = normalizer(removeQuotes(phraseTranslation));
    const selections = [];
    const words = phraseTranslation.split(' ');

    for (const word of words) {
      const text = word.trim();

      if (text) {
        selections.push({ text });
      }
    }

    if (selections.length) {
      // Find the best positions for each word in selections within wordList
      // such that the positions are grouped closest together

      // Build a map of word -> array of positions in wordList
      const wordPositionsMap = new Map();

      for (const selection of selections) {
        const normalizedWord = normalizeForCompare(selection.text);
        const positions = [];

        for (let i = 0; i < wordList.length; i++) {
          if (normalizeForCompare(wordList[i]) === normalizedWord) {
            positions.push(i);
          }
        }
        wordPositionsMap.set(selection.text, positions);
      }

      // Verify all words exist in wordList
      let allWordsFound = true;

      for (const selection of selections) {
        const positions = wordPositionsMap.get(selection.text);

        if (!positions || positions.length === 0) {
          allWordsFound = false;
          break;
        }
      }

      if (!allWordsFound) {
        error = true;
      } else {
        // Find the combination of positions that minimizes the span
        // (distance between first and last selected position)
        let bestCombination = null;
        let minSpan = Infinity;

        // eslint-disable-next-line no-inner-declarations
        function findBestGrouping(selectionIndex, currentPositions) {
          if (selectionIndex === selections.length) {
            // Calculate span of current combination
            const sorted = [...currentPositions].sort((a, b) => a - b);
            const span = sorted[sorted.length - 1] - sorted[0];

            if (span < minSpan) {
              minSpan = span;
              bestCombination = [...currentPositions];
            }
            return;
          }

          const word = selections[selectionIndex].text;
          const availablePositions = wordPositionsMap.get(word);

          for (const pos of availablePositions) {
            findBestGrouping(selectionIndex + 1, [...currentPositions, pos]);
          }
        }

        findBestGrouping(0, []);

        // Assign the best positions and convert to occurrences
        if (bestCombination) {
          for (let i = 0; i < selections.length; i++) {
            const position = bestCombination[i];
            selections[i].text = normalizer(wordList[position]);
            selections[i].occurrence = findOccurrenceForPos(position + 1, wordList, selections[i].text);
            // delete selections[i].position
          }
        } else {
          error = true;
        }
      }

      //TRICKY - now need to de-normalize the selections so that they are exactly the same as in the verse text
      for (const selection of selections) {
        const normalizedWord = normalizeForCompare(selection.text);
        let occurrence = 0;

        for (let i = 0; i < wordList.length; i++) {
          const wordListElement = wordList[i];

          if (normalizeForCompare(wordListElement) === normalizedWord) {
            if (selection.occurrence === ++occurrence) {
              if (wordListElement !== selection.text) { // if not exactly the same format, though they match when normalized
                selection.text = wordListElement; // make word exactly the same
                break;
              }
            }
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
 * @returns {Promise<Array<{selections: Array<{text: string, position: number}>, confidence: number}>>} - array of selection objects, each containing:
 *   - selections: array of {text, position} objects representing matched words, where text is the word and position is its occurrence index in the verse
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
 * //   { selections: [{text: 'tu', position: 1}, {text: 'vejez', position: 1}], confidence: 85 },
 * //   { selections: [{text: 'vejez', position: 1}], confidence: 70 }
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
    const { response } = await queryLmStudio(query, { systemPrompt });
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
  const replaceChars = ['{', '}', '.', ',', ';', ':', '"'];
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
 * Tallies each check's target-language selection against its gateway-language quote, updating
 * `selectionsForWord` in place with `{glQuote: {selectedText: count}}` counts.
 * @param {Array<object>} checks - checking-tool check records, each with `contextId` and `selections`
 * @param {string} gatewayLanguageCode - gateway language code
 * @param {object} tsvRelation - TSV relation data used to resolve the aligned gateway-language text
 * @param {object} bible - gateway-language bible used to resolve the aligned text for each check
 * @param {object} selectionsForWord - accumulator object mutated in place
 * @returns {object} - the same `selectionsForWord` object, for convenience
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
            glText = removePunctuation(glText);
            glQuote = glText;
          }
        }

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
 * @param {string} [url=''] - Base URL of the LM Studio server (e.g., 'http://localhost:1234');
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
 * saveSattingsForChecking_('/path/to/project', { autoCheck: true, threshold: 80 });
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
 * const settings = readSattingsForChecking_('/path/to/project');
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
 * Scans sibling projects on disk for the same language/resource/testament combination and
 * aggregates their previous target-language selections for `groupId`, using and updating
 * `glBiblesCache` to avoid re-reading the gateway-language bible for each project.
 * @param {string} projectSaveLocation - path to the current project folder
 * @param {object} contextId - context of the current check
 * @param {object} glBibles - available gateway-language bibles keyed by bible id
 * @param {object} tsvRelation - TSV relation data used to resolve aligned gateway-language text
 * @param {string} toolName - checking tool name, used to build the selections index path
 * @param {string} groupId - group id (e.g. translationWords entry) to gather selections for
 * @param {string} gatewayLanguageCode - gateway language code
 * @param {string} glOwnerStr - owner string for resolving the most recent gateway bible version
 * @param {object} data - data used only for logging (expects `contextId`)
 * @param {object} glBiblesCache - mutable cache of loaded gateway-language bibles, keyed by book id
 * @returns {object} - `{glQuote: {selectedText: count}}` aggregated across matching projects
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
  const parsed = path.parse(projectSaveLocation);
  const projectName = parsed.base;
  const projectsFolder = parsed.dir;
  const projects = fs.readdirSync(projectsFolder);

  const {
    bookId: currentBookId,
    languageId: currentLanguageId,
    resourceId: currentResourceId,
  } = getDetailsFromProjectNameMini(projectName);

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
 * @param {string} verseText - The target-language verse text to search within (may contain punctuation)
 * @param {string|null} llmQueryUrl - Base URL of the LM Studio server (e.g., 'http://localhost:1234');
 *   if `null` or `undefined`, uses algorithmic mode instead of AI
 * @param {object} targetLanguageDetails - Metadata about the target language
 * @param {string} targetLanguageDetails.id - Language code (e.g., 'es-419' for Latin American Spanish)
 * @param {string} alignedGLText - Gateway-language phrase to translate (e.g., 'church', 'the elders')
 * @param {string} gatewayLanguageCode - Language code of the gateway language (e.g., 'en' for English)
 * @param {object} selectionsData - Historical translation data from previous user selections
 * @param {object} selectionsData.selections - Nested mapping of gateway phrases to target renderings with usage counts:
 *   `{glPhrase: {targetRendering: count}}`, or flat format `{targetRendering: count}` if pre-filtered
 * @param {string} [model='local-model'] - AI model identifier to use (only relevant when `llmQueryUrl` is provided);
 *   the actual model used may differ and is reported in the response
 * @returns {Promise<{error: boolean, bestSelections: Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>, elapsedStr: string, model: string}>}
 *   Object containing:
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
 * const result = await getBestSelections(
 *   'para la iglesia de Éfeso',
 *   null,  // no AI server URL
 *   { id: 'es-419' },
 *   'church',
 *   'en',
 *   { selections: { 'church': { 'iglesia': 7, 'la iglesia': 3 } } }
 * );
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
 * // AI-assisted mode (requires LM Studio server running)
 * const result = await getBestSelections(
 *   'para la iglesia de Éfeso',
 *   'http://localhost:1234',  // LM Studio server URL
 *   { id: 'es-419' },
 *   'church',
 *   'en',
 *   { selections: { 'church': { 'iglesia': 7 } } },
 *   'my-model-v1'  // optional custom model identifier
 * );
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
export async function getBestSelections(
  verseText,
  llmQueryUrl,
  targetLanguageDetails,
  alignedGLText,
  gatewayLanguageCode,
  selectionsData,
  model
) {
  // eslint-disable-next-line no-unused-vars
  let results = {
    error: true,
    bestSelections: [],
    elapsedStr: '',
    model: '',
  };

  try {
    const wordList = getWordList(verseText);

    if (!llmQueryUrl) {
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
    } else {
      const lmOptions = {
        baseUrl: llmQueryUrl,
        enable_thinking: false,
        model,
      };

      results = await getBestTWordSelectionWithConfidenceFromLlm(
        wordList,
        targetLanguageDetails.id,
        alignedGLText,
        gatewayLanguageCode,
        selectionsData?.selections,
        lmOptions
      );
    }
  } catch (e) {
    console.error(`getBestSelections - error`, e);
    return { error: true };
  }

  return results;
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
