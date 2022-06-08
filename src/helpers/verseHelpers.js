import usfmjs from 'usfm-js';
import { verseHelpers } from 'tc-ui-toolkit';
import { normalizeString } from './stringHelpers';
import { isVerseWithinVerseSpan } from './groupDataHelpers';

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
 * find verse in chapter, if not found check if within a verse span
 * @param {string} verse
 * @param {object} chapterData
 * @returns {*}
 */
function getVerse(chapterData, verse ) {
  const verseNum = parseInt(verse);
  let verseData = chapterData[verseNum];

  if (!verseData) {
    for (let verse_ in chapterData) {
      if (verseHelpers.isVerseSpan(verse_)) {
        if (isVerseWithinVerseSpan(verse_, verseNum)) {
          verseData = chapterData[verse_];
          break;
        }
      }
    }
  }
  return verseData;
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
      if (verseHelpers.isVerseSet(verse)) { // if we didn't find verse, check if verse set
        const verseList = verseHelpers.getVerseList(verse);
        let verses = [];

        for (const verse_ of verseList) {
          if (verseHelpers.isVerseSpan(verse_)) {
            // iterate through all verses in span
            const { low, high } = verseHelpers.getVerseSpanRange(verse_);

            for (let i = low; i <= high; i++) {
              const verseStr = getVerse(chapterData, i );

              if (!verseStr) { // if verse missing, abort
                verses = null;
                break;
              }
              verses.push(verseStr);
            }
          } else { // not a verse span
            const verseData = getVerse(chapterData, verse_ );

            if (verseData) {
              verses.push(verseData);
            }
          }
        }
        return verses && verses.join('\n') || null;
      }
      verseData = getVerse(chapterData, verse );
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
      verseText = usfmjs.removeMarker(unfilteredVerseText);
      // normalize whitespace in case selection has contiguous whitespace _this isn't captured
      verseText = normalizeString(verseText);
    }
  }

  return { unfilteredVerseText, verseText };
}
