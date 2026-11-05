/* eslint-env jest */
import {
  getBestTWordSelectionWithConfidenceFromLlm,
  parseLlmSelectionOptions,
} from '../src/utils/autoCheckingUtils';

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
    expect(query.mock.calls[0][0]).toContain('"rendering":"iglesia"');
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

  test('returns an empty array for no requests', async () => {
    expect(await getBestTWordSelectionWithConfidenceFromLlm([])).toEqual([]);
  });
});
