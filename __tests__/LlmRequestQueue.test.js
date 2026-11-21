/* eslint-env jest */

import { ALGORITHM } from '../src/common/constants';
import { LlmRequestQueue, mergeBestSelections } from '../src/utils/LlmRequestQueue';

describe('LlmRequestQueue.clearSuggestionsMemoryForKeyPrefix', () => {
  const makeCache = () => ({
    'translationWords_en_es-419_god_gal_1_1_c1': { bestSelections: [] },
    'translationWords_en_es-419_god_gal_2_3_c2': { bestSelections: [] },
    'translationWords_en_es-419_godly_gal_1_1_c3': { bestSelections: [] },
    'translationWords_en_es-419_faith_gal_1_1_c4': { bestSelections: [] },
  });

  test('removes only the keys for the group', () => {
    const cache = makeCache();
    const queue = new LlmRequestQueue(cache);

    expect(queue.clearSuggestionsMemoryForKeyPrefix('translationWords_en_es-419_god_')).toBe(2);
    expect(Object.keys(cache).sort()).toEqual([
      'translationWords_en_es-419_faith_gal_1_1_c4',
      'translationWords_en_es-419_godly_gal_1_1_c3',
    ]);
  });

  test('empty prefix removes nothing', () => {
    const cache = makeCache();
    const queue = new LlmRequestQueue(cache);

    expect(queue.clearSuggestionsMemoryForKeyPrefix('')).toBe(0);
    expect(Object.keys(cache).length).toBe(4);
  });
});

describe('LlmRequestQueue caches only AI suggestions', () => {
  const KEY = 'translationWords_en_es-419_faith_gal_1_1_c1';
  const AI_URL = 'http://localhost:1234';
  const suggestion = { error: false, bestSelections: [{ selections: [{ text: 'la fe', occurrence: 1 }], confidence: 95 }] };

  /**
   * Makes a queue that never processes requests on its own, so tests can see what was queued.
   * @param {object} cache - suggestions cache
   * @returns {LlmRequestQueue} - the queue
   */
  function makeQueue(cache) {
    const queue = new LlmRequestQueue(cache);
    queue.processNextRequestIfNotBusy = jest.fn();
    return queue;
  }

  test('AI request uses memory', async () => {
    const queue = makeQueue({ [KEY]: { ...suggestion } });
    const callback = jest.fn();

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: AI_URL }, callback);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ cached: true }));
    expect(queue.findKeyInQueue(KEY)).toBe(-1);
  });

  test('algorithm request ignores memory', async () => {
    const queue = makeQueue({ [KEY]: { ...suggestion } });
    const callback = jest.fn();

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: '' }, callback);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(callback).not.toHaveBeenCalled();
    expect(queue.findKeyInQueue(KEY)).toBe(0);
  });

  test.each([
    ['AI', AI_URL, true],
    ['algorithm', '', false],
  ])('processNextRequest saves an %s answer: %s', async (_, llmQueryUrl, saved) => {
    const cache = {};
    const queue = makeQueue(cache);
    const callback = jest.fn();

    queue.doQuery = jest.fn((__, request) => Promise.resolve([{ ...suggestion, request }]));
    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl }, callback);

    await queue.processNextRequest();

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ bestSelections: suggestion.bestSelections }));
    expect(queue.alreadyHaveSuggestionsForKey(KEY)).toBe(saved);
  });
});

describe('LlmRequestQueue answers every waiting caller', () => {
  const KEY = 'translationWords_en_es-419_faith_gal_1_1_c1';
  const OTHER_KEY = 'translationWords_en_es-419_faith_gal_1_2_c2';
  const AI_URL = 'http://localhost:1234';
  const suggestion = { error: false, bestSelections: [{ selections: [{ text: 'la fe', occurrence: 1 }], confidence: 95 }] };

  /**
   * Makes a queue that only runs requests when a test calls `processNextRequest`, and answers
   * every request with `suggestion`.
   * @returns {LlmRequestQueue} - the queue
   */
  function makeQueue() {
    const queue = new LlmRequestQueue({});
    queue.processNextRequestIfNotBusy = jest.fn();
    queue.doQuery = jest.fn((_, requestData) => {
      const requests = Array.isArray(requestData) ? requestData : [requestData];
      return Promise.resolve(requests.map(request => ({ ...suggestion, request })));
    });
    return queue;
  }

  /**
   * Runs every queued request.
   * @param {LlmRequestQueue} queue
   */
  async function runAll(queue) {
    while (queue.requestQueue.hasRequests()) {
      // eslint-disable-next-line no-await-in-loop
      await queue.processNextRequest();
    }
  }

  test('clearing the queue keeps a request someone is waiting for (startup race)', async () => {
    const queue = makeQueue();
    const callback = jest.fn();

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: AI_URL }, callback, true);
    queue.makeSuggestionRequest({ key: OTHER_KEY, llmQueryUrl: AI_URL }, null);
    queue.clearPendingRequests();

    expect(queue.findKeyInQueue(KEY)).toBe(0);
    expect(queue.findKeyInQueue(OTHER_KEY)).toBe(-1); // background request dropped

    await runAll(queue);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ key: KEY }) }));
  });

  test('a background batch replacing a waiting request still answers the waiting caller', async () => {
    const queue = makeQueue();
    const callback = jest.fn();

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: AI_URL }, callback, true);
    // background generation for the group queues the same check again, in a batch
    queue.makeSuggestionRequest([
      { key: KEY, llmQueryUrl: AI_URL },
      { key: OTHER_KEY, llmQueryUrl: AI_URL },
    ], null, false, true);

    await runAll(queue);

    // the replaced request is not run as well (the other calls make the algorithm suggestions to merge)
    expect(queue.doQuery.mock.calls.filter(([, requestData]) => Array.isArray(requestData) ||
      requestData.llmQueryUrl).length).toBe(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].request.key).toBe(KEY);
  });

  test('clearing a batch keeps only its waited-for requests', () => {
    const queue = makeQueue();

    queue.makeSuggestionRequest([
      { key: KEY, llmQueryUrl: AI_URL },
      { key: OTHER_KEY, llmQueryUrl: AI_URL },
    ], null);
    queue.makeSuggestionRequest({ key: OTHER_KEY, llmQueryUrl: AI_URL }, jest.fn());
    queue.clearPendingRequests();

    expect(queue.requestQueue.queue.map(item => item.request.key)).toEqual([OTHER_KEY]);
  });

  test('clearPendingRequests(false) drops everything, including waiting callbacks', async () => {
    const queue = makeQueue();
    const callback = jest.fn();

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: AI_URL }, callback);
    queue.clearPendingRequests(false);
    await runAll(queue);

    expect(queue.requestQueue.hasRequests()).toBe(false);
    expect(queue.waitingCallbacks.size).toBe(0);
    expect(callback).not.toHaveBeenCalled();
  });

  test('a caller waiting when no result comes back gets an error answer', async () => {
    const queue = makeQueue();
    const callback = jest.fn();

    queue.doQuery = jest.fn(() => Promise.resolve([]));
    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: AI_URL }, callback);
    await runAll(queue);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ error: true }));
  });
});

describe('LlmRequestQueue.doQuery marks algorithm suggestions', () => {
  const job = {
    targetLanguageDetails: { id: 'es-419' },
    gatewayLanguageCode: 'en',
    verseText: 'Pablo saludó a la iglesia en Corinto',
    alignedGLText: 'church',
    selectionsData: { selections: { church: { 'la iglesia': 7, 'iglesia': 2 } } },
  };

  afterEach(() => {
    delete window.AiAPIs;
  });

  test('marks each option of an algorithm result', async () => {
    const results = await new LlmRequestQueue({}).doQuery([], { ...job, llmQueryUrl: '' });

    expect(results[0].model).toBe(ALGORITHM);
    expect(results[0].bestSelections.length).toBeGreaterThan(0);
    results[0].bestSelections.forEach(option => expect(option.isAlgorithmSuggestion).toBe(true));
  });

  test('marks the algorithm-first answer but not the AI answer in AI mode', async () => {
    window.AiAPIs = { query: jest.fn().mockResolvedValue({ replyText: '"Roma",95', actualModel: 'test-model' }) };
    const results = await new LlmRequestQueue({}).doQuery([], [
      // one rendering, so the algorithm's answer is certain (with 'iglesia' too, two renderings compete)
      {
        ...job, llmQueryUrl: 'http://localhost:1234', selectionsData: { selections: { church: { 'la iglesia': 7 } } },
      },
      {
        ...job, llmQueryUrl: 'http://localhost:1234', verseText: 'para la iglesia de Roma',
        alignedGLText: 'Rome', selectionsData: { selections: {} },
      },
    ]);

    expect(results[0]).toMatchObject({ model: ALGORITHM, algorithmFirst: true });
    results[0].bestSelections.forEach(option => expect(option.isAlgorithmSuggestion).toBe(true));
    expect(results[1].model).toBe('test-model');
    expect(results[1].bestSelections.length).toBeGreaterThan(0);
    results[1].bestSelections.forEach(option => expect(option.isAlgorithmSuggestion).toBeUndefined());
  });
});

describe('LlmRequestQueue merges algorithm suggestions into AI suggestions', () => {
  const KEY = 'translationWords_en_es-419_church_gal_1_1_c1';
  const AI_URL = 'http://localhost:1234';
  const option = (text, confidence, isAlgorithmSuggestion) => ({
    selections: [{ text, occurrence: 1 }], confidence, ...(isAlgorithmSuggestion && { isAlgorithmSuggestion }),
  });

  /**
   * Makes a queue whose AI answers with `aiResult` and whose algorithm answers with `algorithmOptions`.
   * @param {object} aiResult - the AI's result
   * @param {Array<object>} algorithmOptions - the algorithm's options
   * @returns {LlmRequestQueue} - the queue
   */
  function makeQueue(aiResult, algorithmOptions) {
    const queue = new LlmRequestQueue({});
    queue.processNextRequestIfNotBusy = jest.fn();
    queue.doQuery = jest.fn((_, request) => Promise.resolve([request.llmQueryUrl ?
      { ...aiResult, request } :
      {
        error: false, model: ALGORITHM, bestSelections: algorithmOptions, request,
      }]));
    return queue;
  }

  test('sorts the merged options and keeps a shared one once, with the higher confidence', async () => {
    const queue = makeQueue(
      {
        error: false, model: 'test-model', bestSelections: [option('iglesia', 90), option('la', 60)],
      },
      [option('la iglesia', 100, true), option('iglesia', 70, true), option('de', 75, true)],
    );
    const callback = jest.fn();

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: AI_URL }, callback);
    await queue.processNextRequest();

    const result = callback.mock.calls[0][0];

    expect(result.model).toBe('test-model');
    expect(result.algorithmFallback).toBeUndefined();
    expect(result.bestSelections).toEqual([
      option('la iglesia', 100, true), option('iglesia', 90), option('de', 75, true), option('la', 60),
    ]);
    expect(queue.alreadyHaveSuggestionsForKey(KEY)).toBe(true); // saved with the merged options
  });

  test('uses the algorithm suggestions alone when the AI gives none', async () => {
    const queue = makeQueue({ error: 'timeout', bestSelections: [] }, [option('la iglesia', 85, true)]);
    const callback = jest.fn();
    const request = { key: KEY, llmQueryUrl: AI_URL };

    queue.makeSuggestionRequest(request, callback);
    await queue.processNextRequest();

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      model: ALGORITHM, algorithmFallback: true, llmError: 'timeout', bestSelections: [option('la iglesia', 85, true)],
    }));
    expect(request.llmQueryUrl).toBe(AI_URL); // the caller's request is not changed
    expect(queue.alreadyHaveSuggestionsForKey(KEY)).toBe(false);
  });

  test('does not ask the algorithm again for an algorithm-first answer', async () => {
    const queue = makeQueue({
      error: false, model: ALGORITHM, algorithmFirst: true, bestSelections: [option('la iglesia', 100, true)],
    }, []);

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: AI_URL }, jest.fn());
    await queue.processNextRequest();

    expect(queue.doQuery).toHaveBeenCalledTimes(1);
  });

  test('mergeBestSelections keeps the AI option on a tie', () => {
    expect(mergeBestSelections([option('iglesia', 80)], [option('iglesia', 80, true)])).toEqual([option('iglesia', 80)]);
  });
});
