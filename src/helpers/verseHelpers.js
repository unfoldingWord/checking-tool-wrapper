import usfmjs from 'usfm-js';
import { normalizeString } from './stringHelpers';

/**
 *  Gets both the verse text without usfm markers and unfilteredVerseText.
 * @param {object} targetBible - target bible
 * @param {object} contextId - context id
 */
export function getVerseText(targetBible, contextId) {
  let unfilteredVerseText = '';
  let verseText = '';

  if (contextId && contextId.reference) {
    const { chapter, verse } = contextId.reference;

    if (targetBible && targetBible[chapter]) {
      unfilteredVerseText = targetBible && targetBible[chapter] ? targetBible[chapter][verse] : '';

      if (Array.isArray(unfilteredVerseText)) {
        unfilteredVerseText = unfilteredVerseText[0];
      }
      // normalize whitespace in case selection has contiguous whitespace _this isn't captured
      verseText = normalizeString(unfilteredVerseText);
      verseText = usfmjs.removeMarker(verseText);
    }
  }

  return { unfilteredVerseText, verseText };
}
