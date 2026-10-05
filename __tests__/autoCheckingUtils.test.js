/* eslint-env jest */

import { getBestTWordSelectionWithConfidenceAlgorithm } from '../src/utils/autoCheckingUtils';

describe('getBestTWordSelectionWithConfidenceAlgorithm', () => {
  test('Should find match', async () => {
    //given
    const wordList = [
      'Por',
      'lo',
      'tanto',
      'mis',
      'hermanos',
      'cuando',
      'se',
      'reúnan',
      'para',
      'comer',
      'esperen',
      'el',
      'uno',
      'por',
      'el',
      'otro',
    ];
    const targetLangCode = 'es-419';
    const glPhrase = 'coming together';
    const glLangCode = 'en';
    const previousTranslationData = {
      'having been assembled': { 'Cuando reunan': 1 },
      'you come together': { 'cuando reúnen': 1 },
      'in coming together': { 'cuando reúnen': 1 },
      'coming together': { 'cuando reúnen': 1 },
    };

    //when
    const results = await getBestTWordSelectionWithConfidenceAlgorithm(
      wordList,
      targetLangCode,
      glPhrase,
      glLangCode,
      previousTranslationData,
    ) ;

    //then
    const confidence = results?.[0]?.confidence;
    expect(confidence > 75).toBeTruthy();
  });

});


//
// helpers
//
