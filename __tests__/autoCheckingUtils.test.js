/* eslint-env jest */

import { normalizer } from 'string-punctuation-tokenizer';
import { getBestTWordSelectionWithConfidenceAlgorithm, getWordList } from '../src/utils/autoCheckingUtils';
import viTranslationData from './__fixtures__/tWords/vi_translationData.json';

const fullViHistory = viTranslationData['ἅγια'].selections;
const VERSE_HEB_9_12 = 'cũng chẳng phải bởi huyết của dê đực và bò con, nhưng bởi huyết của chính mình, Ngài đã vào trong các nơi thánh một lần đủ cả, tự mình kiếm được sự cứu chuộc đời đời.';
const VERSE_HEB_12_10 = 'Vì dù cha phần xác sửa dạy chúng ta trong ít ngày theo điều dường như là tốt nhất đối với họ, nhưng Cha phần tâm linh sửa dạy vì cớ đem ích lợi cho chúng ta, để dự phần vào sự thánh khiết của Ngài.';
const VERSE_ES_FAITH = 'Por la fe Abraham obedeció y la ley fue dada';

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
        'Holy': { 'Nơi Thánh': 1 },
        'the Holy': { 'Nơi Thánh': 1 },
        'sanctification': { 'sự nên thánh': 1 },
      });
      const wordList = getWordList(normalizer(verseText));
      const expectedText = normalizer('sự thánh');

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
      expect(confidence >= 50 && confidence < 80).toBeTruthy();
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

  describe('partial GL match', () => {
    test('pools renderings from every related key (vi, Heb 9:12, full history)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm(VERSE_HEB_9_12, normalizer('holy places'), fullViHistory);
      expect(topChoiceText).toBe(normalizer('các nơi thánh'));
      expectInRange(confidence, 85, 95);
    });

    test('is independent of history key order (es)', async () => {
      const lawFirst = await runAlgorithm(VERSE_ES_FAITH, 'the faith', { 'the law': { 'la ley': 3 }, 'faith': { 'fe': 5 } });
      const faithFirst = await runAlgorithm(VERSE_ES_FAITH, 'the faith', { 'faith': { 'fe': 5 }, 'the law': { 'la ley': 3 } });
      expect(lawFirst.topChoiceText).toBe('fe');
      expectInRange(lawFirst.confidence, 85, 95);
      expect(faithFirst.topChoiceText).toBe('fe');
      expectInRange(faithFirst.confidence, 85, 95);
    });

    test('is independent of history key order (hi, Devanagari; made-up data)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm(
        'विश्वास से हम समझते हैं कि व्यवस्था दी गई',
        'the faith',
        { 'the law': { 'व्यवस्था': 3 }, 'faith': { 'विश्वास': 5 } },
      );
      expect(topChoiceText).toBe(normalizer('विश्वास'));
      expectInRange(confidence, 85, 95);
    });

    test('never reports 100 through a partial key (es)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm('por la fe Abraham', 'by faith', { 'faith': { 'la fe': 3 } });
      expect(topChoiceText).toBe('la fe');
      expectInRange(confidence, 82, 95);
    });

    test('uses the most-used group rendering when the GL phrase is only morphologically related (vi, Heb 12:10, full history)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm(VERSE_HEB_12_10, 'holiness', fullViHistory);
      expect(topChoiceText).toBe(normalizer('thánh khiết'));
      expectInRange(confidence, 80, 90);
    });
  });

  describe('fuzzy target match', () => {
    test('matches a compound target word by shared prefix (de-like, made-up data)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm(
        'und die Kirchengemeinde versammelte sich',
        'the church',
        { 'church': { 'Kirche': 4 } },
      );
      expect(topChoiceText).toBe('Kirchengemeinde');
      expectInRange(confidence, 60, 80);
    });

    test('does not fuzzy-match a short target word (vi, Heb 12:10, 3-key history)', async () => {
      const {
        confidence, topChoiceText, results,
      } = await runAlgorithm(
        VERSE_HEB_12_10,
        'holiness',
        normalizePreviousTranslationData({
          'Holy': { 'Nơi Thánh': 1 },
          'the Holy': { 'Nơi Thánh': 1 },
          'sanctification': { 'sự nên thánh': 1 },
        }),
      );
      expect(topChoiceText).toBe(normalizer('sự thánh'));
      expectInRange(confidence, 50, 79);
      const withVoi = results.filter(({ selections }) => getSelectionsText(selections).includes(normalizer('với')));
      expect(withVoi).toEqual([]);
    });
  });

  describe('scoring', () => {
    test('discounts a fragment made only of repeated verse words (es)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm('la casa de la madre y la hija', 'church', { 'church': { 'la iglesia': 5 } });
      expect(topChoiceText).toBe('la');
      expect(confidence < 30).toBeTruthy();
    });
  });

  describe('performance', () => {
    // the algorithm runs synchronously, so a jest timeout cannot interrupt it; time it directly instead
    test('handles a verse that repeats a rendering word many times', async () => {
      const wordList = getWordList(Array(36).fill('a b').join(' '));
      const start = Date.now();
      const results = await getBestTWordSelectionWithConfidenceAlgorithm(
        wordList, 'xx', 'x', 'en', { 'x': { 'a b a b a b a b c': 1 } },
      );
      const elapsed = Date.now() - start;
      expect(results.length > 0).toBeTruthy();
      expect(elapsed).toBeLessThan(2000);
    }, 60000);
  });

  describe('regression', () => {
    test('exact GL key and verbatim rendering still score 100 (es)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm(
        'para la iglesia de Éfeso',
        'church',
        { 'church': { 'la iglesia': 7, 'congregación': 2 } },
      );
      expect(topChoiceText).toBe('la iglesia');
      expect(confidence).toBe(100);
    });

    test('inflected target word through the exact key (hi, made-up)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm('सब विश्वासी एक साथ थे', 'faith', { 'faith': { 'विश्वास': 5 } });
      expect(topChoiceText).toBe(normalizer('विश्वासी'));
      expectInRange(confidence, 75, 90);
    });

    test('finds the outer words when the middle word is missing (vi)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm(
        'để dự phần vào sự thánh khiết của Ngài',
        'sanctification',
        { 'sanctification': { 'sự nên thánh': 1 } },
      );
      expect(topChoiceText).toBe(normalizer('sự thánh'));
      expectInRange(confidence, 50, 79);
    });

    test('fuzzy inflection in a non-Latin script (el, made-up)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm('ο θεός αγαπά τους πιστούς', 'the faithful', { 'faithful': { 'πιστοί': 2 } });
      expect(topChoiceText).toBe(normalizer('πιστούς'));
      expectInRange(confidence, 65, 80);
    });

    test('keeps finding an adjacent swap of a known rendering (ru-like, made-up)', async () => {
      const { confidence, topChoiceText } = await runAlgorithm('и дух святой сошёл', 'holy spirit', { 'holy spirit': { 'святой дух': 3 } });
      expect(topChoiceText).toBe(normalizer('дух святой'));
      expectInRange(confidence, 80, 90);
    });
  });
});


//
// helpers
//

async function runAlgorithm(verseText, glPhrase, previousTranslationData) {
  const wordList = getWordList(normalizer(verseText));
  const results = await getBestTWordSelectionWithConfidenceAlgorithm(
    wordList,
    'xx',
    glPhrase,
    'en',
    previousTranslationData,
  );
  return { ...getResults(results), results };
}

function expectInRange(value, min, max) {
  expect(value).toBeGreaterThanOrEqual(min);
  expect(value).toBeLessThanOrEqual(max);
}

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

