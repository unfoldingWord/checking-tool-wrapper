import usfmjs from 'usfm-js';
import { verseHelpers } from 'tc-ui-toolkit';
import { normalizeString } from './stringHelpers';
import { isVerseWithinVerseSpan } from './groupDataHelpers';

/**
 * find verse data from verse or verse span
 * @param {object} currentBible
 * @param {string} chapter
 * @param {string|number} verse
 * @param {boolean} addVerseRef - if true then we add verse marker inline
 * @return {null|*}
 */
export function getBestVerseFromBook(currentBible, chapter, verse, addVerseRef=false) {
  const chapterData = currentBible && currentBible[chapter];
  let verseData = getBestVerseFromChapter(chapterData, verse, addVerseRef);

  if (verseData) {
    return verseData;
  }
  return '';
}

/**
 * find verse in chapter, if not found check if within a verse span
 * @param {string} verse
 * @param {object} chapterData
 * @returns {{ verseData, verseLabel }}
 */
export function getVerse(chapterData, verse ) {
  const verseNum = parseInt(verse);
  let verseData = chapterData[verseNum];
  let verseLabel = null;

  if (verseData) {
    verseLabel = verseNum;
  } else {
    for (let verse_ in chapterData) {
      if (verseHelpers.isVerseSpan(verse_)) {
        if (isVerseWithinVerseSpan(verse_, verseNum)) {
          verseData = chapterData[verse_];
          verseLabel = verse_;
          break;
        }
      }
    }
  }
  return { verseData, verseLabel };
}

/**
 * append verse to verses array
 * @param {object} chapterData
 * @param {string} verse - verse to fetch (could be verse span)
 * @param {array} history
 * @param {array} verses - array of verses text
 * @param {boolean} addVerseRef - if true then we add verse marker inline
 */
function addVerse(chapterData, verse, history, verses, addVerseRef=false) {
  const { verseData, verseLabel } = getVerse(chapterData, verse);

  if (verseData && !history.includes(verseLabel)) {
    if (addVerseRef && verses.length) {
      verses.push({
        type: 'text',
        text: verse + ' ',
      });
    }

    history.push(verseLabel + '');
    verses.push(verseData);
  }
}

/**
 * find verse data from verse or verse span
 * @param {object} chapterData
 * @param {string|number} verse
 * @param {boolean} addVerseRef - if true then we add verse marker inline
 * @return {null|*}
 */
export function getBestVerseFromChapter(chapterData, verse, addVerseRef=false) {
  if (chapterData) {
    let verseData = chapterData?.[verse];

    if (!verseData) {
      const history = []; // to guard against duplicate verses
      const verseList = verseHelpers.getVerseList(verse);
      let verses = [];

      for (const verse_ of verseList) {
        if (verseHelpers.isVerseSpan(verse_)) {
          // iterate through all verses in span
          const { low, high } = verseHelpers.getVerseSpanRange(verse_);

          for (let i = low; i <= high; i++) {
            addVerse(chapterData, verse_, history, i, addVerseRef);
          }
        } else { // not a verse span
          addVerse(chapterData, verse_, history, verses, addVerseRef);
        }
      }
      return verses && verses.join('\n') || null;
    }
    return verseData;
  }
  return null;
}

/**
 *  Gets both the verse text without usfm markers and unfilteredVerseText.
 * @param {object} targetBible - target bible
 * @param {object} contextId - context id
 * @param {boolean} addVerseRef - if true then we add verse marker inline
 */
export function getVerseText(targetBible, contextId, addVerseRef=false) {
  let unfilteredVerseText = '';
  let verseText = '';

  if (contextId && contextId.reference) {
    const { chapter, verse } = contextId.reference;

    if (targetBible && targetBible[chapter]) {
      unfilteredVerseText = getBestVerseFromBook(targetBible, chapter, verse, addVerseRef);

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
