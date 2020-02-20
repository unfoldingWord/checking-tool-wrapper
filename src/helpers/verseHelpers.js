import usfmjs from 'usfm-js';
import { normalizeString } from './selectionHelpers';

/**
 *  Gets both the verse text without usfm markers and unfilteredVerseText.
 * @param {object} targetBible - target bible
 * @param {object} contextId - context id
 */
export function getVerseText(targetBible, contextId) {
  let unfilteredVerseText = '';
  let verseText = '';

  if (contextId) {
    console.log('====================================');
    console.log('contextId', contextId);
    console.log('====================================');
    const { chapter, verse } = contextId.reference;
    console.log('====================================');
    console.log('1 unfilteredVerseText', unfilteredVerseText);
    console.log('====================================');

    if (targetBible && targetBible[chapter]) {
      console.log('====================================');
      console.log('targetBible', targetBible);
      console.log('====================================');
      unfilteredVerseText = targetBible && targetBible[chapter] ? targetBible[chapter][verse] : '';
      console.log('====================================');
      console.log('2 unfilteredVerseText', unfilteredVerseText);
      console.log('====================================');

      if (Array.isArray(unfilteredVerseText)) {
        unfilteredVerseText = unfilteredVerseText[0];
      }
      console.log('====================================');
      console.log('3 unfilteredVerseText', unfilteredVerseText);
      console.log('====================================');
      // normalize whitespace in case selection has contiguous whitespace _this isn't captured
      verseText = normalizeString(unfilteredVerseText);
      verseText = usfmjs.removeMarker(verseText);
    }
  }

  return { unfilteredVerseText, verseText };
}
