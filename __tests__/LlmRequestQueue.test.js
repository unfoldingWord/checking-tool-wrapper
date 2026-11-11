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

describe('LlmRequestQueue suggestion mode (AI vs algorithm)', () => {
  const KEY = 'translationWords_en_es-419_faith_gal_1_1_c1';
  const AI_URL = 'http://localhost:1234';
  const algorithmMemory = { bestSelections: [{ selections: [{ text: 'fe', occurrence: 1 }], confidence: 90 }], llmMode: false };
  const aiMemory = { bestSelections: [{ selections: [{ text: 'la fe', occurrence: 1 }], confidence: 95 }], llmMode: true };

  /**
   * Makes a queue that never processes requests, so tests can see what was queued.
   * @param {object} cache - suggestions cache
   * @returns {LlmRequestQueue} - the queue
   */
  function makeQueue(cache) {
    const queue = new LlmRequestQueue(cache);
    queue.processNextRequestIfNotBusy = jest.fn();
    return queue;
  }

  test('memory is only found for the mode that made it', () => {
    const queue = makeQueue({ [KEY]: algorithmMemory });

    expect(queue.alreadyHaveSuggestionsForKey(KEY)).toBe(true);
    expect(queue.alreadyHaveSuggestionsForKey(KEY, false)).toBe(true);
    expect(queue.alreadyHaveSuggestionsForKey(KEY, true)).toBe(false);
  });

  test('AI request does not use an algorithm suggestion from memory', async () => {
    const queue = makeQueue({ [KEY]: { ...algorithmMemory } });
    const callback = jest.fn();

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: AI_URL }, callback);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(callback).not.toHaveBeenCalled();
    expect(queue.findKeyInQueue(KEY)).toBe(0);
  });

  test('algorithm request does not use an AI suggestion from memory', async () => {
    const queue = makeQueue({ [KEY]: { ...aiMemory } });
    const callback = jest.fn();

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: '' }, callback);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(callback).not.toHaveBeenCalled();
    expect(queue.findKeyInQueue(KEY)).toBe(0);
  });

  test('request in the same mode uses memory', async () => {
    const queue = makeQueue({ [KEY]: { ...aiMemory } });
    const callback = jest.fn();

    queue.makeSuggestionRequest({ key: KEY, llmQueryUrl: AI_URL }, callback);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ cached: true, llmMode: true }));
    expect(queue.findKeyInQueue(KEY)).toBe(-1);
  });

  test('clearAlgorithmSuggestionsMemory removes only algorithm suggestions', () => {
    const cache = {
      a: { ...algorithmMemory },
      b: { ...aiMemory },
      c: { bestSelections: [] }, // no mode recorded - treated as algorithm
    };
    const queue = makeQueue(cache);

    expect(queue.clearAlgorithmSuggestionsMemory()).toBe(2);
    expect(Object.keys(cache)).toEqual(['b']);
  });

  test.each([
    ['AI', AI_URL, true],
    ['algorithm', '', false],
  ])('processNextRequest records the mode of an %s request in memory', async (_, llmQueryUrl, llmMode) => {
    const cache = {};
    const queue = makeQueue(cache);
    const suggestion = { error: false, bestSelections: [{ selections: [{ text: 'fe', occurrence: 1 }], confidence: 90 }] };

    queue.doQuery = jest.fn((__, request) => Promise.resolve([{ ...suggestion, request }]));
    queue.requestQueue.addRequest({ request: { key: KEY, llmQueryUrl }, callback: jest.fn() });

    await queue.processNextRequest();

    expect(cache[KEY]).toEqual(expect.objectContaining({ llmMode }));
    expect(queue.alreadyHaveSuggestionsForKey(KEY, llmMode)).toBe(true);
    expect(queue.alreadyHaveSuggestionsForKey(KEY, !llmMode)).toBe(false);
  });
});
