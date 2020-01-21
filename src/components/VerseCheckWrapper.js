/* eslint-disable no-nested-ternary */
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { VerseCheck } from 'tc-ui-toolkit';
import { connect } from 'react-redux';
// helpers
import { optimizeSelections } from '../helpers/selectionHelpers';
import { getInvalidQuoteMessage } from '../helpers/checkAreaHelpers';
import { getVerseText } from '../helpers/verseHelpers';
// actions
import { changeToNextContextId, changeToPreviousContextId } from '../state/actions/contextIdActions';
import { addComment } from '../state/actions/commentsActions';
import { changeSelections } from '../state/actions/selectionsActions';
import { editTargetVerse } from '../state/actions/verseEditActions';
import { toggleBookmark } from '../state/actions/bookmarksActions';
// selectors
import {
  getContextId,
  getProjectManifest,
  getGatewayLanguage,
  getTargetBible,
  getCurrentGroup,
  getMaximumSelections,
  getToolName,
  getCommentsReducer,
  getSelectionsReducer,
  getBookmarksReducer,
  getSelectedToolName,
  getProjectPath,
  getUsername,
} from '../selectors';


function useLocalState(initialState) {
  const [localState, setLocalState] = useState(initialState);

  return {
    ...localState,
    setLocalState(newState) {
      setLocalState(prevState => ({ ...prevState, ...newState }));
    },
  };
}

function VerseCheckWrapper({
  manifest,
  translate,
  contextId,
  verseText,
  targetBible,
  isVerseEdited,
  isVerseInvalidated,
  unfilteredVerseText,
  maximumSelections,
  alignedGLText,
  commentsReducer: { text: commentText },
  bookmarksReducer: { enabled: bookmarkEnabled },
  selectionsReducer: {
    selections,
    nothingToSelect,
  },
  gatewayLanguage,
  toggleBookmark,
  changeSelections,
  goToNext,
  goToPrevious,
  onInvalidCheck,
  validateSelections,
  showAlert,
  addComment,
  editTargetVerse,
}) {
  // Determine screen mode
  const initialMode = getInitialMode();
  const {
    mode,
    newComment,
    newVerseText,
    newSelections,
    newNothingToSelect,
    isCommentChanged,
    isVerseChanged,
    newTags,
    isDialogOpen,
    goToNextOrPrevious,
    setLocalState,
    alignedGlTextState,
  } = useLocalState({
    mode: initialMode,
    newComment: null,
    newVerseText: null,
    newSelections: selections,
    newNothingToSelect: nothingToSelect,
    isCommentChanged: false,
    isVerseChanged: false,
    newTags: [],
    isDialogOpen: false,
    goToNextOrPrevious: null,
    lastContextId: null,
    alignedGlTextState: '',
  });

  useEffect(() => {
    // TRICKY: for async fs loads, need to update mode and selection state when new selection loads
    setLocalState(
      {
        mode: getInitialMode(),
        newSelections: selections,
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections]);

  useEffect(() => {
    let alignedGlTextState = alignedGLText;

    if (!alignedGLText && contextId) {
      alignedGlTextState = getInvalidQuoteMessage(contextId, translate);

      if (onInvalidCheck) {
        onInvalidCheck(contextId, gatewayLanguage, true);
      }
    }
    setLocalState({
      mode: initialMode,
      newComment: null,
      newVerseText: null,
      newSelections: selections,
      newNothingToSelect: nothingToSelect,
      newTags: [],
      lastContextId: null,
      alignedGlTextState,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId]);

  function getInitialMode() {
    return selections && selections.length || verseText.length === 0 ?
      'default' : nothingToSelect ? 'default' : 'select';
  }

  function handleOpenDialog(goToNextOrPrevious) {
    setLocalState({ goToNextOrPrevious, isDialogOpen: true });
  }

  function handleCloseDialog() {
    setLocalState({ isDialogOpen: false });
  }

  function handleSkip(e) {
    e.preventDefault();
    setLocalState({ isDialogOpen: false });

    if (goToNextOrPrevious == 'next') {
      goToNext();
    } else if (goToNextOrPrevious == 'previous') {
      goToPrevious();
    }
  }

  function changeMode(mode) {
    setLocalState({
      mode,
      newSelections: selections,
    });
  }

  function handleComment(e) {
    e.preventDefault();
    setLocalState({ newComment: e.target.value });
  }

  function checkIfCommentChanged(e) {
    const newcomment = e.target.value || '';
    const oldcomment = commentText || '';

    setLocalState({ isCommentChanged: newcomment !== oldcomment });
  }

  function cancelComment() {
    setLocalState({
      mode: 'default',
      newSelections: selections,
      newComment: null,
      isCommentChanged: false,
    });
  }

  function saveComment() {
    addComment(newComment);
    setLocalState({
      mode: 'default',
      newSelections: selections,
      newComment: null,
      isCommentChanged: false,
    });
  }

  function handleTagsCheckbox(tag) {
    const tagIndex = newTags.indexOf(tag);
    let _newTags;

    if (tagIndex > -1) {
      const copy = newTags.slice(0);
      copy.splice(tagIndex, 1);
      _newTags = copy;
    } else {
      _newTags = [...newTags, tag];
    }

    setLocalState({ newTags: _newTags });
  }

  function handleEditVerse(e) {
    setLocalState({ newVerseText: e.target.value });
  }

  function checkIfVerseChanged(e) {
    const { chapter, verse } = contextId.reference;
    const newverse = e.target.value || '';
    const oldverse = targetBible[chapter][verse] || '';

    if (newverse === oldverse) {
      setLocalState({
        isVerseChanged: false,
        newTags: [],
      });
    } else {
      setLocalState({ isVerseChanged: true });
    }
  }

  function cancelEditVerse() {
    setLocalState({
      mode: 'default',
      newSelections: selections,
      newVerseText: null,
      isVerseChanged: false,
      newTags: [],
    });
  }

  function saveEditVerse() {
    const { chapter, verse } = contextId.reference;
    const before = targetBible[chapter][verse];

    setLocalState({
      mode: 'default',
      newSelections: selections,
      newVerseText: null,
      isVerseChanged: false,
      newTags: [],
    });
    editTargetVerse(chapter, verse, before, newVerseText, newTags);
  }

  function changeSelectionsInLocalState(newSelections) {
    if (newSelections.length > 0) {
      setLocalState({ newNothingToSelect: false });
    } else {
      setLocalState({ newNothingToSelect: nothingToSelect });
    }
    setLocalState({ newSelections });
  }

  function cancelSelection() {
    setLocalState({
      mode: 'default',
      newNothingToSelect: nothingToSelect,
      newSelections: selections,
    });
  }

  function clearSelection() {
    setLocalState({ newSelections: [] });
  }

  function saveSelection() {
    // optimize the selections to address potential issues and save
    const selections = optimizeSelections(verseText, newSelections);
    changeSelections(selections, newNothingToSelect);
    changeMode('default');
  }

  function toggleNothingToSelect(newNothingToSelect) {
    setLocalState({ newNothingToSelect });
  }

  if (contextId) {
    return (
      <VerseCheck
        translate={translate}
        mode={mode}
        tags={newTags}
        targetBible={targetBible}
        verseText={verseText}
        unfilteredVerseText={unfilteredVerseText}
        contextId={contextId}
        selections={selections}
        isVerseEdited={isVerseEdited}
        commentText={commentText}
        alignedGLText={alignedGlTextState}
        nothingToSelect={nothingToSelect}
        bookmarkEnabled={bookmarkEnabled}
        maximumSelections={maximumSelections}
        isVerseInvalidated={isVerseInvalidated}
        bookDetails={manifest.project}
        targetLanguageDetails={manifest.target_language}
        newSelections={newSelections}
        localNothingToSelect={newNothingToSelect}
        dialogModalVisibility={isDialogOpen}
        isVerseChanged={isVerseChanged}
        isCommentChanged={isCommentChanged}
        handleSkip={handleSkip}
        handleGoToNext={goToNext}
        handleGoToPrevious={goToPrevious}
        handleOpenDialog={handleOpenDialog}
        handleCloseDialog={handleCloseDialog}
        openAlertDialog={showAlert}
        toggleReminder={toggleBookmark}//TODO: Change toggleReminder to toggleBookmark namespace in tc-ui-toolkit
        changeMode={changeMode}
        cancelEditVerse={cancelEditVerse}
        saveEditVerse={saveEditVerse}
        handleComment={handleComment}
        cancelComment={cancelComment}
        saveComment={saveComment}
        saveSelection={saveSelection}
        cancelSelection={cancelSelection}
        clearSelection={clearSelection}
        handleEditVerse={handleEditVerse}
        checkIfVerseChanged={checkIfVerseChanged}
        checkIfCommentChanged={checkIfCommentChanged}
        validateSelections={validateSelections}
        handleTagsCheckbox={handleTagsCheckbox}
        toggleNothingToSelect={toggleNothingToSelect}
        changeSelectionsInLocalState={changeSelectionsInLocalState}
      />
    );
  } else {
    return null;
  }
}

VerseCheckWrapper.propTypes = {
  translate: PropTypes.func.isRequired,
  targetBible: PropTypes.object.isRequired,
  contextId: PropTypes.object.isRequired,
  manifest: PropTypes.object.isRequired,
  maximumSelections: PropTypes.number.isRequired,
  verseText: PropTypes.string.isRequired,
  unfilteredVerseText: PropTypes.string.isRequired,
  isVerseEdited: PropTypes.bool.isRequired,
  isVerseInvalidated: PropTypes.bool.isRequired,
  alignedGLText: PropTypes.string.isRequired,
  gatewayLanguage: PropTypes.string.isRequired,
  bookmarksReducer: PropTypes.object.isRequired,
  commentsReducer: PropTypes.object.isRequired,
  selectionsReducer: PropTypes.shape({
    selections: PropTypes.array.isRequired,
    nothingToSelect: PropTypes.bool.isRequired,
  }).isRequired,
  changeSelections: PropTypes.func.isRequired,
  goToNext: PropTypes.func.isRequired,
  goToPrevious: PropTypes.func.isRequired,
  onInvalidCheck: PropTypes.func.isRequired,
  validateSelections: PropTypes.func.isRequired,
  toggleBookmark: PropTypes.func.isRequired,
  showAlert: PropTypes.func.isRequired,
  addComment: PropTypes.func.isRequired,
  editTargetVerse: PropTypes.func.isRequired,
};

export const mapStateToProps = (state, ownProps) => {
  const contextId = getContextId(state);
  const targetBible = getTargetBible(ownProps);
  const { verseText, unfilteredVerseText } = getVerseText(targetBible, contextId);
  const currentGroupItem = getCurrentGroup(state);
  const isVerseEdited = !!(currentGroupItem && currentGroupItem.verseEdits);
  const isVerseInvalidated = !!(currentGroupItem && currentGroupItem.invalidated);
  const selectedToolName = getToolName(ownProps);
  const alignedGLText = ownProps.gatewayLanguageQuote;

  return {
    contextId,
    verseText,
    targetBible,
    isVerseEdited,
    isVerseInvalidated,
    unfilteredVerseText,
    alignedGLText,
    showAlert: ownProps.tc.showAlert,
    onInvalidCheck: ownProps.tc.onInvalidCheck,
    manifest: getProjectManifest(ownProps),
    maximumSelections: getMaximumSelections(selectedToolName),
    commentsReducer: getCommentsReducer(state),
    selectionsReducer: getSelectionsReducer(state),
    bookmarksReducer: getBookmarksReducer(state),
    gatewayLanguage: getGatewayLanguage(ownProps),
  };
};

const mapDispatchToProps = (dispatch, ownProps) => {
  const {
    tc: {
      showAlert,
      closeAlert,
      setInvalidation,
      gatewayLanguage,
      updateTargetVerse,
      showIgnorableAlert,
    },
    translate,
    gatewayLanguageQuote,
    actions: { validateSelections },
  } = ownProps;
  const username = getUsername(ownProps);
  const selectedToolName = getSelectedToolName(ownProps);
  const projectSaveLocation = getProjectPath(ownProps);

  return {
    goToNext: () => dispatch(changeToNextContextId()),
    goToPrevious: () => dispatch(changeToPreviousContextId()),
    addComment: (text) => dispatch(addComment(text, username, gatewayLanguage, gatewayLanguageQuote, projectSaveLocation)),
    editTargetVerse: (chapter, verse, before, after, tags) => {
      dispatch(editTargetVerse(chapter, verse, before, after, tags, username, gatewayLanguage, gatewayLanguageQuote, projectSaveLocation, selectedToolName, translate, showAlert, closeAlert, showIgnorableAlert, updateTargetVerse));
    },
    toggleBookmark: () => {
      dispatch(toggleBookmark(username, gatewayLanguage, gatewayLanguageQuote, projectSaveLocation));
    },
    changeSelections: (selections, nothingToSelect) => {// TODO: Make sure it works correctly.
      dispatch(changeSelections(selections, nothingToSelect, username, selectedToolName, setInvalidation, null, null, null, gatewayLanguage, gatewayLanguageQuote, projectSaveLocation));
    },
    validateSelections: () => {// TODO: Use the version of this function located withi this tools codebase.
      console.log('====================================');
      console.log('validateSelections()');
      console.log('====================================');
      console.log('contextId', ownProps.contextId);
      validateSelections();
    },
  };
};

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(VerseCheckWrapper);
