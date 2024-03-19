/* eslint-env jest */
// helpers
import _ from 'lodash';
import * as gatewayLanguageHelpers from '../src/helpers/gatewayLanguageHelpers';

describe('checkAreayHelpers.bibleIdSort', () => {
  test('Test ordering of Bible IDs - new sort order', () => {
    // given
    const bibleIds = ['asv', 'esv', 'ulb', 'ust', 'ult', 'udb', 'irv', 'aaa', 'zzz', 'glt'];
    const expectedSortedBibleIds = ['glt', 'irv', 'ult', 'ulb', 'aaa', 'asv', 'esv', 'udb', 'ust', 'zzz'];

    // when
    const sortedBibleIds = bibleIds.sort(gatewayLanguageHelpers.bibleIdSort);

    // then
    expect(sortedBibleIds).toEqual(expectedSortedBibleIds);
  });
});

describe('gatewayLanguageHelpers.getAlignedGLText', () => {
  const verseObjects = [
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G14870',
      lemma: 'εἰ',
      morph: 'Gr,CS,,,,,,,,',
      occurrence: 1,
      occurrences: 1,
      content: 'εἴ',
      children: [
        {
          tag: 'zaln',
          type: 'milestone',
          strong: 'G51000',
          lemma: 'τις',
          morph: 'Gr,RI,,,,NMS,',
          occurrence: 1,
          occurrences: 1,
          content: 'τίς',
          children: [
            {
              text: 'An',
              tag: 'w',
              type: 'word',
              occurrence: 1,
              occurrences: 1,
            },
            {
              text: 'elder',
              tag: 'w',
              type: 'word',
              occurrence: 1,
              occurrences: 1,
            },
          ],
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G15100',
      lemma: 'εἰμί',
      morph: 'Gr,V,IPA3,,S,',
      occurrence: 1,
      occurrences: 1,
      content: 'ἐστιν',
      children: [
        {
          text: 'must',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
        {
          text: 'be',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G04100',
      lemma: 'ἀνέγκλητος',
      morph: 'Gr,NP,,,,NMS,',
      occurrence: 1,
      occurrences: 1,
      content: 'ἀνέγκλητος',
      children: [
        {
          text: 'without',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
        {
          text: 'blame',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      type: 'text',
      text: ',',
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G04350',
      lemma: 'ἀνήρ',
      morph: 'Gr,N,,,,,NMS,',
      occurrence: 1,
      occurrences: 1,
      content: 'ἀνήρ',
      children: [
        {
          text: 'the',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
        {
          text: 'husband',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G15200',
      lemma: 'εἷς',
      morph: 'Gr,EN,,,,GFS,',
      occurrence: 1,
      occurrences: 1,
      content: 'μιᾶς',
      children: [
        {
          text: 'of',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 2,
        },
        {
          text: 'one',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G11350',
      lemma: 'γυνή',
      morph: 'Gr,N,,,,,GFS,',
      occurrence: 1,
      occurrences: 1,
      content: 'γυναικὸς',
      children: [
        {
          text: 'wife',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      type: 'text',
      text: ',',
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G21920',
      lemma: 'ἔχω',
      morph: 'Gr,V,PPA,NMS,',
      occurrence: 1,
      occurrences: 1,
      content: 'ἔχων',
      children: [
        {
          text: 'with',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G41030',
      lemma: 'πιστός',
      morph: 'Gr,NS,,,,ANP,',
      occurrence: 1,
      occurrences: 1,
      content: 'πιστά',
      children: [
        {
          text: 'faithful',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G50430',
      lemma: 'τέκνον',
      morph: 'Gr,N,,,,,ANP,',
      occurrence: 1,
      occurrences: 1,
      content: 'τέκνα',
      children: [
        {
          text: 'children',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G33610',
      lemma: 'μή',
      morph: 'Gr,D,,,,,,,,,',
      occurrence: 1,
      occurrences: 1,
      content: 'μὴ',
      children: [
        {
          text: 'not',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G17220',
      lemma: 'ἐν',
      morph: 'Gr,P,,,,,D,,,',
      occurrence: 1,
      occurrences: 1,
      content: 'ἐν',
      children: [
        {
          tag: 'zaln',
          type: 'milestone',
          strong: 'G27240',
          lemma: 'κατηγορία',
          morph: 'Gr,N,,,,,DFS,',
          occurrence: 1,
          occurrences: 1,
          content: 'κατηγορίᾳ',
          children: [
            {
              text: 'accused',
              tag: 'w',
              type: 'word',
              occurrence: 1,
              occurrences: 1,
            },
          ],
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G08100',
      lemma: 'ἀσωτία',
      morph: 'Gr,N,,,,,GFS,',
      occurrence: 1,
      occurrences: 1,
      content: 'ἀσωτίας',
      children: [
        {
          text: 'of',
          tag: 'w',
          type: 'word',
          occurrence: 2,
          occurrences: 2,
        },
        {
          text: 'reckless',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
        {
          text: 'behavior',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G22280',
      lemma: 'ἤ',
      morph: 'Gr,CC,,,,,,,,',
      occurrence: 1,
      occurrences: 1,
      content: 'ἢ',
      children: [
        {
          text: 'or',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      tag: 'zaln',
      type: 'milestone',
      strong: 'G05060',
      lemma: 'ἀνυπότακτος',
      morph: 'Gr,NP,,,,ANP,',
      occurrence: 1,
      occurrences: 1,
      content: 'ἀνυπότακτα',
      children: [
        {
          text: 'undisciplined',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1,
        },
      ],
    },
    {
      type: 'text',
      text: '. \n',
    },
  ];
  const verseObjects2 = replaceTextInVerseObjects(verseObjects, 'blame', 'guilt');_.cloneDeep(verseObjects);

  test('should return text from ult and ignore hi reference in tsv_relation', () => {
    // given
    const contextId = {
      groupId: 'blameless',
      occurrence: 1,
      quote: 'ἀνέγκλητος',
      reference: {
        bookId: 'tit',
        chapter: 1,
        verse: 6,
      },
      strong: ['G04100'],
    };
    const bibles = {
      'ult': { 1: { 6: { verseObjects: verseObjects } } },
      'zzz': { 1: { 6: { verseObjects: verseObjects2 } } },
      'ulb': [],
    };
    const expectedAlignedGLText = 'without blame';
    const tsv_relation = [
      'hi/zzz',
      'en/ust',
      'en/obs',
      'el-x-koine/ugnt?v=0.13',
      'hbo/uhb?v=2.1.14',
    ];
    const glID = 'en';

    // when
    const alignedGLText = gatewayLanguageHelpers.getAlignedGLTextHelper( contextId, bibles, glID, tsv_relation);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });

  test('should return text from ult and ignore hi reference in tsv_relation with multiverse', () => {
    // given
    const contextId = {
      groupId: 'blameless',
      occurrence: 1,
      quote: 'ἀνέγκλητος',
      reference: {
        bookId: 'tit',
        chapter: 1,
        verse: '6-8',
      },
      strong: ['G04100'],
    };
    const bibles = {
      'ult': {
        1: {
          6: { verseObjects: verseObjects },
          7: { verseObjects: verseObjects.slice(0, verseObjects.length-2) }, // make 2nd verse shorter
          8: { verseObjects: verseObjects.slice(0, verseObjects.length-4) }, // make 3rd verse even shorter
        },
      },
      'zzz': { 1: { 6: { verseObjects: verseObjects2 } } },
      'ulb': [],
    };
    const expectedAlignedGLText = 'without blame';
    const tsv_relation = [
      'hi/zzz',
      'en/ust',
      'en/obs',
      'el-x-koine/ugnt?v=0.13',
      'hbo/uhb?v=2.1.14',
    ];
    const glID = 'en';

    // when
    const alignedGLText = gatewayLanguageHelpers.getAlignedGLTextHelper( contextId, bibles, glID, tsv_relation);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });

  test('should return text from tsv_relation and not ult', () => {
    // given
    const contextId = {
      groupId: 'blameless',
      occurrence: 1,
      quote: 'ἀνέγκλητος',
      reference: {
        bookId: 'tit',
        chapter: 1,
        verse: 6,
      },
      strong: ['G04100'],
    };
    const bibles = {
      'ult': { 1: { 6: { verseObjects: verseObjects } } },
      'zzz': { 1: { 6: { verseObjects: verseObjects2 } } },
      'ulb': [],
    };
    const expectedAlignedGLText = 'without guilt';
    const tsv_relation = [
      'en/zzz',
      'en/ust',
      'en/obs',
      'el-x-koine/ugnt?v=0.13',
      'hbo/uhb?v=2.1.14',
    ];
    const glID = 'en';

    // when
    const alignedGLText = gatewayLanguageHelpers.getAlignedGLTextHelper( contextId, bibles, glID, tsv_relation);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });

  test('should return text from ult and NOT the ulb', () => {
    // given
    const contextId = {
      groupId: 'blameless',
      occurrence: 1,
      quote: 'ἀνέγκλητος',
      reference: {
        bookId: 'tit',
        chapter: 1,
        verse: 6,
      },
      strong: ['G04100'],
    };
    const bibles = {
      'ult': { 1: { 6: { verseObjects: verseObjects } } },
      'ulb': [],
    };
    const expectedAlignedGLText = 'without blame';

    // when
    const alignedGLText = gatewayLanguageHelpers.getAlignedGLTextHelper( contextId, bibles);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });

  test('should return text from ulb', () => {
    // given
    const contextId = {
      groupId: 'blameless',
      occurrence: 1,
      quote: 'ἀνέγκλητος',
      reference: {
        bookId: 'tit',
        chapter: 1,
        verse: 6,
      },
      strong: ['G04100'],
    };
    const bibles = { 'ulb': { 1: { 6: { verseObjects: verseObjects } } } };
    const expectedAlignedGLText = 'without blame';

    // when
    const alignedGLText = gatewayLanguageHelpers.getAlignedGLTextHelper( contextId, bibles);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });

  test('should handle array of words for quote', () => {
    // given
    const verseObjects = [
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G24430',
        'lemma': 'ἵνα',
        'morph': 'Gr,CS,,,,,,,,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'ἵνα',
        'children': [
          {
            'text': 'that',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G20680',
        'lemma': 'ἐσθίω',
        'morph': 'Gr,V,SPA2,,P,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'ἔσθητε',
        'children': [
          {
            'text': 'you',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 2,
          },
          {
            'text': 'may',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
          {
            'text': 'eat',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G25320',
        'lemma': 'καί',
        'morph': 'Gr,CC,,,,,,,,',
        'occurrence': 1,
        'occurrences': 2,
        'content': 'καὶ',
        'children': [
          {
            'text': 'and',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 2,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G40950',
        'lemma': 'πίνω',
        'morph': 'Gr,V,SPA2,,P,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'πίνητε',
        'children': [
          {
            'text': 'drink',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G19090',
        'lemma': 'ἐπί',
        'morph': 'Gr,P,,,,,G,,,',
        'occurrence': 1,
        'occurrences': 2,
        'content': 'ἐπὶ',
        'children': [
          {
            'text': 'at',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G14730',
        'lemma': 'ἐγώ',
        'morph': 'Gr,RP,,,1G,S,',
        'occurrence': 1,
        'occurrences': 2,
        'content': 'μου',
        'children': [
          {
            'text': 'my',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 2,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G35880',
        'lemma': 'ὁ',
        'morph': 'Gr,EA,,,,GFS,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'τῆς',
        'children': [
          {
            'tag': 'zaln',
            'type': 'milestone',
            'strong': 'G51320',
            'lemma': 'τράπεζα',
            'morph': 'Gr,N,,,,,GFS,',
            'occurrence': 1,
            'occurrences': 1,
            'content': 'τραπέζης',
            'children': [
              {
                'text': 'table',
                'tag': 'w',
                'type': 'word',
                'occurrence': 1,
                'occurrences': 1,
              },
            ],
            'endTag': 'zaln-e\\*',
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G17220',
        'lemma': 'ἐν',
        'morph': 'Gr,P,,,,,D,,,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'ἐν',
        'children': [
          {
            'text': 'in',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G14730',
        'lemma': 'ἐγώ',
        'morph': 'Gr,RP,,,1G,S,',
        'occurrence': 2,
        'occurrences': 2,
        'content': 'μου',
        'children': [
          {
            'text': 'my',
            'tag': 'w',
            'type': 'word',
            'occurrence': 2,
            'occurrences': 2,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G35880',
        'lemma': 'ὁ',
        'morph': 'Gr,EA,,,,DFS,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'τῇ',
        'children': [
          {
            'tag': 'zaln',
            'type': 'milestone',
            'strong': 'G09320',
            'lemma': 'βασιλεία',
            'morph': 'Gr,N,,,,,DFS,',
            'occurrence': 1,
            'occurrences': 1,
            'content': 'βασιλείᾳ',
            'children': [
              {
                'text': 'kingdom',
                'tag': 'w',
                'type': 'word',
                'occurrence': 1,
                'occurrences': 1,
              },
            ],
            'endTag': 'zaln-e\\*',
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'type': 'text',
        'text': ',',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G25320',
        'lemma': 'καί',
        'morph': 'Gr,CC,,,,,,,,',
        'occurrence': 2,
        'occurrences': 2,
        'content': 'καὶ',
        'children': [
          {
            'text': 'and',
            'tag': 'w',
            'type': 'word',
            'occurrence': 2,
            'occurrences': 2,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G25210',
        'lemma': 'κάθημαι',
        'morph': 'Gr,V,IPM2,,P,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'καθῆσθε',
        'children': [
          {
            'text': 'you',
            'tag': 'w',
            'type': 'word',
            'occurrence': 2,
            'occurrences': 2,
          },
          {
            'text': 'will',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
          {
            'text': 'sit',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G19090',
        'lemma': 'ἐπί',
        'morph': 'Gr,P,,,,,G,,,',
        'occurrence': 2,
        'occurrences': 2,
        'content': 'ἐπὶ',
        'children': [
          {
            'text': 'on',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G23620',
        'lemma': 'θρόνος',
        'morph': 'Gr,N,,,,,GMP,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'θρόνων',
        'children': [
          {
            'text': 'thrones',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G29190',
        'lemma': 'κρίνω',
        'morph': 'Gr,V,PPA,NMP,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'κρίνοντες',
        'children': [
          {
            'text': 'judging',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G35880',
        'lemma': 'ὁ',
        'morph': 'Gr,EA,,,,AFP,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'τὰς',
        'children': [
          {
            'text': 'the',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G14270',
        'lemma': 'δώδεκα',
        'morph': 'Gr,EN,,,,AFP,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'δώδεκα',
        'children': [
          {
            'text': 'twelve',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G54430',
        'lemma': 'φυλή',
        'morph': 'Gr,N,,,,,AFP,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'φυλὰς',
        'children': [
          {
            'text': 'tribes',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G35880',
        'lemma': 'ὁ',
        'morph': 'Gr,EA,,,,GMS,',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'τοῦ',
        'children': [
          {
            'text': 'of',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'tag': 'zaln',
        'type': 'milestone',
        'strong': 'G24740',
        'lemma': 'Ἰσραήλ',
        'morph': 'Gr,N,,,,,GMSI',
        'occurrence': 1,
        'occurrences': 1,
        'content': 'Ἰσραήλ',
        'children': [
          {
            'text': 'Israel',
            'tag': 'w',
            'type': 'word',
            'occurrence': 1,
            'occurrences': 1,
          },
        ],
        'endTag': 'zaln-e\\*',
      },
      {
        'type': 'text',
        'text': '.',
      },
      {
        'tag': 's5',
        'nextChar': '\n',
        'type': 'section',
      },
      {
        'tag': 'p',
        'type': 'paragraph',
        'text': ' \n',
      },
    ];
    const contextId = {
      'reference': {
        'bookId': 'luk',
        'chapter': 22,
        'verse': 30,
      },
      'groupId': '12tribesofisrael',
      'quote': [
        {
          'word': 'δώδεκα',
          'occurrence': 1,
        },
        {
          'word': 'φυλὰς',
          'occurrence': 1,
        },
        {
          'word': 'κρίνοντες',
          'occurrence': 1,
        },
        {
          'word': 'τοῦ',
          'occurrence': 1,
        },
        {
          'word': 'Ἰσραήλ',
          'occurrence': 1,
        },
      ],
      'strong': [
        'G14270',
        'G54430',
        'G29190',
        'G35880',
        'G24740',
      ],
      'occurrence': 1,
    };
    const bibles = { 'ult': { 22: { 30: { verseObjects: verseObjects } } } };
    const expectedAlignedGLText = 'judging & twelve tribes of Israel';

    // when
    const alignedGLText = gatewayLanguageHelpers.getAlignedGLTextHelper( contextId, bibles);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });
});

//
// Helpers
//

function replaceTextInVerseObjects(verseObjects, findText, replaceText) {
  const verseObjects_ = _.cloneDeep(verseObjects);

  for (let verseObject of verseObjects_) {
    if (verseObject.text === findText) {
      verseObject.text = replaceText;
    }

    if (verseObject.children) { // check for nesting
      const newChildren = replaceTextInVerseObjects(verseObject.children, findText, replaceText);
      verseObject.children = newChildren;
    }
  }
  return verseObjects_;
}
