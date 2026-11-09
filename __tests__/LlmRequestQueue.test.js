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
