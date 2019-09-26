/* eslint-disable no-nested-ternary */
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { VerseCheck } from 'tc-ui-toolkit';

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
  unfilteredVerseText,
  currentToolName,
  maximumSelections,
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
  const initialState = {
    mode: initialMode,
    newComment: null,// renamed comment -> newComment
    newVerseText: null,// renamed verseText -> newVerseText
    newSelections: selections,// renamed selections -> newSelections
    newNothingToSelect: nothingToSelect,// renamed nothingToSelect -> newNothingToSelect
    commentChanged: false,
    verseChanged: false,
    editTags: [],// renamed tags -> editTags
    isDialogOpen: false,// renamed dialogModalVisibility -> isDialogOpen
    goToNextOrPrevious: null,
    lastContextId: null,
  };
  const {
    mode,
    newComment,
    newVerseText,
    newSelections,
    newNothingToSelect,
    commentChanged,
    verseChanged,
    editTags,
    isDialogOpen,
    goToNextOrPrevious,
    setLocalState,
  } = useLocalState(initialState);

  useEffect(() => {
    setLocalState({ selections });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // useEffect(() => {//? Do we even need this anymore?👀
  // // componentWillReceiveProps not fully completed yet
  //   setLocalState({
  //     mode: initialMode,
  //     newComment: null,
  //     newVerseText: null,
  //     selections,
  //     nothingToSelect,
  //     editTags: [],
  //     lastContextId: null,
  //   });
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [contextId]);

  return (
    <VerseCheck
      translate={translate}
      mode={mode}
      tags={editTags}
      targetBible={targetBible}
      verseText={verseText}
      unfilteredVerseText={unfilteredVerseText}
      contextId={contextId}
      selections={selections}
      verseEdited={verseEdited || ''}//TODO: Add default prop to tc-toolkit
      commentText={commentText || ''}//TODO: Add default prop to tc-toolkit
      alignedGLText={alignedGLText}
      nothingToSelect={nothingToSelect}
      bookmarkEnabled={bookmarkEnabled}
      maximumSelections={maximumSelections}
      isVerseInvalidated={isVerseInvalidated}
      bookDetails={manifest.project}
      targetLanguageDetails={manifest.target_language}
      newSelections={newSelections}
      verseChanged={verseChanged}
      localNothingToSelect={newNothingToSelect}
      dialogModalVisibility={isDialogOpen}
      commentChanged={commentChanged}
      handleSkip={this.handleSkip}
      handleGoToNext={this.handleGoToNext}
      handleGoToPrevious={this.handleGoToPrevious}
      handleOpenDialog={this.handleOpenDialog}
      handleCloseDialog={this.handleCloseDialog}
      openAlertDialog={this.openAlertDialog}
      toggleReminder={this.toggleReminder}
      changeMode={this.changeMode}
      cancelEditVerse={this.cancelEditVerse}
      saveEditVerse={this.saveEditVerse}
      handleComment={this.handleComment}
      cancelComment={this.cancelComment}
      saveComment={this.saveComment}
      saveSelection={this.saveSelection}
      cancelSelection={this.cancelSelection}
      clearSelection={this.clearSelection}
      handleEditVerse={this.handleEditVerse}
      handleCheckVerse={this.handleCheckVerse}
      handleCheckComment={this.handleCheckComment}
      validateSelections={this.validateSelections}
      handleTagsCheckbox={this.handleTagsCheckbox}
      toggleNothingToSelect={this.toggleNothingToSelect}
      changeSelectionsInLocalState={this.changeSelectionsInLocalState}
    />
  );
}

VerseCheckWrapper.propTypes = {
  translate: PropTypes.func.isRequired,
  currentToolName: PropTypes.string.isRequired,
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
  selectionsReducer: PropTypes.shape({
    selections: PropTypes.array,
    nothingToSelect: PropTypes.bool,
  }),
  actions: PropTypes.shape({
    changeSelections: PropTypes.func.isRequired,
    goToNext: PropTypes.func.isRequired,
    goToPrevious: PropTypes.func.isRequired,
    onInvalidCheck: PropTypes.func.isRequired,
  }),
};

export default VerseCheckWrapper;
