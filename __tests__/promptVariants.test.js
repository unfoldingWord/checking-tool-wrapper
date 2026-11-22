/* eslint-env jest */
/**
 * Tests for the prompt-experiment plumbing of plans/improve-single-prompt.md: the `messages`
 * option of `queryAiAPI`, `setSinglePromptOverrideForEval`, and the variants in
 * `helpers/promptVariants.js`. No network: `fetch` and `window.AiAPIs` are mocked.
 */
import {
  applyThinkingDirectiveToMessages,
  buildChatMessages,
  chatMessagesToSystemAndQuery,
  getBestSelections,
  getValidChatMessages,
  getWordList,
  queryAiAPI,
  setSinglePromptOverrideForEval,
} from '../src/utils/checkingSuggestionsUtils';
import { testCaseToSelectionOptions } from './helpers/suggestionsHelpers';
import {
  getPromptVariantFromEnv, installPromptVariant, PROMPT_VARIANTS,
} from './helpers/promptVariants';
import realCases from './__fixtures__/llmEval/realCases.json';

const SYSTEM = { role: 'system', content: 'rules' };
const EXAMPLE_USER = { role: 'user', content: 'example request' };
const EXAMPLE_ANSWER = { role: 'assistant', content: '"a",90' };
const REQUEST = { role: 'user', content: 'real request' };

/**
 * Silences console output from the code under test while `fn` runs.
 * @param {function(): Promise<*>} fn
 * @returns {Promise<*>}
 */
async function quietly(fn) {
  const spies = ['error', 'warn', 'log'].map(name => jest.spyOn(console, name).mockImplementation(() => {}));

  try {
    return await fn();
  } finally {
    spies.forEach(spy => spy.mockRestore());
  }
}

describe('getValidChatMessages', () => {
  test('copies a valid list, keeping only role and content', () => {
    expect(getValidChatMessages([{ ...SYSTEM, name: 'x' }, REQUEST])).toEqual([SYSTEM, REQUEST]);
  });

  test.each([
    ['not an array', 'text'],
    ['empty', []],
    ['unknown role', [{ role: 'tool', content: 'x' }, REQUEST]],
    ['content not text', [{ role: 'user', content: ['x'] }]],
    ['last message not from the user', [SYSTEM, REQUEST, EXAMPLE_ANSWER]],
  ])('null when %s', (name, messages) => {
    expect(getValidChatMessages(messages)).toBeNull();
  });
});

describe('applyThinkingDirectiveToMessages', () => {
  test('thinking off: adds /no_think to the system message and the last user message only', () => {
    const messages = [SYSTEM, EXAMPLE_USER, EXAMPLE_ANSWER, REQUEST];

    expect(applyThinkingDirectiveToMessages(messages, false)).toEqual([
      { role: 'system', content: '/no_think\nrules' },
      EXAMPLE_USER,
      EXAMPLE_ANSWER,
      { role: 'user', content: '/no_think\nreal request' },
    ]);
    expect(messages[0].content).toBe('rules'); // not changed in place
  });

  test('with no system message, only the last user message gets it', () => {
    expect(applyThinkingDirectiveToMessages([REQUEST], false)).toEqual([{ role: 'user', content: '/no_think\nreal request' }]);
  });

  test('thinking on: unchanged', () => {
    expect(applyThinkingDirectiveToMessages([SYSTEM, REQUEST], true)).toEqual([SYSTEM, REQUEST]);
  });
});

describe('chatMessagesToSystemAndQuery and buildChatMessages', () => {
  test('a system + user pair round-trips', () => {
    const pair = chatMessagesToSystemAndQuery([SYSTEM, REQUEST]);
    expect(pair).toEqual({ systemPrompt: 'rules', query: 'real request' });
    expect(buildChatMessages(pair.systemPrompt, pair.query)).toEqual([SYSTEM, REQUEST]);
  });

  test('chat turns are joined into the query, in order', () => {
    expect(chatMessagesToSystemAndQuery([SYSTEM, EXAMPLE_USER, EXAMPLE_ANSWER, REQUEST])).toEqual({ systemPrompt: 'rules', query: 'example request\n\n"a",90\n\nreal request' });
  });

  test('no system message is sent for an empty system prompt, as translationCore does', () => {
    expect(buildChatMessages('', 'q')).toEqual([{ role: 'user', content: 'q' }]);
  });
});

describe('queryAiAPI with messages through window.AiAPIs', () => {
  afterEach(() => {
    delete window.AiAPIs;
  });

  test('a translationCore that sends messages gets them, with /no_think added', async () => {
    const query = jest.fn(() => Promise.resolve({ replyText: '"a",90', actualModel: 'm' }));
    window.AiAPIs = { query, features: { messages: true } };

    await quietly(() => queryAiAPI('', { messages: [SYSTEM, REQUEST] }));

    const [sentQuery, options] = query.mock.calls[0];

    expect(options.messages).toEqual([
      { role: 'system', content: '/no_think\nrules' },
      { role: 'user', content: '/no_think\nreal request' },
    ]);
    expect(sentQuery).toBe('/no_think\nreal request');
  });

  test('an older translationCore gets the same text as a system prompt and query', async () => {
    const query = jest.fn(() => Promise.resolve({ replyText: '"a",90', actualModel: 'm' }));
    window.AiAPIs = { query };

    await quietly(() => queryAiAPI('', { messages: [SYSTEM, EXAMPLE_USER, EXAMPLE_ANSWER, REQUEST] }));

    const [sentQuery, options] = query.mock.calls[0];
    expect(options.messages).toBeUndefined();
    expect(options.systemPrompt).toBe('/no_think\nrules');
    expect(sentQuery).toBe('example request\n\n"a",90\n\n/no_think\nreal request');
  });

  test('without messages the system prompt and the query both get /no_think', async () => {
    const query = jest.fn(() => Promise.resolve({ replyText: '"a",90', actualModel: 'm' }));
    window.AiAPIs = { query, features: { messages: true } };

    await quietly(() => queryAiAPI('the query', { systemPrompt: 'rules' }));

    const [sentQuery, options] = query.mock.calls[0];
    expect(sentQuery).toBe('/no_think\nthe query');
    expect(options.messages).toBeUndefined();
    expect(options.systemPrompt).toBe('/no_think\nrules');
    expect(options.query).toBe('/no_think\nthe query');
  });
});

describe('prompt variants through getBestSelections', () => {
  const originalFetch = global.fetch;
  const settings = { llmQueryUrl: 'http://localhost:1234', currentModel: 'm' };

  afterEach(() => {
    global.fetch = originalFetch;
    setSinglePromptOverrideForEval(null);
  });

  /**
   * Runs every real evaluation case through `getBestSelections` and records the request bodies
   * sent over HTTP (the server answers 500, so nothing is parsed).
   * @returns {Promise<Array<object|null>>} - one body per case, null when the algorithm answered
   */
  async function recordBodies() {
    const bodies = [];

    global.fetch = jest.fn((url, { body }) => {
      bodies[bodies.length - 1] = JSON.parse(body);
      return Promise.resolve({
        ok: false, status: 500, text: () => Promise.resolve('recorded'),
      });
    });

    await quietly(async () => {
      for (const testCase of realCases) {
        bodies.push(null);
        // eslint-disable-next-line no-await-in-loop
        await getBestSelections(testCaseToSelectionOptions(testCase, settings));
      }
    });
    return bodies;
  }

  test('baseline sends exactly what the app sends', async () => {
    const appBodies = await recordBodies();
    const uninstall = installPromptVariant('baseline');
    const baselineBodies = await recordBodies();
    uninstall();

    expect(appBodies.filter(Boolean).length).toBeGreaterThanOrEqual(5);
    expect(baselineBodies).toEqual(appBodies);
  });

  test('the builder gets the check context and the algorithm options', async () => {
    const builder = jest.fn(request => PROMPT_VARIANTS.baseline(request));
    setSinglePromptOverrideForEval(builder);
    await recordBodies();

    const request = builder.mock.calls[0][0];
    expect(request.contextId).toBeTruthy();
    expect(Array.isArray(request.algorithmBestSelections)).toBe(true);
    expect(request.wordList.length).toBeGreaterThan(0);
  });

  test('a builder returning invalid messages makes the request fail', async () => {
    setSinglePromptOverrideForEval(() => ({ messages: [] }));
    const results = await quietly(() => getBestSelections(testCaseToSelectionOptions(
      { ...realCases[0], history: {} }, settings,
    )));
    expect(results[0].error).toBe(true);
  });
});

describe('getPromptVariantFromEnv', () => {
  test('empty when not set, the id when known', () => {
    expect(getPromptVariantFromEnv({})).toBe('');
    expect(getPromptVariantFromEnv({ LLM_PROMPT_VARIANT: 'baseline' })).toBe('baseline');
  });

  test('throws for an unknown variant', () => {
    expect(() => getPromptVariantFromEnv({ LLM_PROMPT_VARIANT: 'nope' })).toThrow('unknown LLM_PROMPT_VARIANT');
    expect(() => installPromptVariant('nope')).toThrow('unknown prompt variant');
  });
});

describe('scripts/compare-prompt-variants.js', () => {
  // a plain Node script, so it is loaded with require
  // eslint-disable-next-line global-require
  const {
    mcnemarP, scoreRun, summarize,
  } = require('../scripts/compare-prompt-variants');
  const option = (text, confidence, occurrence = 1) => ({ selections: [{ text, occurrence }], confidence });

  test('exact McNemar p', () => {
    expect(mcnemarP(0, 0)).toBe(1);
    expect(mcnemarP(10, 0)).toBeCloseTo(2 / 1024, 10);
    expect(mcnemarP(3, 3)).toBe(1);
  });

  test('scores as the app shows it, falling back to the algorithm when the AI gave nothing', () => {
    const cases = [
      { id: 'a', expected: ['La Iglesia'] },
      { id: 'b', expected: ['fe'] },
      { id: 'c', expected: ['amor:2'] },
      { id: 'd', expected: ['paz'] },
    ];
    const results = [
      {
        id: 'a', result: { bestSelections: [option('la iglesia', 90)] }, elapsedMs: 100,
      },
      {
        id: 'b', result: { bestSelections: [] }, elapsedMs: 300,
      },
      {
        id: 'c', result: { bestSelections: [option('amor', 85), option('amor', 60, 2)] }, elapsedMs: 200,
      },
    ];
    const algorithmById = new Map([['b', { bestSelections: [option('fe', 70)] }]]);
    const scores = scoreRun(cases, results, algorithmById);

    expect(scores[3]).toBeNull();
    expect(summarize(scores.filter(Boolean))).toEqual({
      cases: 3,
      top1: 2,
      top3: 3,
      confidentWrong: 1,
      aiEmpty: 1,
      meanConfidenceRight: '80.0',
      meanConfidenceWrong: '85.0',
      medianMs: 200,
    });
  });
});

describe('no-history cases (DEV-NOHIST, TEST-NOHIST)', () => {
  test('the algorithm gives no option without history, so every one is answered by the AI alone', async () => {
    const results = await quietly(() => getBestSelections(realCases.map(testCase => testCaseToSelectionOptions({ ...testCase, history: {} }))));
    expect(results.length).toBe(realCases.length);
    results.forEach(result => expect(result.bestSelections || []).toEqual([]));
  });
});

describe('raw AI answer in the results', () => {
  const settings = { llmQueryUrl: 'http://localhost:1234', currentModel: 'm' };
  const noHistoryCase = { ...realCases[0], history: {} };

  afterEach(() => {
    delete window.AiAPIs;
  });

  test.each([
    ['a parsed answer', '"$WORD",80', 1],
    ['an answer whose words are not in the verse', '"zzzqqq",90', 0],
    ['an answer saying nothing fits', '"",0', 0],
  ])('getBestSelections keeps the answer text for %s', async (name, reply, options) => {
    const word = realCases[0].verse.split(/\s+/)[0];
    const replyText = reply.replace('$WORD', word);

    window.AiAPIs = {
      query: jest.fn(() => Promise.resolve({ replyText, actualModel: 'm' })),
      features: { messages: true },
    };

    const [result] = await quietly(() => getBestSelections(testCaseToSelectionOptions(noHistoryCase, settings)));

    expect(result.rawAnswer).toBe(replyText);
    expect(result.bestSelections.length).toBe(options);
  });
});

describe('variant X1 (history marked against the verse)', () => {
  // eslint-disable-next-line global-require
  const { X1_SYSTEM_PROMPT, editPrompt } = require('./helpers/promptVariants');

  const requestOf = testCase => {
    const options = testCaseToSelectionOptions(testCase);
    return {
      wordList: getWordList(options.verseText),
      targetLangCode: testCase.targetLang,
      glPhrase: testCase.glPhrase,
      glLangCode: testCase.glLang,
      previousTranslationData: testCase.history || {},
    };
  };

  test('editPrompt throws when the text to replace is missing', () => {
    expect(() => editPrompt('abc', [['x', 'y']])).toThrow('expected 1 occurrence, found 0');
  });

  test('the system prompt refers to the marks and its examples show them', () => {
    expect(X1_SYSTEM_PROMPT).toContain('3. A previous translation marked "in verse"');
    expect(X1_SYSTEM_PROMPT).toContain('"Gläubige" (chosen 5 times for "believer") - verse has "Gläubigen"');
    expect(X1_SYSTEM_PROMPT).not.toContain('las iglesias');
  });

  test('the request text differs from the app\'s only by the marks', () => {
    let marked = 0;

    for (const testCase of realCases) {
      const request = requestOf(testCase);
      const app = PROMPT_VARIANTS.baseline(request).messages[1].content;
      const x1 = PROMPT_VARIANTS.X1(request).messages[1].content;

      expect(x1.replace(/ - (in verse|not in verse|verse has "[^"\n]*")$/gm, '')).toBe(app);
      marked += (x1.match(/ - (in verse|not in verse|verse has "[^"\n]*")$/gm) || []).length;
    }
    expect(marked).toBeGreaterThan(10);
  });
});

describe('variant X4 (algorithm options as POSSIBLE ANSWERS)', () => {
  // eslint-disable-next-line global-require
  const { X4_SYSTEM_PROMPT, formatPossibleAnswers } = require('./helpers/promptVariants');
  const option = (...texts) => ({ selections: texts.map(text => ({ text, occurrence: 1 })), confidence: 50 });
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    previousTranslationData: { church: { iglesia: 7 } },
  };

  test('formatPossibleAnswers: the first 3 options, words joined, repeats left out', () => {
    expect(formatPossibleAnswers([option('iglesia'), option('la', 'iglesia'), option('de'), option('x')]))
      .toBe('"iglesia"\n"la iglesia"\n"de"');
    expect(formatPossibleAnswers([option('iglesia'), option('iglesia'), option('de')])).toBe('"iglesia"\n"de"');
    expect(formatPossibleAnswers([])).toBe('');
    expect(formatPossibleAnswers(undefined)).toBe('');
  });

  test('the block goes before GATEWAY PHRASE and is the only change to the request text', () => {
    const app = PROMPT_VARIANTS.baseline(request).messages[1].content;
    const x4 = PROMPT_VARIANTS.X4({ ...request, algorithmBestSelections: [option('iglesia')] }).messages[1].content;

    expect(x4).toContain('\n\nPOSSIBLE ANSWERS:\n"iglesia"\n\nGATEWAY PHRASE (en): church');
    expect(x4.replace('\nPOSSIBLE ANSWERS:\n"iglesia"\n', '')).toBe(app);
    expect(PROMPT_VARIANTS.X4({ ...request, algorithmBestSelections: [] }).messages[1].content).toBe(app);
  });

  test('the system prompt describes the block and Example 1 shows it', () => {
    expect(X4_SYSTEM_PROMPT).toContain('POSSIBLE ANSWERS - verse words a matching program found');
    expect(X4_SYSTEM_PROMPT).toContain('POSSIBLE ANSWERS:\n"iglesia"\n"la iglesia"\n\nGATEWAY PHRASE (en): church');
  });
});

describe('variant X6 (translationWords term)', () => {
  // eslint-disable-next-line global-require
  const { X6_SYSTEM_PROMPT } = require('./helpers/promptVariants');
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    previousTranslationData: { church: { iglesia: 7 } },
  };

  test('the TERM line goes under GATEWAY PHRASE and is the only change to the request text', () => {
    const app = PROMPT_VARIANTS.baseline(request).messages[1].content;
    const x6 = PROMPT_VARIANTS.X6({ ...request, contextId: { groupId: 'church' } }).messages[1].content;

    expect(x6).toContain('GATEWAY PHRASE (en): church\nTERM: church\n\nAnswer:');
    expect(x6.replace('\nTERM: church', '')).toBe(app);
    expect(PROMPT_VARIANTS.X6({ ...request, contextId: {} }).messages[1].content).toBe(app);
  });

  test('the system prompt describes TERM and both examples show it', () => {
    expect(X6_SYSTEM_PROMPT).toContain('TERM - the Bible term the phrase is an example of');
    expect(X6_SYSTEM_PROMPT).toContain('GATEWAY PHRASE (en): church\nTERM: church\n\nAnswer:');
    expect(X6_SYSTEM_PROMPT).toContain('GATEWAY PHRASE (en): believers\nTERM: believe\n\nAnswer:');
  });
});

describe('variant X4b (X4 only when the algorithm has options)', () => {
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    previousTranslationData: { church: { iglesia: 7 } },
  };
  const withOptions = { ...request, algorithmBestSelections: [{ selections: [{ text: 'iglesia', occurrence: 1 }], confidence: 70 }] };

  test('with options it is X4, without it is the app prompt', () => {
    expect(PROMPT_VARIANTS.X4b(withOptions)).toEqual(PROMPT_VARIANTS.X4(withOptions));
    expect(PROMPT_VARIANTS.X4b({ ...request, algorithmBestSelections: [] })).toEqual(PROMPT_VARIANTS.baseline(request));
    expect(PROMPT_VARIANTS.X4b(request)).toEqual(PROMPT_VARIANTS.baseline(request));
  });
});
