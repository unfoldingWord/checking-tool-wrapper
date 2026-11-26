/* eslint-env jest */

import { normalizer } from 'string-punctuation-tokenizer';
import {
  getBestSelections,
  getBestTWordSelectionWithConfidenceAlgorithm,
  moveSelectionsToOccurrence,
  getQuoteStringKey,
  getWordList,
  normalizeForCompare,
  toLowerCaseForLang,
} from '../src/utils/checkingSuggestionsUtils';
import viTranslationData from './__fixtures__/tWords/vi_translationData.json';

const fullViHistory = viTranslationData['ἅγια'].selections;
const VERSE_HEB_9_12 = 'cũng chẳng phải bởi huyết của dê đực và bò con, nhưng bởi huyết của chính mình, Ngài đã vào trong các nơi thánh một lần đủ cả, tự mình kiếm được sự cứu chuộc đời đời.';
const VERSE_HEB_12_10 = 'Vì dù cha phần xác sửa dạy chúng ta trong ít ngày theo điều dường như là tốt nhất đối với họ, nhưng Cha phần tâm linh sửa dạy vì cớ đem ích lợi cho chúng ta, để dự phần vào sự thánh khiết của Ngài.';
const VERSE_ES_FAITH = 'Por la fe Abraham obedeció y la ley fue dada';
const VERSE_ES_COMING_TOGETHER = 'Por lo tanto mis hermanos cuando se reúnan para comer esperen el uno por el otro';

// each row: [test name, verse text, GL phrase, previous translation history, expected top choice, min confidence, max confidence]
// expected top choice is passed through `normalizer` before comparing
// on failure the error message starts with the row name and shows the inputs and the results returned,
// since jest 24 has no custom assertion messages
const checkTopChoice = async (name, verseText, glPhrase, history, expectedText, min, max) => {
  const {
    confidence, topChoiceText, results,
  } = await runAlgorithm(verseText, glPhrase, history);

  try {
    expect(topChoiceText).toBe(normalizer(expectedText));
    expectInRange(confidence, min, max);
  } catch (error) {
    const returned = results.map(({ selections, confidence: c }) => `"${getSelectionsText(selections)}" (${c})`).join(', ');

    error.message = [
      `Failed: ${name}`,
      `  verse: ${verseText}`,
      `  GL phrase: ${glPhrase}`,
      `  expected: "${normalizer(expectedText)}" with confidence ${min}-${max}`,
      `  returned: ${returned || 'nothing'}`,
      '',
      error.message,
    ].join('\n');
    throw error;
  }
};

// Confidences follow `scoreSuggestionFromHistory` (plans/algorithm-confidence.md): closeness to the
// history rendering x GL-key weight x verse checks, 100 only for a certain match. A rendering reached
// through a related GL key scores 36-60% of an exact-key match, so the related-key cases below are low.
describe('getBestTWordSelectionWithConfidenceAlgorithm', () => {
  describe('existing translation history', () => {
    test.each([
      [
        'vi Heb 9:12, 3-key history',
        VERSE_HEB_9_12,
        normalizer('holy places'),
        {
          'Holy': { 'Nơi Thánh': 1 },
          'the Holy': { 'Nơi Thánh': 1 },
          'holy place': { 'một nơi thánh': 1 },
        },
        'nơi thánh', 40, 60, // related keys only; 51
      ],
      [
        'es-419 with the exact GL key (perfect)',
        VERSE_ES_COMING_TOGETHER,
        'coming together',
        normalizePreviousTranslationData({
          'having been assembled': { 'Cuando reunan': 1 },
          'you come together': { 'cuando reúnen': 1 },
          'in coming together': { 'cuando reúnen': 1 },
          'coming together': { 'cuando reúnen': 1 },
        }),
        'cuando reúnan', 35, 55, // a fuzzy match (reúnen/reúnan); 43
      ],
      [
        'es-419 without the exact GL key (imperfect)',
        VERSE_ES_COMING_TOGETHER,
        'coming together',
        normalizePreviousTranslationData({
          'having been assembled': { 'Cuando reunan': 1 },
          'you come together': { 'cuando reúnen': 1 },
          'in coming together': { 'cuando reúnen': 1 },
        }),
        'cuando reúnan', 20, 40, // fuzzy and through a related key; 29
      ],
    ])('Should find match - %s', checkTopChoice);
  });

  describe('partial GL match', () => {
    test.each([
      [
        'pools renderings from every related key (vi, Heb 9:12, full history)',
        VERSE_HEB_9_12, normalizer('holy places'), fullViHistory,
        'các nơi thánh', 30, 50, // related key, and other history renderings are in the verse; 40
      ],
      [
        'is independent of history key order - law first (es)',
        VERSE_ES_FAITH, 'the faith', { 'the law': { 'la ley': 3 }, 'faith': { 'fe': 5 } },
        'fe', 30, 50, // related key and 'la ley' also in the verse; 'la' is not an exact-key word; 40
      ],
      [
        'is independent of history key order - faith first (es)',
        VERSE_ES_FAITH, 'the faith', { 'faith': { 'fe': 5 }, 'the law': { 'la ley': 3 } },
        'fe', 30, 50, // as above, whatever the key order; 40
      ],
      [
        'is independent of history key order (hi, Devanagari; made-up data)',
        'विश्वास से हम समझते हैं कि व्यवस्था दी गई', 'the faith', { 'the law': { 'व्यवस्था': 3 }, 'faith': { 'विश्वास': 5 } },
        'विश्वास', 30, 50, // related key, another history rendering in the verse; 40
      ],
      [
        'never reports 100 through a partial key (es)',
        'por la fe Abraham', 'by faith', { 'faith': { 'la fe': 3 } },
        'la fe', 45, 70, // related key: never 100; 58
      ],
      [
        'uses the most-used group rendering when the GL phrase is only morphologically related (vi, Heb 12:10, full history)',
        VERSE_HEB_12_10, 'holiness', fullViHistory,
        'thánh khiết', 25, 45, // related key, other history renderings in the verse; 36
      ],
    ])('%s', checkTopChoice);
  });

  describe('fuzzy target match', () => {
    test.each([
      [
        'matches a compound target word by shared prefix (de-like, made-up data)',
        'und die Kirchengemeinde versammelte sich', 'the church', { 'church': { 'Kirche': 4 } },
        'Kirchengemeinde', 45, 70, // fuzzy through a related key; 58
      ],
    ])('%s', checkTopChoice);

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
      expectInRange(confidence, 5, 25); // part of a rendering, through related keys; 12
      const withVoi = results.filter(({ selections }) => getSelectionsText(selections).includes(normalizer('với')));
      expect(withVoi).toEqual([]);
    });
  });

  describe('scoring', () => {
    test.each([
      [
        'discounts a fragment made only of repeated verse words (es)',
        'la casa de la madre y la hija', 'church', { 'church': { 'la iglesia': 5 } },
        'la', 0, 29,
      ],
    ])('%s', checkTopChoice);
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
    test.each([
      [
        'exact GL key and verbatim rendering still score 100 (es)',
        'para la iglesia de Éfeso', 'church', { 'church': { 'la iglesia': 7, 'congregación': 2 } },
        'la iglesia', 100, 100,
      ],
      [
        'is not certain from a rendering chosen fewer than 5 times (es)',
        'para la iglesia de Éfeso', 'church', { 'church': { 'la iglesia': 4 } },
        'la iglesia', 99, 99, // exact key and verbatim, but too little history for 100
      ],
      [
        'is not certain when the rendering occurs twice in the verse (es)',
        'la iglesia de Dios y la iglesia de Éfeso', 'church', { 'church': { 'la iglesia': 7 } },
        'la iglesia', 45, 55, // another occurrence may be meant (x 0.5); 50
      ],
      [
        'is not certain when another history rendering is in the verse (es)',
        'la iglesia y la congregación de Éfeso', 'church', { 'church': { 'la iglesia': 7, 'la congregación': 3 } },
        'la iglesia', 65, 75, // which rendering is meant is unclear (x 0.7); 70
      ],
      [
        'inflected target word through the exact key (hi, made-up)',
        'सब विश्वासी एक साथ थे', 'faith', { 'faith': { 'विश्वास': 5 } },
        'विश्वासी', 75, 90,
      ],
      [
        'finds the outer words when the middle word is missing (vi)',
        'để dự phần vào sự thánh khiết của Ngài', 'sanctification', { 'sanctification': { 'sự nên thánh': 1 } },
        'sự thánh', 25, 45, // two of three words, around a gap; 33
      ],
      [
        'fuzzy inflection in a non-Latin script (el, made-up)',
        'ο θεός αγαπά τους πιστούς', 'the faithful', { 'faithful': { 'πιστοί': 2 } },
        'πιστούς', 45, 70, // fuzzy through a related key; 58
      ],
      [
        'keeps finding an adjacent swap of a known rendering (ru-like, made-up)',
        'и дух святой сошёл', 'holy spirit', { 'holy spirit': { 'святой дух': 3 } },
        'дух святой', 20, 40, // swapped words; 30
      ],
    ])('%s', checkTopChoice);
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

describe('toLowerCaseForLang', () => {
  // each row: [test name, text, language code, expected]
  test.each([
    ['no language uses default rules', 'Işık İstanbul', undefined, 'işık i̇stanbul'],
    ['empty language uses default rules', 'Işık', '', 'işık'],
    ['Turkish dotless and dotted I', 'Işık İstanbul', 'tr', 'ışık istanbul'],
    ['Turkish with region', 'Işık', 'tr-TR', 'ışık'],
    ['Azerbaijani with script', 'Işıq', 'az-Latn', 'ışıq'],
    ['Lithuanian keeps the dot before an accent', 'Ì', 'lt', 'i̇̀'],
    ['upper-case language code', 'Işık', 'TR', 'ışık'],
    ['Spanish with region', 'Por La Fe', 'es-419', 'por la fe'],
    ['Koine Greek', 'Πίστεως ΟΣ', 'el-x-koine', 'πίστεως ος'],
    ['Hebrew has no case', 'בְּרֵאשִׁ֖ית', 'hbo', 'בְּרֵאשִׁ֖ית'],
    ['unknown three-letter code', 'Iglesia', 'qaa', 'iglesia'],
  ])('%s', (name, text, langId, expected) => {
    expect(toLowerCaseForLang(text, langId)).toBe(expected);
  });

  // `normalizer` also changes Unicode composition (e.g. 'ş'), so compare against normalized text
  test('normalizeForCompare passes the language through', () => {
    expect(normalizeForCompare('Işık', 'tr')).toBe(normalizer('ışık'));
    expect(normalizeForCompare('Işık')).toBe(normalizer('işık'));
  });

  test('getQuoteStringKey picks Greek or Hebrew from the book', () => {
    expect(getQuoteStringKey({ reference: { bookId: 'gal' }, quote: [{ word: 'Τῇ' }, { word: 'Πίστει' }] })).toBe('τῇ πίστει');
    expect(getQuoteStringKey({ reference: { bookId: 'gen' }, quoteString: 'בְּרֵאשִׁ֖ית' })).toBe('בְּרֵאשִׁ֖ית');
    expect(getQuoteStringKey({ reference: { bookId: 'gal' } })).toBe('');
  });
});

// a function declaration (not a const) so the test.each tables above can call it while jest collects tests
function normalizePreviousTranslationData(previousTranslationData) {
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
}

describe('moveSelectionsToOccurrence', () => {
  const verse = ['Dios', 'amó', 'al', 'mundo', 'y', 'Dios', 'envió', 'a', 'su', 'Hijo', 'al', 'mundo'];
  const alMundo = [{ text: 'al', occurrence: 1 }, { text: 'mundo', occurrence: 1 }];

  test.each([
    ['occurrence 1 leaves the selections alone', [{ text: 'Dios', occurrence: 1 }], 1, [{ text: 'Dios', occurrence: 1 }]],
    ['occurrence 2 moves one word', [{ text: 'Dios', occurrence: 1 }], 2, [{ text: 'Dios', occurrence: 2 }]],
    ['occurrence 2 moves a run of words', alMundo, 2, [{ text: 'al', occurrence: 2 }, { text: 'mundo', occurrence: 2 }]],
    ['more occurrences than the verse has leaves them alone', [{ text: 'Dios', occurrence: 1 }], 3, [{ text: 'Dios', occurrence: 1 }]],
    ['non-adjacent selections are left alone', [{ text: 'Dios', occurrence: 1 }, { text: 'mundo', occurrence: 1 }], 2,
      [{ text: 'Dios', occurrence: 1 }, { text: 'mundo', occurrence: 1 }]],
    ['selections not at the first run are left alone', [{ text: 'Dios', occurrence: 2 }], 2, [{ text: 'Dios', occurrence: 2 }]],
  ])('%s', (_, selections, occurrence, expected) => {
    expect(moveSelectionsToOccurrence(selections, verse, occurrence)).toEqual(expected);
  });

  test('getBestSelections suggests the check\'s occurrence of a repeated word', async () => {
    const [result] = await getBestSelections({
      verseText: 'Dios amó al mundo y Dios envió a su Hijo',
      targetLanguageDetails: { id: 'es-419' },
      alignedGLText: 'God',
      gatewayLanguageCode: 'en',
      selectionsData: { selections: { God: { Dios: 9 } } },
      contextId: { occurrence: 2 },
    });

    expect(result.bestSelections[0].selections).toEqual([{ text: 'Dios', occurrence: 2 }]);
  });
});

describe('getBestTWordSelectionWithConfidenceAlgorithm explain', () => {
  const words = getWordList('la iglesia de Dios y la iglesia de Éfeso');
  const history = { 'church': { 'la iglesia': 7, 'congregación': 2 }, 'the churches': { 'las iglesias': 1 } };

  test('without explain the options have no features', async () => {
    const options = await getBestTWordSelectionWithConfidenceAlgorithm(words, 'es-419', 'church', 'en', history);

    expect(options[0]).toEqual({
      selections: [{ text: 'la', occurrence: 1 }, { text: 'iglesia', occurrence: 1 }],
      confidence: 50, // not certain: 'la iglesia' occurs twice in the verse (x 0.5)
    });
  });

  test('explain keeps the options and adds how each was found', async () => {
    const plain = await getBestTWordSelectionWithConfidenceAlgorithm(words, 'es-419', 'church', 'en', history);
    const explained = await getBestTWordSelectionWithConfidenceAlgorithm(words, 'es-419', 'church', 'en', history, { explain: true });

    expect(explained.map(({ selections, confidence }) => ({ selections, confidence }))).toEqual(plain);
    expect(explained[0].features).toMatchObject({
      path: 'verbatim',
      exactKey: true,
      count: 7,
      share: 0.7, // 7 of 10 pooled uses
      usageRank: 0,
      renderings: 3,
      renderingWords: 2,
      matchedWords: 2,
      gap: 0,
      similarity: 1,
      runsInVerse: 2, // 'la iglesia' occurs twice
      neighbourInHistory: 0,
      pointScore: 100,
      cap: 100,
      verbatimRenderings: 1,
      rank: 0,
    });
  });

  test('explain reports partial, related-key and fuzzy matches', async () => {
    const [partial] = await getBestTWordSelectionWithConfidenceAlgorithm(
      getWordList('para la gran iglesia'), 'es-419', 'church', 'en', { church: { 'la iglesia': 3 } }, { explain: true });
    const [related] = await getBestTWordSelectionWithConfidenceAlgorithm(
      words, 'es-419', 'church', 'en', { 'churches of God': { 'iglesia de Dios': 2 } }, { explain: true });
    const [fuzzy] = await getBestTWordSelectionWithConfidenceAlgorithm(
      getWordList('las iglesias de Galacia'), 'es-419', 'church', 'en', { church: { iglesia: 4 } }, { explain: true });

    expect(partial.features).toMatchObject({
      path: 'ordered', matchedWords: 2, gap: 1,
    });
    expect(related.features).toMatchObject({ path: 'verbatim', exactKey: false });
    expect(related.features.relatedness).toBeGreaterThan(0);
    expect(related.features.cap).toBeLessThan(100);
    expect(fuzzy.features.path).toBe('fuzzy');
    expect(fuzzy.features.similarity).toBeLessThan(1);
  });
});


describe('getBestTWordSelectionWithConfidenceAlgorithm with an original-language history', () => {
  const words = getWordList('Por la fe Abraham obedeció y creyó');
  // 'by faith' is related to 'faith' but not the exact key
  const history = { 'by faith': { fe: 2, creyó: 3 } };
  const olHistory = {
    keys: { lemma: 'πίστις', form: 'πιστει' },
    lemma: { 'πίστις': { fe: 2 } },
    form: { 'πιστει': { fe: 2 } },
  };

  test('gives the same options without an OL history', async () => {
    const plain = await getBestTWordSelectionWithConfidenceAlgorithm(words, 'es', 'faith', 'en', history, { explain: true });
    const withNull = await getBestTWordSelectionWithConfidenceAlgorithm(words, 'es', 'faith', 'en', history, { explain: true, olHistory: null });
    expect(withNull).toEqual(plain);
    expect(plain[0].features).not.toHaveProperty('olKey');
  });

  test('a rendering chosen for the OL form gets the form weight', async () => {
    const plain = await getBestTWordSelectionWithConfidenceAlgorithm(words, 'es', 'faith', 'en', history, { explain: true });
    const results = await getBestTWordSelectionWithConfidenceAlgorithm(words, 'es', 'faith', 'en', history, { explain: true, olHistory });
    const fe = results.find(option => option.selections[0].text === 'fe');
    const plainFe = plain.find(option => option.selections[0].text === 'fe');
    expect(fe.features).toMatchObject({ olKey: 'form', olFormInHistory: true });
    expect(fe.confidence).toBeGreaterThan(plainFe.confidence);
    expect(results[0].selections).toEqual([{ text: 'fe', occurrence: 1 }]);
  });

  test('the lemma weight is used when only the lemma matches, and weights can be overridden', async () => {
    const lemmaOnly = { ...olHistory, form: {} };
    const results = await getBestTWordSelectionWithConfidenceAlgorithm(words, 'es', 'faith', 'en', history, {
      explain: true, olHistory: lemmaOnly, olKeyWeights: { lemma: 0.9 },
    });
    const fe = results.find(option => option.selections[0].text === 'fe');
    expect(fe.features).toMatchObject({ olKey: 'lemma', olFormInHistory: false });
    expect(fe.confidence).toBe(63); // 100 x 0.9 x 0.7 (creyó, another rendering, is in the verse too)
  });

  test('a rendering only the OL history has joins the pool', async () => {
    const results = await getBestTWordSelectionWithConfidenceAlgorithm(words, 'es', 'faith', 'en', {}, { olHistory });
    expect(results[0]).toEqual({ selections: [{ text: 'fe', occurrence: 1 }], confidence: 70 }); // the form weight
  });
});
