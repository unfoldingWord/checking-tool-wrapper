// Suggestions for scripts written without spaces between words (Chinese, Japanese, Thai, ...):
// the verse is split into words with Intl.Segmenter so that part of a clause can be suggested.
import {
  getBestSelections,
  getBestTWordSelectionWithConfidenceAlgorithm,
  getWordList,
  parseLlmSelectionOptions,
  removePunctuation,
  splitIntoWords,
  toVerseTextSelections,
} from '../src/utils/checkingSuggestionsUtils';

const VERSE = '分门结党的人，警戒过一两次，就要弃绝他。 ';

describe('splitting scripts written without spaces', () => {
  test('getWordList splits a Chinese clause into words', () => {
    expect(getWordList(VERSE)).toEqual(['分', '门', '结党', '的', '人', '警戒', '过', '一', '两次', '就要', '弃绝', '他']);
  });

  test('getWordList splits Thai', () => {
    expect(getWordList('สวัสดีครับ')).toEqual(['สวัสดี', 'ครับ']);
  });

  test('getWordList leaves spaced scripts as the lexer gives them', () => {
    expect(getWordList('En el principio, Dios creó')).toEqual(['En', 'el', 'principio', 'Dios', 'creó']);
  });

  test('splitIntoWords splits a rendering like the verse', () => {
    expect(splitIntoWords('弃绝他')).toEqual(['弃绝', '他']);
    expect(splitIntoWords('la  iglesia')).toEqual(['la', 'iglesia']);
  });

  test('removePunctuation keeps a Chinese GL quote whole (history keys)', () => {
    expect(removePunctuation('分门结党的人，')).toEqual('分门结党的人');
  });
});

describe('parseLlmSelectionOptions with Chinese', () => {
  const wordList = getWordList(VERSE);

  test('matches an answer that is part of a clause', () => {
    expect(parseLlmSelectionOptions('\n\n"警戒",70', wordList)).toEqual([
      { selections: [{ text: '警戒', occurrence: 1 }], confidence: 70 },
    ]);
  });

  test('matches an answer of several words written together', () => {
    expect(parseLlmSelectionOptions('"弃绝他",80', wordList)).toEqual([
      { selections: [{ text: '弃绝', occurrence: 1 }, { text: '他', occurrence: 1 }], confidence: 80 },
    ]);
  });
});

describe('toVerseTextSelections', () => {
  test('joins adjacent words into one selection, as a user would select them', () => {
    const wordList = getWordList(VERSE);

    expect(toVerseTextSelections([{ text: '警戒', occurrence: 1 }, { text: '过', occurrence: 1 }], wordList, VERSE))
      .toEqual([{ text: '警戒过', occurrence: 1 }]);
  });

  test('counts the occurrence in the verse text, as tc-ui-toolkit does', () => {
    const verse = '他们说：他来了。';
    const wordList = getWordList(verse); // 他们 说 他 来 了

    expect(toVerseTextSelections([{ text: '他', occurrence: 1 }], wordList, verse))
      .toEqual([{ text: '他', occurrence: 2 }]);
  });

  test('leaves spaced scripts unchanged', () => {
    const verse = 'la iglesia de Dios';
    const selections = [{ text: 'la', occurrence: 1 }, { text: 'iglesia', occurrence: 1 }];
    expect(toVerseTextSelections(selections, getWordList(verse), verse)).toBe(selections);
  });
});

describe('algorithm with Chinese history', () => {
  test('finds a rendering written without spaces', async () => {
    const options = await getBestTWordSelectionWithConfidenceAlgorithm(
      getWordList(VERSE), 'zh', 'reject', 'en', { reject: { '弃绝他': 6 } });
    expect(options[0]).toEqual({ selections: [{ text: '弃绝', occurrence: 1 }, { text: '他', occurrence: 1 }], confidence: 100 });
  });

  test('getBestSelections returns the selection as verse text', async () => {
    const [result] = await getBestSelections([{
      verseText: VERSE,
      alignedGLText: 'reject',
      gatewayLanguageCode: 'en',
      targetLanguageDetails: { id: 'zh' },
      selectionsData: { selections: { reject: { '弃绝他': 6 } } },
      contextId: { occurrence: 1 },
    }]);
    expect(result.bestSelections[0]).toEqual({ selections: [{ text: '弃绝他', occurrence: 1 }], confidence: 100 });
  });
});
