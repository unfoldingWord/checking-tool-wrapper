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

  test('the builder gets the case\'s GL verse as glVerseText', async () => {
    const builder = jest.fn(request => PROMPT_VARIANTS.baseline(request));
    setSinglePromptOverrideForEval(builder);
    const testCase = realCases.find(c => !c.history || Object.keys(c.history).length === 0) || realCases[0];

    await quietly(() => getBestSelections(testCaseToSelectionOptions(
      {
        ...testCase, history: {}, glVerse: 'the GL verse',
      }, settings,
    )));
    expect(builder.mock.calls[0][0].glVerseText).toBe('the GL verse');
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

describe('variant X3 (GL verse with the phrase in brackets)', () => {
  // eslint-disable-next-line global-require
  const {
    X3_SYSTEM_PROMPT, X3_X4_SYSTEM_PROMPT, markGlPhraseInVerse,
  } = require('./helpers/promptVariants');
  // eslint-disable-next-line global-require
  const { verseDataToText } = require('./helpers/promptEvalCases');
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    previousTranslationData: { church: { iglesia: 7 } },
    glVerseText: 'to the church in Ephesus,',
  };
  const withOptions = { ...request, algorithmBestSelections: [{ selections: [{ text: 'iglesia', occurrence: 1 }], confidence: 70 }] };

  test('verseDataToText: words and text of verse objects, footnotes and markers left out', () => {
    expect(verseDataToText('In the  beginning\n')).toBe('In the beginning');
    expect(verseDataToText({
      verseObjects: [
        {
          tag: 'zaln', type: 'milestone', children: [{ text: 'Make', type: 'word' }, { type: 'text', text: ' ' }, { text: 'music', type: 'word' }],
        },
        { type: 'text', text: ' {to} ' },
        {
          type: 'footnote', tag: 'f', content: 'a note',
        },
        { text: 'the', type: 'word' },
        { type: 'text', text: ' \\q2 Lord,' },
      ],
    })).toBe('Make music {to} the Lord,');
  });

  test('markGlPhraseInVerse brackets the phrase, split or inflected words included', () => {
    expect(markGlPhraseInVerse('Make music {to} the Lord, Selah', 'to the Lord'))
      .toEqual({ text: 'Make music [to the Lord,] Selah', marked: true });
    expect(markGlPhraseInVerse('in my Father’s house', 'Father s').text).toBe('in my [Father’s] house');
    expect(markGlPhraseInVerse('alive in Christ—by grace you', 'by grace').text).toBe('alive in Christ — [by grace] you');
    // gaps allowed, in the shortest stretch
    expect(markGlPhraseInVerse('the Lord said, the will of the Lord', 'the Lord').text)
      .toBe('[the Lord] said, the will of the Lord');
    expect(markGlPhraseInVerse('Que los siervos se sometan', 'Que se sometan').text)
      .toBe('[Que] los siervos [se sometan]');
    expect(markGlPhraseInVerse('nothing here', 'church')).toEqual({ text: 'nothing here', marked: false });
  });

  test('the GATEWAY VERSE line goes before GATEWAY PHRASE and is the only change to X4b\'s request', () => {
    const line = '\nGATEWAY VERSE (en): to the [church] in Ephesus,';
    const plain = PROMPT_VARIANTS.X3(request).messages;
    const options = PROMPT_VARIANTS.X3(withOptions).messages;

    expect(plain[1].content).toContain(`${line}\nGATEWAY PHRASE (en): church`);
    expect(plain[1].content.replace(line, '')).toBe(PROMPT_VARIANTS.X4b(request).messages[1].content);
    expect(options[1].content.replace(line, '')).toBe(PROMPT_VARIANTS.X4b(withOptions).messages[1].content);
    expect(plain[0].content).toBe(X3_SYSTEM_PROMPT);
    expect(options[0].content).toBe(X3_X4_SYSTEM_PROMPT);
  });

  test('without a GL verse it is X4b', () => {
    const noVerse = { ...withOptions, glVerseText: undefined };
    expect(PROMPT_VARIANTS.X3(noVerse)).toEqual(PROMPT_VARIANTS.X4b(noVerse));
    expect(PROMPT_VARIANTS.X3({ ...noVerse, algorithmBestSelections: [] })).toEqual(PROMPT_VARIANTS.baseline(noVerse));
  });

  test('both system prompts describe the line and both examples show it', () => {
    for (const prompt of [X3_SYSTEM_PROMPT, X3_X4_SYSTEM_PROMPT]) {
      expect(prompt).toContain('GATEWAY VERSE - the same verse in the gateway language');
      expect(prompt).toContain('GATEWAY VERSE (en): to the [church] in Ephesus\nGATEWAY PHRASE (en): church\n');
      expect(prompt).toContain('GATEWAY VERSE (en): all the [believers] were together\nGATEWAY PHRASE (en): believers\n');
    }
    expect(X3_X4_SYSTEM_PROMPT).toContain('POSSIBLE ANSWERS:');
    expect(X3_SYSTEM_PROMPT).not.toContain('POSSIBLE ANSWERS');
  });
});

describe('variant X5 (occurrence)', () => {
  // eslint-disable-next-line global-require
  const {
    X5_SYSTEM_PROMPT, X5_X4_SYSTEM_PROMPT, hasRepeatedCandidateWord,
  } = require('./helpers/promptVariants');
  const request = {
    wordList: ['Dios', 'amó', 'al', 'mundo', 'y', 'dios', 'envió'],
    targetLangCode: 'es-419',
    glPhrase: 'God',
    glLangCode: 'en',
    previousTranslationData: { God: { Dios: 7 } },
    contextId: { occurrence: 2 },
  };
  const withOptions = { ...request, algorithmBestSelections: [{ selections: [{ text: 'Dios', occurrence: 1 }], confidence: 70 }] };

  test('hasRepeatedCandidateWord looks at option and history words', () => {
    expect(hasRepeatedCandidateWord(request)).toBe(true);
    expect(hasRepeatedCandidateWord({ ...request, previousTranslationData: {} })).toBe(false);
    expect(hasRepeatedCandidateWord({ ...withOptions, previousTranslationData: {} })).toBe(true);
    expect(hasRepeatedCandidateWord({ ...request, previousTranslationData: { God: { mundo: 1 } } })).toBe(false);
  });

  test('the OCCURRENCE line goes under GATEWAY PHRASE and is the only change to X4b\'s request', () => {
    for (const r of [request, withOptions]) {
      const x5 = PROMPT_VARIANTS.X5(r).messages;
      expect(x5[1].content).toContain('GATEWAY PHRASE (en): God\nOCCURRENCE: 2\n\nAnswer:');
      expect(x5[1].content.replace('\nOCCURRENCE: 2', '')).toBe(PROMPT_VARIANTS.X4b(r).messages[1].content);
    }
    expect(PROMPT_VARIANTS.X5(request).messages[0].content).toBe(X5_SYSTEM_PROMPT);
    expect(PROMPT_VARIANTS.X5(withOptions).messages[0].content).toBe(X5_X4_SYSTEM_PROMPT);
  });

  test('X4b when the occurrence is 1 or no candidate word repeats', () => {
    const first = { ...withOptions, contextId: { occurrence: 1 } };
    expect(PROMPT_VARIANTS.X5(first)).toEqual(PROMPT_VARIANTS.X4b(first));
    const noRepeat = { ...request, previousTranslationData: { God: { mundo: 1 } } };
    expect(PROMPT_VARIANTS.X5(noRepeat)).toEqual(PROMPT_VARIANTS.X4b(noRepeat));
  });

  test('the system prompts describe OCCURRENCE, add its rule and keep the rules numbered', () => {
    for (const prompt of [X5_SYSTEM_PROMPT, X5_X4_SYSTEM_PROMPT]) {
      expect(prompt).toContain('OCCURRENCE - when the phrase comes more than once');
      expect(prompt).toContain('6. When OCCURRENCE is given');
      expect(prompt).toContain('9. Answer only as CSV rows');
    }
  });
});

describe('variant N4 (GL verse only without history)', () => {
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    previousTranslationData: { church: { iglesia: 7 } },
    glVerseText: 'to the church in Ephesus',
  };
  const withOptions = { ...request, algorithmBestSelections: [{ selections: [{ text: 'iglesia', occurrence: 1 }], confidence: 70 }] };

  test('with history it is X4b, without it is X3', () => {
    expect(PROMPT_VARIANTS.N4(request)).toEqual(PROMPT_VARIANTS.X4b(request));
    expect(PROMPT_VARIANTS.N4(withOptions)).toEqual(PROMPT_VARIANTS.X4b(withOptions));

    for (const empty of [{}, { church: {} }, undefined]) {
      const noHistory = { ...request, previousTranslationData: empty };
      expect(PROMPT_VARIANTS.N4(noHistory)).toEqual(PROMPT_VARIANTS.X3(noHistory));
      expect(PROMPT_VARIANTS.N4(noHistory).messages[1].content).toContain('GATEWAY VERSE (en): to the [church] in Ephesus');
    }
  });
});

describe('variants N1 (explicit none) and N6 (unrelated history treated like none)', () => {
  // eslint-disable-next-line global-require
  const { hasOnlyUnrelatedHistory } = require('./helpers/promptVariants');
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    previousTranslationData: { church: { iglesia: 7 } },
  };
  const unrelated = { ...request, previousTranslationData: { church: { congregación: 3, asamblea: 1 } } };
  const option = { selections: [{ text: 'iglesia', occurrence: 1 }], confidence: 60 };

  test('N1: with history it is X4b; without, PREVIOUS TRANSLATIONS: none before GATEWAY PHRASE', () => {
    expect(PROMPT_VARIANTS.N1(request)).toEqual(PROMPT_VARIANTS.X4b(request));

    const noHistory = { ...request, previousTranslationData: {} };
    const app = PROMPT_VARIANTS.baseline(noHistory).messages;
    const n1 = PROMPT_VARIANTS.N1(noHistory).messages;
    expect(n1[0]).toEqual(app[0]);
    expect(n1[1].content).toContain('\n\nPREVIOUS TRANSLATIONS: none\n\nGATEWAY PHRASE (en): church');
    expect(n1[1].content.replace('\nPREVIOUS TRANSLATIONS: none\n', '')).toBe(app[1].content);
  });

  test('hasOnlyUnrelatedHistory: history whose renderings are not in the verse', () => {
    expect(hasOnlyUnrelatedHistory(unrelated)).toBe(true);
    expect(hasOnlyUnrelatedHistory(request)).toBe(false);
    expect(hasOnlyUnrelatedHistory({ ...request, previousTranslationData: {} })).toBe(false);
    // another form of a verse word fits
    expect(hasOnlyUnrelatedHistory({ ...request, previousTranslationData: { church: { iglesias: 2 } } })).toBe(false);
  });

  test('N6: unrelated history is sent as no history, keeping any options; otherwise X4b', () => {
    expect(PROMPT_VARIANTS.N6(request)).toEqual(PROMPT_VARIANTS.X4b(request));

    const n6 = PROMPT_VARIANTS.N6(unrelated).messages[1].content;
    expect(n6).not.toContain('PREVIOUS TRANSLATIONS');
    expect(n6).toBe(PROMPT_VARIANTS.baseline({ ...unrelated, previousTranslationData: {} }).messages[1].content);

    const withOption = { ...unrelated, algorithmBestSelections: [option] };
    expect(PROMPT_VARIANTS.N6(withOption)).toEqual(PROMPT_VARIANTS.X4({ ...withOption, previousTranslationData: {} }));
  });
});

describe('variant N2 (a no-history example)', () => {
  // eslint-disable-next-line global-require
  const {
    N2_SYSTEM_PROMPT, N2_X4_SYSTEM_PROMPT, N2_EXAMPLE,
  } = require('./helpers/promptVariants');
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    previousTranslationData: { church: { iglesia: 7 } },
  };
  const withOptions = { ...request, algorithmBestSelections: [{ selections: [{ text: 'iglesia', occurrence: 1 }], confidence: 70 }] };

  test('only the system prompt changes: Example 3 before the wrong answers', () => {
    for (const r of [request, withOptions]) {
      const n2 = PROMPT_VARIANTS.N2(r).messages;
      const x4b = PROMPT_VARIANTS.X4b(r).messages;
      expect(n2[1]).toEqual(x4b[1]);
      expect(n2[0].content.replace(N2_EXAMPLE, '')).toBe(x4b[0].content);
    }
    expect(PROMPT_VARIANTS.N2(request).messages[0].content).toBe(N2_SYSTEM_PROMPT);
    expect(PROMPT_VARIANTS.N2(withOptions).messages[0].content).toBe(N2_X4_SYSTEM_PROMPT);
    expect(N2_SYSTEM_PROMPT).toContain('"Gläubigen",75\n\nExample 3:\nTARGET VERSE (sw):');
    expect(N2_SYSTEM_PROMPT).toContain('"wagonjwa",65\n\nWrong answer for Example 1:');
  });
});

describe('variant N3 (a separate no-history system prompt)', () => {
  // eslint-disable-next-line global-require
  const { N3_SYSTEM_PROMPT, APP_SINGLE_SYSTEM_PROMPT } = require('./helpers/promptVariants');
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    previousTranslationData: { church: { iglesia: 7 } },
  };

  test('with history it is X4b; without, only the system prompt changes', () => {
    expect(PROMPT_VARIANTS.N3(request)).toEqual(PROMPT_VARIANTS.X4b(request));

    const noHistory = { ...request, previousTranslationData: {} };
    const n3 = PROMPT_VARIANTS.N3(noHistory).messages;
    expect(n3[0].content).toBe(N3_SYSTEM_PROMPT);
    expect(n3[1]).toEqual(PROMPT_VARIANTS.baseline(noHistory).messages[1]);
  });

  test('the prompt never mentions previous translations and keeps the app\'s output rules', () => {
    expect(N3_SYSTEM_PROMPT).not.toMatch(/PREVIOUS|previous|chosen/);
    expect(N3_SYSTEM_PROMPT).toContain('from 0 to 70');

    for (const line of ['1. Answer only with words copied from TARGET VERSE', 'If no words in TARGET VERSE fit, answer: "",0',
      'Answer only as CSV rows: no header, no explanation, no markdown fences.', 'Required output format:\n"word word",confidence']) {
      expect(APP_SINGLE_SYSTEM_PROMPT).toContain(line);
      expect(N3_SYSTEM_PROMPT).toContain(line);
    }

    // every example confidence is within the ceiling
    const confidences = [...N3_SYSTEM_PROMPT.matchAll(/",(\d+)/g)].map(m => Number(m[1]));
    expect(confidences.length).toBeGreaterThan(5);
    expect(Math.max(...confidences)).toBeLessThanOrEqual(70);
  });
});

describe('variant N34 (N3 + N4)', () => {
  // eslint-disable-next-line global-require
  const { N3_SYSTEM_PROMPT, N34_SYSTEM_PROMPT } = require('./helpers/promptVariants');
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    glVerseText: 'to the church in Ephesus',
    previousTranslationData: { church: { iglesia: 7 } },
  };

  test('with history it is X4b; without, N3\'s prompt with GATEWAY VERSE and N4\'s request', () => {
    expect(PROMPT_VARIANTS.N34(request)).toEqual(PROMPT_VARIANTS.X4b(request));

    const noHistory = { ...request, previousTranslationData: {} };
    const [system, user] = PROMPT_VARIANTS.N34(noHistory).messages;
    expect(system.content).toBe(N34_SYSTEM_PROMPT);
    expect(user).toEqual(PROMPT_VARIANTS.N4(noHistory).messages[1]);
    expect(user.content).toContain('GATEWAY VERSE (en): to the [church] in Ephesus\nGATEWAY PHRASE (en): church');
  });

  test('the prompt is N3\'s plus the GATEWAY VERSE field and one GATEWAY VERSE per example', () => {
    expect(N34_SYSTEM_PROMPT.match(/^GATEWAY VERSE \(en\):/gm).length).toBe(3);
    expect(N34_SYSTEM_PROMPT).toContain('GATEWAY VERSE - the same verse in the gateway language');
    expect(N34_SYSTEM_PROMPT.replace(/^GATEWAY VERSE.*\n/gm, '')).toBe(N3_SYSTEM_PROMPT);
    expect(N34_SYSTEM_PROMPT).not.toMatch(/PREVIOUS|previous|chosen/);
  });
});

describe('Step 4 variants S1-S6 (instruction length and structure, on X4b)', () => {
  // eslint-disable-next-line global-require
  const {
    S_SYSTEM_PROMPTS, S5_REMINDER, getPromptExamples, reorderRequestBlocks, X4_SYSTEM_PROMPT,
  } = require('./helpers/promptVariants');
  const request = {
    wordList: ['para', 'la', 'iglesia', 'de', 'Éfeso'],
    targetLangCode: 'es-419',
    glPhrase: 'church',
    glLangCode: 'en',
    previousTranslationData: { church: { iglesia: 7 } },
  };
  const withOptions = { ...request, algorithmBestSelections: [{ selections: [{ text: 'iglesia', occurrence: 1 }], confidence: 70 }] };
  const x4b = r => PROMPT_VARIANTS.X4b(r).messages;

  test('getPromptExamples gives each example in the request layout', () => {
    const examples = getPromptExamples(X4_SYSTEM_PROMPT);
    expect(examples).toHaveLength(2);
    expect(examples[0].request).toMatch(/^\nTARGET VERSE \(es-419\): para la iglesia de Éfeso\n\nPREVIOUS TRANSLATIONS:\n/);
    expect(examples[0].request).toMatch(/\n\nPOSSIBLE ANSWERS:\n"iglesia"\n"la iglesia"\n\nGATEWAY PHRASE \(en\): church\n\nAnswer:$/);
    expect(examples[0].answer).toBe('"iglesia",98\n"la iglesia",70');
    expect(examples[1].answer).toBe('"Gläubigen",75');
  });

  test('S1 is shorter, with Example 1 only and no wrong-answer list; request text unchanged', () => {
    for (const r of [request, withOptions]) {
      const s1 = PROMPT_VARIANTS.S1(r).messages;
      expect(s1[1]).toEqual(x4b(r)[1]);
      expect(s1[0].content.length).toBeLessThan(x4b(r)[0].content.length * 0.75);
      expect(s1[0].content).not.toContain('Example 2');
      expect(s1[0].content).not.toContain('Wrong answer');
      expect(s1[0].content).toContain('Example:\nTARGET VERSE (es-419): para la iglesia de Éfeso');
    }
    expect(S_SYSTEM_PROMPTS.S1.options).toContain('POSSIBLE ANSWERS');
    expect(S_SYSTEM_PROMPTS.S1.plain).not.toContain('POSSIBLE ANSWERS');
  });

  test('S2 replaces the rules with steps; the rest is unchanged', () => {
    const s2 = PROMPT_VARIANTS.S2(withOptions).messages;
    expect(s2[1]).toEqual(x4b(withOptions)[1]);
    expect(s2[0].content).toContain('Steps - follow them in order');
    expect(s2[0].content).not.toContain('Rules:');
    expect(s2[0].content.slice(s2[0].content.indexOf('Required output format:')))
      .toBe(x4b(withOptions)[0].content.slice(x4b(withOptions)[0].content.indexOf('Required output format:')));
  });

  test('S3 sends one user message: the system prompt, then the request', () => {
    const s3 = PROMPT_VARIANTS.S3(withOptions).messages;
    const [system, user] = x4b(withOptions);
    expect(s3).toEqual([{ role: 'user', content: `${system.content.trimEnd()}\n${user.content}` }]);
  });

  test('S4 sends the examples as chat turns, then the request', () => {
    const s4 = PROMPT_VARIANTS.S4(withOptions).messages;
    expect(s4.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user']);
    expect(s4[0].content).not.toContain('Example 1:');
    expect(s4[0].content).toContain('"church",98 - gateway words are not in TARGET VERSE');
    expect(s4[2].content).toBe('"iglesia",98\n"la iglesia",70');
    expect(s4[5]).toEqual(x4b(withOptions)[1]);
  });

  test('S5 adds the reminder before Answer: only', () => {
    const s5 = PROMPT_VARIANTS.S5(request).messages;
    expect(s5[0]).toEqual(x4b(request)[0]);
    expect(s5[1].content).toContain(`\n\n${S5_REMINDER}\nAnswer:`);
    expect(s5[1].content.replace(`${S5_REMINDER}\n`, '')).toBe(x4b(request)[1].content);
  });

  test('S6 puts GATEWAY PHRASE first and TARGET VERSE right after it, in the request and the examples', () => {
    const order = text => ['GATEWAY PHRASE', 'TARGET VERSE', 'PREVIOUS TRANSLATIONS', 'POSSIBLE ANSWERS', 'Answer:']
      .map(label => text.indexOf(label));
    const s6 = PROMPT_VARIANTS.S6(withOptions).messages;
    const positions = order(s6[1].content);
    expect(positions.every(p => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(s6[1].content.startsWith('\nGATEWAY PHRASE (en): church\n\nTARGET VERSE')).toBe(true);
    expect(s6[1].content).not.toContain('\n\n\n');
    expect([...s6[1].content].sort()).toEqual([...x4b(withOptions)[1].content].sort());

    for (const example of getPromptExamples(s6[0].content)) {
      expect(example.request.startsWith('\nGATEWAY PHRASE (en):')).toBe(true);
      expect(example.request.indexOf('TARGET VERSE')).toBeLessThan(example.request.indexOf('PREVIOUS TRANSLATIONS'));
    }
    expect(s6[0].content).toContain('You are given:\nGATEWAY PHRASE - the phrase');
    expect(reorderRequestBlocks('\nTARGET VERSE (x): a\n\nGATEWAY PHRASE (en): b\n\nAnswer:'))
      .toBe('\nGATEWAY PHRASE (en): b\n\nTARGET VERSE (x): a\n\nAnswer:');
  });
});
