/* eslint-env jest */
import {
  buildTranslationOptionsPrompt,
  getBestSelections,
  getBestTWordSelectionWithConfidenceFromLlm,
  parseLlmSelectionOptions,
} from '../src/utils/autoCheckingUtils';
import viTranslationData from './__fixtures__/tWords/vi_translationData.json';

const wordList = ['Para', 'la', 'iglesia', 'de', 'Éfeso', 'y', 'la', 'iglesia', 'de', 'Roma'];
const iglesia = [{ text: 'iglesia', occurrence: 1 }];
const laIglesia = [{ text: 'la', occurrence: 1 }, { text: 'iglesia', occurrence: 1 }];

describe('parseLlmSelectionOptions', () => {
  test.each([
    ['standard CSV', '"iglesia",98\n"la iglesia",70'],
    ['rows on one line', '"iglesia",98 "la iglesia",70'],
    ['think block with example rows', '<think>maybe "Roma",40 fits</think>\n"iglesia",98\n"la iglesia",70'],
    ['untagged reasoning before the answer', 'The phrase means church.\nExample: "Roma",10\n\nAnswer:\n"iglesia",98\n"la iglesia",70'],
    ['harmony channels', '<|channel|>analysis<|message|>"Roma",5<|end|><|start|>assistant<|channel|>final<|message|>"iglesia",98\n"la iglesia",70'],
    ['markdown fence and list', '```csv\n1. "iglesia", 98%\n2. "la iglesia", 70%\n```'],
    ['curly quotes and semicolons', '“iglesia”;98\n“la iglesia”;70'],
    ['JSON array', '[{"rendering":"iglesia","confidence":0.98},{"rendering":"la iglesia","confidence":0.7}]'],
    ['JSON object wrapper', '{"options":[["iglesia",98],["la iglesia",70]]}'],
    ['unquoted rows', 'iglesia,98\nla iglesia,70'],
    ['positions despite instructions', '"iglesia:3",98\n"la:2 iglesia:3",70'],
  ])('handles %s', (_, answer) => {
    expect(parseLlmSelectionOptions(answer, wordList)).toEqual([
      { selections: iglesia, confidence: 98 },
      { selections: laIglesia, confidence: 70 },
    ]);
  });

  test('restores casing and accents from the verse', () => {
    expect(parseLlmSelectionOptions('"para la iglesia de efeso",90', wordList)).toEqual([{
      selections: [
        { text: 'Para', occurrence: 1 },
        { text: 'la', occurrence: 1 },
        { text: 'iglesia', occurrence: 1 },
        { text: 'de', occurrence: 1 },
        { text: 'Éfeso', occurrence: 1 },
      ],
      confidence: 90,
    }]);
  });

  test('phrase and confidence on separate lines', () => {
    expect(parseLlmSelectionOptions('iglesia\n98', wordList)).toEqual([{ selections: iglesia, confidence: 98 }]);
  });

  test('merges duplicates, caps at 3 options and sorts by confidence', () => {
    const answer = '"iglesia",60\n"Iglesia",95\n"la iglesia",70\n"de Roma",50\n"Roma",40';
    expect(parseLlmSelectionOptions(answer, wordList).map(option => option.confidence)).toEqual([95, 70, 50]);
  });

  test.each([
    ['markers run together on one line', '###REQUEST1"iglesia",98###REQUEST2"",0###REQUEST3"",0'],
    ['markers on their own lines', '### REQUEST 1\n"iglesia",98\n### REQUEST 2\n"",0'],
  ])('parses the first request of a batched answer with %s', (_, answer) => {
    expect(parseLlmSelectionOptions(answer, wordList)).toEqual([{ selections: iglesia, confidence: 98 }]);
    expect(parseLlmSelectionOptions(answer, wordList, 1)).toEqual([]);
  });

  test('parses the requested entry of a batched answer', () => {
    const answer = '###REQUEST1"",0###REQUEST2"Roma",95###REQUEST3"",0';

    expect(parseLlmSelectionOptions(answer, wordList, 1)).toEqual([{ selections: [{ text: 'Roma', occurrence: 1 }], confidence: 95 }]);
  });

  test('returns no options for the "none" answer or unrelated text', () => {
    expect(parseLlmSelectionOptions('"",0', wordList)).toEqual([]);
    expect(parseLlmSelectionOptions('I cannot answer that, 100', wordList)).toEqual([]);
  });
});

describe.skip('getBestTWordSelectionWithConfidenceFromLlm', () => {
  afterEach(() => {
    delete window.AiAPIs;
  });

  test('queries the AI with a capped response length and parses the answer', async () => {
    const query = jest.fn().mockResolvedValue({ replyText: '<think>hmm</think>"iglesia",98', actualModel: 'test-model' });
    window.AiAPIs = { query };

    const results = await getBestTWordSelectionWithConfidenceFromLlm({
      wordList,
      targetLangCode: 'es-419',
      glPhrase: 'church',
      glLangCode: 'en',
      previousTranslationData: { church: { iglesia: 3 } },
    });

    expect(query.mock.calls[0][1].maxTokens).toBe(2048);
    expect(query.mock.calls[0][0]).toContain('"iglesia" (chosen 3 times for "church")');
    expect(results).toMatchObject({
      error: false,
      model: 'test-model',
      bestSelections: [{ selections: iglesia, confidence: 98 }],
    });
  });

  test('reports a failed request as an error', async () => {
    window.AiAPIs = { query: jest.fn().mockResolvedValue({ error: true }) };

    const results = await getBestTWordSelectionWithConfidenceFromLlm({
      wordList,
      targetLangCode: 'es-419',
      glPhrase: 'church',
      glLangCode: 'en',
      previousTranslationData: {},
    });

    expect(results).toMatchObject({ error: true, bestSelections: [] });
  });

  // /no_think at the end of the system prompt made qwen3-4b drop the batch markers (plan W13)
  test('puts /no_think at the start of the system prompt when thinking is off', async () => {
    const query = jest.fn().mockResolvedValue({ replyText: '"iglesia",98' });
    window.AiAPIs = { query };
    const request = {
      wordList, targetLangCode: 'es-419', glPhrase: 'church', glLangCode: 'en', previousTranslationData: {},
    };

    await getBestTWordSelectionWithConfidenceFromLlm(request);
    await getBestTWordSelectionWithConfidenceFromLlm({ ...request, lmOptions: { enable_thinking: true } });

    expect(query.mock.calls[0][1].systemPrompt.startsWith('/no_think\n')).toBe(true);
    expect(query.mock.calls[0][1].systemPrompt.trim().endsWith('/no_think')).toBe(false);
    expect(query.mock.calls[1][1].systemPrompt).not.toContain('/no_think');
  });
});

describe('getBestTWordSelectionWithConfidenceFromLlm with an array', () => {
  const romaList = ['para', 'la', 'iglesia', 'de', 'Roma'];
  const requests = [
    {
      wordList, targetLangCode: 'es-419', glPhrase: 'church', glLangCode: 'en', previousTranslationData: {},
    },
    {
      wordList: romaList, targetLangCode: 'es-419', glPhrase: 'Rome', glLangCode: 'en', previousTranslationData: {},
    },
  ];

  afterEach(() => {
    delete window.AiAPIs;
  });

  test('sends all requests in one query and splits the answer per request', async () => {
    const query = jest.fn().mockResolvedValue({
      replyText: '<think>### REQUEST 2\n"de",10</think>\n### REQUEST 1\n"iglesia",98\n### REQUEST 2\n"Roma",95',
      actualModel: 'test-model',
    });
    window.AiAPIs = { query };

    const results = await getBestTWordSelectionWithConfidenceFromLlm(requests);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('### REQUEST 1');
    expect(query.mock.calls[0][0]).toContain('### REQUEST 2');
    expect(results).toMatchObject([
      {
        error: false, model: 'test-model', bestSelections: [{ selections: iglesia, confidence: 98 }],
      },
      {
        error: false, model: 'test-model', bestSelections: [{ selections: [{ text: 'Roma', occurrence: 1 }], confidence: 95 }],
      },
    ]);
  });

  test('splits an answer with the markers run together on one line', async () => {
    window.AiAPIs = { query: jest.fn().mockResolvedValue({ replyText: '###REQUEST1"iglesia",98###REQUEST2"Roma",95' }) };

    const results = await getBestTWordSelectionWithConfidenceFromLlm(requests);

    expect(results[0].bestSelections).toEqual([{ selections: iglesia, confidence: 98 }]);
    expect(results[1].bestSelections).toEqual([{ selections: [{ text: 'Roma', occurrence: 1 }], confidence: 95 }]);
  });

  test('leaves unanswered requests empty', async () => {
    window.AiAPIs = { query: jest.fn().mockResolvedValue({ replyText: '### REQUEST 1\n"iglesia",98' }) };

    const results = await getBestTWordSelectionWithConfidenceFromLlm(requests);

    expect(results[0].bestSelections).toEqual([{ selections: iglesia, confidence: 98 }]);
    expect(results[1]).toMatchObject({ error: false, bestSelections: [] });
  });

  test('reports a failed request as an error for every request', async () => {
    window.AiAPIs = { query: jest.fn().mockResolvedValue({ error: true }) };

    const results = await getBestTWordSelectionWithConfidenceFromLlm(requests);

    expect(results).toMatchObject([{ error: true, bestSelections: [] }, { error: true, bestSelections: [] }]);
  });

  test.each([
    ['one row per request is split in order', '"iglesia",98\n"",0', [[{ selections: iglesia, confidence: 98 }], []]],
    ['more rows than requests are left unanswered', '"iglesia",98\n"la iglesia",70\n"",0', [[], []]],
    ['fewer rows than requests are left unanswered', '"iglesia",98', [[], []]],
  ])('an answer without markers: %s', async (_, replyText, expected) => {
    window.AiAPIs = { query: jest.fn().mockResolvedValue({ replyText }) };

    const results = await getBestTWordSelectionWithConfidenceFromLlm(requests);

    expect(results.map(result => result.bestSelections)).toEqual(expected);
  });

  test('returns an empty array for no requests', async () => {
    expect(await getBestTWordSelectionWithConfidenceFromLlm([])).toEqual([]);
  });
});

describe('buildTranslationOptionsPrompt previous translations', () => {
  const VERSE_HEB_9_12 = 'cũng chẳng phải bởi huyết của dê đực và bò con, nhưng bởi huyết của chính mình, Ngài đã vào trong các nơi thánh một lần đủ cả, tự mình kiếm được sự cứu chuộc đời đời.';
  const historyLines = input => input.split('\n').filter(line => / \(chosen \d+ times? for "/.test(line));

  test('keeps a related key whose rendering is in the verse (vi Heb 9:12)', () => {
    const { input } = buildTranslationOptionsPrompt(VERSE_HEB_9_12, 'vi', 'holy places', 'en',
      viTranslationData['ἅγια'].selections);

    expect(input).toContain('"các nơi thánh" (chosen 1 time for "of the holy places")');
  });

  test('lists flat history', () => {
    const { input } = buildTranslationOptionsPrompt('Pablo saludó a la iglesia', 'es-419', 'church', 'en',
      { 'iglesia': 7, 'la iglesia': 3 });

    expect(historyLines(input)).toEqual([
      '"iglesia" (chosen 7 times for "church")',
      '"la iglesia" (chosen 3 times for "church")',
    ]);
  });

  test('sends at most 5 lines when no rendering is in the verse', () => {
    const history = {};

    for (let i = 0; i < 40; i++) {
      history[`key ${i}`] = { [`palabra${i}`]: i + 1 };
    }

    const { input } = buildTranslationOptionsPrompt('Pablo saludó a la iglesia', 'es-419', 'church', 'en', history);
    expect(historyLines(input)).toHaveLength(5);
  });

  test('keeps a rendering found in the verse in another form', () => {
    const { input } = buildTranslationOptionsPrompt('सब विश्वासी एक साथ थे', 'hi', 'faith', 'en',
      { faith: { 'विश्वास': 5 } });

    expect(historyLines(input)).toEqual(['"विश्वास" (chosen 5 times for "faith")']);
  });

  test('lists the better GL key match first', () => {
    const { input } = buildTranslationOptionsPrompt('Por la fe Abraham obedeció y la ley fue dada', 'es-419',
      'the faith', 'en', { 'the law': { 'la ley': 9 }, 'faith': { 'fe': 2 } });
    const lines = historyLines(input);

    expect(lines).toEqual([
      '"fe" (chosen 2 times for "faith")',
      '"la ley" (chosen 9 times for "the law")',
    ]);
  });
});

describe('parseLlmSelectionOptions maps answer words to the verse', () => {
  const words = text => text.split(' ');
  const sel = text => text.split(' ').map(word => ({ text: word, occurrence: 1 }));
  const kirche = words('und die Kirchengemeinde versammelte sich');
  const casa = words('la casa de la madre y la hija');

  test.each([
    ['a compound form, keeping its confidence', '"Kirche",85', kirche, [{ selections: sel('Kirchengemeinde'), confidence: 85 }]],
    ['a compound form, capping a high confidence', '"Kirche",98', kirche, [{ selections: sel('Kirchengemeinde'), confidence: 90 }]],
    ['no unrelated word for a word not in the verse', '"mesa",90', casa, []],
    ['nothing for gateway-language words', '"the church of Ephesus",95', wordList, []],
    ['nothing when half the words are missing', '"la iglesia",40', casa, []],
    ['nothing for confidence 0', '"la casa",0', casa, []],
    ['an inflected form in a non-Latin script', '"विश्वास",95', words('सब विश्वासी एक साथ थे'), [{ selections: sel('विश्वासी'), confidence: 90 }]],
    ['an inflected word in a phrase', '"cuando se reúnen",85', words('cuando se reúnan para comer'), [{ selections: sel('cuando se reúnan'), confidence: 85 }]],
  ])('%s', (_, answer, verseWords, expected) => {
    expect(parseLlmSelectionOptions(answer, verseWords)).toEqual(expected);
  });
});

describe('AI system prompts', () => {
  test('are the same for every request, with the inflected-form example only for single requests', () => {
    const first = buildTranslationOptionsPrompt('Pablo saludó a la iglesia', 'es-419', 'church', 'en', { church: { iglesia: 2 } });
    const second = buildTranslationOptionsPrompt('सब विश्वासी एक साथ थे', 'hi', 'faith', 'en', {});
    const batch = buildTranslationOptionsPrompt('Pablo saludó a la iglesia', 'es-419', 'church', 'en', {}, true);

    expect(second.systemPrompt).toBe(first.systemPrompt);
    expect(first.systemPrompt).toContain('Example 2:');
    expect(first.systemPrompt).toContain('Copy exactly those words');
    expect(batch.systemPrompt).not.toContain('Example 2:');
    expect(batch.systemPrompt).not.toContain('Copy exactly those words');
    expect(batch.input).toBe(buildTranslationOptionsPrompt('Pablo saludó a la iglesia', 'es-419', 'church', 'en', {}).input);
  });
});

describe('getBestSelections temperature', () => {
  afterEach(() => {
    delete window.AiAPIs;
  });

  test.each([
    ['a setting of 0 is used', 0, 0],
    ['no setting uses 0.1', undefined, 0.1],
  ])('%s', async (_, llmTemperature, expected) => {
    const query = jest.fn().mockResolvedValue({ replyText: '"iglesia",98' });
    window.AiAPIs = { query };

    await getBestSelections({
      verseText: 'Pablo saludó a la iglesia',
      llmQueryUrl: 'http://localhost:1234',
      targetLanguageDetails: { id: 'es-419' },
      alignedGLText: 'church',
      gatewayLanguageCode: 'en',
      selectionsData: { selections: {} },
      llmTemperature,
    });

    expect(query.mock.calls[0][1].temperature).toBe(expected);
  });
});

describe('getBestSelections with AI and a certain algorithm answer', () => {
  afterEach(() => {
    delete window.AiAPIs;
  });

  test('answers a confidence-100 job with the algorithm and sends only the other job', async () => {
    const query = jest.fn().mockResolvedValue({ replyText: '"Roma",95', actualModel: 'test-model' });
    window.AiAPIs = { query };
    const job = {
      llmQueryUrl: 'http://localhost:1234',
      targetLanguageDetails: { id: 'es-419' },
      gatewayLanguageCode: 'en',
    };

    const results = await getBestSelections([
      {
        ...job, verseText: 'Pablo saludó a la iglesia en Corinto', alignedGLText: 'church',
        selectionsData: { selections: { church: { 'la iglesia': 7 } } },
      },
      {
        ...job, verseText: 'para la iglesia de Roma', alignedGLText: 'Rome', selectionsData: { selections: {} },
      },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('para la iglesia de Roma');
    expect(query.mock.calls[0][0]).not.toContain('Corinto');
    expect(results).toMatchObject([
      {
        model: 'APP', elapsedStr: '0', algorithmFirst: true,
        bestSelections: [{ selections: [{ text: 'la', occurrence: 1 }, { text: 'iglesia', occurrence: 1 }], confidence: 100 }],
      },
      { model: 'test-model', bestSelections: [{ selections: [{ text: 'Roma', occurrence: 1 }], confidence: 95 }] },
    ]);
  });
});
