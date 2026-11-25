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
import { getQuoteAsString } from '../helpers/checkAreaHelpers';
import {
  ALGORITHM,
  NT_ORIG_LANG,
  OT_ORIG_LANG,
} from '../common/constants';

const AI_API_URL = 'http://192.168.142.70:1234';
/** most previous-translation entries sent in an AI prompt, strongest evidence first */
const MAX_PROMPT_PREVIOUS_TRANSLATIONS = 10;
/** previous-translation entries sent when none of them fits the verse */
const MAX_PROMPT_UNMATCHED_TRANSLATIONS = 5;

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
 * @param {object} [options.extraParams] - Extra request body fields (e.g. seed, stop, top_p,
 *   response_format). They are applied after temperature, max_tokens and chat_template_kwargs, so
 *   they can override those; a key set to undefined is left out of the request. They cannot
 *   override model, stream or messages. Same rules as translationCore's main-process query.
 * @param {Array<{role: string, content: string}>} [options.messages] - chat messages to send in
 *   place of `systemPrompt` and `query`, when valid (see {@link getValidChatMessages})
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
    apiToken, baseUrl, model, systemPrompt, query, temperature, maxTokens, enable_thinking, extraParams,
    messages,
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
        temperature,
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking },
        ...getExtraParams(extraParams),
        // these are always set here and cannot be overridden
        model,
        stream: true,
        messages: getValidChatMessages(messages) || buildChatMessages(systemPrompt, query),
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
 * Returns the extra request body fields to merge into a chat completion request.
 *
 * @param {object} [extraParams] - extra request body fields from the caller
 * @returns {object} - the extra fields, or an empty object when extraParams is missing or not a
 *   plain object
 */
export function getExtraParams(extraParams) {
  if (!extraParams || typeof extraParams !== 'object' || Array.isArray(extraParams)) {
    return {};
  }
  return extraParams;
}

/**
 * Returns the AI bridge that translationCore puts on `window.AiAPIs` during Electronite startup, so AI
 * requests can go through the Electron main process instead of a direct HTTP call from this page.
 *
 * Only `query` is checked; callers also use `getAvailableModels` and assume the bridge provides it.
 *
 * @returns {{
 *   query: function(string, object): Promise<{replyText: string, reasoningText: string, actualModel: string, error: boolean}>,
 *   getAvailableModels: function(object): Promise<*>
 * }|null} - `window.AiAPIs` when it has a `query` function; `null` when there is no `window`
 *   (e.g. Node or jest) or the bridge is missing, in which case callers fall back to direct HTTP
 *   (`streamChatMessage` or `fetch`)
 * @example
 * const AiAPIs = getAiAPIs();
 *
 * if (AiAPIs) {
 *   const { replyText } = await AiAPIs.query(query, lmQueryOptions);
 * }
 */
function getAiAPIs() {
  let AiAPIs = null;
  const isAiAPIQueryAvailable =
    typeof window !== 'undefined' &&
    // this is exposed by translationCore during Electronite startup
    typeof window.AiAPIs?.query === 'function';

  if (isAiAPIQueryAvailable) {
    AiAPIs = window.AiAPIs;
  }

  // console.log('isAiAPIModelsAvailable', isAiAPIModelsAvailable);

  return AiAPIs;
}

/**
 * Whether a suggestion request asks an AI server: either it has a query URL, or it uses the AI server
 * bundled with translationCore (`llmUseLocalServer`, which needs no URL).
 * @param {object} request - suggestion request (or settings) with `llmQueryUrl` and `llmUseLocalServer`
 * @returns {boolean} - true when an AI server is to be asked
 */
export function usesAiServer(request) {
  return !!(request?.llmQueryUrl || request?.llmUseLocalServer);
}

/**
 * Reports whether translationCore's bundled AI server (`window.AiAPIs.localServer`, see
 * electronite/preloadAiApi.js) can be used, and how many models are in its models folder. Doesn't start
 * the server.
 * @returns {Promise<{available: boolean, modelCount: number, modelSizes: Object<string, number>}>} -
 *   `available` is false when there is no `window.AiAPIs`, it is too old to have a local server, or the
 *   server isn't bundled for this platform. `modelSizes` maps each model id to its size in bytes.
 */
export async function getLocalAiServerStatus() {
  const AiAPIs = getAiAPIs();
  const notAvailable = {
    available: false, modelCount: 0, modelSizes: {},
  };

  if (!AiAPIs?.features?.localServer || typeof AiAPIs.localServer?.getStatus !== 'function') {
    return notAvailable;
  }

  try {
    const status = await AiAPIs.localServer.getStatus();
    const models = Array.isArray(status?.models) ? status.models : [];
    const modelSizes = {};

    for (const model of models) {
      if (model?.id && Number.isFinite(model.size)) {
        modelSizes[model.id] = model.size;
      }
    }
    return {
      available: !!status?.available, modelCount: models.length, modelSizes,
    };
  } catch (e) {
    console.warn('getLocalAiServerStatus - error getting local server status', e);
    return notAvailable;
  }
}

/**
 * Throws if `localServer` is asked for but this translationCore can't provide it: there is no
 * `window.AiAPIs` (the local server is only reachable through translationCore's main process), or its
 * `window.AiAPIs` is older and lacks `features.localServer` (electronite/preloadAiApi.js).
 * @param {object|null} AiAPIs - result of {@link getAiAPIs}
 * @param {boolean} localServer - whether the local server is asked for
 * @throws {Error} when the local server is asked for and not supported
 */
function checkLocalServerSupported(AiAPIs, localServer) {
  if (localServer && !AiAPIs?.features?.localServer) {
    throw new Error('The local AI server is not supported by this version of translationCore');
  }
}

/**
 * Adds the `/no_think` directive to the start of the system prompt and of the query when thinking
 * is off, as {@link queryAiAPI} sends them. At the end of the system prompt it made small models drop
 * the batch markers, so it goes first. Exported so the fine-tuning data exporter builds exactly the
 * messages the app sends.
 *
 * @param {{systemPrompt: string, query: string}} prompt - system prompt and user query
 * @param {boolean} enableThinking - true leaves both unchanged
 * @returns {{systemPrompt: string, query: string}} - the texts to send
 */
export function applyThinkingDirective({ systemPrompt, query }, enableThinking) {
  if (enableThinking) {
    return { systemPrompt, query };
  }
  return { systemPrompt: `/no_think\n${systemPrompt}`, query: `/no_think\n${query}` };
}

/** roles a chat message may have in a `messages` list sent to the AI */
const CHAT_MESSAGE_ROLES = ['system', 'user', 'assistant'];

/**
 * Checks a list of chat messages and copies it: a non-empty array of
 * `{ role: 'system' | 'user' | 'assistant', content: string }` ending in a user message. Anything
 * else gives null, so callers fall back to the system prompt + query pair.
 *
 * @param {*} messages - the list to check
 * @returns {Array<{role: string, content: string}>|null} - a copy holding only `role` and `content`
 */
export function getValidChatMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return null;
  }

  const valid = messages.every(message => CHAT_MESSAGE_ROLES.includes(message?.role) &&
    typeof message.content === 'string');

  if (!valid || messages[messages.length - 1].role !== 'user') {
    return null;
  }
  return messages.map(({ role, content }) => ({ role, content }));
}

/**
 * The `messages` form of {@link applyThinkingDirective}: when thinking is off, `/no_think` goes
 * at the start of the first system message, if there is one, and of the last user message (the
 * request). For `[system, user]` that is exactly what {@link applyThinkingDirective} does; earlier
 * user turns (worked examples given as chat turns) are left as they are.
 *
 * @param {Array<{role: string, content: string}>} messages - valid messages (see
 *   {@link getValidChatMessages})
 * @param {boolean} enableThinking - true leaves them unchanged
 * @returns {Array<{role: string, content: string}>} - a new list
 */
export function applyThinkingDirectiveToMessages(messages, enableThinking) {
  const result = messages.map(message => ({ ...message }));

  if (enableThinking) {
    return result;
  }

  const system = result.find(message => message.role === 'system');

  if (system) {
    system.content = `/no_think\n${system.content}`;
  }

  const lastUser = result[result.length - 1];
  lastUser.content = `/no_think\n${lastUser.content}`;
  return result;
}

/**
 * Turns a `messages` list into the system prompt + query pair, for a translationCore that cannot
 * send `messages` (no `window.AiAPIs.features.messages`). The first system message is the system
 * prompt (or '' when there is none); every other message's text, in order, is the query, separated
 * by blank lines. For `[system, user]` this gives back exactly the two texts.
 *
 * @param {Array<{role: string, content: string}>} messages - valid messages
 * @returns {{systemPrompt: string, query: string}}
 */
export function chatMessagesToSystemAndQuery(messages) {
  const systemIndex = messages.findIndex(message => message.role === 'system');
  const systemPrompt = systemIndex >= 0 ? messages[systemIndex].content : '';
  const query = messages.filter((message, index) => index !== systemIndex)
    .map(message => message.content)
    .join('\n\n');
  return { systemPrompt, query };
}

/**
 * The `messages` of a chat-completions request built from a system prompt and a query, as
 * translationCore's main process builds them: no system message when the system prompt is empty.
 *
 * @param {string} systemPrompt - system prompt; '' or missing sends no system message
 * @param {string} query - user message
 * @returns {Array<{role: string, content: string}>}
 */
export function buildChatMessages(systemPrompt, query) {
  const messages = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
  messages.push({ role: 'user', content: query });
  return messages;
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
 * When `enable_thinking` is false, the function puts '/no_think' at the start of the system prompt
 * and the query ({@link applyThinkingDirective}) to disable the model's chain-of-thought reasoning output, which can reduce response verbosity for
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
 * @param {object} [options.extraParams] - Extra request body fields, e.g. `{ seed: 42, top_k: 20 }`;
 *   see {@link streamChatMessage} for how they are merged. Passed to `window.AiAPIs.query` too.
 * @param {Array<{role: string, content: string}>} [options.messages] - chat messages to send in
 *   place of `systemPrompt` and `query` (e.g. worked examples as earlier chat turns). Used only when
 *   valid ({@link getValidChatMessages}); `/no_think` is added by
 *   {@link applyThinkingDirectiveToMessages}. A translationCore whose `window.AiAPIs` lacks
 *   `features.messages` cannot send them, so they are sent there as the system prompt + query pair
 *   of {@link chatMessagesToSystemAndQuery}, with a warning.
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
    extraParams,
    messages,
    localServer = false,
  } = options;
  const startTime = Date.now();
  const AiAPIs = getAiAPIs();

  checkLocalServerSupported(AiAPIs, localServer);
  const validMessages = getValidChatMessages(messages);
  let finalMessages = validMessages && applyThinkingDirectiveToMessages(validMessages, enable_thinking);
  let finalQuery;
  let finalSystemPrompt;

  if (finalMessages) {
    ({ query: finalQuery, systemPrompt: finalSystemPrompt } = chatMessagesToSystemAndQuery(finalMessages));

    if (AiAPIs && !AiAPIs.features?.messages) {
      console.warn('queryAiAPI - this translationCore cannot send chat messages, so they are sent as a system prompt and query');
      finalMessages = undefined;
    }
  } else {
    ({ query: finalQuery, systemPrompt: finalSystemPrompt } = applyThinkingDirective({ systemPrompt, query }, enable_thinking));
  }

  let replyText_ = null;
  let reasoningText_ = null;
  let actualModel_ = null;

  const lmQueryOptions = {
    apiToken,
    baseUrl,
    enable_thinking,
    extraParams,
    maxTokens,
    model,
    query: finalQuery,
    systemPrompt: finalSystemPrompt,
    temperature,
  };

  if (finalMessages) {
    lmQueryOptions.messages = finalMessages;
  }

  if (localServer) {
    // translationCore's main process starts its bundled llama-server and fills in baseUrl and apiToken
    lmQueryOptions.localServer = true;
  }

  // console.log('queryAiAPI - starting fetch isAiAPIQueryAvailable', isAiAPIQueryAvailable);
  let error = false;

  if (AiAPIs) { // calling Electron process
    try {
      // translationCore's main process sends this argument as the user message, so it gets the
      // thinking directive too, as on the direct HTTP path and in the fine-tuning data
      // (plans/improve-single-prompt.md, Q7)
      const answer = await AiAPIs.query(finalQuery, lmQueryOptions);
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
 * Queries a running OpenAI-compatible server for the list of available AI models.
 * LM Studio exposes an OpenAI-compatible models endpoint once "Local Server" is started.
 *
 * @param {object} [options] - optional overrides
 * @param {string} [options.baseUrl='http://localhost:1234'] - base URL of the OpenAI-compatible server
 * @returns {Promise<Array<object>>} - the model objects as the server returns them, unfiltered and
 *   unsorted, e.g. `{id: 'qwen/qwen3-1.7b', object: 'model', owned_by: 'organization_owner'}`; the
 *   caller (tc-ui-toolkit) picks what it needs, such as `id`
 * @throws {Error} - if the server is unreachable or returns an error status
 * @example
 * const models = await queryAiAPIModels();
 * console.log(models.map(model => model.id));
 */
export async function queryAiAPIModels(options = {}) {
  const {
    // baseUrl = 'http://localhost:1234',
    baseUrl = AI_API_URL,
    localServer = false,
  } = options;

  const url = `${baseUrl}/v1/models`;
  let response;

  const AiAPIs = getAiAPIs();
  let answer;

  checkLocalServerSupported(AiAPIs, localServer);

  if (AiAPIs) { // calling Electron process
    try {
      const llmOptions = { ...options, baseUrl };
      answer = await AiAPIs.getAvailableModels(llmOptions);
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

  if (!Array.isArray(answer)) {
    const message = 'Unexpected OpenAI-compatible models response shape';
    console.log(message, answer);
    throw new Error(message);
  }
  return answer;
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
 * Base language codes whose lowercasing differs from the default `toLowerCase`, per Unicode
 * SpecialCasing: Turkish and Azerbaijani (dotted/dotless I) and Lithuanian (keeps the dot on
 * i/j before accents). Every other language lowercases exactly like `toLowerCase`.
 */
const LOCALE_LOWERCASE_LANGS = new Set(['tr', 'az', 'lt']);

/**
 * Lowercases `text` using the rules of language `langId`. Only Turkish, Azerbaijani and
 * Lithuanian lowercase differently from the default (see `LOCALE_LOWERCASE_LANGS`), so those
 * use `toLocaleLowerCase` with the base language code and everything else uses the faster
 * `toLowerCase`. This also avoids `toLocaleLowerCase` being very slow for codes like 'es-419'
 * or 'hbo', throwing for `''`, and following the computer's own language when no code is given.
 *
 * @param {string} text - text to lowercase
 * @param {string} [langId] - language code of `text` (e.g. 'tr', 'es-419', 'el-x-koine');
 *   region, script and other parts after the first '-' are ignored. When missing, the
 *   default `toLowerCase` rules are used.
 * @returns {string} - lowercased text
 * @example
 * toLowerCaseForLang('Iglesia', 'es-419'); // 'iglesia'
 * toLowerCaseForLang('Işık', 'tr-TR'); // 'ışık'
 * toLowerCaseForLang('Işık'); // 'işık'
 */
export function toLowerCaseForLang(text, langId) {
  const baseLang = (langId || '').split('-')[0].toLowerCase();

  if (LOCALE_LOWERCASE_LANGS.has(baseLang)) {
    return text.toLocaleLowerCase(baseLang);
  }
  return text.toLowerCase();
}

/**
 * Normalizes a word for loose comparison. `normalizer` leaves case alone, and matching a
 * rendering against a verse word has to survive that word being capitalized at the start
 * of the verse, so lowercasing is added. Accents stay significant: a rendering differing by
 * an accent is a different word form, and `normalizer` does not fold accents either.
 *
 * @param {string} word
 * @param {string} [langId=''] - language code of `word` (e.g. 'tr', 'es-419'), passed to
 *   {@link toLowerCaseForLang}; when empty, the default lowercasing rules are used
 * @returns {string}
 */
export function normalizeForCompare(word, langId = '') {
  return toLowerCaseForLang(normalizer(word || ''), langId);
}

/**
 * Chooses and formats the previous translations sent to the AI, one line per rendering, in the
 * format `"rendering" (chosen N times for "GL phrase")`.
 *
 * The history holds one translationWords group, so every key is the same concept (see
 * `poolRenderings`); ordering is safer than filtering keys out. Every rendering of every key is
 * considered:
 * 1. each history key is scored against `glPhrase` with {@link rankGlKeys} (exact key, or a
 *    relatedness in [0, 1]);
 * 2. renderings equal after {@link normalizeForCompare} are merged: counts add up, the first
 *    spelling is kept, and the GL phrase shown is the key with the better match (exact first, then
 *    higher relatedness);
 * 3. each rendering gets a verse fit: 2 when every word is in the verse, 1 when every word is in the
 *    verse or has a {@link wordSimilarity} match there (an inflected or compound form), else 0;
 * 4. they are sorted by verse fit, exact key, relatedness, then count, all descending;
 * 5. the ones with a verse fit are kept, up to `MAX_PROMPT_PREVIOUS_TRANSLATIONS`; when none fits,
 *    the first `MAX_PROMPT_UNMATCHED_TRANSLATIONS` of the rest are kept instead.
 *
 * Nothing here assumes a language: words are compared with `normalizeForCompare` and
 * `wordSimilarity`, which are character-level.
 *
 * @param {object} previousTranslationData - nested `{glPhrase: {rendering: count}}`, or flat
 *   `{rendering: count}` (taken as the counts for `glPhrase`)
 * @param {string} glPhrase - gateway-language phrase being translated
 * @param {string} glLangCode - gateway-language code, for lowercasing GL words
 * @param {string} verseContent - target-language verse words, separated by spaces
 * @param {string} [targetLangCode=''] - target-language code, for lowercasing target words
 * @param {object} [options]
 * @param {boolean} [options.markVerseFit=false] - **prompt experiments only** (variant X1 of
 *   plans/improve-single-prompt.md; the app's prompt does not use it): end each line with what was
 *   found in the verse: ` - in verse` (verse fit 2), ` - verse has "<words>"` (verse fit 1: the verse
 *   words matching the rendering's words, exactly or by {@link wordSimilarity}, in verse order), or
 *   ` - not in verse`
 * @param {boolean} [options.markOtherKey=false] - **prompt experiments only** (variant C3 of
 *   plans/prompt-span-experiments.md; the app's prompt does not use it): end each line whose GL
 *   key is not the exact phrase (`isExact` false in {@link rankGlKeys}) with ` - for another phrase`
 * @returns {string} - the lines joined by `\n`, or '' when there is no history
 * @example
 * formatPreviousTranslations(
 *   { 'of the holy places': { 'các nơi thánh': 1 }, 'Holy': { 'Nơi Thánh': 1 } },
 *   'holy places', 'en', 'Ngài đã vào trong các nơi thánh một lần', 'vi',
 * );
 * // '"các nơi thánh" (chosen 1 time for "of the holy places")\n"Nơi Thánh" (chosen 1 time for "Holy")'
 */
export function formatPreviousTranslations(previousTranslationData, glPhrase, glLangCode, verseContent, targetLangCode = '', options = {}) {
  const { markVerseFit = false, markOtherKey = false } = options;
  // renderings are split like the verse words (getWordList), which verseContent already holds
  const normalizeWords = text => splitIntoWords(text)
    .map(word => normalizeForCompare(word, targetLangCode));
  const verseWords = (verseContent || '').split(/\s+/).filter(Boolean)
    .map(word => normalizeForCompare(word, targetLangCode));
  const originalVerseWords = (verseContent || '').split(/\s+/).filter(Boolean);
  const verseWordSet = new Set(verseWords);
  const byRendering = new Map();

  for (const {
    key, counts, relatedness, isExact,
  } of rankGlKeys(previousTranslationData, glPhrase, glLangCode)) {
    for (const [rendering, count] of Object.entries(counts || {})) {
      const normalized = normalizeWords(rendering).join(' ');

      if (!normalized || !(count > 0)) {
        continue;
      }

      const entry = byRendering.get(normalized);

      if (!entry) {
        byRendering.set(normalized, {
          rendering, phrase: key, count, relatedness, isExact,
        });
        continue;
      }

      entry.count += count;

      if ((isExact && !entry.isExact) || (isExact === entry.isExact && relatedness > entry.relatedness)) {
        Object.assign(entry, {
          phrase: key, relatedness, isExact,
        });
      }
    }
  }

  const entries = [...byRendering.entries()].map(([normalized, entry]) => {
    const words = normalized.split(' ');
    let verseFit = 0;

    if (words.every(word => verseWordSet.has(word))) {
      verseFit = 2;
    } else if (words.every(word => verseWordSet.has(word) || verseWords.some(verseWord => wordSimilarity(word, verseWord) > 0))) {
      verseFit = 1;
    }
    return { ...entry, verseFit };
  });

  // Array.prototype.sort is stable, so ties keep the order of the history
  entries.sort((a, b) => (b.verseFit - a.verseFit) || (Number(b.isExact) - Number(a.isExact)) ||
    (b.relatedness - a.relatedness) || (b.count - a.count));

  const fitting = entries.filter(entry => entry.verseFit > 0);
  const chosen = fitting.length ?
    fitting.slice(0, MAX_PROMPT_PREVIOUS_TRANSLATIONS) :
    entries.slice(0, MAX_PROMPT_UNMATCHED_TRANSLATIONS);

  // one plain line per rendering - easier for small models to read than JSON, and fewer tokens
  /**
   * The verse words of a rendering found in the verse only as other forms, in verse order.
   * @param {string} rendering
   * @returns {string}
   */
  const verseFormsOf = rendering => {
    const positions = new Set();

    for (const word of normalizeWords(rendering)) {
      let best = verseWords.indexOf(word);

      if (best < 0) {
        let bestSimilarity = 0;

        verseWords.forEach((verseWord, index) => {
          const similarity = wordSimilarity(word, verseWord);

          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            best = index;
          }
        });
      }

      if (best >= 0) {
        positions.add(best);
      }
    }
    return [...positions].sort((a, b) => a - b).map(index => originalVerseWords[index]).join(' ');
  };

  const verseFitMark = ({ rendering, verseFit }) => {
    if (verseFit === 2) {
      return ' - in verse';
    }
    return verseFit === 1 ? ` - verse has "${verseFormsOf(rendering)}"` : ' - not in verse';
  };

  // one plain line per rendering - easier for small models to read than JSON, and fewer tokens
  return chosen.map(entry => {
    const {
      phrase, rendering, count,
    } = entry;
    const line = `"${rendering}" (chosen ${count} time${count === 1 ? '' : 's'} for "${phrase}")` +
      (markOtherKey && !entry.isExact ? ' - for another phrase' : '');
    return markVerseFit ? `${line}${verseFitMark(entry)}` : line;
  }).join('\n');
}

/**
 * Renders the verse as `word:position` tokens (1-based positions), for log messages only: it
 * shows which verse word an AI answer could have meant. Nothing sent to the AI uses it.
 *
 * @param {string} verseContent - the target-language verse words, separated by spaces
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
 * Rule 3 of the system prompt for single requests: follow a previous translation found word for
 * word, without adding or dropping small words. Measured in Step 7 of
 * plans/improve-llm-suggestions.md (variant P3b): it lowered confident wrong answers and raised the
 * user-visible top-1 for single requests on qwen3-1.7b and qwen3-4b, but lowered qwen3-4b's
 * batched top-1, so the batch prompt keeps `LLM_PREVIOUS_TRANSLATION_RULE_BATCH`.
 */
const LLM_PREVIOUS_TRANSLATION_RULE_SINGLE = 'If a previous translation is in TARGET VERSE word for word, it is usually the answer. Copy exactly those words: do not add or drop small words.';
/** Rule 3 of the system prompt for batched requests (the wording before Step 7) */
const LLM_PREVIOUS_TRANSLATION_RULE_BATCH = 'A previous translation whose words are all in TARGET VERSE is usually the right answer. Ignore any that use words not in TARGET VERSE.';

/**
 * Second worked example, of a verse word that is another form of a previous translation. Measured
 * in Step 7 of plans/improve-llm-suggestions.md (variant P5): it raised qwen3-1.7b's top-1 and
 * lowered its confident wrong answers on single requests, but gave qwen3-4b more confident wrong
 * answers in batches, so only the single-request prompt has it.
 */
const LLM_INFLECTED_FORM_EXAMPLE = `
Example 2:
TARGET VERSE (de): alle Gläubigen waren zusammen

PREVIOUS TRANSLATIONS:
"Glaube" (chosen 5 times for "faith")

GATEWAY PHRASE (en): believers

Answer:
"Gläubigen",75
`;

/**
 * Builds the system prompt. Kept short and literal for small models: plain-language rules, worked
 * examples in exactly the layout of the real input, and the input ending in "Answer:" so the
 * reply is a completion. It holds no per-call data.
 *
 * @param {string} previousTranslationRule - text of rule 3, which differs between single and
 *   batched requests
 * @param {string} [extraExample=''] - another worked example, placed after Example 1
 * @returns {string}
 */
function buildLlmSystemPrompt(previousTranslationRule, extraExample = '') {
  return `You find the words in a Bible verse that translate a phrase.

You are given:
TARGET VERSE - the words of the verse, in order.
PREVIOUS TRANSLATIONS - how the phrase was translated before, most used first (may be missing).
GATEWAY PHRASE - the phrase to find in the verse.

Rules:
1. Answer only with words copied from TARGET VERSE, spelled exactly as written there.
2. Choose the fewest words that carry the meaning of GATEWAY PHRASE, kept in verse order.
3. ${previousTranslationRule}
4. Give 1 to 3 options, best first, one per line, written as: "words",confidence
5. confidence is a whole number from 0 to 100: 90 or more only when a previous translation is in the verse word for word, 60 to 89 for another form of a previous translation or a clear meaning match, below 60 for a guess.
6. If no words in TARGET VERSE fit, answer: "",0
7. Do not include reasoning in answer.
8. Answer only as CSV rows: no header, no explanation, no markdown fences.

Required output format:
"word word",confidence

Example 1:
TARGET VERSE (es-419): para la iglesia de Éfeso

PREVIOUS TRANSLATIONS:
"iglesia" (chosen 7 times for "church")
"la iglesia" (chosen 3 times for "the church")
"las iglesias" (chosen 31 time for "the churches")

GATEWAY PHRASE (en): church

Answer:
"iglesia",98
"la iglesia",70
${extraExample}
Wrong answer for Example 1:
"church",98 - gateway words are not in TARGET VERSE
"congregación",90 - word is not in TARGET VERSE
iglesia,98 - missing the quotes
`;
}

/*
 * Changing the system prompts, `buildTranslationOptionsPrompt` or `applyThinkingDirective` changes
 * what a fine-tuned model was trained on (plans/fine-tune-qwen3.md): regenerate the data with
 * `npm run build:finetune-data` and retrain, or the fine-tuned model loses accuracy.
 */
/** system prompt for one request per query; a constant, so the server can reuse its prompt cache */
const LLM_SINGLE_SYSTEM_PROMPT = buildLlmSystemPrompt(LLM_PREVIOUS_TRANSLATION_RULE_SINGLE, LLM_INFLECTED_FORM_EXAMPLE);
/** system prompt for batched requests, before `LLM_BATCH_SYSTEM_PROMPT` is appended; also a constant */
const LLM_BATCH_BASE_SYSTEM_PROMPT = buildLlmSystemPrompt(LLM_PREVIOUS_TRANSLATION_RULE_BATCH);

/**
 * System prompt for one request per query when the request has no previous translations (variant N3
 * of plans/improve-single-prompt.md, adopted 2026-11-25 in plans/prompt-span-experiments.md): nothing
 * about previous translations, rule 3 a meaning match, confidence 0 to 70, examples without history.
 * Without history it raised top-1 for Qwen3-4B on every set measured (TEST-NOHIST 314 -> 376 of 835),
 * and no model, the fine-tunes included, was significantly worse. A second constant, so the server
 * caches it too. Batched requests keep `LLM_BATCH_BASE_SYSTEM_PROMPT` (not measured).
 */
const LLM_SINGLE_NO_HISTORY_SYSTEM_PROMPT = `You find the words in a Bible verse that translate a phrase.

You are given:
TARGET VERSE - the words of the verse, in order.
GATEWAY PHRASE - the phrase to find in the verse.

Rules:
1. Answer only with words copied from TARGET VERSE, spelled exactly as written there.
2. Choose the fewest words that carry the meaning of GATEWAY PHRASE, kept in verse order.
3. Find the verse words with the same meaning as GATEWAY PHRASE. They may be another form of the word, or a different word with that meaning.
4. Give 1 to 3 options, best first, one per line, written as: "words",confidence
5. confidence is a whole number from 0 to 70: 60 to 70 for a clear meaning match, below 60 for a guess.
6. If no words in TARGET VERSE fit, answer: "",0
7. Do not include reasoning in answer.
8. Answer only as CSV rows: no header, no explanation, no markdown fences.

Required output format:
"word word",confidence

Example 1:
TARGET VERSE (es-419): para la iglesia de Éfeso

GATEWAY PHRASE (en): church

Answer:
"iglesia",70
"la iglesia",55

Example 2:
TARGET VERSE (de): alle Gläubigen waren zusammen

GATEWAY PHRASE (en): believers

Answer:
"Gläubigen",65

Example 3:
TARGET VERSE (sw): Yesu aliwaponya wagonjwa wengi

GATEWAY PHRASE (en): the sick

Answer:
"wagonjwa",65

Wrong answer for Example 1:
"church",70 - gateway words are not in TARGET VERSE
"congregación",70 - word is not in TARGET VERSE
iglesia,70 - missing the quotes`;

/**
 * Builds the AI prompt for selecting the best target-language translation option(s)
 * for a gateway-language phrase, using only words found in the target-language verse.
 *
 * The system prompt holds no per-call data, so the server can reuse its cached prompt prefix: one
 * constant for single requests with history lines, one for single requests without
 * (`LLM_SINGLE_NO_HISTORY_SYSTEM_PROMPT`), and one for batches.
 *
 * @param {string} verseContent - the target-language verse text without punctuation
 * @param {string} targetLangCode - language code of the target words, e.g. 'es-419'
 * @param {string} glPhrase - gateway-language phrase to translate, e.g. 'church'
 * @param {string} glLangCode - language code of the gateway phrase, e.g. 'en'
 * @param {object} previousTranslationData - prior translation-count object; the renderings
 *   are chosen and ordered by `formatPreviousTranslations`
 * @param {boolean} [forBatch=false] - true when the request is one of several in a query
 * @returns {{systemPrompt: string, input: string}} - the fully populated prompt data
 */
export function buildTranslationOptionsPrompt(
  verseContent,
  targetLangCode,
  glPhrase,
  glLangCode,
  previousTranslationData = {},
  forBatch = false,
) {
  const previousTranslations = formatPreviousTranslations(previousTranslationData, glPhrase, glLangCode, verseContent, targetLangCode);
  // a single request with no history lines gets the prompt written for that case
  const singleSystemPrompt = previousTranslations ? LLM_SINGLE_SYSTEM_PROMPT : LLM_SINGLE_NO_HISTORY_SYSTEM_PROMPT;
  const systemPrompt = forBatch ? LLM_BATCH_BASE_SYSTEM_PROMPT : singleSystemPrompt;
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
 * @param {string} [langId] - gateway-language code, passed to {@link toLowerCaseForLang};
 *   when missing, the default lowercasing rules are used
 * @returns {Array<string>} - non-empty words
 */
function getNormalizedGlWords(phrase, langId) {
  return toLowerCaseForLang(normalizer(phrase || ''), langId)
    .split(/\s+/)
    .filter(Boolean);
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
 * @param {string} [glLangId=''] - gateway-language code, used for locale-aware lowercasing when
 *   splitting `glPhrase` and each history key into words
 * @returns {Array<{key: string, counts: object, relatedness: number, isExact: boolean}>} - one entry
 *   per history key; `key` is the history key (`glPhrase` for flat history)
 */
function rankGlKeys(previousTranslationData, glPhrase, glLangId = '') {
  const data = previousTranslationData || {};
  const keys = Object.keys(data);

  // data is phrase-keyed when its values are count maps rather than counts
  const isPhraseKeyed = Object.values(data).some(value => value && typeof value === 'object');

  if (!isPhraseKeyed) { // already the counts for this phrase
    return keys.length ? [{
      key: glPhrase, counts: data, relatedness: 1, isExact: true,
    }] : [];
  }

  const normalizedGl = normalizeForCompare(glPhrase, glLangId).trim();
  const glWords = getNormalizedGlWords(glPhrase, glLangId);

  return keys.map(key => {
    const counts = data[key] || {};

    if (key === glPhrase || normalizeForCompare(key, glLangId).trim() === normalizedGl) {
      return {
        key, counts, relatedness: 1, isExact: true,
      };
    }

    const keyWords = getNormalizedGlWords(key, glLangId);
    let relatedness = 0;

    if (glWords.length && keyWords.length) {
      const recall = getWeightedWordCoverage(glWords, keyWords);
      const precision = getWeightedWordCoverage(keyWords, glWords);
      relatedness = (recall + precision) ? (2 * recall * precision) / (recall + precision) : 0;
    }

    return {
      key, counts, relatedness, isExact: false,
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
      const normalizedRendering = splitIntoWords(rendering)
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
 * Moves a suggestion to the occurrence of the check. Both suggestion paths place a rendering at
 * its first match in the verse, so when the original-language word occurs more than once (the
 * check's `contextId.occurrence` is above 1), two checks would get the same words. This assumes
 * the nth occurrence of the original word is rendered by the nth occurrence of the suggested
 * words - a heuristic, applied only when it is safe:
 * - `occurrence` is above 1, and the selections are an adjacent run of verse words;
 * - the selections are the first of the non-overlapping runs of the same words (compared with
 *   `normalizeForCompare`) in the verse, found left to right;
 * - the verse has at least `occurrence` such runs.
 * Otherwise the selections are returned unchanged.
 *
 * @param {Array<{text: string, occurrence: number}>} selections - one suggestion option's words
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {number} occurrence - the check's occurrence of its original-language quote (1-based)
 * @param {string} [langId=''] - target-language code, for lowercasing
 * @returns {Array<{text: string, occurrence: number}>} - the selections at run number
 *   `occurrence`, or `selections` unchanged
 * @example
 * moveSelectionsToOccurrence([{ text: 'Dios', occurrence: 1 }],
 *   ['Dios', 'amó', 'al', 'mundo', 'y', 'Dios', 'envió'], 2);
 * // [{ text: 'Dios', occurrence: 2 }]
 */
export function moveSelectionsToOccurrence(selections, wordList, occurrence, langId = '') {
  if (!(occurrence > 1) || !selections?.length || !wordList?.length) {
    return selections;
  }

  const positions = selections.map(({ text, occurrence: wordOccurrence }) => {
    let seen = 0;
    return wordList.findIndex(word => word === text && ++seen === (wordOccurrence || 1));
  });
  const adjacent = positions.every((position, i) => position >= 0 && (i === 0 || position === positions[i - 1] + 1));

  if (!adjacent) {
    return selections;
  }

  const normalizedWordList = wordList.map(word => normalizeForCompare(word, langId));
  const runWords = positions.map(position => normalizedWordList[position]);
  const runStarts = [];

  for (let start = 0; start <= normalizedWordList.length - runWords.length; start++) {
    if (runWords.every((word, offset) => normalizedWordList[start + offset] === word)) {
      runStarts.push(start);
      start += runWords.length - 1; // runs may not overlap
    }
  }

  if (runStarts[0] !== positions[0] || runStarts.length < occurrence) {
    return selections;
  }

  const start = runStarts[occurrence - 1];
  return buildSelectionsFromPositions(wordList, runWords.map((_, offset) => start + offset));
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

/** most extra verse words allowed inside an out-of-order placement of a rendering */
const MAX_UNORDERED_GAP = 1;
/** confidence taken off a rendering found only with its words out of order */
const ORDER_PENALTY = 10;
/** highest confidence an out-of-order placement can report */
const UNORDERED_MAX_CONFIDENCE = 89;

/**
 * Finds the smallest verse window holding one position of every word, in any order, for target
 * languages whose word order varies between verses (e.g. 'святой дух' read as 'дух святой').
 * Only accepted when the window has at most `MAX_UNORDERED_GAP` extra words, so far-apart words are
 * never paired up. Sorts every (position, word) pair and slides two pointers over them.
 *
 * @param {Array<Array<number>>} positionsPerWord - for each word, its ascending candidate positions
 * @returns {Array<number>|null} - ascending distinct positions, one per word, or `null`
 */
function findTightestUnorderedWindow(positionsPerWord) {
  const wordCount = positionsPerWord.length;

  if (!wordCount || positionsPerWord.some(positions => !positions?.length)) {
    return null;
  }

  const pairs = [];

  positionsPerWord.forEach((positions, wordIndex) => {
    positions.forEach(position => pairs.push([position, wordIndex]));
  });
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const wordsInWindow = new Map();
  let coveredWords = 0;
  let left = 0;
  let best = null;

  for (let right = 0; right < pairs.length; right++) {
    const rightWord = pairs[right][1];
    wordsInWindow.set(rightWord, (wordsInWindow.get(rightWord) || 0) + 1);

    if (wordsInWindow.get(rightWord) === 1) {
      coveredWords++;
    }

    while (coveredWords === wordCount) {
      const span = pairs[right][0] - pairs[left][0];

      if (!best || span < best.span) {
        best = {
          span, left, right,
        };
      }

      const leftWord = pairs[left][1];
      wordsInWindow.set(leftWord, wordsInWindow.get(leftWord) - 1);

      if (!wordsInWindow.get(leftWord)) {
        coveredWords--;
      }
      left++;
    }
  }

  if (!best || best.span - (wordCount - 1) > MAX_UNORDERED_GAP) {
    return null;
  }

  // give each word a distinct position inside the window
  const chosen = new Map();
  const used = new Set();

  for (let i = best.left; i <= best.right; i++) {
    const [position, wordIndex] = pairs[i];

    if (!chosen.has(wordIndex) && !used.has(position)) {
      chosen.set(wordIndex, position);
      used.add(position);
    }
  }

  if (chosen.size < wordCount) {
    return null; // a repeated rendering word could not get its own verse word
  }

  return [...used].sort((a, b) => a - b);
}

/**
 * Places the words of a rendering in the verse: in reading order if possible (tightest placement),
 * otherwise in a tight out-of-order window (see `findTightestUnorderedWindow`).
 *
 * @param {Array<Array<number>>} positionsPerWord - for each word, its ascending candidate positions
 * @returns {{positions: Array<number>, inOrder: boolean}|null} - ascending positions, or `null` when the words cannot be placed
 */
function placeWords(positionsPerWord) {
  const ordered = findTightestOrderedPlacement(positionsPerWord);

  if (ordered) {
    return { positions: ordered, inOrder: true };
  }

  const unordered = findTightestUnorderedWindow(positionsPerWord);
  return unordered ? { positions: unordered, inOrder: false } : null;
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
 * Weights of {@link scoreSuggestionFromHistory}, fitted on the training data's tune projects and
 * checked on its held-out projects (plans/algorithm-confidence.md, Step 2 revised: held-out AUC 0.789
 * -> 0.874, wrong options shown at confidence 80 or more 1,585 -> 121).
 */
const HISTORY_SCORE = {
  /** closeness of a rendering found in order with other verse words between its words */
  ordered: 0.2,
  /** closeness of a rendering found with its words slightly out of order */
  unordered: 0.3,
  /** closeness of a match with some of the rendering's words missing, before coverage */
  partial: 0.6,
  /**
   * closeness of a fuzzy match (similar word forms) through the exact GL key; such matches were right
   * 79% of the time on tune and 92% on test. Through a related key the GL-key weight already lowers
   * them, and the fit found no further reduction.
   */
  fuzzyExactKey: 0.85,
  /**
   * each word of a suggestion that is not a word of the history rendering it is compared with multiplies
   * its closeness by this; only for `scoreSelectionsFromHistory` (measuring AI answers, Step 5b), since
   * the algorithm's own options have no extra words
   */
  extraWord: 0.7,
  /** coverage (words found / rendering words) is raised to this power for partial and fuzzy matches */
  coverageExponent: 1.5,
  /** each verse word between the matched words multiplies closeness by this */
  gapFactor: 0.5,
  /**
   * a related (not exact) GL key: weight `relatedKeyMax * (relatedKeyBase + (1 - relatedKeyBase) *
   * relatedness)`, so 0.36-0.6
   */
  relatedKeyMax: 0.6,
  relatedKeyBase: 0.6,
  /** the matched words occur more than once in the verse, so another occurrence may be meant */
  repeatedInVerse: 0.5,
  /**
   * a verse word next to the match is a word of a rendering of the exact GL key, so the user's own
   * selections for this phrase suggest a longer selection. Words of other keys' renderings are left out:
   * they misfired ('la' of 'la ley' for 'the faith'), and they put a longer related-key rendering ('la
   * foi' for 'fe') above the exact key's ('foi'), which was right twice as often (Step 4).
   */
  historyNeighbour: 0.4,
  /** another history rendering is also in the verse word for word */
  competingRendering: 0.7,
};

/**
 * Times a rendering must have been chosen before for a match to be certain (confidence 100), with the
 * other conditions of {@link scoreSuggestionFromHistory}. With 5, certain answers were right 95.0% of
 * the time on the held-out projects and 95.2% on tune (3: 94.2% and 94.2%; 4: 94.5% and 95.0%),
 * against 86.4% held out for the old rule (exact GL key, verbatim); the target is 95% (Step 4).
 */
const CERTAIN_MIN_HISTORY_COUNT = 5;

/**
 * The fuzzy pass (similar word forms) runs when no candidate's confidence reaches this. With it, fuzzy
 * candidates compete by confidence whenever the verbatim and partial matches are weak: top-1 rose on tune
 * (11,590 -> 11,625) and test (3,478 -> 3,487) against the old trigger (no match score above 80); any
 * cutoff from 50 to "always" gave the same top-1, and higher ones only added low-ranked options
 * (plans/algorithm-confidence.md, Step 5).
 */
const FUZZY_PASS_BELOW_CONFIDENCE = 50;

/**
 * Confidence of a suggestion from the user's selection history (plans/algorithm-confidence.md): how
 * closely it matches the most similar history rendering, lower when that rendering came from a GL key
 * that is not the exact GL phrase, and lower when the verse makes the match doubtful.
 *
 *   confidence = 100 x closeness x GL-key weight x verse checks, 1-99
 *
 * - closeness: 1 for the rendering found word for word; `HISTORY_SCORE.ordered` or `.unordered` when its
 *   words are separated or swapped; `HISTORY_SCORE.partial` x coverage^`coverageExponent` when some are
 *   missing; coverage^`coverageExponent` for a fuzzy match (times `fuzzyExactKey` through the exact GL
 *   key); each gap word multiplies by `gapFactor`.
 *   Word similarity of a fuzzy match is not used: on the training data it did not predict whether the
 *   match was right.
 * - GL-key weight: 1 for the exact GL key, else 0.36-0.6 by relatedness.
 * - verse checks: `repeatedInVerse`, `historyNeighbour`, `competingRendering`.
 *
 * How often the rendering was chosen is not a factor: on the training data it did not predict the right
 * answer once the verse checks were applied (the history holds many inflected forms, and the one in the
 * verse is usually right however rarely it was chosen). It decides certainty only: 100, the level at
 * which the app does not ask the AI, needs a verbatim match from the exact GL key that passes every verse
 * check, from a rendering chosen at least {@link CERTAIN_MIN_HISTORY_COUNT} times.
 *
 * @param {object} features - how the suggestion was found, as `explain` reports them in
 *   {@link getBestTWordSelectionWithConfidenceAlgorithm}: `path`, `exactKey`, `relatedness`, `count`,
 *   `renderingWords`, `matchedWords`, `gap`, `runsInVerse`, `neighbourInExactKeyHistory`, `verbatimRenderings`
 * @returns {number} - 100 when certain, else 1-99
 */
function scoreSuggestionFromHistory(features, { extraWordFactor = HISTORY_SCORE.extraWord } = {}) {
  const {
    path, exactKey, relatedness = 0, count = 0, renderingWords = 1, matchedWords = 1, gap = 0,
    runsInVerse = 1, neighbourInExactKeyHistory = 0, verbatimRenderings = 1, extraWords = 0,
  } = features;
  const repeated = runsInVerse > 1;
  const neighbour = neighbourInExactKeyHistory > 0;
  const competing = verbatimRenderings > 1;

  if (path === 'verbatim' && exactKey && !repeated && !neighbour && !competing && !extraWords
    && count >= CERTAIN_MIN_HISTORY_COUNT) {
    return 100;
  }

  const coverage = (matchedWords / renderingWords) ** HISTORY_SCORE.coverageExponent;
  const gapWeight = HISTORY_SCORE.gapFactor ** gap;
  const closeness = {
    verbatim: 1,
    ordered: HISTORY_SCORE.ordered * gapWeight,
    unordered: HISTORY_SCORE.unordered * gapWeight,
    partial: HISTORY_SCORE.partial * coverage * gapWeight,
    slice: HISTORY_SCORE.partial * coverage,
    fuzzy: (exactKey ? HISTORY_SCORE.fuzzyExactKey : 1) * coverage * gapWeight,
  }[path] ?? HISTORY_SCORE.partial * coverage;
  const keyWeight = exactKey ? 1 :
    HISTORY_SCORE.relatedKeyMax * (HISTORY_SCORE.relatedKeyBase + (1 - HISTORY_SCORE.relatedKeyBase) * relatedness);
  const verseWeight = (repeated ? HISTORY_SCORE.repeatedInVerse : 1)
    * (neighbour ? HISTORY_SCORE.historyNeighbour : 1)
    * (competing ? HISTORY_SCORE.competingRendering : 1);

  return Math.max(1, Math.min(99, Math.round(100 * closeness * keyWeight * verseWeight * extraWordFactor ** extraWords)));
}

/**
 * Positions in `wordList` of a suggestion's words, each at its occurrence.
 * @param {Array<string>} wordList - verse words
 * @param {Array<{text: string, occurrence: number}>} selections
 * @returns {Array<number>|null} - ascending positions, or null when a word is not in the verse
 */
function positionsOfSelections(wordList, selections) {
  const positions = (selections || []).map(({ text, occurrence = 1 }) => {
    let seen = 0;
    return wordList.findIndex(word => word === text && ++seen === occurrence);
  });
  return positions.length && positions.every(position => position >= 0) ? positions.sort((a, b) => a - b) : null;
}

/**
 * Confidence of any suggestion (an AI answer, for one) from the user's selection history, on the same
 * scale as the algorithm's (plans/algorithm-confidence.md, Step 5b). **Not used by the app:** for
 * measuring only (`__tests__/calibrateAiConfidence.test.js`). Giving AI answers this score instead of the
 * AI's own confidence made the first suggestion shown in AI mode right 3-5 points less often with the
 * fine-tuned model (whose own confidences are calibrated), so AI confidences are left as the AI gives
 * them (decision D). The suggestion is compared with
 * every history rendering, and the best {@link scoreSuggestionFromHistory} wins. Against a rendering it
 * is verbatim when it is the rendering's words, adjacent and in order; it is in order with gaps when it is
 * the rendering's words with verse words between them; partial when it has some of the rendering's
 * words; fuzzy when it has none but similar forms (`wordSimilarity`). Words of the suggestion that are
 * not the rendering's count as `extraWords`.
 *
 * @param {Array<string>} wordList - verse words in reading order
 * @param {Array<{text: string, occurrence: number}>} selections - the suggestion's words
 * @param {string} glPhrase - gateway-language phrase
 * @param {string} glLangCode - gateway-language code
 * @param {object} previousTranslationData - the selection history, as for the algorithm
 * @param {object} [weights] - for measuring: `extraWordFactor` (default `HISTORY_SCORE.extraWord`)
 * @returns {{confidence: number, features: object}|null} - the best score and its features, or null when
 *   the history is empty or no rendering shares a word (or a similar form) with the suggestion
 */
export function scoreSelectionsFromHistory(wordList, selections, glPhrase, glLangCode, previousTranslationData, weights = {}) {
  const words = wordList || [];
  const countEntries = poolRenderings(rankGlKeys(previousTranslationData, glPhrase, glLangCode));
  const positions = positionsOfSelections(words, selections);

  if (!countEntries.length || !positions) {
    return null;
  }

  const normalizedWordList = words.map(word => normalizeForCompare(word));
  const optionWords = positions.map(position => normalizedWordList[position]);
  const span = positions[positions.length - 1] - positions[0];
  const isContiguous = span === positions.length - 1;
  const exactKeyWords = new Set(countEntries.filter(({ isExact }) => isExact).flatMap(({ rendering }) => rendering.split(/\s+/)));
  const neighbours = [normalizedWordList[positions[0] - 1], normalizedWordList[positions[positions.length - 1] + 1]];
  let runsInVerse = Math.min(...optionWords.map(word => normalizedWordList.filter(verseWord => verseWord === word).length));

  if (isContiguous) {
    runsInVerse = 0;

    for (let start = 0; start <= normalizedWordList.length - optionWords.length; start++) {
      if (optionWords.every((word, offset) => normalizedWordList[start + offset] === word)) {
        runsInVerse++;
        start += optionWords.length - 1; // runs may not overlap
      }
    }
  }

  const verbatimRenderings = countEntries.filter(({ rendering }) => findContiguousMatchPositions(normalizedWordList, rendering.split(/\s+/))).length;
  const shared = {
    runsInVerse,
    neighbourInExactKeyHistory: neighbours.filter(word => word && exactKeyWords.has(word)).length,
    verbatimRenderings,
    gap: span + 1 - positions.length,
  };
  let best = null;

  for (const entry of countEntries) {
    const renderingWords = entry.rendering.split(/\s+/).filter(Boolean);
    const unused = [...optionWords];
    let matchedWords = 0;

    for (const word of renderingWords) {
      const index = unused.indexOf(word);

      if (index >= 0) {
        unused.splice(index, 1);
        matchedWords++;
      }
    }

    let path;

    if (matchedWords === renderingWords.length) {
      const inOrder = renderingWords.join(' ') === optionWords.filter(word => renderingWords.includes(word)).join(' ');
      path = inOrder ? 'ordered' : 'unordered';

      if (isContiguous && inOrder) {
        path = 'verbatim';
      }
    } else if (matchedWords) {
      path = 'partial';
    } else {
      matchedWords = renderingWords.filter(word => optionWords.some(optionWord => wordSimilarity(word, optionWord) > 0)).length;
      path = 'fuzzy';
      unused.splice(0, unused.length, ...optionWords.filter(optionWord => !renderingWords.some(word => wordSimilarity(word, optionWord) > 0)));
    }

    if (!matchedWords) {
      continue;
    }

    const features = {
      ...shared,
      path,
      exactKey: entry.isExact,
      relatedness: entry.relatedness,
      count: entry.count,
      renderingWords: renderingWords.length,
      matchedWords,
      extraWords: unused.length,
      gap: path === 'verbatim' ? 0 : shared.gap,
    };
    const confidence = scoreSuggestionFromHistory(features, weights);

    if (!best || confidence > best.confidence) {
      best = { confidence, features };
    }
  }

  return best;
}

/**
 * Scores how good a match is, 0-100. Used to choose between candidates for the same words, to decide
 * whether the fuzzy pass runs, and to order the options; the confidence reported for an option is
 * {@link scoreSuggestionFromHistory}.
 *
 * Only a complete rendering found adjacently and in order scores 100 - that is the exact match.
 * Every weaker match is capped at 99 so a caller applying a confidence threshold can tell an
 * exact hit from a fallback, built from:
 * - coverage: how much of the rendering was found, worth up to 60. For a partial match each found word
 *   counts as `matchedWeight / matchedWordCount`, so a fragment made of words the verse repeats counts less
 * - completeness: 20 more when every word of the rendering was found
 * - adjacency: 15 more when two or more matched words are adjacent in the verse (a single word is
 *   trivially "adjacent", so it earns nothing)
 * - compactness: up to 10 for a gapped match, shrinking as the words spread further apart
 * - usage: up to 5 for how often this rendering was chosen before, relative to the most-used one
 *
 * @param {number} matchedWordCount - words of the rendering located in the verse
 * @param {number} phraseWordCount - words in the full rendering
 * @param {boolean} isContiguous - whether the matched words are adjacent in the verse
 * @param {number} span - distance between the first and last matched position
 * @param {number} count - times this rendering was used before
 * @param {number} maxCount - times the most-used rendering of this phrase was used
 * @param {number} [matchedWeight=matchedWordCount] - weighted number of matched words used for coverage
 * @returns {number} - 100 for an exact match, otherwise 1-99
 */
function scoreAlgorithmicMatch(
  matchedWordCount,
  phraseWordCount,
  isContiguous,
  span,
  count,
  maxCount,
  matchedWeight = matchedWordCount,
) {
  const isFullMatch = matchedWordCount === phraseWordCount;

  if (isFullMatch && isContiguous) {
    return 100;
  }

  const coverageScore = Math.round((matchedWeight / phraseWordCount) * 60);
  const fullMatchBonus = isFullMatch ? 20 : 0;
  const contiguousBonus = (isContiguous && matchedWordCount >= 2) ? 15 : 0;
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
export function wordSimilarity(a, b) {
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
 * usage count first, and each candidate gets a match score (`scoreAlgorithmicMatch`) that chooses
 * between candidates for the same words and breaks ties in the order:
 * - found adjacently and in order through the exact GL key: 100
 * - found adjacently and in order through a related GL key: 82-95, higher the more weighted GL words
 *   the key shares with the phrase (`capForRendering`)
 * - found in order with other verse words in between: below 100, by compactness (and under the key's cap)
 * - found with its words swapped but within one gap: 10 points below the in-order score, never above 89
 * - when the whole rendering is not there, the words the verse does contain are tried and score lower
 *   still, by how much of the rendering they cover (discounted when the verse repeats those words)
 *   and how tightly they sit together
 * - found only by fuzzy word matching (inflection, compound, accent): at most 90, scaled by average
 *   word similarity (`wordSimilarity`); this pass runs only when no candidate above has a confidence of
 *   `FUZZY_PASS_BELOW_CONFIDENCE` (50) or more
 *
 * The same verse words can be reached from more than one rendering (`iglesia` is both its own
 * rendering and part of `de la iglesia`), so a candidate keeps the best score any rendering
 * earns for it rather than whichever was examined first.
 *
 * The confidence reported for each of the (up to 3) options, which also orders them, is not the match
 * score but {@link scoreSuggestionFromHistory}: closeness to the history rendering x GL-key weight x verse checks,
 * fitted on the training data (plans/algorithm-confidence.md). It is 100 (certain, so the app does not
 * ask the AI) only for a verbatim match through the exact GL key that occurs once in the verse, has no
 * history word next to it, is the only history rendering in the verse, and was chosen at least
 * {@link CERTAIN_MIN_HISTORY_COUNT} times.
 *
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {string} targetLangCode - language code of the verse, e.g. 'es-419'; unused, kept so this
 *   function is interchangeable with the AI version
 * @param {string} glPhrase - gateway-language phrase to translate, e.g. 'church'
 * @param {string} glLangCode - language code of the gateway phrase, e.g. 'en'; passed to
 *   {@link rankGlKeys} for locale-aware lowercasing of the GL phrase and history keys
 * @param {object} previousTranslationData - prior translation counts, nested `{glPhrase: {target: count}}`
 *   or flat `{target: count}`
 * @param {object} [options]
 * @param {boolean} [options.explain=false] - also return each option's `features`: how it was found
 *   and the evidence for it, for measuring and calibrating the confidence
 *   (plans/algorithm-confidence.md, `npm run calibrate:algorithm`). The options and confidences are the
 *   same either way.
 * @param {number} [options.fuzzyPassBelow=FUZZY_PASS_BELOW_CONFIDENCE] - run the fuzzy pass when no
 *   candidate's confidence reaches this; for measuring (plans/algorithm-confidence.md, Step 5)
 * @returns {Promise<Array<{selections: Array<{text: string, occurrence: number}>, confidence: number, features?: object}>>} -
 *   up to 3 options, best first; empty when this phrase has no history or nothing in it fits the verse.
 *   With `explain`, each option's `features` are:
 *   - `path`: how its words were found: 'verbatim' (adjacent and in order), 'ordered' (in order with
 *     gaps), 'unordered' (slightly out of order), 'partial' (only some of the rendering's words),
 *     'slice' (a contiguous slice of the rendering), or 'fuzzy' (similar word forms)
 *   - `exactKey`, `relatedness`: whether its rendering came from the exact GL key, else how related
 *     the key is (0-1)
 *   - `count`, `share`, `usageRank`, `renderings`: the rendering's history count, its share of all
 *     pooled counts, its rank among them (0 = most used), and how many renderings were pooled
 *   - `renderingWords`, `matchedWords`, `gap`: words in the rendering, words found, and verse words
 *     between the first and last found word that are not part of it
 *   - `similarity`: mean word similarity (1 unless fuzzy matched)
 *   - `runsInVerse`: how many times its words occur in the verse (as separate adjacent runs when they
 *     are adjacent, else the fewest times any of its words occurs)
 *   - `neighbourInHistory`: how many of the verse words just before and after it (0-2) are words of
 *     a history rendering; `neighbourInExactKeyHistory` counts only renderings of the exact GL key (the
 *     one the confidence uses), `neighbourInRelatedHistory` those of the exact or a closely related key
 *     (relatedness 0.5 or more), and `neighbourExtendsRendering` renderings that also hold one of its words
 *   - `pointScore`, `cap`: the score before the GL-key cap, and the cap
 *   - `verbatimRenderings`: how many history renderings were found verbatim in this verse
 *   - `candidates`, `rank`: how many candidates were found, and this option's place among them
 *   - `matchScore`: the candidate's match score (see above)
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
  { explain = false, fuzzyPassBelow = FUZZY_PASS_BELOW_CONFIDENCE } = {},
) {
  // Initialize wordList, defaulting to empty array if null/undefined
  const words = wordList || [];
  // Score every history key against the GL phrase and pool their renderings, most used first, so the
  // strongest evidence claims its words before weaker renderings. Each rendering remembers how closely
  // its GL key matched, which caps its confidence.
  const countEntries = poolRenderings(
    rankGlKeys(previousTranslationData, glPhrase, glLangCode)
  );

  // Early exit if no previous translations exist or verse has no words
  if (!countEntries.length || !words.length) {
    console.log('algorithm response: no usable previous translations', { glPhrase });
    return [];
  }

  // Store the highest usage count for relative scoring later
  const maxCount = countEntries[0].count;
  // Normalize all verse words for case-insensitive, punctuation-free comparison
  const normalizedWordList = words.map(word => normalizeForCompare(word));
  // how often each word occurs in the verse, so fragments made of common words count for less
  const verseWordCounts = new Map();

  for (const word of normalizedWordList) {
    verseWordCounts.set(word, (verseWordCounts.get(word) || 0) + 1);
  }

  // Map to store candidates, keyed by position string (e.g. "2:3:5") to deduplicate same words
  const candidates = new Map(); // keyed by matched positions, so the same words appear once
  // the evidence behind each candidate, for its confidence (`scoreSuggestionFromHistory`) and `explain`
  const totalCount = countEntries.reduce((total, { count }) => total + count, 0);
  const historyWords = new Set(countEntries.flatMap(({ rendering }) => rendering.split(/\s+/)));
  // words of renderings from the exact or a closely related GL key (plans/algorithm-confidence.md, Step 4)
  const relatedHistoryWords = new Set(countEntries
    .filter(({ isExact, relatedness }) => isExact || relatedness >= 0.5)
    .flatMap(({ rendering }) => rendering.split(/\s+/)));
  const renderingWordSets = countEntries.map(({ rendering }) => new Set(rendering.split(/\s+/)));
  const exactKeyHistoryWords = new Set(countEntries.filter(({ isExact }) => isExact)
    .flatMap(({ rendering }) => rendering.split(/\s+/)));
  let verbatimRenderings = 0;

  /**
   * Features of a candidate (see the function's doc comment); `verbatimRenderings`, `candidates` and
   * `rank` are added once every candidate is known.
   * @returns {object}
   */
  function describeCandidate({
    positions, phraseWordCount, entry, path, isContiguous, span, totalSimilarity, score,
  }) {
    const matchedWords = positions.map(position => normalizedWordList[position]);
    let runsInVerse = Math.min(...matchedWords.map(word => verseWordCounts.get(word)));

    if (isContiguous) {
      runsInVerse = 0;

      for (let start = 0; start <= normalizedWordList.length - matchedWords.length; start++) {
        if (matchedWords.every((word, offset) => normalizedWordList[start + offset] === word)) {
          runsInVerse++;
          start += matchedWords.length - 1; // runs may not overlap
        }
      }
    }

    const neighbours = [normalizedWordList[positions[0] - 1], normalizedWordList[positions[positions.length - 1] + 1]];

    return {
      path,
      exactKey: entry.isExact,
      relatedness: Math.round(entry.relatedness * 1000) / 1000,
      count: entry.count,
      share: Math.round(entry.count / totalCount * 1000) / 1000,
      usageRank: countEntries.indexOf(entry),
      renderings: countEntries.length,
      renderingWords: phraseWordCount,
      matchedWords: positions.length,
      gap: span - (positions.length - 1),
      similarity: totalSimilarity === null ? 1 : Math.round(totalSimilarity / phraseWordCount * 1000) / 1000,
      runsInVerse,
      neighbourInHistory: neighbours.filter(word => word && historyWords.has(word)).length,
      neighbourInRelatedHistory: neighbours.filter(word => word && relatedHistoryWords.has(word)).length,
      neighbourInExactKeyHistory: neighbours.filter(word => word && exactKeyHistoryWords.has(word)).length,
      // a history rendering holds the neighbour and one of these words: a longer selection may be meant
      neighbourExtendsRendering: neighbours.filter(word => word && renderingWordSets.some(set => set.has(word)
        && matchedWords.some(matched => set.has(matched)))).length,
      pointScore: score,
      cap: capForRendering(entry),
    };
  }

  // Helper function to evaluate and store a candidate match; `inOrder` is false for an out-of-order
  // placement, and `totalSimilarity` is set (sum of word similarities) when words were fuzzy matched;
  // `path` names how the words were found, for `explain`
  function considerCandidate(positions, phraseWordCount, entry, inOrder = true, totalSimilarity = null, path = '') {
    // Skip if no positions found
    if (!positions?.length) {
      return;
    }

    // Calculate span (distance between first and last matched word)
    const span = positions[positions.length - 1] - positions[0];
    // Check if words are adjacent (contiguous) and in reading order in the verse
    const isContiguous = inOrder && span === positions.length - 1;
    // a partial match is discounted when its words occur many times in the verse
    const matchedWeight = positions.length < phraseWordCount
      ? positions.reduce((total, position) => total + 1 / verseWordCounts.get(normalizedWordList[position]), 0)
      : positions.length;
    // Calculate confidence score (0-100) based on match quality
    const { count } = entry;
    let score = scoreAlgorithmicMatch(positions.length, phraseWordCount, isContiguous, span, count, maxCount, matchedWeight);

    if (!inOrder) {
      score = Math.max(1, Math.min(UNORDERED_MAX_CONFIDENCE, score - ORDER_PENALTY));
    }

    if (totalSimilarity !== null) { // fuzzy matches are scaled by how similar the words are, and capped
      score = Math.max(1, Math.min(FUZZY_TARGET_MAX_CONFIDENCE, Math.round(score * (totalSimilarity / phraseWordCount))));
    }

    // capped by how closely the GL key matched; this match score chooses and orders candidates, the
    // reported confidence comes from `scoreSuggestionFromHistory` once every candidate is known
    const matchScore = Math.min(score, capForRendering(entry));
    // Create unique key from positions for deduplication
    const key = positions.join(':');
    const existing = candidates.get(key);

    // Keep only the best match for these positions (highest match score, then highest count)
    // These words may already have been matched by another rendering - keep the stronger reading
    if (existing && (existing.matchScore > matchScore
      || (existing.matchScore === matchScore && existing.count >= count))) {
      return;
    }

    // Store or update the candidate with its metadata
    candidates.set(key, {
      selections: buildSelectionsFromPositions(words, positions),
      matchScore,
      count,
      span,
      matchedWordCount: positions.length,
      features: describeCandidate({
        positions, phraseWordCount, entry, path, isContiguous, span, totalSimilarity, score,
      }),
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
      verbatimRenderings++;
      considerCandidate(exactPositions, phraseWords.length, entry, true, null, 'verbatim');
      continue;
    }

    const positionsPerWord = phraseWords.map(word => {
      const positions = [];

      normalizedWordList.forEach((verseWord, position) => {
        if (verseWord === word) {
          positions.push(position);
        }
      });
      return positions;
    });

    // Second attempt: all the words, in order with gaps between them, else slightly out of order
    const placement = placeWords(positionsPerWord);

    if (placement) {
      considerCandidate(placement.positions, phraseWords.length, entry, placement.inOrder, null,
        placement.inOrder ? 'ordered' : 'unordered');
      continue;
    }

    // Third attempt: every rendering word the verse does contain, wherever the missing ones were.
    // Partial matches are still scored against the full rendering length, so confidence is reduced
    // when one or more words from the previous translation are missing from wordList.
    const presentPositions = positionsPerWord.filter(positions => positions.length);

    if (presentPositions.length) {
      const presentPlacement = placeWords(presentPositions);

      if (presentPlacement) {
        considerCandidate(presentPlacement.positions, phraseWords.length, entry, presentPlacement.inOrder, null, 'partial');
        continue;
      }
    }

    // Fallback: the best ordered contiguous slice of the rendering that exists in the verse
    const availablePositions = findBestAvailableOrderedMatchPositions(normalizedWordList, phraseWords);
    considerCandidate(availablePositions, phraseWords.length, entry, true, null, 'slice');
  }

  const haveConfidentCandidate = [...candidates.values()].some(candidate => scoreSuggestionFromHistory({
    ...candidate.features, verbatimRenderings, candidates: candidates.size,
  }) >= fuzzyPassBelow);

  if (!haveConfidentCandidate) {
    // Fuzzy pass: match each rendering word to similar verse words (inflected, compound or accent-variant
    // forms, see `wordSimilarity`), then place the matched words like an exact match - in order, else
    // in a tight out-of-order window - so words scattered across the verse are never paired up.
    const similarityCache = new Map(); // the same word pairs recur across renderings

    const getSimilarity = (phraseWord, verseWord) => {
      const cacheKey = phraseWord + '\u0000' + verseWord;

      if (!similarityCache.has(cacheKey)) {
        similarityCache.set(cacheKey, wordSimilarity(phraseWord, verseWord));
      }
      return similarityCache.get(cacheKey);
    };

    for (const entry of countEntries) {
      const phraseWords = entry.rendering.split(/\s+/).filter(Boolean).map(word => normalizeForCompare(word));
      // drop rendering words with no similar verse word; they still count against coverage
      const presentWords = phraseWords.filter(phraseWord => normalizedWordList.some(verseWord => getSimilarity(phraseWord, verseWord) > 0));

      if (!presentWords.length) {
        continue;
      }

      const positionsPerWord = presentWords.map(phraseWord => {
        const positions = [];

        normalizedWordList.forEach((verseWord, position) => {
          if (getSimilarity(phraseWord, verseWord) > 0) {
            positions.push(position);
          }
        });
        return positions;
      });
      const placement = placeWords(positionsPerWord);

      if (placement) {
        const totalSimilarity = placement.positions.reduce((total, position) => total +
          Math.max(...presentWords.map(phraseWord => getSimilarity(phraseWord, normalizedWordList[position]))), 0);
        considerCandidate(placement.positions, phraseWords.length, entry, placement.inOrder, totalSimilarity, 'fuzzy');
      }
    }

    if (candidates.size) {
      // console.log('fuzzy match response:', {
      //   wordList: formatNumberedVerse(words.join(' ')),
      //   glPhrase,
      //   candidates: [...candidates.values()],
      // });
    } else {
      // console.log('algorithm response: no usable candidates for ', { glPhrase });
    }
  }

  // Give every candidate the confidence of its evidence (`scoreSuggestionFromHistory`), order them by
  // it (ties by match score, count, matched word count, compactness), and take the top 3. Ordering by
  // the confidence raised top-1 on the tune projects and kept it on the held-out ones (Step 4), and
  // keeps the confidences shown falling from first to last.
  const bestSelections = [...candidates.values()]
    .map(candidate => ({
      ...candidate,
      confidence: scoreSuggestionFromHistory({
        ...candidate.features, verbatimRenderings, candidates: candidates.size,
      }),
    }))
    .sort((a, b) => (
      b.confidence - a.confidence
      || b.matchScore - a.matchScore
      || b.count - a.count
      || b.matchedWordCount - a.matchedWordCount
      || a.span - b.span
    ))
    .slice(0, 3)
    .map(({
      selections, confidence, matchScore, features,
    }, rank) => (explain ? {
      selections,
      confidence,
      features: {
        ...features, verbatimRenderings, candidates: candidates.size, rank, matchScore,
      },
    } : { selections, confidence }));

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
/** sampling temperature used when the caller gives none */
const LLM_DEFAULT_TEMPERATURE = 0.1;
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
 * Each word is matched exactly first, then ignoring accents, then (unless `strict`) to the verse
 * word with the highest {@link wordSimilarity} (an inflected or compound form, e.g. `Kirche` →
 * `Kirchengemeinde`; the first such word on a tie). `wordSimilarity` never fuzzy-matches short
 * words and needs about two thirds of the characters to agree, so a word that is not in the verse
 * is not mapped onto an unrelated one. Words that cannot be found are dropped, but more than half
 * of the phrase must be found. The matched words are then placed in the verse as an adjacent run
 * if possible, otherwise as the tightest in-order placement.
 *
 * @param {string} phrase - words suggested by the AI
 * @param {Array<string>} wordList - target-language verse words in reading order
 * @param {Array<string>} normalizedWordList - `wordList` through `normalizeForCompare`
 * @param {Array<string>} foldedWordList - `normalizedWordList` through `foldAccents`
 * @param {boolean} strict - when true every word must be found, without fuzzy matching
 * @returns {{selections: Array<{text: string, occurrence: number}>, inexact: boolean}|null} -
 *   the selections, and whether any word was matched by similarity or dropped (a match that only
 *   ignores accents is exact); null when the phrase could not be placed
 */
function resolveLlmPhraseInVerse(phrase, wordList, normalizedWordList, foldedWordList, strict) {
  const phraseWords = (phrase || '')
    .split(/[\s,]+/)
    .map(word => word.replace(/:\d+$/, '')) // drop `word:3` positions
    .filter(Boolean)
    .flatMap(segmentUnspacedWord) // the verse words were split the same way (getWordList)
    .map(word => normalizeForCompare(word))
    .filter(Boolean);

  if (!phraseWords.length) {
    return null;
  }

  const verseWords = [];
  let inexact = false;

  for (const word of phraseWords) {
    let verseWord = null;

    if (normalizedWordList.includes(word)) {
      verseWord = word;
    } else {
      const foldedIndex = foldedWordList.indexOf(foldAccents(word));

      if (foldedIndex >= 0) {
        verseWord = normalizedWordList[foldedIndex];
      } else if (!strict) {
        let bestSimilarity = 0; // wordSimilarity is 0 below its own threshold

        normalizedWordList.forEach(normalizedWord => {
          const similarity = wordSimilarity(word, normalizedWord);

          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            verseWord = normalizedWord;
          }
        });
        inexact = inexact || !!verseWord;
      }
    }

    if (verseWord) {
      verseWords.push(verseWord);
    } else if (strict) {
      return null;
    } else {
      inexact = true; // dropped
    }
  }

  // an answer mostly made of words that are not in the verse is not about this verse
  if (!verseWords.length || verseWords.length * 2 <= phraseWords.length) {
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

  return positions.length ? { selections: buildSelectionsFromPositions(wordList, positions), inexact } : null;
}

/**
 * Turns an AI answer into up to `LLM_MAX_OPTIONS` translation options for the verse.
 * Rows that resolve to the same words are merged keeping the higher confidence. Rows with
 * confidence 0 are the model saying the option does not fit, so they are skipped. When a row's
 * words had to be matched to the verse by similarity, or some were dropped (see
 * `resolveLlmPhraseInVerse`), its confidence is capped at `FUZZY_TARGET_MAX_CONFIDENCE`, the cap
 * the algorithm path uses for fuzzy matches.
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
      phrase, confidence: rowConfidence, strict,
    } of candidateRows) {
      const resolved = rowConfidence > 0 ?
        resolveLlmPhraseInVerse(phrase, wordList, normalizedWordList, foldedWordList, strict) : null;

      if (resolved) {
        const { selections, inexact } = resolved;
        const confidence = inexact ? Math.min(rowConfidence, FUZZY_TARGET_MAX_CONFIDENCE) : rowConfidence;
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
 * Prompt builder that replaces `buildTranslationOptionsPrompt` for single AI requests while set;
 * for prompt experiments only (plans/improve-single-prompt.md). See
 * {@link setSinglePromptOverrideForEval}.
 */
let singlePromptOverrideForEval = null;

/**
 * **For evaluation only** (plans/improve-single-prompt.md): makes single AI requests (one request
 * per query) use `builder` to build the chat messages instead of the app's prompt, so prompt
 * variants go through the same code path as the app. Batched requests are not affected. The app
 * never calls it.
 *
 * @param {function(object): {messages: Array<{role: string, content: string}>}|null} builder -
 *   called with the request given to {@link getBestTWordSelectionWithConfidenceFromLlm} (`wordList`,
 *   `targetLangCode`, `glPhrase`, `glLangCode`, `previousTranslationData`, `contextId`,
 *   `algorithmBestSelections`, `glVerseText`, `lmOptions`); it returns the messages without `/no_think`, which
 *   `queryAiAPI` adds. `null` goes back to the app's prompt.
 * @returns {void}
 */
export function setSinglePromptOverrideForEval(builder) {
  singlePromptOverrideForEval = typeof builder === 'function' ? builder : null;
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
 * of results in the same order. In a batch, only the first request's `lmOptions` are used.
 *
 * @param {object|Array<object>} request - one request, or an array of them to send as a batch
 * @param {Array<string>} request.wordList - target-language verse words in reading order
 * @param {string} request.targetLangCode - language code of the verse (e.g. 'es-419')
 * @param {string} request.glPhrase - gateway-language phrase to translate (e.g. 'church')
 * @param {string} request.glLangCode - language code of the gateway phrase (e.g. 'en')
 * @param {object} [request.previousTranslationData] - prior translation counts; can be nested
 *   `{glPhrase: {targetPhrase: count}}` or flat `{targetPhrase: count}`. May be missing when
 *   there is no history.
 * @param {string} [request.key] - caller's cache key for this job; ignored here
 * @param {object} [request.lmOptions={enable_thinking: false}] - options passed to `queryAiAPI`
 * @param {boolean} [request.lmOptions.enable_thinking=false] - whether to enable AI thinking mode
 * @param {string} [request.lmOptions.baseUrl] - OpenAI-compatible server URL; defaults to `AI_API_URL`
 * @param {string} [request.lmOptions.model] - AI model identifier
 * @param {number} [request.lmOptions.temperature] - sampling temperature
 * @param {number} [request.lmOptions.maxTokens] - max response tokens; defaults to
 *   `LLM_DEFAULT_MAX_TOKENS` when thinking is off
 * @param {string} [request.lmOptions.apiToken] - bearer token for servers that require one
 * @returns {Promise<{error: boolean, bestSelections: Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>, elapsedStr: string, model: string, rawAnswer?: string}|Array<object>>} -
 *   an array of these results, in request order, when `request` is an array.
 *   `bestSelections` holds up to 3 options sorted by confidence, each containing:
 *   - selections: array of {text, occurrence} objects representing matched words
 *     - text: the word exactly as it appears in the verse
 *     - occurrence: 1-based occurrence index of this word in the verse
 *   - confidence: integer 0-100 indicating match certainty
 *
 *   `error` is true only when the AI request itself failed. If the answer could not be parsed,
 *   `error` is false and `bestSelections` is empty. `elapsedStr` is the query time in seconds
 *   (e.g. '2.35'). `model` is the model name the server reported, or '' on failure or when
 *   nothing could be parsed. For a single request answered by the server, `rawAnswer` is the
 *   answer text as received, before parsing; the app does not use it, the evaluation results keep
 *   it (plans/improve-single-prompt.md).
 * @throws Does not throw for AI or parsing failures: they are logged and an empty
 *   `bestSelections` is returned. Throws if `wordList` is missing.
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
  let systemPrompt;
  let input;
  let messages;

  if (singlePromptOverrideForEval) {
    ({ messages } = singlePromptOverrideForEval(request));
    input = '';

    if (!getValidChatMessages(messages)) {
      throw new Error('setSinglePromptOverrideForEval - the prompt builder returned invalid messages');
    }
  } else {
    ({ systemPrompt, input } = buildTranslationOptionsPrompt(
      wordList.join(' '),
      targetLangCode,
      glPhrase,
      glLangCode,
      previousTranslationData,
    ));
  }

  const options = buildLlmQueryOptions(lmOptions, systemPrompt, LLM_DEFAULT_MAX_TOKENS);

  if (messages) {
    options.messages = messages;
  }

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
      rawAnswer: answer,
    };
  }

  // console.log('AI response ERROR decoding:', {
  //   wordList: formatNumberedVerse(wordList.join(' ')),
  //   glPhrase,
  //   answer,
  // });

  return {
    error: false,
    bestSelections: [],
    elapsedStr,
    model: '',
    rawAnswer: answer,
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
Each request is separate: use only its own TARGET VERSE and PREVIOUS TRANSLATIONS.
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

/** one CSV answer row on its own line: `"words",confidence` (any of the quote marks models use) */
const LLM_CSV_ROW_LINE = /^\s*["“”][^"“”\n]*["“”]\s*,\s*\d{1,3}\s*$/;

/**
 * Splits a batched AI answer into the answer text for each request, keyed by its
 * `### REQUEST n` marker (see `LLM_BATCH_MARKER`). When a marker appears more than once (e.g.
 * reasoning echoed it before the final answer) the last section wins, since that is where the
 * final answer is.
 *
 * Small models sometimes leave the markers out and give one row per request, in order. Such an
 * answer is split by line, but only when it has exactly one CSV row per request and nothing else;
 * any other answer without markers is left unanswered, so a row is never given to the wrong
 * request.
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
    } else {
      const lines = text.split('\n').filter(line => line.trim());

      if (lines.length === count && lines.every(line => LLM_CSV_ROW_LINE.test(line))) {
        lines.forEach((line, i) => {
          sections[i] = line.trim();
        });
      }
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
 * Builds the prompt for several requests sent in one AI query: each request's input from
 * {@link buildTranslationOptionsPrompt} (batch form) under a `### REQUEST n` line, one `Answer:` at
 * the end, and the batch system prompt with `LLM_BATCH_SYSTEM_PROMPT` appended. Exported so the
 * fine-tuning data exporter builds exactly the prompt the app sends.
 *
 * @param {Array<{wordList: Array<string>, targetLangCode: string, glPhrase: string, glLangCode: string, previousTranslationData: object}>} requests
 *   - the requests, in order (at least one)
 * @returns {{systemPrompt: string, input: string}} - the prompt, before `applyThinkingDirective`
 */
export function buildBatchTranslationOptionsPrompt(requests) {
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
      true,
    );
    systemPrompt = prompt.systemPrompt;
    return `### REQUEST ${i + 1}${prompt.input.replace(/\n*Answer:\s*$/, '')}`;
  });

  return { systemPrompt: systemPrompt + LLM_BATCH_SYSTEM_PROMPT, input: `${inputs.join('\n\n')}\n\nAnswer:` };
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

  const { systemPrompt, input } = buildBatchTranslationOptionsPrompt(requests);
  const lmOptions = requests[0].lmOptions || { enable_thinking: false };
  const maxTokens = Math.max(LLM_DEFAULT_MAX_TOKENS, requests.length * LLM_BATCH_MAX_TOKENS_PER_REQUEST);
  const options = buildLlmQueryOptions(lmOptions, systemPrompt, maxTokens);

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

  // console.log('getBestTWordSelectionsBatchFromLlm - AI response:', {
  //   answer,
  //   requestCount: requests.length
  // });

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
  return getLexerWords(verseText).flatMap(segmentUnspacedWord);
}

/**
 * Tokenizes text with the wordmap-lexer only, without splitting scripts written without spaces.
 * @param {string} text
 * @returns {Array<string>} - tokens in reading order
 */
function getLexerWords(text) {
  return Lexer.tokenize(text).map(token => token.text);
}

/**
 * Scripts usually written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer,
 * Myanmar): the lexer leaves a whole clause of them as one token. Built with `new RegExp` so that
 * babel leaves the Unicode property escapes alone.
 */
const UNSPACED_SCRIPT_REGEX = new RegExp(
  '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Thai}\\p{Script=Lao}' +
  '\\p{Script=Khmer}\\p{Script=Myanmar}]', 'u');

let wordSegmenter; // undefined until first use; null when Intl.Segmenter is not available

/**
 * @returns {Intl.Segmenter|null} - a word segmenter, or null when the runtime has none
 */
function getWordSegmenter() {
  if (wordSegmenter === undefined) {
    // ICU splits these scripts with its own dictionaries, whatever the locale
    wordSegmenter = (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') ?
      new Intl.Segmenter('und', { granularity: 'word' }) : null;
  }
  return wordSegmenter;
}

/**
 * Splits a token of a script written without spaces (see `UNSPACED_SCRIPT_REGEX`) into words with
 * `Intl.Segmenter`, so that part of it can be matched and selected, e.g. `警戒过一两次` →
 * `['警戒', '过', '一', '两次']`. Other tokens, and every token when the runtime has no
 * `Intl.Segmenter`, are returned whole.
 *
 * @param {string} word - one token, without spaces
 * @returns {Array<string>} - its words in reading order
 */
export function segmentUnspacedWord(word) {
  const segmenter = word && UNSPACED_SCRIPT_REGEX.test(word) ? getWordSegmenter() : null;

  if (!segmenter) {
    return [word];
  }

  const words = [...segmenter.segment(word)]
    .filter(({ isWordLike }) => isWordLike)
    .map(({ segment }) => segment);
  return words.length ? words : [word];
}

/**
 * Splits target-language text (a history rendering or an AI answer) into words: at whitespace,
 * then each part with {@link segmentUnspacedWord}, the way {@link getWordList} splits the verse.
 *
 * @param {string} text
 * @returns {Array<string>} - non-empty words
 */
export function splitIntoWords(text) {
  return (text || '').split(/\s+/).filter(Boolean).flatMap(segmentUnspacedWord);
}

/**
 * Turns the selections of one suggestion into the form translationCore saves for text written
 * without spaces. tc-ui-toolkit selections are spans of the verse text: a selection of such
 * script is found by counting every match of its text in the verse, even inside a longer run of
 * characters (`occurrencesInString`), while {@link getWordList} counts whole words. So adjacent
 * words of such scripts are joined into one selection, as a user dragging over them would make,
 * and their occurrence is counted in the verse text. Other selections are left unchanged.
 *
 * @param {Array<{text: string, occurrence: number}>} selections - words of `wordList`
 * @param {Array<string>} wordList - from {@link getWordList}(verseText)
 * @param {string} verseText - the verse the words came from
 * @returns {Array<{text: string, occurrence: number}>} - the selections for the verse text
 */
export function toVerseTextSelections(selections, wordList, verseText) {
  if (!selections?.length || !verseText || !selections.some(({ text }) => UNSPACED_SCRIPT_REGEX.test(text || ''))) {
    return selections;
  }

  // character offset of each word of wordList in the verse text
  const offsets = [];
  let cursor = 0;

  for (const word of wordList) {
    const start = verseText.indexOf(word, cursor);
    offsets.push(start);
    cursor = start >= 0 ? start + word.length : cursor;
  }

  const spans = selections.map(selection => {
    let seen = 0;
    const index = wordList.findIndex(word => word === selection.text && ++seen === (selection.occurrence || 1));
    const start = index >= 0 ? offsets[index] : -1;
    return start >= 0 ? {
      selection, start, end: start + selection.text.length,
    } : { selection };
  });

  if (spans.some(({ start }) => start === undefined)) {
    return selections; // not words of this verse - leave them as they are
  }

  const merged = [];

  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];

    if (last && last.end === span.start && UNSPACED_SCRIPT_REGEX.test(last.selection.text) &&
      UNSPACED_SCRIPT_REGEX.test(span.selection.text)) {
      last.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }

  return merged.map(({
    selection, start, end,
  }) => {
    if (!UNSPACED_SCRIPT_REGEX.test(selection.text)) {
      return selection;
    }

    const text = verseText.slice(start, end);
    let occurrence = 1;

    // non-overlapping matches before this one, as tc-ui-toolkit counts them
    for (let position = verseText.indexOf(text); position >= 0 && position < start; position = verseText.indexOf(text, position + text.length)) {
      occurrence++;
    }
    return { text, occurrence };
  });
}

/**
 * Strips punctuation from gateway-language text by tokenizing it into words and rejoining.
 * @param {string} glText
 * @returns {string} - text with punctuation removed
 */
export function removePunctuation(glText) {
  // not getWordList: GL quotes are history keys and must keep their saved form
  const wordList = getLexerWords(glText);
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
 * `selectionsForGlQuote` in place with `{glQuote: {selectedText: count}}` counts, and, when
 * given, `selectionsForQuoteString` with `{quoteString: {selectedText: count}}` counts.
 *
 * For each check, the gateway-language quote is found with
 * `gatewayLanguageHelpers.getAlignedTextFromBible()`: the gateway-language words in `bible`
 * aligned to `contextId.quote` / `contextId.occurrence` at `contextId.reference`. That text then
 * goes through {@link removePunctuation} and `normalizer`. Checks with no `contextId` or
 * `selections` are skipped. A check is left out of `selectionsForGlQuote` if `bible` is missing
 * or no aligned text is found, but is still counted in `selectionsForQuoteString`.
 *
 * Calling this once per book with the same accumulators adds up the counts across books
 * (see {@link fetchPreviousSelectionData}).
 *
 * @param {Array<{contextId: ContextId, selections: Array<{text: string, occurrence: number}>}>} checks
 *   - checking-tool check records, e.g. the contents of
 *   `.apps/translationCore/index/{toolName}/{bookId}/{groupId}.json`; may be null or empty
 * @param {string} gatewayLanguageCode - gateway language code (currently unused)
 * @param {object} tsvRelation - TSV relation data (currently unused)
 * @param {object} bible - gateway-language book used to find the aligned text for each check
 * @param {Object<string, Object<string, number>>} selectionsForGlQuote - accumulator in the same
 *   format as the return value; changed in place. Pass `{}` to start a new tally.
 * @param {Object<string, Object<string, number>>|null} [selectionsForQuoteString] - optional
 *   accumulator with the same inner format as `selectionsForGlQuote`, but the outer key is the
 *   check's original-language quote string (`contextId.quoteString`, or `contextId.quote`
 *   converted with `getQuoteAsString`), lowercased with `origLangId` locale rules but otherwise
 *   not normalized. Changed in place. Counted even when no aligned gateway-language text is
 *   found. Omit or pass null to skip.
 * @param {string} [origLangId=NT_ORIG_LANG] - original-language code used to lowercase the
 *   quote string: `NT_ORIG_LANG` for New Testament books, `OT_ORIG_LANG` for Old Testament
 * @returns {Object<string, Object<string, number>>} the same `selectionsForGlQuote` object, nested
 *   two levels:
 *   - **outer key** (`glQuote`): the check's aligned gateway-language text, with punctuation
 *     removed and passed through `normalizer` (e.g. 'faith', 'by faith')
 *   - **inner key** (`selectedText`): the `text` of each of the check's selections, joined by
 *     single spaces (e.g. 'fe', 'la fe'). It is not normalized. A check whose `selections` is an
 *     empty array is counted under the key `''`.
 *   - **value**: how many checks so far had that selection for that gateway-language text
 *     (always 1 or more), including counts already in `selectionsForGlQuote` when it was passed in
 * @example
 * const checks = [
 *   { contextId: { reference: { chapter: 2, verse: 16 }, quote: 'πίστεως', occurrence: 1 },
 *     selections: [{ text: 'fe', occurrence: 1 }] },
 *   { contextId: { reference: { chapter: 3, verse: 7 }, quote: 'πίστεως', occurrence: 1 },
 *     selections: [{ text: 'la', occurrence: 1 }, { text: 'fe', occurrence: 1 }] },
 * ];
 * const selectionsForGlQuote = { 'faith': { 'fe': 2 } };
 * const selectionsForQuoteString = {};
 * getSelectionsForBook(checks, 'en', tsvRelation, glBook, selectionsForGlQuote,
 *   selectionsForQuoteString, NT_ORIG_LANG);
 * // If both checks align to 'faith', selectionsForGlQuote is now:
 * // { 'faith': { 'fe': 3, 'la fe': 1 } }
 * // and selectionsForQuoteString is:
 * // { 'πίστεως': { 'fe': 1, 'la fe': 1 } }
 */
export function getSelectionsForBook(checks, gatewayLanguageCode, tsvRelation, bible, selectionsForGlQuote, selectionsForQuoteString = null, origLangId = NT_ORIG_LANG) {
  if (checks?.length) {
    for (const check of checks) {
      const contextId = check?.contextId;
      const selectionsForCheck = check?.selections;

      if (selectionsForCheck && contextId) {
        let glQuote = null;

        if (bible) { // if already have bible use it
          const glText = gatewayLanguageHelpers.getAlignedTextFromBible(
            contextId,
            bible
          );

          if (glText) {
            glQuote = cleanGlQuote(glText);
          }
        }

        const quoteString = getQuoteStringKey(contextId, origLangId);

        const selectedText = selectionsForCheck
          ?.map(word => word?.text)
          ?.join(' ');

        if (glQuote) {
          incrementSelectionCount(selectionsForGlQuote, glQuote, selectedText);
        }

        if (quoteString && selectionsForQuoteString) {
          incrementSelectionCount(selectionsForQuoteString, quoteString, selectedText);
        }
      }
    }
  }
  return selectionsForGlQuote;
}

/**
 * Gets the key a check is tallied under in `selectionsForQuoteString`: the check's
 * original-language quote string (`contextId.quoteString`, or `contextId.quote` converted with
 * `getQuoteAsString`), lowercased with {@link toLowerCaseForLang}.
 *
 * @param {ContextId} contextId - check context
 * @param {string} [origLangId] - original-language code used for lowercasing; when omitted,
 *   `NT_ORIG_LANG` or `OT_ORIG_LANG` is chosen from `contextId.reference.bookId`
 * @returns {string} - lowercased quote string, or '' when the check has no quote
 * @example
 * getQuoteStringKey({ reference: { bookId: 'gal' }, quote: 'Πίστεως' }); // 'πίστεως'
 */
export function getQuoteStringKey(contextId, origLangId) {
  const langId = origLangId ||
    (isNT(contextId?.reference?.bookId) ? NT_ORIG_LANG : OT_ORIG_LANG);
  return toLowerCaseForLang(contextId?.quoteString || getQuoteAsString(contextId?.quote), langId);
}

/**
 * Adds one to the count of `selectedText` under `key` in a two-level tally, creating the inner
 * object if needed.
 * @param {Object<string, Object<string, number>>} tally - changed in place
 * @param {string} key - outer key (e.g. GL quote or original-language quote string)
 * @param {string} selectedText - inner key
 */
function incrementSelectionCount(tally, key, selectedText) {
  let matches = tally[key];

  if (!matches) {
    matches = {};
    tally[key] = matches;
  }

  matches[selectedText] = (matches[selectedText] || 0) + 1;
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
 * Clears `glBiblesCache` when the project's target language or resource id is not the one it was
 * filled for.
 * @param {{targetLangId: string|null, resourceId: string|null, glBibleId: string|null,
 *   bibles: Object<string, object>}} glBiblesCache - changed in place
 * @param {string} languageId - the current project's target language id
 * @param {string} resourceId - the current project's resource id
 * @returns {void}
 */
export function resetGlBiblesCacheForProject(glBiblesCache, languageId, resourceId) {
  if (
    glBiblesCache?.targetLangId !== languageId ||
    glBiblesCache?.resourceId !== resourceId
  ) {
    // if targetLangId or resourceId has changed, clear cache
    glBiblesCache.targetLangId = languageId;
    glBiblesCache.resourceId = resourceId;
    glBiblesCache.glBibleId = null;
    glBiblesCache.bibles = {};
  }
}

/**
 * The gateway-language bible id the suggestion history uses: the first of `glBibles` in
 * `bibleIdSort` order.
 * @param {object} glBibles - available gateway-language bibles keyed by bible id
 * @returns {string|undefined}
 */
export function getFirstGlBibleId(glBibles) {
  return Object.keys(glBibles || {}).sort(gatewayLanguageHelpers.bibleIdSort)[0];
}

/**
 * Loads one book of the gateway-language bible `glBibleId` (its newest version for `glOwnerStr`
 * in the resources folder next to the projects folder), using and filling `glBiblesCache`.
 * @param {string} projectsFolder - the translationCore projects folder
 * @param {string} bookId - e.g. 'tit'
 * @param {string} glBibleId - e.g. 'ult' (see {@link getFirstGlBibleId})
 * @param {string} gatewayLanguageCode - e.g. 'en'
 * @param {string} glOwnerStr - owner of the gateway-language bible, e.g. 'unfoldingWord'
 * @param {object} glBiblesCache - see {@link fetchPreviousSelectionData}; changed in place
 * @returns {object|null} - the book keyed by chapter then verse, or null when the bible has no
 *   version for the owner or no such book
 */
export function loadGlBookForSuggestions(projectsFolder, bookId, glBibleId, gatewayLanguageCode, glOwnerStr, glBiblesCache) {
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
    return null;
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
  return foundBible || null;
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
 * @returns {{selectionsForGlQuote: Object<string, Object<string, number>>,
 *   selectionsForQuoteString: Object<string, Object<string, number>>}} previous selections,
 *   tallied two ways (see {@link getSelectionsForBook}):
 *   - **selectionsForGlQuote**: nested two levels:
 *     - **outer key** (`glQuote`): the gateway-language text aligned to a check, with
 *       punctuation removed and then passed through `normalizer` (e.g. 'faith', 'by faith')
 *     - **inner key** (`selectedText`): the target-language words the user selected for that
 *       check, joined by single spaces (e.g. 'fe', 'la fe'). Not normalized.
 *     - **value**: how many checks across all included projects used that selection for that
 *       gateway-language text (always 1 or more)
 *   - **selectionsForQuoteString**: same inner keys and values, but the outer key is the
 *     check's original-language quote string, lowercased with the Greek (NT) or Hebrew (OT)
 *     locale rules (e.g. 'πίστεως'). Checks are counted here even when no aligned
 *     gateway-language text is found, but only in books whose gateway-language bible was found.
 *
 *   Both are `{}` if no included project has checks for `groupId`.
 * @example
 * const { selectionsForGlQuote, selectionsForQuoteString } = fetchPreviousSelectionData(
 *   '/path/to/tCore/projects/es-419_glt_gal_book',
 *   contextId, glBibles, tsvRelation, 'translationWords', 'faith', 'en',
 *   'unfoldingWord', data, glBiblesCache,
 * );
 * // selectionsForGlQuote: {
 * //   'faith': { 'fe': 12, 'la fe': 3 },
 * //   'by faith': { 'por la fe': 4 },
 * // }
 * // selectionsForQuoteString: {
 * //   'πίστεως': { 'fe': 12, 'la fe': 3 },
 * //   'πίστει': { 'por la fe': 4 },
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

  resetGlBiblesCacheForProject(glBiblesCache, currentLanguageId, currentResourceId);

  // eslint-disable-next-line no-unused-vars
  let { bible: foundBible } = gatewayLanguageHelpers.getAlignedGLTextHelperMajor(
    contextId,
    glBibles,
    tsvRelation,
    currentLanguageId
  );

  const glBibleId = getFirstGlBibleId(glBibles);

  const usingNT = isNT(currentBookId);
  let selectionsForGlQuote = {};
  let selectionsForQuoteString = {};
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
    const foundBible = loadGlBookForSuggestions(projectsFolder, bookId, glBibleId, gatewayLanguageCode, glOwnerStr, glBiblesCache);

    if (foundBible) {
      getSelectionsForBook(
        checks,
        gatewayLanguageCode,
        tsvRelation,
        foundBible,
        selectionsForGlQuote,
        selectionsForQuoteString,
        (isNt ? NT_ORIG_LANG : OT_ORIG_LANG)
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
  return selectionsForGlQuote;
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
 * @param {string} alignedGLText - the outer key these selections are for: the gateway-language
 *   phrase
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
 * The algorithm's answer is used without asking the AI when its top option has at least this
 * confidence (`scoreSuggestionFromHistory`). 95 rather than 100: 100 is given only to matches right 95%
 * of the time, but the 95-99 band (mostly exact-key verbatim matches chosen fewer than
 * `CERTAIN_MIN_HISTORY_COUNT` times) was right 91% of the time by the algorithm against 86% by the
 * fine-tuned model, so with 100 the app's first suggestion was right 0.5-1.3 points less often; with 95 it
 * is as before, and the answers given without the AI are right ~92.5% of the time, against 86% for the old
 * algorithm (plans/algorithm-confidence.md, Step 6). A job's `algorithmCertainConfidence` option, from
 * the `llmAlgorithmCertainConfidence` setting, overrides it.
 */
export const ALGORITHM_CERTAIN_CONFIDENCE = 95;

/**
 * Highest confidence shown for an AI suggestion made with no selection history. Without history the
 * stock models' answers were right 20-28% (Qwen3-1.7B) and 22-51% (Qwen3-4B) of the time whatever
 * confidence they gave, mostly 90 or more (plans/improve-single-prompt.md, Step 5, N5), so a guess
 * is not shown as certain. Only lowers confidences, so the order of the options does not change.
 */
export const LLM_NO_HISTORY_MAX_CONFIDENCE = 70;

/**
 * Caps the confidences of an AI result for a request with no selection history at
 * `LLM_NO_HISTORY_MAX_CONFIDENCE`; other results are returned unchanged.
 * @param {object} result - from `getBestTWordSelectionWithConfidenceFromLlm`
 * @param {object} previousTranslationData - the request's history, `{ glKey: { rendering: count } }`
 * @returns {object} - a copy with capped confidences, or `result`
 */
export function capConfidenceWithoutHistory(result, previousTranslationData) {
  const hasHistory = Object.values(previousTranslationData || {})
    .some(renderings => Object.keys(renderings || {}).length);

  if (hasHistory || !result?.bestSelections?.length) {
    return result;
  }
  return {
    ...result,
    bestSelections: result.bestSelections.map(option => ({ ...option, confidence: Math.min(option.confidence, LLM_NO_HISTORY_MAX_CONFIDENCE) })),
  };
}

/**
 * Runs the algorithm path for one `getBestSelections` job.
 * @param {object} job - one `getBestSelections` job
 * @returns {Promise<{error: boolean, bestSelections: Array<object>, elapsedStr: string, model: string}>} -
 *   `model` is ALGORITHM; on an exception only `{error: true}`
 */
async function getAlgorithmResultForJob(job) {
  try {
    const {
      verseText,
      targetLanguageDetails,
      alignedGLText,
      gatewayLanguageCode,
      selectionsData,
    } = job;

    const bestSelections = await getBestTWordSelectionWithConfidenceAlgorithm(
      getWordList(verseText),
      targetLanguageDetails.id,
      alignedGLText,
      gatewayLanguageCode,
      selectionsData?.selections,
      // for measuring the confidences: `explain`, and any other options of the algorithm
      { ...job.algorithmOptions, explain: !!job.explainAlgorithm },
    );

    return {
      error: false,
      bestSelections,
      elapsedStr: '0',
      model: ALGORITHM,
    };
  } catch (error) {
    console.error(`getBestSelections - error`, error, job);
    return { error: true };
  }
}

/**
 * Finds the best target-language translation selections for a gateway-language phrase within a verse.
 *
 * This function identifies the most appropriate target-language word(s) that correspond to a gateway-language
 * phrase in the context of a specific verse. It operates in two distinct modes:
 *
 * **1. Algorithmic mode** (when `llmQueryUrl` is `null` or `undefined` and `llmUseLocalServer` is not set):
 * - Uses historical translation data and pattern matching algorithms
 * - Suggests selections based on previous translation choices
 * - Works entirely offline without requiring an AI model
 * - Returns immediately with `elapsedStr: '0'` and `model: ALGORITHM`
 *
 * **2. AI-assisted mode** (when `llmQueryUrl` is provided, or `llmUseLocalServer` is true):
 * - The algorithm runs first; a job whose top option has confidence `ALGORITHM_CERTAIN_CONFIDENCE`
 *   (95) or more (see `scoreSuggestionFromHistory`) gets the algorithm's answer, marked `algorithmFirst: true`,
 *   and is not sent to the AI
 * - The other jobs are sent to the AI in one query
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
 *   if `null` or `undefined`, uses algorithmic mode instead of AI (unless `llmUseLocalServer` is true)
 * @param {boolean} [options.llmEnableThinking=false] - true to have the AI reason before answering (slower);
 *   only applies in AI mode
 * @param {boolean} [options.llmUseLocalServer] - true to use the AI server bundled with translationCore
 *   (`window.AiAPIs.localServer`) in place of `llmQueryUrl`
 * @param {object} options.targetLanguageDetails - Metadata about the target language
 * @param {string} options.targetLanguageDetails.id - Language code (e.g., 'es-419' for Latin American Spanish)
 * @param {string} options.alignedGLText - Gateway-language phrase to translate (e.g., 'church', 'the elders')
 * @param {string} options.gatewayLanguageCode - Language code of the gateway language (e.g., 'en' for English)
 * @param {object} options.selectionsData - Historical translation data from previous user selections
 * @param {object} options.selectionsData.selections - Nested mapping of gateway phrases to target renderings with usage counts:
 *   `{glPhrase: {targetRendering: count}}`, or flat format `{targetRendering: count}` if pre-filtered
 * @param {string} [options.model='local-model'] - AI model identifier to use (only relevant when `llmQueryUrl` is provided);
 *   the actual model used may differ and is reported in the response
 * @param {number} [options.llmTemperature=0.1] - Sampling temperature for AI model (0.0-1.0); higher values increase
 *   randomness in suggestions, lower values make output more repeatable; 0 is used as given; only applies in AI mode
 * @param {string} [options.apiToken] - Bearer token for LLM API requests when required
 * @param {boolean} [options.llmEnableThinking=false] - let the AI think before answering (no `/no_think`,
 *   no default response cap); the app leaves it off; for experiments
 * @param {object} [options.llmExtraParams] - extra chat-completion request body fields, e.g.
 *   `{ seed: 42, top_k: 20 }`; only applies in AI mode (see {@link streamChatMessage})
 * @param {object} [options.contextId] - the check's context; when `contextId.occurrence` is above 1,
 *   each suggestion is moved to that occurrence of its words (see {@link moveSelectionsToOccurrence})
 * @param {number} [options.algorithmCertainConfidence=ALGORITHM_CERTAIN_CONFIDENCE] - in AI mode, the
 *   algorithm's answer is used without asking the AI when its top option has at least this confidence;
 *   above 100 always asks the AI; ignored when not a number
 * @returns {Promise<{error: boolean, bestSelections: Array<{selections: Array<{text: string, occurrence: number}>, confidence: number}>, elapsedStr: string, model: string}>}
 *   Promise resolving to an object containing:
 *   - **error**: `true` if the operation failed or no valid translations were found, `false` otherwise
 *   - **bestSelections**: Array of translation options (up to 3), sorted by confidence score (highest first). Each option contains:
 *     - **selections**: Array of word objects representing the matched phrase, each with:
 *       - **text**: The normalized word form as it appears in the verse (without punctuation)
 *       - **occurrence**: 1-based occurrence index of this word in the verse (e.g., if 'iglesia' appears twice, first is 1, second is 2)
 *     - **confidence**: Integer from 0-100 indicating match certainty (100 = exact match, lower = partial/fuzzy match)
 *   - **elapsedStr**: Elapsed time in seconds as a formatted string (e.g., "1.23" for AI mode, "0" for algorithmic mode)
 *   - **model**: Model identifier string (ALGORITHM for algorithmic mode, actual AI model name for AI mode, empty string on error)
 *   - **algorithmFirst**: `true` in AI mode when the algorithm was certain and the AI was not asked (`model` is ALGORITHM)
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
 * //   model: ALGORITHM
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
  // TRICKY - llmQueryUrl and llmUseLocalServer assumed the same in all jobs
  const llmQueryUrl = jobs[0]?.llmQueryUrl;
  const llmUseLocalServer = !!jobs[0]?.llmUseLocalServer;

  try {
    if (!usesAiServer(jobs[0])) {
      for (const job of jobs) {
        // eslint-disable-next-line no-await-in-loop
        jobResults.push(await getAlgorithmResultForJob(job));
      }
    } else { // querying AI Model - all jobs still needing the AI are sent in a single query
      // when the algorithm is certain (the exact GL key's rendering found word for word), its
      // answer is used and the job is not sent: it saves a request, and the AI is not more right
      // there (plans/improve-llm-suggestions.md, Step 10)
      const aiJobIndexes = [];
      const algorithmResults = [];

      for (let i = 0; i < jobs.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const algorithmResult = await getAlgorithmResultForJob(jobs[i]);
        algorithmResults[i] = algorithmResult;
        const certainConfidence = Number.isFinite(jobs[i].algorithmCertainConfidence) ?
          jobs[i].algorithmCertainConfidence : ALGORITHM_CERTAIN_CONFIDENCE;

        if (!algorithmResult.error && algorithmResult.bestSelections?.[0]?.confidence >= certainConfidence) {
          jobResults[i] = { ...algorithmResult, algorithmFirst: true };
        } else {
          aiJobIndexes.push(i);
        }
      }

      const llmRequests = aiJobIndexes.map(i => {
        const {
          alignedGLText,
          apiToken,
          contextId,
          currentModel,
          gatewayLanguageCode,
          glVerseText,
          key,
          llmEnableThinking,
          llmExtraParams,
          llmTemperature,
          selectionsData,
          targetLanguageDetails,
          verseText,
        } = jobs[i];

        return {
          wordList: getWordList(verseText),
          key,
          targetLangCode: targetLanguageDetails.id,
          glPhrase: alignedGLText,
          glLangCode: gatewayLanguageCode,
          previousTranslationData: selectionsData?.selections,
          // not sent to the AI by the app's prompt; for prompt experiments
          // (`setSinglePromptOverrideForEval`)
          contextId,
          algorithmBestSelections: algorithmResults[i]?.bestSelections || [],
          // the gateway-language verse, when the job has it (prompt experiments only, for now)
          glVerseText,
          lmOptions: {
            apiToken,
            // with the local server translationCore supplies the URL and token
            baseUrl: llmUseLocalServer ? undefined : llmQueryUrl,
            localServer: llmUseLocalServer || undefined,
            enable_thinking: !!llmEnableThinking,
            extraParams: llmExtraParams,
            model: currentModel,
            // ?? so that a setting of 0 is used; 0.1 gave the same accuracy as 0.7 or better, with
            // repeatable answers (plans/improve-llm-suggestions.md, Step 8)
            temperature: (llmTemperature ?? LLM_DEFAULT_TEMPERATURE),
          },
        };
      });

      if (llmRequests.length) {
        const llmRequests_ = llmRequests.length > 1 ? llmRequests : llmRequests[0];
        const results = await getBestTWordSelectionWithConfidenceFromLlm(llmRequests_);
        const resultList = Array.isArray(results) ? results : [results];

        aiJobIndexes.forEach((jobIndex, i) => {
          // without history the AI's confidence says little (N5 of plans/improve-single-prompt.md)
          jobResults[jobIndex] = capConfidenceWithoutHistory(resultList[i], llmRequests[i].previousTranslationData);
        });
      }
    }
  } catch (e) {
    console.error(`getBestSelections - error`, e);
    return jobs.map(() => ({ error: true }));
  }

  // both paths place each suggestion at its first match; move it to the check's occurrence, then
  // put selections of scripts written without spaces in the form tc-ui-toolkit saves
  jobs.forEach((job, i) => {
    const occurrence = job?.contextId?.occurrence;
    const result = jobResults[i];

    if (result?.bestSelections?.length) {
      const wordList = getWordList(job.verseText);

      result.bestSelections = result.bestSelections.map(option => {
        const selections = occurrence > 1 ?
          moveSelectionsToOccurrence(option.selections, wordList, occurrence, job.targetLanguageDetails?.id) :
          option.selections;
        return { ...option, selections: toVerseTextSelections(selections, wordList, job.verseText) };
      });
    }
  });

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

