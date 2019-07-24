/* eslint-env jest */
import * as VerseCheckWrapper from '../src/components/VerseCheckWrapper';
import {TRANSLATION_NOTES} from "../src/helpers/consts";

describe('VerseCheckWrapper.getGlQuote', () => {
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

  it('should handle GL string quote', () => {
    // given
    const currentProjectToolsSelectedGL = {
      translationNotes: 'en',
      currentToolName: TRANSLATION_NOTES
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
      tool: TRANSLATION_NOTES
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
    const currentToolName = TRANSLATION_NOTES;
    const expectedAlignedGLText = "without blame";
    const mock_OnInvalidQuote = jest.fn();

    // when
    const alignedGLText = VerseCheckWrapper.getGlQuote(currentProjectToolsSelectedGL, contextId, bibles, currentToolName, k => k, mock_OnInvalidQuote);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
    expect(mock_OnInvalidQuote).not.toHaveBeenCalled();
  });

  it('should have GL string quote error', () => {
    // given
    const currentProjectToolsSelectedGL = {
      translationNotes: 'en',
      currentToolName: TRANSLATION_NOTES
    };
    const contextId = {
      groupId: 'blameless',
      occurrence: 1,
      quote: 'ἀνέγκλητο',
      reference: {
        bookId: 'tit',
        chapter: 1,
        verse: 6
      },
      strong: ['G04100'],
      tool: TRANSLATION_NOTES
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
    const currentToolName = TRANSLATION_NOTES;
    const expectedAlignedGLText = "quote_invalid";
    const mock_OnInvalidQuote = jest.fn();

    // when
    const alignedGLText = VerseCheckWrapper.getGlQuote(currentProjectToolsSelectedGL, contextId, bibles, currentToolName, k => k, mock_OnInvalidQuote);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
    expect(mock_OnInvalidQuote).toHaveBeenCalledWith(contextId, currentProjectToolsSelectedGL.translationNotes);
  });
});
