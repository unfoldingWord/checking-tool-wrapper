/* eslint-env jest */
import * as checkAreaHelpers from '../src/helpers/checkAreaHelpers';

describe('checkAreaHelpers.getAlignedGLText', () => {
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
              occurrences: 1
            },
            {
              text: 'elder',
              tag: 'w',
              type: 'word',
              occurrence: 1,
              occurrences: 1
            }
          ]
        }
      ]
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
          occurrences: 1
        },
        {
          text: 'be',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1
        }
      ]
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
          occurrences: 1
        },
        {
          text: 'blame',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1
        }
      ]
    },
    {
      type: 'text',
      text: ','
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
          occurrences: 1
        },
        {
          text: 'husband',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1
        }
      ]
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
          occurrences: 2
        },
        {
          text: 'one',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1
        }
      ]
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
          occurrences: 1
        }
      ]
    },
    {
      type: 'text',
      text: ','
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
          occurrences: 1
        }
      ]
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
          occurrences: 1
        }
      ]
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
          occurrences: 1
        }
      ]
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
          occurrences: 1
        }
      ]
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
              occurrences: 1
            }
          ]
        }
      ]
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
          occurrences: 2
        },
        {
          text: 'reckless',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1
        },
        {
          text: 'behavior',
          tag: 'w',
          type: 'word',
          occurrence: 1,
          occurrences: 1
        }
      ]
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
          occurrences: 1
        }
      ]
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
          occurrences: 1
        }
      ]
    },
    {
      type: 'text',
      text: '. \n'
    }
  ];

  it('should return text from ult and NOT the ulb', () => {
    // given
    const currentProjectToolsSelectedGL = {
      translationWords: 'en',
      currentToolName: 'translationWords'
    };
    const contextId = {
      groupId: 'blameless',
      occurrence: 1,
      quote: 'ἀνέγκλητος',
      reference: {
        bookId: 'tit',
        chapter: 1,
        verse: 6
      },
      strong: ['G04100'],
      tool: 'translationWords'
    };
    const bibles = {
      en: {
        'ult': {
          1: {
            6: {
              verseObjects: verseObjects
            }
          }
        },
        'ulb': []
      }
    };
    const currentToolName = 'translationWords';
    const expectedAlignedGLText = 'without blame';

      // when
    const alignedGLText = checkAreaHelpers.getAlignedGLText(currentProjectToolsSelectedGL, contextId, bibles, currentToolName);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });

  it('should return text from ulb', () => {
    // given
    const currentProjectToolsSelectedGL = {
      translationWords: 'en',
      currentToolName: 'translationWords'
    };
    const contextId = {
      groupId: 'blameless',
      occurrence: 1,
      quote: 'ἀνέγκλητος',
      reference: {
        bookId: 'tit',
        chapter: 1,
        verse: 6
      },
      strong: ['G04100'],
      tool: 'translationWords'
    };
    const bibles = {
      en: {
        'ulb': {
          1: {
            6: {
              verseObjects: verseObjects
            }
          }
        }
      }
    };
    const currentToolName = 'translationWords';
    const expectedAlignedGLText = 'without blame';

      // when
    const alignedGLText = checkAreaHelpers.getAlignedGLText(currentProjectToolsSelectedGL, contextId, bibles, currentToolName);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });

  it('should valid string from ult for twelve tribes', () => {
    // given
    const currentProjectToolsSelectedGL = {
      translationWords: 'en',
      currentToolName: 'translationWords'
    };
    const contextId = {
      "reference": {
        "bookId": "mat",
        "chapter": 19,
        "verse": 28
      },
      "tool": "translationWords",
      "groupId": "12tribesofisrael",
      "quote": [
        {
          "word": "δώδεκα",
          "occurrence": 2
        },
        {
          "word": "φυλὰς",
          "occurrence": 1
        },
        {
          "word": "τοῦ",
          "occurrence": 2
        },
        {
          "word": "Ἰσραήλ",
          "occurrence": 1
        }
      ],
      "strong": [
        "G14270",
        "G54430",
        "G35880",
        "G24740"
      ],
      "occurrence": 1
    };
    const verseObjects = [
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G35880",
        "lemma": "ὁ",
        "morph": "Gr,EA,,,,NMS,",
        "occurrence": 1,
        "occurrences": 2,
        "content": "ὁ",
        "children": [
          {
            "tag": "zaln",
            "type": "milestone",
            "strong": "G11610",
            "lemma": "δέ",
            "morph": "Gr,CC,,,,,,,,",
            "occurrence": 1,
            "occurrences": 1,
            "content": "δὲ",
            "children": [
              {
                "tag": "zaln",
                "type": "milestone",
                "strong": "G24240",
                "lemma": "Ἰησοῦς",
                "morph": "Gr,N,,,,,NMS,",
                "occurrence": 1,
                "occurrences": 1,
                "content": "Ἰησοῦς",
                "children": [
                  {
                    "text": "Jesus",
                    "tag": "w",
                    "type": "word",
                    "occurrence": 1,
                    "occurrences": 1
                  }
                ],
                "endTag": "zaln-e\\*"
              }
            ],
            "endTag": "zaln-e\\*"
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G30040",
        "lemma": "λέγω",
        "morph": "Gr,V,IAA3,,S,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "εἶπεν",
        "children": [
          {
            "text": "said",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G08460",
        "lemma": "αὐτός",
        "morph": "Gr,RP,,,3DMP,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "αὐτοῖς",
        "children": [
          {
            "text": "to",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 2
          },
          {
            "type": "text",
            "text": " "
          },
          {
            "text": "them",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": ", \""
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G02810",
        "lemma": "ἀμήν",
        "morph": "Gr,IE,,,,,,,,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "ἀμὴν",
        "children": [
          {
            "text": "Truly",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G30040",
        "lemma": "λέγω",
        "morph": "Gr,V,IPA1,,S,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "λέγω",
        "children": [
          {
            "text": "I",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          },
          {
            "type": "text",
            "text": " "
          },
          {
            "text": "say",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G47710",
        "lemma": "σύ",
        "morph": "Gr,RP,,,2D,P,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "ὑμῖν",
        "children": [
          {
            "text": "to",
            "tag": "w",
            "type": "word",
            "occurrence": 2,
            "occurrences": 2
          },
          {
            "type": "text",
            "text": " "
          },
          {
            "text": "you",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 3
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": ", "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G17220",
        "lemma": "ἐν",
        "morph": "Gr,P,,,,,D,,,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "ἐν",
        "children": [
          {
            "text": "in",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G35880",
        "lemma": "ὁ",
        "morph": "Gr,EA,,,,DFS,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "τῇ",
        "children": [
          {
            "text": "the",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 3
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G38240",
        "lemma": "παλιγγενεσία",
        "morph": "Gr,N,,,,,DFS,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "παλιγγενεσίᾳ",
        "children": [
          {
            "text": "new",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          },
          {
            "type": "text",
            "text": " "
          },
          {
            "text": "age",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G37520",
        "lemma": "ὅταν",
        "morph": "Gr,CS,,,,,,,,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "ὅταν",
        "children": [
          {
            "text": "when",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G35880",
        "lemma": "ὁ",
        "morph": "Gr,EA,,,,NMS,",
        "occurrence": 2,
        "occurrences": 2,
        "content": "ὁ",
        "children": [
          {
            "text": "the",
            "tag": "w",
            "type": "word",
            "occurrence": 2,
            "occurrences": 3
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G52070",
        "lemma": "υἱός",
        "morph": "Gr,N,,,,,NMS,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "Υἱὸς",
        "children": [
          {
            "text": "Son",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G35880",
        "lemma": "ὁ",
        "morph": "Gr,EA,,,,GMS,",
        "occurrence": 1,
        "occurrences": 2,
        "content": "τοῦ",
        "children": [
          {
            "tag": "zaln",
            "type": "milestone",
            "strong": "G04440",
            "lemma": "ἄνθρωπος",
            "morph": "Gr,N,,,,,GMS,",
            "occurrence": 1,
            "occurrences": 1,
            "content": "Ἀνθρώπου",
            "children": [
              {
                "text": "of",
                "tag": "w",
                "type": "word",
                "occurrence": 1,
                "occurrences": 2
              },
              {
                "type": "text",
                "text": " "
              },
              {
                "text": "Man",
                "tag": "w",
                "type": "word",
                "occurrence": 1,
                "occurrences": 1
              }
            ],
            "endTag": "zaln-e\\*"
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G25230",
        "lemma": "καθίζω",
        "morph": "Gr,V,SAA3,,S,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "καθίσῃ",
        "children": [
          {
            "text": "sits",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G19090",
        "lemma": "ἐπί",
        "morph": "Gr,P,,,,,G,,,",
        "occurrence": 1,
        "occurrences": 2,
        "content": "ἐπὶ",
        "children": [
          {
            "text": "on",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G08460",
        "lemma": "αὐτός",
        "morph": "Gr,RP,,,3GMS,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "αὐτοῦ",
        "children": [
          {
            "text": "his",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G13910",
        "lemma": "δόξα",
        "morph": "Gr,N,,,,,GFS,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "δόξης",
        "children": [
          {
            "text": "glorious",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G23620",
        "lemma": "θρόνος",
        "morph": "Gr,N,,,,,GMS,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "θρόνου",
        "children": [
          {
            "text": "throne",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": ", "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G37540",
        "lemma": "ὅτι",
        "morph": "Gr,CS,,,,,,,,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "ὅτι",
        "children": [
          {
            "tag": "zaln",
            "type": "milestone",
            "strong": "G47710",
            "lemma": "σύ",
            "morph": "Gr,RP,,,2N,P,",
            "occurrence": 1,
            "occurrences": 2,
            "content": "ὑμεῖς",
            "children": [
              {
                "text": "you",
                "tag": "w",
                "type": "word",
                "occurrence": 2,
                "occurrences": 3
              }
            ],
            "endTag": "zaln-e\\*"
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G35880",
        "lemma": "ὁ",
        "morph": "Gr,RR,,,,NMP,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "οἱ",
        "children": [
          {
            "tag": "zaln",
            "type": "milestone",
            "strong": "G01900",
            "lemma": "ἀκολουθέω",
            "morph": "Gr,V,PAA,NMP,",
            "occurrence": 1,
            "occurrences": 1,
            "content": "ἀκολουθήσαντές",
            "children": [
              {
                "text": "who",
                "tag": "w",
                "type": "word",
                "occurrence": 1,
                "occurrences": 1
              },
              {
                "type": "text",
                "text": " "
              },
              {
                "text": "have",
                "tag": "w",
                "type": "word",
                "occurrence": 1,
                "occurrences": 1
              },
              {
                "type": "text",
                "text": " "
              },
              {
                "text": "followed",
                "tag": "w",
                "type": "word",
                "occurrence": 1,
                "occurrences": 1
              }
            ],
            "endTag": "zaln-e\\*"
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G14730",
        "lemma": "ἐγώ",
        "morph": "Gr,RP,,,1D,S,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "μοι",
        "children": [
          {
            "text": "me",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": ", "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G47710",
        "lemma": "σύ",
        "morph": "Gr,RP,,,2N,P,",
        "occurrence": 2,
        "occurrences": 2,
        "content": "ὑμεῖς",
        "children": [
          {
            "text": "you",
            "tag": "w",
            "type": "word",
            "occurrence": 3,
            "occurrences": 3
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G25210",
        "lemma": "κάθημαι",
        "morph": "Gr,V,IFM2,,P,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "καθήσεσθε",
        "children": [
          {
            "text": "will",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G25320",
        "lemma": "καί",
        "morph": "Gr,D,,,,,,,,,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "καὶ",
        "children": [
          {
            "text": "also",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G25210",
        "lemma": "κάθημαι",
        "morph": "Gr,V,IFM2,,P,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "καθήσεσθε",
        "children": [
          {
            "text": "sit",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G19090",
        "lemma": "ἐπί",
        "morph": "Gr,P,,,,,A,,,",
        "occurrence": 2,
        "occurrences": 2,
        "content": "ἐπὶ",
        "children": [
          {
            "text": "upon",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G14270",
        "lemma": "δώδεκα",
        "morph": "Gr,EN,,,,AMPI",
        "occurrence": 1,
        "occurrences": 2,
        "content": "δώδεκα",
        "children": [
          {
            "text": "twelve",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 2
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G23620",
        "lemma": "θρόνος",
        "morph": "Gr,N,,,,,AMP,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "θρόνους",
        "children": [
          {
            "text": "thrones",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": ", "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G29190",
        "lemma": "κρίνω",
        "morph": "Gr,V,PPA,NMP,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "κρίνοντες",
        "children": [
          {
            "text": "judging",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G35880",
        "lemma": "ὁ",
        "morph": "Gr,EA,,,,AFP,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "τὰς",
        "children": [
          {
            "text": "the",
            "tag": "w",
            "type": "word",
            "occurrence": 3,
            "occurrences": 3
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G14270",
        "lemma": "δώδεκα",
        "morph": "Gr,EN,,,,AFP,",
        "occurrence": 2,
        "occurrences": 2,
        "content": "δώδεκα",
        "children": [
          {
            "text": "twelve",
            "tag": "w",
            "type": "word",
            "occurrence": 2,
            "occurrences": 2
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G54430",
        "lemma": "φυλή",
        "morph": "Gr,N,,,,,AFP,",
        "occurrence": 1,
        "occurrences": 1,
        "content": "φυλὰς",
        "children": [
          {
            "text": "tribes",
            "tag": "w",
            "type": "word",
            "occurrence": 1,
            "occurrences": 1
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": " "
      },
      {
        "tag": "zaln",
        "type": "milestone",
        "strong": "G35880",
        "lemma": "ὁ",
        "morph": "Gr,EA,,,,GMS,",
        "occurrence": 2,
        "occurrences": 2,
        "content": "τοῦ",
        "children": [
          {
            "tag": "zaln",
            "type": "milestone",
            "strong": "G24740",
            "lemma": "Ἰσραήλ",
            "morph": "Gr,N,,,,,GMSI",
            "occurrence": 1,
            "occurrences": 1,
            "content": "Ἰσραήλ",
            "children": [
              {
                "text": "of",
                "tag": "w",
                "type": "word",
                "occurrence": 2,
                "occurrences": 2
              },
              {
                "type": "text",
                "text": " "
              },
              {
                "text": "Israel",
                "tag": "w",
                "type": "word",
                "occurrence": 1,
                "occurrences": 1
              }
            ],
            "endTag": "zaln-e\\*"
          }
        ],
        "endTag": "zaln-e\\*"
      },
      {
        "type": "text",
        "text": ".\n\n"
      },
      {
        "tag": "s5",
        "type": "section",
        "content": " \n"
      }
    ];
    const bibles = {
      en: {
        'ult': {
          19: {
            28: {
              verseObjects: verseObjects
            }
          }
        }
      }
    };
    const currentToolName = 'translationWords';
    const expectedAlignedGLText = 'twelve tribes of Israel';

    // when
    const alignedGLText = checkAreaHelpers.getAlignedGLText(currentProjectToolsSelectedGL, contextId, bibles, currentToolName);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });
});

describe('checkAreayHelpers.bibleIdSort', () => {
  it('Test ordering of Bible IDs', () => {
    // given
    const bibleIds = ['asv', 'esv', 'ulb', 'ust', 'ult', 'udb', 'irv', 'aaa', 'zzz'];
    const expectedSortedBibleIds = ['irv', 'ult', 'ulb', 'ust', 'udb', 'aaa', 'asv', 'esv', 'zzz'];

    // when
    const sortedBibleIds = bibleIds.sort(checkAreaHelpers.bibleIdSort);

    // then
    expect(sortedBibleIds).toEqual(expectedSortedBibleIds);
  });
});
