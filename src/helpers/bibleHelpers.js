import { BIBLE_BOOKS } from '../common/booksOfTheBible';
import {
  OT_ORIG_LANG,
  NT_ORIG_LANG,
  OT_ORIG_LANG_BIBLE,
  NT_ORIG_LANG_BIBLE,
} from '../common/constants';

/**
 * tests if book is a Old Testament book
 * @param bookId
 * @return {boolean}
 */
export function isOldTestament(bookId) {
  return bookId in BIBLE_BOOKS.oldTestament;
}

/**
 * determine Original Language and Original Language bible for book
 * @param bookId
 * @return {{resourceLanguage: string, bibleID: string}}
 */
export function getOrigLangforBook(bookId) {
  const isOT = isOldTestament(bookId);
  const languageId = (isOT) ? OT_ORIG_LANG : NT_ORIG_LANG;
  const bibleId = (isOT) ? OT_ORIG_LANG_BIBLE : NT_ORIG_LANG_BIBLE;
  return { languageId, bibleId };
}
