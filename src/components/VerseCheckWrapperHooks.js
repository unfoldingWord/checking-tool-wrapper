/* eslint-disable no-nested-ternary */
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { VerseCheck } from 'tc-ui-toolkit';
import { optimizeSelections } from '../helpers/selectionHelpers';

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
  actions,
  commentsReducer: { text: commentText },
  remindersReducer: { enabled: bookmarkEnabled },
  selectionsReducer: {
    selections,
    nothingToSelect,
  },
}) {
  // Determine screen mode
  const initialMode = selections && selections.length || verseText.length === 0 ?
    'default' : nothingToSelect ? 'default' : 'select';
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
  });

  useEffect(() => {
    setLocalState({ selections });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  console.log('contextId', contextId);

  useEffect(() => {
    setLocalState({
      mode: initialMode,
      newComment: null,
      newVerseText: null,
      selections,
      nothingToSelect,
      newTags: [],
      lastContextId: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId]);

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
      actions.goToNext();
    } else if (goToNextOrPrevious == 'previous') {
      actions.goToPrevious();
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
    actions.addComment(newComment);
    setLocalState({
      mode: 'default',
      newSelections: selections,
      newComment: null,
      isCommentChanged: false,
    });
  }

  function handleTagsCheckbox(tag) {
    const _newTags = Array.from(newTags);

    if (!newTags.includes(tag)) {
      _newTags.push(tag);
    } else {
      _newTags.tags = _newTags.tags.filter(_tag => _tag !== tag);
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
    actions.editTargetVerse(chapter, verse, before, newVerseText, newTags);
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
    actions.changeSelections(selections, newNothingToSelect);
    changeMode('default');
  }

  function toggleNothingToSelect(nothingToSelect) {
    setLocalState({ nothingToSelect });
  }

  const alignedGLText = 'alignedGLText';// TODO:

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
      alignedGLText={alignedGLText}
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
      handleGoToNext={actions.goToNext}
      handleGoToPrevious={actions.goToPrevious}
      handleOpenDialog={handleOpenDialog}
      handleCloseDialog={handleCloseDialog}
      openAlertDialog={actions.openAlertDialog}
      toggleReminder={actions.toggleReminder}
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
      validateSelections={actions.validateSelections}
      handleTagsCheckbox={handleTagsCheckbox}
      toggleNothingToSelect={toggleNothingToSelect}
      changeSelectionsInLocalState={changeSelectionsInLocalState}
    />
  );
}

VerseCheckWrapper.propTypes = {
  translate: PropTypes.func.isRequired,
  remindersReducer: PropTypes.object,
  commentsReducer: PropTypes.object,
  targetBible: PropTypes.object.isRequired,
  groupsDataReducer: PropTypes.object,
  loginReducer: PropTypes.object,
  contextId: PropTypes.object.isRequired,
  manifest: PropTypes.object.isRequired,
  maximumSelections: PropTypes.number.isRequired,
  verseText: PropTypes.string.isRequired,
  unfilteredVerseText: PropTypes.string.isRequired,
  isVerseEdited: PropTypes.bool.isRequired,
  isVerseInvalidated: PropTypes.bool.isRequired,
  selectionsReducer: PropTypes.shape({
    selections: PropTypes.array,
    nothingToSelect: PropTypes.bool,
  }),
  actions: PropTypes.shape({
    changeSelections: PropTypes.func.isRequired,
    goToNext: PropTypes.func.isRequired,
    goToPrevious: PropTypes.func.isRequired,
    onInvalidCheck: PropTypes.func.isRequired,
    validateSelections: PropTypes.func.isRequired,
    toggleReminder: PropTypes.func.isRequired,
    openAlertDialog: PropTypes.func.isRequired,
    addComment: PropTypes.func.isRequired,
    editTargetVerse: PropTypes.func.isRequired,
  }),
};

export default VerseCheckWrapper;