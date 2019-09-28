/* eslint-disable no-nested-ternary */
import React from 'react';
import PropTypes from 'prop-types';
import isEqual from 'deep-equal';
import { VerseCheck } from 'tc-ui-toolkit';
import { optimizeSelections, normalizeString } from '../helpers/selectionHelpers';

class VerseCheckWrapper extends React.Component {
  constructor(props) {//✅
    super(props);

    let { verseText } = this.props;//✅
    const mode = props.selectionsReducer &&
      props.selectionsReducer.selections &&
      props.selectionsReducer.selections.length > 0 || verseText.length === 0 ?
      'default' : props.selectionsReducer.nothingToSelect ? 'default' : 'select';//✅
    const { nothingToSelect } = props.selectionsReducer;//✅

    this.state = { //✅
      mode: mode,
      comment: undefined,
      commentChanged: false,
      verseText: undefined,
      verseChanged: false,
      selections: [],
      nothingToSelect,
      tags: [],
      dialogModalVisibility: false,
      goToNextOrPrevious: null,
    };
  }//✅

  componentDidCatch(error, info) {
    console.error(error);
    console.warn(info);
  }

  componentWillMount() {//✅
    let selections = [...this.props.selectionsReducer.selections];
    this.setState({ selections });
  }//✅

  componentWillReceiveProps(nextProps) {//✅👀
    const { contextId } = this.props || {};//✅
    const nextContextId = nextProps;//✅

    if (contextId !== nextContextId) {//✅
      const selections = Array.from(nextProps.selectionsReducer.selections);//✅
      const nothingToSelect = nextProps.selectionsReducer.nothingToSelect;//✅

      const { chapter, verse } = nextContextId.reference || {};//✅
      const targetBible = nextProps.targetBible || {};//✅
      let verseText = targetBible && targetBible[chapter] ? targetBible[chapter][verse] : '';//✅

      if (Array.isArray(verseText)) {//✅
        verseText = verseText[0];//✅
      }//✅
      // normalize whitespace in case selection has contiguous whitespace _this isn't captured
      verseText = normalizeString(verseText);//✅
      const mode = nextProps.selectionsReducer.selections.length > 0 || verseText.length === 0 ?
        'default' : nextProps.selectionsReducer.nothingToSelect ? 'default' : 'select';

      this.setState({
        mode: mode,
        comments: undefined,
        verseText: undefined,
        selections,
        nothingToSelect,
        tags: [],
        lastContextId: undefined,
      });
    }
  }

  handleGoToNext = () => {//✅
    this.props.actions.goToNext();
  }//✅

  handleGoToPrevious = () => {//✅
    this.props.actions.goToPrevious();
  }//✅

  handleOpenDialog = (goToNextOrPrevious) => {//✅
    this.setState({ goToNextOrPrevious });
    this.setState({ dialogModalVisibility: true });
  }//✅

  handleCloseDialog = () => {//✅
    this.setState({ dialogModalVisibility: false });
  }//✅

  skipToNext = () => {//✅
    this.setState({ dialogModalVisibility: false });
    this.props.actions.goToNext();
  }//✅

  skipToPrevious = () => {//✅
    this.setState({ dialogModalVisibility: false });
    this.props.actions.goToPrevious();
  }//✅

  changeSelectionsInLocalState = (selections) => {//✅
    const { nothingToSelect } = this.props.selectionsReducer;

    if (selections.length > 0) {
      this.setState({ nothingToSelect: false });
    } else {
      this.setState({ nothingToSelect });
    }
    this.setState({ selections });
  }//✅

  changeMode = (mode) => {//✅
    this.setState({
      mode: mode,
      selections: this.props.selectionsReducer.selections,
    });
  }//✅

  handleComment = (e) => {//✅
    const comment = e.target.value;

    this.setState({ comment: comment });
  }//✅

  handleCheckComment = (e) => {//✅
    const newcomment = e.target.value || '';
    const oldcomment = this.props.commentsReducer.text || '';

    this.setState({ commentChanged: newcomment !== oldcomment });
  }//✅

  cancelComment = () => {//✅
    this.setState({
      mode: 'default',
      selections: this.props.selectionsReducer.selections,
      comment: undefined,
      commentChanged: false,
    });
  }//✅

  saveComment = () => {//✅
    this.props.actions.addComment(this.state.comment);
    this.setState({
      mode: 'default',
      selections: this.props.selectionsReducer.selections,
      comment: undefined,
      commentChanged: false,
    });
  }//✅

  handleTagsCheckbox = (tag) => {//✅
    let newState = this.state;

    if (newState.tags === undefined) {
      newState.tags = [];
    }

    if (!newState.tags.includes(tag)) {
      newState.tags.push(tag);
    } else {
      newState.tags = newState.tags.filter(_tag => _tag !== tag);
    }
    this.setState(newState);
  }//✅

  handleEditVerse = (e) => {//✅
    const verseText = e.target.value;

    this.setState({ verseText: verseText });
  }//✅

  handleCheckVerse = (e) => {//✅
    const { chapter, verse } = this.props.contextId.reference;
    const newverse = e.target.value || '';
    const oldverse = this.props.targetBible[chapter][verse] || '';

    if (newverse === oldverse) {
      this.setState({
        verseChanged: false,
        tags: [],
      });
    } else {
      this.setState({ verseChanged: true });
    }
  }//✅

  cancelEditVerse = () => {//✅
    this.setState({
      mode: 'default',
      selections: this.props.selectionsReducer.selections,
      verseText: undefined,
      verseChanged: false,
      tags: [],
    });
  }//✅

  saveEditVerse = () => {//✅
    const {
      actions, contextId, targetBible,
    } = this.props;
    const { chapter, verse } = contextId.reference;
    let before = targetBible[chapter][verse];

    const save = () => {
      actions.editTargetVerse(chapter, verse, before, this.state.verseText, this.state.tags);
      this.setState({
        mode: 'default',
        selections: this.props.selectionsReducer.selections,
        verseText: undefined,
        verseChanged: false,
        tags: [],
      });
    };

    if (this.state.verseText) {
      save();
    } else {
      // alert the user if the text is blank
      let message = 'You are saving a blank verse. Please confirm.';

      actions.openOptionDialog(message, (option) => {
        if (option !== 'Cancel') {
          save();
        }
        actions.closeAlertDialog();
      }, 'Save Blank Verse', 'Cancel');
    }
  }//✅

  validateSelections = (verseText) => {//✅
    this.props.actions.validateSelections(verseText);
  }//✅

  toggleReminder = () => {//✅
    this.props.actions.toggleReminder();
  }//✅

  openAlertDialog = (message) => {//✅
    this.props.actions.openAlertDialog(message);
  }//✅

  selectModalTab = (tab, section, vis) => {//✅
    this.props.actions.selectModalTab(tab, section, vis);
  }//✅

  cancelSelection = () => {//✅
    const { nothingToSelect } = this.props.selectionsReducer;
    this.setState({ nothingToSelect });
    this.changeSelectionsInLocalState(this.props.selectionsReducer.selections);
    this.changeMode('default');
  }//✅

  clearSelection = () => {//✅
    this.setState({ selections: [] });
  }//✅

  saveSelection = () => {//✅
    let { verseText } = this.props;
    // optimize the selections to address potential issues and save
    let selections = optimizeSelections(verseText, this.state.selections);
    this.props.actions.changeSelections(selections, this.state.nothingToSelect);
    this.changeMode('default');
  }//✅

  handleSkip = (e) => {//✅
    e.preventDefault();

    if (this.state.goToNextOrPrevious == 'next') {
      this.skipToNext();
    } else if (this.state.goToNextOrPrevious == 'previous') {
      this.skipToPrevious();
    }
  }//✅

  onInvalidQuote = (contextId, selectedGL) => {// !
    // to prevent multiple alerts on current selection
    if (!isEqual(contextId, this.state.lastContextId)) {
      this.props.actions.onInvalidCheck(contextId, selectedGL, true);
      this.setState({ lastContextId: contextId });
    }
  }// !

  toggleNothingToSelect = (nothingToSelect) => {//✅
    this.setState({ nothingToSelect });
  }//✅

  render() {
    const { //✅
      translate,
      manifest,
      selectionsReducer: {
        selections,
        nothingToSelect,
      },
      contextId,
      targetBible,
      verseText,
      unfilteredVerseText,
      commentsReducer: { text: commentText },
      remindersReducer: { enabled: bookmarkEnabled },
      maximumSelections,
      isVerseEdited,
      isVerseInvalidated,
      alignedGLText,
    } = this.props;//✅

    return (
      <VerseCheck
        translate={translate}
        mode={this.state.mode}
        tags={this.state.tags}
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
        newSelections={this.state.selections}
        isVerseChanged={this.state.verseChanged}
        isCommentChanged={this.state.commentChanged}
        localNothingToSelect={this.state.nothingToSelect}
        dialogModalVisibility={this.state.dialogModalVisibility}
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
        checkIfVerseChanged={this.handleCheckVerse}
        checkIfCommentChanged={this.handleCheckComment}
        validateSelections={this.validateSelections}
        handleTagsCheckbox={this.handleTagsCheckbox}
        toggleNothingToSelect={this.toggleNothingToSelect}
        changeSelectionsInLocalState={this.changeSelectionsInLocalState}
      />
    );
  }
}

VerseCheckWrapper.propTypes = {
  translate: PropTypes.func.isRequired,
  remindersReducer: PropTypes.object,
  commentsReducer: PropTypes.object,
  targetBible: PropTypes.object.isRequired,
  contextId: PropTypes.object.isRequired,
  verseText: PropTypes.string.isRequired,
  unfilteredVerseText: PropTypes.string.isRequired,
  manifest: PropTypes.object.isRequired,
  maximumSelections: PropTypes.number.isRequired,
  isVerseEdited: PropTypes.bool.isRequired,
  isVerseInvalidated: PropTypes.bool.isRequired,
  alignedGLText: PropTypes.string.isRequired,
  selectionsReducer: PropTypes.shape({
    selections: PropTypes.array,
    nothingToSelect: PropTypes.bool,
  }),
  actions: PropTypes.shape({
    changeSelections: PropTypes.func.isRequired,
    goToNext: PropTypes.func.isRequired,
    goToPrevious: PropTypes.func.isRequired,
    onInvalidCheck: PropTypes.func.isRequired,
    selectModalTab: PropTypes.func.isRequired,
    openAlertDialog: PropTypes.func.isRequired,
    addComment: PropTypes.func.isRequired,
    editTargetVerse: PropTypes.func.isRequired,
    openOptionDialog: PropTypes.func.isRequired,
    closeAlertDialog: PropTypes.func.isRequired,
    validateSelections: PropTypes.func.isRequired,
    toggleReminder: PropTypes.func.isRequired,
  }),
};

/*TODO: Remove the following reducers
  removed groupsDataReducer
  removed loginReducer

  Changed addComment to not need username as argument
    ?  actions.addComment(newComment, loginReducer.userdata.username);
  Removed username as parameter from toggleReminder action
    this.props.actions.toggleReminder(this.props.loginReducer.userdata.username);
    Same for actions.editTargetVerse
        this.props.actions.toggleReminder(this.props.loginReducer.userdata.username);
            this.props.actions.changeSelections(selections, username, this.state.nothingToSelect);

  Removed the bibles prop and only pass targetBible since it is the only one needed.

  verseText is now calculated in the highest level component and passed down so we dont have to process getting it multiple times

  Reworked alignedGLText
      const { toolsSelectedGLs } = manifest;

    const alignedGLText = checkAreaHelpers.getAlignedGLText(
      toolsSelectedGLs,
      contextId,
      bibles,
      currentToolName,
      translate,
      this.onInvalidQuote
    );
*/

export default VerseCheckWrapper;
