/* eslint-env jest */
import { generateItemId } from '../src/helpers/groupMenuHelpers';
import { TRANSLATION_WORDS } from '../src/common/constants';

describe('groupMenuHelpers.generateItemId', () => {
  it('should handle string quote', () => {
    // given
    const contextID = {
      'reference': {
        'bookId': 'luk', 'chapter': 1, 'verse': 5,
      },
      'tool': TRANSLATION_WORDS,
      'groupId': 'aaron',
      'quote': 'Ἀαρών',
      'strong': ['G00020'],
      'occurrence': 1,
    };
    const expectedAlignedGLText = '1:Ἀαρών:5:1:luk';

    // when
    const alignedGLText = generateItemId(contextID.occurrence, contextID.reference.bookId,
      contextID.reference.chapter, contextID.reference.verse, contextID.quote);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });

  it('should handle quote array', () => {
    // given
    const contextID = {
      'reference':{
        'bookId':'luk','chapter':22,'verse':30,
      },
      'tool':TRANSLATION_WORDS,
      'groupId':'12tribesofisrael',
      'quote':[
        { 'word':'δώδεκα','occurrence':1 },
        { 'word':'φυλὰς','occurrence':1 },
        { 'word':'κρίνοντες','occurrence':1 },
        { 'word':'τοῦ','occurrence':1 },
        { 'word':'Ἰσραήλ','occurrence':1 },
      ],
      'strong':['G14270','G54430','G29190','G35880','G24740'],
      'occurrence':1,
    };
    const expectedAlignedGLText = '1:δώδεκα:1:φυλὰς:1:κρίνοντες:1:τοῦ:1:Ἰσραήλ:30:22:luk';

    // when
    const alignedGLText = generateItemId(contextID.occurrence, contextID.reference.bookId,
      contextID.reference.chapter, contextID.reference.verse, contextID.quote);

    // then
    expect(alignedGLText).toEqual(expectedAlignedGLText);
  });
});
