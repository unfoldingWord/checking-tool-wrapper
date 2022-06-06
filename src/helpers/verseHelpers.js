import usfmjs from 'usfm-js';
import { normalizeString } from './stringHelpers';
import {
  getVerseSpanRange,
  isVerseSpan,
  isVerseWithinVerseSpan,
} from './groupDataHelpers';

/**
 * find verse data from verse or verse span
 * @param {object} currentBible
 * @param {string} chapter
 * @param {string|number} verse
 * @return {null|*}
 */
export function getBestVerseFromBook(currentBible, chapter, verse) {
  const chapterData = currentBible && currentBible[chapter];
  let verseData = getBestVerseFromChapter(chapterData, verse);

  if (verseData) {
    return verseData;
  }
  return '';
}

/**
 * find verse data from verse or verse span
 * @param {object} chapterData
 * @param {string|number} verse
 * @return {null|*}
 */
export function getBestVerseFromChapter(chapterData, verse) {
  let verseData = null;

  if (chapterData) {
    verseData = chapterData[verse];

    if (!verseData) {
      if (isVerseSpan(verse)) { // if we didn't find verse, check if verse span
        let verses = [];
        // iterate through all verses in span
        const { low, high } = getVerseSpanRange(verse);

        for (let i = low; i <= high; i++) {
          const verseStr = chapterData[i];

          if (!verseStr) { // if verse missing, abort
            verses = null;
            break;
          }
          verses = verses.push(verseStr);
        }
        return verses && verses.join('\n') || null;
      }

      const verseNum = parseInt(verse);

      for (let verse_ in chapterData) {
        if (isVerseSpan(verse_)) {
          if (isVerseWithinVerseSpan(verse_, verseNum)) {
            verseData = chapterData[verse_];
            break;
          }
        }
      }
    }
  }
  return verseData;
}

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
      unfilteredVerseText = getBestVerseFromBook(targetBible, chapter, verse);

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
