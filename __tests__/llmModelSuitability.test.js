/* eslint-env jest */
/**
 * Checks whether a model on an OpenAI-compatible server (e.g. LM Studio) is suitable for
 * `getBestTWordSelectionWithConfidenceFromLlm`, using the cases in
 * `__fixtures__/llmEval/cases.json`.
 *
 * The live tests are skipped unless `LLM_EVAL_MODEL` is set, so `npm test` makes no network calls.
 * The case-file checks always run.
 *
 * Usage:
 *   LLM_EVAL_MODEL=qwen/qwen3-4b-2507 npm run test:llm
 *
 * Environment variables:
 *   LLM_EVAL_MODEL         model id as the server lists it (required for the live tests)
 *   LLM_EVAL_URL           server base URL (default http://localhost:1234)
 *   LLM_EVAL_API_TOKEN     bearer token, for hosted servers
 *   LLM_EVAL_TEMPERATURE   sampling temperature (default 0.7, the app's default)
 *   LLM_EVAL_GROUPING      requests per query for the batched tests; 1 skips them (default 4)
 *   LLM_EVAL_RUNS          times every case is asked; results are pooled (default 2)
 *   LLM_EVAL_OUT           if set, the full results are written to this JSON file
 *   LLM_EVAL_TIMEOUT_MS    time allowed for all queries (default 1800000)
 * Thresholds (all can be overridden):
 *   LLM_EVAL_MIN_TOP1             share of cases whose top option is right (default 0.7)
 *   LLM_EVAL_MAX_CONFIDENT_WRONG  share of cases wrong at confidence >= 80 (default 0.15)
 *   LLM_EVAL_MIN_FORMAT           share of answers in the requested CSV format (default 0.9)
 *   LLM_EVAL_MAX_MEDIAN_MS        median time per single request (default 3000)
 *   LLM_EVAL_MAX_BATCH_TOP1_DROP  how much lower batched top-1 may be than single (default 0.15)
 *
 * The requests go through a stand-in for translationCore's `window.AiAPIs.query`, which sends
 * what translationCore's main process sends (`electronite/queryAiApisFromMainProcess.js`), but
 * not streamed, so the server reports token usage. jest has no `fetch`, so Node's http is used.
 */
import http from 'http';
import https from 'https';
import fs from 'fs';
import { normalizer } from 'string-punctuation-tokenizer';
import {
  getBestTWordSelectionWithConfidenceFromLlm,
  getWordList,
} from '../src/utils/autoCheckingUtils';
import cases from './__fixtures__/llmEval/cases.json';

const env = process.env;
const MODEL = env.LLM_EVAL_MODEL || '';
const BASE_URL = (env.LLM_EVAL_URL || 'http://localhost:1234').replace(/\/+$/, '');
const API_TOKEN = env.LLM_EVAL_API_TOKEN || '';
const TEMPERATURE = numberEnv('LLM_EVAL_TEMPERATURE', 0.7);
const GROUPING = numberEnv('LLM_EVAL_GROUPING', 4);
const RUNS = Math.max(1, Math.round(numberEnv('LLM_EVAL_RUNS', 2)));

console.log('LLM eval settings:', {
  MODEL,
  BASE_URL,
  API_TOKEN: API_TOKEN ? '(set)' : '(none)', // never print the token itself
  TEMPERATURE,
  GROUPING,
  RUNS,
});

const TIMEOUT_MS = numberEnv('LLM_EVAL_TIMEOUT_MS', 1800000);
const REQUEST_TIMEOUT_MS = 120000;
const THRESHOLDS = {
  minTop1: numberEnv('LLM_EVAL_MIN_TOP1', 0.7),
  maxConfidentWrong: numberEnv('LLM_EVAL_MAX_CONFIDENT_WRONG', 0.15),
  minFormat: numberEnv('LLM_EVAL_MIN_FORMAT', 0.9),
  maxMedianMs: numberEnv('LLM_EVAL_MAX_MEDIAN_MS', 3000),
  maxBatchTop1Drop: numberEnv('LLM_EVAL_MAX_BATCH_TOP1_DROP', 0.15),
};
/** a reply row in the requested format: `"words",confidence` */
const CSV_ROW = /["“”][^"“”\n]*["“”]\s*,\s*\d{1,3}/;
/** confidence at or above which a wrong answer counts as confidently wrong */
const CONFIDENT = 80;

const describeIfModel = MODEL ? describe : describe.skip;

describe('llmEval cases', () => {
  test('have unique ids and the required fields', () => {
    const ids = new Set();

    for (const evalCase of cases) {
      const {
        id, targetLang, glLang, verse, glPhrase, history, expected,
      } = evalCase;
      expect([id, targetLang, glLang, verse, glPhrase].every(value => typeof value === 'string' && value)).toBe(true);
      expect(typeof history).toBe('object');
      expect(Array.isArray(expected)).toBe(true);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  test.each(cases.map(evalCase => [evalCase.id, evalCase]))('%s: expected answers are verse words', (_, evalCase) => {
    const verseWords = getCaseWordList(evalCase).map(normalizePhrase);

    for (const answer of evalCase.expected) {
      for (const word of answer.split(/\s+/)) {
        expect(verseWords).toContain(normalizePhrase(word.replace(/:\d+$/, '')));
      }
    }
  });

  test('do not reuse the system prompt example verse, which models copy answers from', () => {
    const exampleVerse = normalizePhrase('para la iglesia de Éfeso');
    expect(cases.filter(evalCase => normalizePhrase(evalCase.verse) === exampleVerse)).toEqual([]);
  });
});

describeIfModel(`model suitability: ${MODEL}`, () => {
  const run = {
    model: MODEL,
    url: BASE_URL,
    temperature: TEMPERATURE,
    grouping: GROUPING,
    runs: RUNS,
    thresholds: THRESHOLDS,
    available: [],
    warmUp: null,
    single: [],
    batch: [],
    batchCalls: [],
  };
  let calls = [];

  beforeAll(async () => {
    run.available = await getAvailableModels();

    if (!run.available.includes(MODEL)) {
      return; // the first test reports it
    }

    window.AiAPIs = { query: bridgeQuery };

    // first request loads the model and fills the prompt cache - timed apart from the rest
    calls = [];
    await getBestTWordSelectionWithConfidenceFromLlm(toRequest({
      verse: 'a b', targetLang: 'xx', glLang: 'en', glPhrase: 'a', history: {},
    }));
    // eslint-disable-next-line require-atomic-updates
    run.warmUp = calls[0] || null;

    // answers vary from run to run at the app's temperature, so results of all runs are pooled
    for (let runNumber = 1; runNumber <= RUNS; runNumber++) {
      for (const evalCase of cases) {
        calls = [];
        // eslint-disable-next-line no-await-in-loop
        const result = await getBestTWordSelectionWithConfidenceFromLlm(toRequest(evalCase));
        run.single.push({ run: runNumber, ...scoreCase(evalCase, result, calls[0]) });
      }

      if (GROUPING > 1) {
        for (let i = 0; i < cases.length; i += GROUPING) {
          const group = cases.slice(i, i + GROUPING);
          calls = [];
          const request = group.map(toRequest);
          // eslint-disable-next-line no-await-in-loop
          const results = await getBestTWordSelectionWithConfidenceFromLlm(request);
          const call = calls[0];

          run.batchCalls.push({
            run: runNumber,
            size: group.length,
            markers: countBatchMarkers(call?.content, group.length),
            ...call,
          });
          group.forEach((evalCase, j) => run.batch.push({ run: runNumber, ...scoreCase(evalCase, results[j], null) }));
        }
      }
    }
  }, TIMEOUT_MS);

  afterAll(() => {
    delete window.AiAPIs;
    run.summary = summarize(run);
    console.log(formatReport(run));

    if (env.LLM_EVAL_OUT) {
      fs.writeFileSync(env.LLM_EVAL_OUT, JSON.stringify(run, null, 2));
    }
  });

  /**
   * Records one query the way translationCore's main process sends it.
   * @param {string} query - user message
   * @param {object} options - options from `queryAiAPI`
   * @returns {Promise<{replyText: string, reasoningText: string, actualModel: string}>}
   */
  async function bridgeQuery(query, options) {
    const start = Date.now();
    const call = {
      ms: 0, usage: null, content: '', reasoning: '', finish: '', error: '',
    };
    calls.push(call);

    try {
      const reply = await postJson('/v1/chat/completions', {
        model: options.model,
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: query },
        ],
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: false,
        chat_template_kwargs: { enable_thinking: options.enable_thinking },
      });
      const choice = reply?.choices?.[0] || {};
      call.usage = reply?.usage || null;
      call.content = choice.message?.content || '';
      call.reasoning = choice.message?.reasoning_content || choice.message?.reasoning || '';
      call.finish = choice.finish_reason || '';
      call.ms = Date.now() - start;
      return {
        replyText: call.content || call.reasoning,
        reasoningText: call.reasoning,
        actualModel: reply?.model,
      };
    } catch (error) {
      call.ms = Date.now() - start;
      call.error = error.message;
      throw error;
    }
  }

  test('model is available on the server', () => {
    if (!run.available.includes(MODEL)) {
      throw new Error(`"${MODEL}" is not listed by ${BASE_URL}/v1/models. Available: ${run.available.join(', ') || '(none)'}`);
    }
  });

  test('every request succeeds', () => {
    const failed = run.single.filter(result => result.error);
    expectOrReport(!failed.length, 'requests failed', failed.map(result => `${result.id}: ${result.callError || 'error'}`));
  });

  test('answers in the requested CSV format', () => {
    const share = shareOf(run.single, result => result.format);

    expectOrReport(share >= THRESHOLDS.minFormat,
      `CSV format ${percent(share)} < ${percent(THRESHOLDS.minFormat)}`,
      run.single.filter(result => !result.format).map(result => `${result.id}: ${JSON.stringify(result.raw)}`));
  });

  test('keeps thinking off and stops by itself', () => {
    const bad = run.single.filter(result => result.reasoningChars > 20 || result.finish === 'length');

    expectOrReport(!bad.length, 'answers with reasoning or cut off at the token limit',
      bad.map(result => `${result.id}: reasoning ${result.reasoningChars} chars, finish ${result.finish}`));
  });

  test('top suggestion matches the translator\'s choice often enough', () => {
    const share = shareOf(run.single, result => result.top1);

    expectOrReport(share >= THRESHOLDS.minTop1,
      `top-1 ${percent(share)} < ${percent(THRESHOLDS.minTop1)}`, describeMisses(run.single));
  });

  test('is rarely wrong with high confidence', () => {
    const share = shareOf(run.single, result => result.confidentlyWrong);

    expectOrReport(share <= THRESHOLDS.maxConfidentWrong,
      `wrong at confidence >= ${CONFIDENT}: ${percent(share)} > ${percent(THRESHOLDS.maxConfidentWrong)}`,
      describeMisses(run.single.filter(result => result.confidentlyWrong)));
  });

  test('responds quickly enough', () => {
    const ms = median(run.single.map(result => result.ms));
    expectOrReport(ms <= THRESHOLDS.maxMedianMs, `median ${ms} ms > ${THRESHOLDS.maxMedianMs} ms`, []);
  });

  (GROUPING > 1 ? test : test.skip)(`batched (${GROUPING} per query): answers every request under its marker`, () => {
    const bad = run.batchCalls.filter(call => call.error || call.markers < call.size);

    expectOrReport(!bad.length, 'batched answers missing requests',
      bad.map(call => `run ${call.run}, ${call.markers}/${call.size} markers: ${call.error || JSON.stringify(call.content)}`));
  });

  (GROUPING > 1 ? test : test.skip)(`batched (${GROUPING} per query): accuracy holds up`, () => {
    const single = shareOf(run.single, result => result.top1);
    const batch = shareOf(run.batch, result => result.top1);

    expectOrReport(batch >= single - THRESHOLDS.maxBatchTop1Drop,
      `batched top-1 ${percent(batch)} is more than ${percent(THRESHOLDS.maxBatchTop1Drop)} below single ${percent(single)}`,
      describeMisses(run.batch));
  });
});

//
// helpers
//

/**
 * Reads a number from an environment variable.
 * @param {string} name
 * @param {number} defaultValue
 * @returns {number}
 */
function numberEnv(name, defaultValue) {
  const value = parseFloat(process.env[name]);
  return Number.isNaN(value) ? defaultValue : value;
}

/**
 * Normalizes a phrase for comparing answers: punctuation and Unicode form via `normalizer`, then case.
 * @param {string} phrase
 * @returns {string}
 */
function normalizePhrase(phrase) {
  return normalizer(phrase || '').toLowerCase().trim();
}

/**
 * The case's verse split into words the way the tests and the app split verses.
 * @param {object} evalCase
 * @returns {Array<string>}
 */
function getCaseWordList(evalCase) {
  return getWordList(normalizer(evalCase.verse));
}

/**
 * Builds the request `getBestTWordSelectionWithConfidenceFromLlm` takes, as `getBestSelections` does.
 * @param {object} evalCase
 * @returns {object}
 */
function toRequest(evalCase) {
  return {
    wordList: getCaseWordList(evalCase),
    targetLangCode: evalCase.targetLang,
    glPhrase: evalCase.glPhrase,
    glLangCode: evalCase.glLang,
    previousTranslationData: evalCase.history,
    lmOptions: {
      apiToken: API_TOKEN || undefined,
      baseUrl: BASE_URL,
      enable_thinking: false,
      model: MODEL,
      temperature: TEMPERATURE,
    },
  };
}

/**
 * Text of an option as `word word:2`, the format of `expected` in the cases.
 * @param {{selections: Array<{text: string, occurrence: number}>}} option
 * @returns {string}
 */
function optionText(option) {
  return (option?.selections || [])
    .map(({ text, occurrence }) => (occurrence > 1 ? `${text}:${occurrence}` : text))
    .join(' ');
}

/**
 * Scores one result against its case.
 * @param {object} evalCase
 * @param {object} result - from `getBestTWordSelectionWithConfidenceFromLlm`
 * @param {object|null} call - the recorded query, for single requests
 * @returns {object}
 */
function scoreCase(evalCase, result, call) {
  const options = result?.bestSelections || [];
  const top = options[0];
  const expected = evalCase.expected.map(normalizePhrase);
  const top1 = expected.length ? !!top && expected.includes(normalizePhrase(optionText(top))) : !options.length;
  const top3 = expected.length ? options.some(option => expected.includes(normalizePhrase(optionText(option)))) : !options.length;
  const raw = call ? call.content : null;

  return {
    id: evalCase.id,
    tags: evalCase.tags || [],
    expected: evalCase.expected,
    got: options.map(option => `"${optionText(option)}" ${option.confidence}`),
    top1,
    top3,
    confidentlyWrong: !top1 && (top?.confidence || 0) >= CONFIDENT,
    error: !!result?.error,
    raw,
    format: raw !== null ? CSV_ROW.test(raw) : null,
    reasoningChars: call ? (call.reasoning || '').trim().length : 0,
    finish: call ? call.finish : '',
    ms: call ? call.ms : 0,
    promptTokens: call?.usage?.prompt_tokens || 0,
    completionTokens: call?.usage?.completion_tokens || 0,
    callError: call?.error || '',
  };
}

/**
 * Counts how many of `### REQUEST 1` .. `### REQUEST size` appear in a batched answer.
 * @param {string} content
 * @param {number} size
 * @returns {number}
 */
function countBatchMarkers(content, size) {
  const found = new Set();
  const marker = /REQUEST\s*(\d+)/gi;
  let match;

  while ((match = marker.exec(content || ''))) {
    const n = parseInt(match[1], 10);

    if (n >= 1 && n <= size) {
      found.add(n);
    }
  }
  return found.size;
}

function shareOf(results, predicate) {
  return results.length ? results.filter(predicate).length / results.length : 0;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
}

function percent(share) {
  return `${Math.round(share * 100)}%`;
}

function describeMisses(results) {
  return results.filter(result => !result.top1)
    .map(result => `${result.id} (run ${result.run}): expected ${JSON.stringify(result.expected)}, got ${result.got.join(' | ') || '(none)'}`);
}

/**
 * Throws with the details listed, since jest 24 has no custom assertion messages.
 * @param {boolean} condition
 * @param {string} message
 * @param {Array<string>} details
 */
function expectOrReport(condition, message, details) {
  if (!condition) {
    throw new Error([message, ...details.map(detail => `  ${detail}`)].join('\n'));
  }
}

/**
 * Sums up the run. Single and batched results get the same accuracy and time-per-suggestion
 * figures so they can be compared; `batchVsSingle` holds the differences (batch minus single).
 * A batched query answers several requests at once, so its time per suggestion is the query
 * time divided by the number of requests in it.
 * @param {object} run
 * @returns {object}
 */
function summarize(run) {
  const sum = (items, getValue) => items.reduce((total, item) => total + (getValue(item) || 0), 0);
  const perAnswer = (total, count) => (count ? Math.round(total / count) : 0);
  const single = run.single;
  const totalMs = sum(single, result => result.ms);
  const summary = {
    answers: single.length,
    top1: shareOf(single, result => result.top1),
    top3: shareOf(single, result => result.top3),
    confidentlyWrong: shareOf(single, result => result.confidentlyWrong),
    errors: shareOf(single, result => result.error),
    format: shareOf(single, result => result.format),
    medianMs: median(single.map(result => result.ms)),
    avgMsPerAnswer: perAnswer(totalMs, single.length),
    totalMs,
    promptTokensPerAnswer: perAnswer(sum(single, result => result.promptTokens), single.length),
    completionTokensPerAnswer: perAnswer(sum(single, result => result.completionTokens), single.length),
    warmUpMs: run.warmUp?.ms || 0,
    systemPromptTokens: run.warmUp?.usage?.prompt_tokens || 0,
  };

  if (run.batch.length) {
    const batch = run.batch;
    const calls = run.batchCalls;
    const batchTotalMs = sum(calls, call => call.ms);

    Object.assign(summary, {
      batchAnswers: batch.length,
      batchQueries: calls.length,
      batchTop1: shareOf(batch, result => result.top1),
      batchTop3: shareOf(batch, result => result.top3),
      batchConfidentlyWrong: shareOf(batch, result => result.confidentlyWrong),
      batchErrors: shareOf(batch, result => result.error),
      batchMedianMsPerQuery: median(calls.map(call => call.ms || 0)),
      batchMedianMsPerAnswer: median(calls.map(call => (call.ms || 0) / call.size).map(Math.round)),
      batchAvgMsPerAnswer: perAnswer(batchTotalMs, batch.length),
      batchTotalMs,
      batchPromptTokensPerAnswer: perAnswer(sum(calls, call => call.usage?.prompt_tokens), batch.length),
      batchCompletionTokensPerAnswer: perAnswer(sum(calls, call => call.usage?.completion_tokens), batch.length),
    });

    summary.batchVsSingle = {
      top1: summary.batchTop1 - summary.top1,
      top3: summary.batchTop3 - summary.top3,
      confidentlyWrong: summary.batchConfidentlyWrong - summary.confidentlyWrong,
      avgMsPerAnswer: summary.batchAvgMsPerAnswer - summary.avgMsPerAnswer,
      // > 1 means batching is faster per suggestion
      speedup: summary.batchAvgMsPerAnswer ? summary.avgMsPerAnswer / summary.batchAvgMsPerAnswer : 0,
      promptTokensPerAnswer: summary.batchPromptTokensPerAnswer - summary.promptTokensPerAnswer,
    };
  }
  return summary;
}

function formatReport(run) {
  const s = run.summary;
  const lines = [
    `LLM suitability: ${run.model} at ${run.url}, temperature ${run.temperature}, ${run.runs} run(s) of ${cases.length} cases`,
    `single: top-1 ${percent(s.top1)}, top-3 ${percent(s.top3)}, wrong at >=${CONFIDENT} ${percent(s.confidentlyWrong)}, CSV format ${percent(s.format)}`,
    `        median ${s.medianMs} ms, total ${s.totalMs} ms, ${s.promptTokensPerAnswer} prompt + ${s.completionTokensPerAnswer} answer tokens per request`,
    `        first request ${s.warmUpMs} ms, smallest prompt ${s.systemPromptTokens} tokens`,
  ];

  if (s.batchTop1 !== undefined) {
    const d = s.batchVsSingle;
    const points = share => `${share >= 0 ? '+' : ''}${Math.round(share * 100)} pts`;
    const row = cells => `  ${cells[0].padEnd(24)}${cells[1].padStart(10)}${cells[2].padStart(10)}${cells[3].padStart(12)}`;

    lines.push(
      `batch (${run.grouping} per query): ${s.batchQueries} queries, median ${s.batchMedianMsPerQuery} ms per query, total ${s.batchTotalMs} ms`,
      `single vs batch (${s.answers} vs ${s.batchAnswers} answers):`,
      row(['', 'single', 'batch', 'difference']),
      row(['top-1', percent(s.top1), percent(s.batchTop1), points(d.top1)]),
      row(['top-3', percent(s.top3), percent(s.batchTop3), points(d.top3)]),
      row([`wrong at >=${CONFIDENT}`, percent(s.confidentlyWrong), percent(s.batchConfidentlyWrong), points(d.confidentlyWrong)]),
      row(['errors', percent(s.errors), percent(s.batchErrors), points(s.batchErrors - s.errors)]),
      row(['avg ms per suggestion', `${s.avgMsPerAnswer}`, `${s.batchAvgMsPerAnswer}`, `${d.avgMsPerAnswer >= 0 ? '+' : ''}${d.avgMsPerAnswer} ms`]),
      row(['median ms per sugg.', `${s.medianMs}`, `${s.batchMedianMsPerAnswer}`, `${s.batchMedianMsPerAnswer - s.medianMs >= 0 ? '+' : ''}${s.batchMedianMsPerAnswer - s.medianMs} ms`]),
      row(['prompt tokens per sugg.', `${s.promptTokensPerAnswer}`, `${s.batchPromptTokensPerAnswer}`, `${d.promptTokensPerAnswer >= 0 ? '+' : ''}${d.promptTokensPerAnswer}`]),
      row(['answer tokens per sugg.', `${s.completionTokensPerAnswer}`, `${s.batchCompletionTokensPerAnswer}`,
        `${s.batchCompletionTokensPerAnswer - s.completionTokensPerAnswer >= 0 ? '+' : ''}${s.batchCompletionTokensPerAnswer - s.completionTokensPerAnswer}`]),
      `  batching is ${d.speedup.toFixed(2)}x as fast per suggestion`,
    );
  }

  for (const result of run.single) {
    lines.push(`  ${result.top1 ? 'OK  ' : 'MISS'} run ${result.run} ${result.id}: expected ${JSON.stringify(result.expected)}, got ${result.got.join(' | ') || '(none)'} (${result.ms} ms)`);
  }
  return lines.join('\n');
}

/**
 * Lists the model ids the server offers.
 * @returns {Promise<Array<string>>}
 */
async function getAvailableModels() {
  const reply = await requestJson('GET', '/v1/models');
  return (reply?.data || []).map(model => model.id).filter(Boolean);
}

function postJson(path, body) {
  return requestJson('POST', path, body);
}

/**
 * Sends a JSON request to the server.
 * @param {string} method
 * @param {string} path - e.g. '/v1/models'
 * @param {object} [body]
 * @returns {Promise<object>}
 */
function requestJson(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };

    if (bodyStr) {
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    if (API_TOKEN) {
      headers.Authorization = `Bearer ${API_TOKEN}`;
    }

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${method} ${url.href} failed (${res.statusCode}): ${data.slice(0, 300)}`));
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`${method} ${url.href} returned non-JSON: ${data.slice(0, 300)}`));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error(`${method} ${url.href} timed out after ${REQUEST_TIMEOUT_MS} ms`)));
    req.on('error', error => reject(new Error(`Cannot reach ${url.href}: ${error.message}`)));

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}
