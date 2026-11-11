/* eslint-env jest */

import { LlmRequestQueue } from '../src/utils/LlmRequestQueue';

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
    queue.requestQueue.addRequest({ request: { key: KEY, llmQueryUrl }, callback });

    await queue.processNextRequest();

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ bestSelections: suggestion.bestSelections }));
    expect(queue.alreadyHaveSuggestionsForKey(KEY)).toBe(saved);
  });
});
