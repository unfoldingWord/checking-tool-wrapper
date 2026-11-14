/* eslint-env jest */
import { getBestSelections } from '../src/utils/checkingSuggestionsUtils';
import { runTestCases, testCaseToSelectionOptions } from './helpers/suggestionsHelpers';

// an entry of llmTrainingData/vi_glt_luk_book_ru_gl_ru.json, with the USFM marker its verse has
const trainingCase = {
  id: 'train-vi-luk-1-73-abraham',
  targetLang: 'vi',
  glLang: 'ru',
  glOwner: 'ru_gl',
  groupId: 'abraham',
  verse: 'tức là lời kết ước mà Ngài đã thề cùng Áp-ra-ham, tổ phụ chúng tôi, để ban cho chúng tôi\n\\q1',
  glPhrase: 'Аврааму',
  history: { 'Аврааму': { 'với Áp ra ham': 1 } },
  expected: ['Áp ra ham'],
  contextId: {
    reference: {
      bookId: 'luk', chapter: 1, verse: 73,
    },
    tool: 'translationWords',
    groupId: 'abraham',
    checkId: 'hsjm',
    quote: 'Ἀβραὰμ',
    quoteString: 'Ἀβραὰμ',
    occurrence: 1,
  },
};

describe('testCaseToSelectionOptions', () => {
  test('builds the options of a training case', () => {
    const options = testCaseToSelectionOptions(trainingCase);

    expect(options).toEqual({
      verseText: 'tức là lời kết ước mà Ngài đã thề cùng Áp-ra-ham, tổ phụ chúng tôi, để ban cho chúng tôi',
      targetLanguageDetails: { id: 'vi' },
      alignedGLText: 'Аврааму',
      gatewayLanguageCode: 'ru',
      selectionsData: { selections: trainingCase.history },
      contextId: trainingCase.contextId,
      key: 'translationWords_ru_vi_abraham_luk_1_73_hsjm',
      llmQueryUrl: null,
      currentModel: undefined,
      llmTemperature: undefined,
      llmExtraParams: undefined,
      apiToken: undefined,
    });
  });

  test('passes the AI settings through', () => {
    const options = testCaseToSelectionOptions(trainingCase, {
      llmQueryUrl: 'http://localhost:1234',
      currentModel: 'qwen/qwen3-4b-2507',
      llmTemperature: 0.1,
      llmExtraParams: { seed: 42 },
      apiToken: 'token',
    });

    expect(options).toMatchObject({
      llmQueryUrl: 'http://localhost:1234',
      currentModel: 'qwen/qwen3-4b-2507',
      llmTemperature: 0.1,
      llmExtraParams: { seed: 42 },
      apiToken: 'token',
    });
  });

  test('takes the occurrence of an llmEval case, which has no contextId', () => {
    const evalCase = {
      id: 'real-vi-heb-7-26-sin', targetLang: 'vi', glLang: 'en', verse: 'tội lỗi và tội lỗi', glPhrase: 'sin', occurrence: 2, history: {},
    };
    const options = testCaseToSelectionOptions(evalCase);

    expect(options.contextId).toEqual({ occurrence: 2 });
    expect(options.key).toBe('real-vi-heb-7-26-sin');
  });

  test('getBestSelections finds the expected answer on the algorithm path', async () => {
    const [result] = await getBestSelections(testCaseToSelectionOptions(trainingCase));
    const top = result.bestSelections[0].selections.map(selection => selection.text).join(' ');

    expect(result.error).toBe(false);
    expect(top).toBe(trainingCase.expected[0]);
  });
});

describe('runTestCases', () => {
  test('returns the id, the getBestSelections result and the time of each case, in order', async () => {
    const secondCase = {
      ...trainingCase,
      id: 'train-vi-luk-1-73-abraham-copy',
      history: {},
    };
    const results = await runTestCases([trainingCase, secondCase]);

    expect(results.map(({ id }) => id)).toEqual([trainingCase.id, secondCase.id]);

    for (const { result, elapsedMs } of results) {
      expect(result.error).toBe(false);
      expect(typeof elapsedMs).toBe('number');
      expect(elapsedMs).toBeGreaterThanOrEqual(0);
    }

    const top = results[0].result.bestSelections[0].selections.map(selection => selection.text).join(' ');
    expect(top).toBe(trainingCase.expected[0]);
  });

  test('returns an empty array for no cases', async () => {
    expect(await runTestCases([])).toEqual([]);
    expect(await runTestCases(undefined)).toEqual([]);
  });
});
