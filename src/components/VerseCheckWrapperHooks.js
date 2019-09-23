import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { VerseCheck } from 'tc-ui-toolkit';

function VerseCheckWrapper({
  translate,
  currentToolName,
  projectDetailsReducer: {
    manifest,
    projectSaveLocation,
  },
  loginReducer,
  selectionsReducer: {
    selections,
    nothingToSelect,
  },
  contextIdReducer: { contextId },
  resourcesReducer,
  commentsReducer,
  toolsReducer,
  groupsDataReducer,
  remindersReducer,
  maximumSelections,
}) {
  return (
    <VerseCheck
      translate={translate}
      toggleNothingToSelect={nothingToSelect => this.setState({ nothingToSelect })}
      commentsReducer={commentsReducer}
      localNothingToSelect={this.state.nothingToSelect}
      remindersReducer={remindersReducer}
      projectDetailsReducer={{ manifest, projectSaveLocation }}
      contextIdReducer={{ contextId }}
      resourcesReducer={resourcesReducer}
      selectionsReducer={{ selections, nothingToSelect }}
      loginReducer={loginReducer}
      toolsReducer={toolsReducer}
      groupsDataReducer={groupsDataReducer}
      alignedGLText={alignedGLText}
      verseText={verseText}
      unfilteredVerseText={unfilteredVerseText}
      mode={this.state.mode}
      actions={this.actions}
      dialogModalVisibility={this.state.dialogModalVisibility}
      commentChanged={this.state.commentChanged}
      findIfVerseEdited={this.findIfVerseEdited}
      findIfVerseInvalidated={this.findIfVerseInvalidated}
      tags={this.state.tags}
      verseChanged={this.state.verseChanged}
      selections={this.state.selections}
      saveSelection={this.saveSelection}
      cancelSelection={this.cancelSelection}
      clearSelection={this.clearSelection}
      handleSkip={this.handleSkip}
      maximumSelections={maximumSelections}
    />
  );
}

VerseCheckWrapper.propTypes = {
  translate: PropTypes.func,
  currentToolName: PropTypes.string,
  remindersReducer: PropTypes.object,
  commentsReducer: PropTypes.object,
  resourcesReducer: PropTypes.object,
  selectionsReducer: PropTypes.shape({
    selections: PropTypes.array,
    nothingToSelect: PropTypes.bool,
  }),
  groupsDataReducer: PropTypes.object,
  loginReducer: PropTypes.object,
  contextIdReducer: PropTypes.shape({ contextId: PropTypes.object.isRequired }),
  toolsReducer: PropTypes.object,
  actions: PropTypes.shape({
    changeSelections: PropTypes.func.isRequired,
    goToNext: PropTypes.func.isRequired,
    goToPrevious: PropTypes.func.isRequired,
    onInvalidCheck: PropTypes.func.isRequired,
  }),
  projectDetailsReducer: PropTypes.object.isRequired,
  maximumSelections: PropTypes.number.isRequired,
};

export default VerseCheckWrapper;
