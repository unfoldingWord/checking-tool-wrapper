/* eslint-env jest */

import { normalizer } from 'string-punctuation-tokenizer';
import { getBestTWordSelectionWithConfidenceAlgorithm, getWordList } from '../src/utils/autoCheckingUtils';

describe('getBestTWordSelectionWithConfidenceAlgorithm', () => {
  describe('vi testing', () => {
    const targetLangCode = 'vi';
    const glLangCode = 'en';

    test('Should find match Heb 9:12', async () => {
      //given

      const verseText =
        'cũng chẳng phải bởi huyết của dê đực và bò con, nhưng bởi huyết của chính mình, Ngài đã vào trong các nơi thánh một lần đủ cả, tự mình kiếm được sự cứu chuộc đời đời. ';
      const glPhrase = normalizer('holy places');
      const previousTranslationData = {
        'Holy': { 'Nơi Thánh': 1 },
        'the Holy': { 'Nơi Thánh': 1 },
        'holy place': { 'một nơi thánh': 1 },
      };
      const expectedText = normalizer('nơi thánh');
      const wordList = getWordList(normalizer(verseText));

      //when
      const results = await getBestTWordSelectionWithConfidenceAlgorithm(
        wordList,
        targetLangCode,
        glPhrase,
        glLangCode,
        previousTranslationData
      );

      //then
      const { confidence, topChoiceText } = getResults(results);
      expect(topChoiceText).toBe(expectedText);
      expect(confidence > 75).toBeTruthy();
    });

    test('Should find match Heb 12:10', async () => {
      //given

      const verseText =
        'Vì dù cha phần xác sửa dạy chúng ta trong ít ngày theo điều dường như là tốt nhất đối với họ, nhưng Cha phần tâm linh sửa dạy vì cớ đem ích lợi cho chúng ta, để dự phần vào sự thánh khiết của Ngài. ';
      const targetLangCode = 'vi';
      const glPhrase = 'holiness';
      const glLangCode = 'en';
      const previousTranslationData = normalizePreviousTranslationData( {
        "Holy": { 'Nơi Thánh': 1 },
        'the Holy': { 'Nơi Thánh': 1 },
        'sanctification': { 'sự nên thánh': 1 },
      });
      const wordList = getWordList(normalizer(verseText));
      const expectedText = normalizer('thánh');

      //when
      const results = await getBestTWordSelectionWithConfidenceAlgorithm(
        wordList,
        targetLangCode,
        glPhrase,
        glLangCode,
        previousTranslationData
      );

      //then
      const { confidence, topChoiceText } = getResults(results);
      expect(topChoiceText).toBe(expectedText); //TODO this should at least find a partial match
      expect(confidence > 50).toBeTruthy();
    });
  });

  describe('es-419 testing', () => {
    test('Should find match - perfect', async () => {
      //given
      const verseText = 'Por lo tanto mis hermanos cuando se reúnan para comer esperen el uno por el otro';
      const targetLangCode = 'es-419';
      const glPhrase = 'coming together';
      const glLangCode = 'en';
      const previousTranslationData = normalizePreviousTranslationData( {
        'having been assembled': { 'Cuando reunan': 1 },
        'you come together': { 'cuando reúnen': 1 },
        'in coming together': { 'cuando reúnen': 1 },
        'coming together': { 'cuando reúnen': 1 },
      });
      const wordList = getWordList(normalizer(verseText));
      const expectedText = normalizer('cuando reúnan');

      //when
      const results = await getBestTWordSelectionWithConfidenceAlgorithm(
        wordList,
        targetLangCode,
        glPhrase,
        glLangCode,
        previousTranslationData,
      );

      //then
      const { confidence, topChoiceText } = getResults(results);
      expect(topChoiceText).toBe(expectedText);
      expect(confidence > 75).toBeTruthy();
    });

    test('Should find match - impertect', async () => {
      //given
      const verseText =
        'Por lo tanto mis hermanos cuando se reúnan para comer esperen el uno por el otro';
      const targetLangCode = 'es-419';
      const glPhrase = 'coming together';
      const glLangCode = 'en';
      const previousTranslationData = normalizePreviousTranslationData( {
        'having been assembled': { 'Cuando reunan': 1 },
        'you come together': { 'cuando reúnen': 1 },
        'in coming together': { 'cuando reúnen': 1 },
      });
      const wordList = getWordList(normalizer(verseText));
      const expectedText = normalizer('cuando reúnan');

      //when
      const results = await getBestTWordSelectionWithConfidenceAlgorithm(
        wordList,
        targetLangCode,
        glPhrase,
        glLangCode,
        previousTranslationData,
      );

      //then
      const { confidence, topChoiceText } = getResults(results);
      expect(topChoiceText).toBe(expectedText);
      expect(confidence > 75).toBeTruthy();
    });
  });
});


//
// helpers
//

function getSelectionsText(selections) {
  return (selections || []).map(({ text }) => text).join(' ');
}

function getResults(results) {
  const topChoice = results?.[0];
  const confidence = topChoice?.confidence;
  const selections = topChoice?.selections;
  const topChoiceText = getSelectionsText(selections);
  return { confidence, topChoiceText };
}

const normalizePreviousTranslationData = (
  previousTranslationData
) => {
  if (!previousTranslationData) {
    return previousTranslationData;
  }

  return Object.keys(previousTranslationData).reduce(
    (normalizedData, sourceText) => {
      const normalizedSourceText = normalizer(sourceText);
      const translations = previousTranslationData[sourceText];

      normalizedData[normalizedSourceText] = Object.keys(
        translations || {}
      ).reduce((normalizedTranslations, targetText) => {
        const normalizedTargetText = normalizer(targetText);
        normalizedTranslations[normalizedTargetText] = translations[targetText];
        return normalizedTranslations;
      }, {});

      return normalizedData;
    },
    {}
  );
};

