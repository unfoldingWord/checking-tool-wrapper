import generateTimestamp from '../../utils/generateTimestamp';
import { getContextId } from '../../selectors';
import { validateSelections } from './selectionsActions';

/**
 * This is a called by tool when a verse has been edited. It updates group data reducer for current tool
 * and updates the file system for tools not loaded.
 * This will first do TW selections validation and prompt user if invalidations are found.
 * Then it calls updateVerseEditStatesAndCheckAlignments to save verse edits and then validate alignments.
 * @param {int} chapterWithVerseEdit
 * @param {int|string} verseWithVerseEdit
 * @param {string} before - the verse text before the edit
 * @param {string} after - the verse text after the edit
 * @param {array} tags - an array of tags indicating the reason for the edit
 * @param {string} username - user's name.
 * @param {string} gatewayLanguageCode - gateway Language Code.
 * @param {string} gatewayLanguageQuote - gateway Language quote.
 * @param {string} projectSaveLocation - project path.
 * @param {string} selectedToolName - tool name.
 */
export const editTargetVerse = (chapterWithVerseEdit, verseWithVerseEdit, before, after, tags, username, gatewayLanguageCode, gatewayLanguageQuote, projectSaveLocation, selectedToolName) => (dispatch, getState) => {
  const state = getState();
  const contextId = getContextId(state);
  const currentCheckContextId = contextId;
  const {
    bookId, chapter: currentCheckChapter, verse: currentCheckVerse,
  } = currentCheckContextId.reference;
  verseWithVerseEdit = (typeof verseWithVerseEdit === 'string') ? parseInt(verseWithVerseEdit) : verseWithVerseEdit; // make sure number

  const contextIdWithVerseEdit = {
    ...currentCheckContextId,
    reference: {
      ...currentCheckContextId.reference,
      chapter: chapterWithVerseEdit,
      verse: verseWithVerseEdit,
    },
  };
  const selectionsValidationResults = {};
  const actionsBatch = [];

  dispatch(validateSelections(after, contextIdWithVerseEdit, chapterWithVerseEdit, verseWithVerseEdit,
    false, selectionsValidationResults, actionsBatch, projectSaveLocation, bookId, selectedToolName, username));

  // create verse edit record to write to file system
  const modifiedTimestamp = generateTimestamp();
  const verseEdit = {
    verseBefore: before,
    verseAfter: after,
    tags,
    username,
    activeBook: bookId,
    activeChapter: currentCheckChapter,
    activeVerse: currentCheckVerse,
    modifiedTimestamp,
    gatewayLanguageCode,
    gatewayLanguageQuote,
    contextId: contextIdWithVerseEdit,
  };

  dispatch(updateVerseEditStatesAndCheckAlignments(verseEdit, contextIdWithVerseEdit, currentCheckContextId,
    selectionsValidationResults.selectionsChanged, actionsBatch));
};
