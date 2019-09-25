/* eslint-disable no-nested-ternary */
import React from 'react';
import PropTypes from 'prop-types';
import usfmjs from 'usfm-js';
import isEqual from 'deep-equal';
import { VerseCheck } from 'tc-ui-toolkit';
import { optimizeSelections, normalizeString } from '../helpers/selectionHelpers';
import * as checkAreaHelpers from '../helpers/checkAreaHelpers';

class VerseCheckWrapper extends React.Component {
  constructor(props) {
    super(props);

    let { verseText } = this.getVerseText();
    const mode = props.selectionsReducer &&
      props.selectionsReducer.selections &&
      props.selectionsReducer.selections.length > 0 || verseText.length === 0 ?
      'default' : props.selectionsReducer.nothingToSelect ? 'default' : 'select';
    const { nothingToSelect } = props.selectionsReducer;

    this.state = {
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
  }

  componentDidCatch(error, info) {
    console.error(error);
    console.warn(info);
  }

  componentWillMount() {
    let selections = [...this.props.selectionsReducer.selections];
    this.setState({ selections });
  }

  componentWillReceiveProps(nextProps) {
    const { contextIdReducer } = this.props || {};
    const nextContextIDReducer = nextProps.contextIdReducer;

    if (contextIdReducer !== nextContextIDReducer) {
      const selections = Array.from(nextProps.selectionsReducer.selections);
      const nothingToSelect = nextProps.selectionsReducer.nothingToSelect;
      const { chapter, verse } = nextContextIDReducer.contextId.reference || {};
      const { targetBible } = nextProps.resourcesReducer.bibles.targetLanguage || {};
      let verseText = targetBible && targetBible[chapter] ? targetBible[chapter][verse] : '';

      if (Array.isArray(verseText)) {
        verseText = verseText[0];
      }
      // normalize whitespace in case selection has contiguous whitespace _this isn't captured
      verseText = normalizeString(verseText);
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

  handleGoToNext = () => {
    if (!this.props.loginReducer.loggedInUser) {
      this.props.actions.selectModalTab(1, 1, true);
      this.props.actions.openAlertDialog('You must be logged in to save progress');
      return;
    }
    this.props.actions.goToNext();
  }

  handleGoToPrevious = () => {
    if (!this.props.loginReducer.loggedInUser) {
      this.props.actions.selectModalTab(1, 1, true);
      this.props.actions.openAlertDialog('You must be logged in to save progress');
      return;
    }
    this.props.actions.goToPrevious();
  }

  handleOpenDialog = (goToNextOrPrevious) => {
    this.setState({ goToNextOrPrevious });
    this.setState({ dialogModalVisibility: true });
  }

  handleCloseDialog = () => {
    this.setState({ dialogModalVisibility: false });
  }

  skipToNext = () => {
    this.setState({ dialogModalVisibility: false });
    this.props.actions.goToNext();
  }

  skipToPrevious = () => {
    this.setState({ dialogModalVisibility: false });
    this.props.actions.goToPrevious();
  }

  changeSelectionsInLocalState = (selections) => {
    const { nothingToSelect } = this.props.selectionsReducer;

    if (selections.length > 0) {
      this.setState({ nothingToSelect: false });
    } else {
      this.setState({ nothingToSelect });
    }
    this.setState({ selections });
  }

  changeMode = (mode) => {
    this.setState({
      mode: mode,
      selections: this.props.selectionsReducer.selections,
    });
  }

  handleComment = (e) => {
    const comment = e.target.value;

    this.setState({ comment: comment });
  }

  handleCheckComment = (e) => {
    const newcomment = e.target.value || '';
    const oldcomment = this.props.commentsReducer.text || '';

    this.setState({ commentChanged: newcomment !== oldcomment });
  }

  cancelComment = () => {
    this.setState({
      mode: 'default',
      selections: this.props.selectionsReducer.selections,
      comment: undefined,
      commentChanged: false,
    });
  }

  saveComment = () => {
    if (!this.props.loginReducer.loggedInUser) {
      this.props.actions.selectModalTab(1, 1, true);
      this.props.actions.openAlertDialog('You must be logged in to leave a comment', 5);
      return;
    }
    this.props.actions.addComment(this.state.comment, this.props.loginReducer.userdata.username);
    this.setState({
      mode: 'default',
      selections: this.props.selectionsReducer.selections,
      comment: undefined,
      commentChanged: false,
    });
  }

  handleTagsCheckbox = (tag) => {
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
  }

  handleEditVerse = (e) => {
    const verseText = e.target.value;

    this.setState({ verseText: verseText });
  }

  handleCheckVerse = (e) => {
    let { chapter, verse } = this.props.contextIdReducer.contextId.reference;
    const newverse = e.target.value || '';
    const oldverse = this.props.resourcesReducer.bibles.targetLanguage.targetBible[chapter][verse] || '';

    if (newverse === oldverse) {
      this.setState({
        verseChanged: false,
        tags: [],
      });
    } else {
      this.setState({ verseChanged: true });
    }
  }

  cancelEditVerse = () => {
    this.setState({
      mode: 'default',
      selections: this.props.selectionsReducer.selections,
      verseText: undefined,
      verseChanged: false,
      tags: [],
    });
  }

  saveEditVerse = () => {
    let {
      loginReducer, actions, contextIdReducer, resourcesReducer,
    } = this.props;
    let { chapter, verse } = contextIdReducer.contextId.reference;
    let before = resourcesReducer.bibles.targetLanguage.targetBible[chapter][verse];
    let username = loginReducer.userdata.username;

    // verseText state is undefined if no changes are made in the text box.
    if (!loginReducer.loggedInUser) {
      actions.selectModalTab(1, 1, true);
      actions.openAlertDialog('You must be logged in to edit a verse');
      return;
    }

    const save = () => {
      actions.editTargetVerse(chapter, verse, before, this.state.verseText, this.state.tags, username);
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
  }

  validateSelections = (verseText) => {
    this.props.actions.validateSelections(verseText);
  }

  toggleReminder = () => {
    this.props.actions.toggleReminder(this.props.loginReducer.userdata.username);
  }

  openAlertDialog = (message) => {
    this.props.actions.openAlertDialog(message);
  }

  selectModalTab = (tab, section, vis) => {
    this.props.actions.selectModalTab(tab, section, vis);
  }

  /**
   * get filtered and unfiltered verse text
   * @return {{verseText: string, unfilteredVerseText: string}}
   */
  getVerseText = () => {
    let unfilteredVerseText = '';
    let verseText = '';

    if (this.props.contextIdReducer && this.props.contextIdReducer.contextId) {
      const {
        chapter, verse, bookId,
      } = this.props.contextIdReducer.contextId.reference;
      const bookAbbr = this.props.projectDetailsReducer.manifest.project.id;
      const { targetBible } = this.props.resourcesReducer.bibles.targetLanguage;

      if (targetBible && targetBible[chapter] && bookId === bookAbbr) {
        unfilteredVerseText = targetBible && targetBible[chapter] ? targetBible[chapter][verse] : '';

        if (Array.isArray(unfilteredVerseText)) {
          unfilteredVerseText = unfilteredVerseText[0];
        }
        // normalize whitespace in case selection has contiguous whitespace _this isn't captured
        verseText = normalizeString(unfilteredVerseText);
      }
    }
    return { unfilteredVerseText, verseText };
  }

  cancelSelection = () => {
    const { nothingToSelect } = this.props.selectionsReducer;
    this.setState({ nothingToSelect });
    this.changeSelectionsInLocalState(this.props.selectionsReducer.selections);
    this.changeMode('default');
  }

  clearSelection = () => {
    this.setState({ selections: [] });
  }

  saveSelection = () => {
    let { verseText } = this.getVerseText();
    // optimize the selections to address potential issues and save
    let selections = optimizeSelections(verseText, this.state.selections);
    const { username } = this.props.loginReducer.userdata;
    this.props.actions.changeSelections(selections, username, this.state.nothingToSelect);
    this.changeMode('default');
  }

  /**
   * returns true if current verse has been edited
   * @return {boolean}
   */
  findIfVerseEdited = (groupItem) => !!(groupItem && groupItem.verseEdits)

  /**
   * returns true if current verse has been invalidated
   * @return {boolean}
   */
  findIfVerseInvalidated = (groupItem) => !!(groupItem && groupItem.invalidated)

  /**
   * finds group data for current context (verse)
   * @return {*}
   * TODO: We should remove the need to loop trough groupsdata to find the current groupData. This may be slowing down the app. This could be done once in a higher level component or even better in the groupData reducer
   */
  getGroupDatumForCurrentContext = () => {
    const { contextIdReducer: { contextId }, groupsDataReducer: { groupsData } } = this.props;
    let groupItem = null;

    if (groupsData[contextId.groupId]) {
      groupItem = groupsData[contextId.groupId].find(groupData => isEqual(groupData.contextId, contextId));
    }
    return groupItem;
  }

  handleSkip = (e) => {
    e.preventDefault();

    if (this.state.goToNextOrPrevious == 'next') {
      this.skipToNext();
    } else if (this.state.goToNextOrPrevious == 'previous') {
      this.skipToPrevious();
    }
  }

  onInvalidQuote = (contextId, selectedGL) => {
    // to prevent multiple alerts on current selection
    if (!isEqual(contextId, this.state.lastContextId)) {
      this.props.actions.onInvalidCheck(contextId, selectedGL, true);
      this.setState({ lastContextId: contextId });
    }
  }

  toggleNothingToSelect = (nothingToSelect) => {
    this.setState({ nothingToSelect });
  }

  render() {
    const {
      translate,
      currentToolName,
      projectDetailsReducer: { manifest },
      selectionsReducer: {
        selections,
        nothingToSelect,
      },
      contextIdReducer: { contextId },
      resourcesReducer: { bibles },
      commentsReducer: { text: commentText },
      remindersReducer: { enabled: bookmarkEnabled },
      maximumSelections,
    } = this.props;

    let { unfilteredVerseText, verseText } = this.getVerseText();
    verseText = usfmjs.removeMarker(verseText);
    const { toolsSelectedGLs } = manifest;
    const alignedGLText = checkAreaHelpers.getAlignedGLText(
      toolsSelectedGLs,
      contextId,
      bibles,
      currentToolName,
      translate,
      this.onInvalidQuote
    );
    const groupItem = this.getGroupDatumForCurrentContext();
    const verseEdited = this.findIfVerseEdited(groupItem);
    const isVerseInvalidated = this.findIfVerseInvalidated(groupItem);

    return (
      <VerseCheck
        translate={translate}
        mode={this.state.mode}
        tags={this.state.tags}
        bibles={bibles}
        verseText={verseText || ''}
        unfilteredVerseText={unfilteredVerseText || ''}
        contextId={contextId}
        selections={selections}
        verseEdited={verseEdited}
        commentText={commentText || ''}
        alignedGLText={alignedGLText}
        nothingToSelect={nothingToSelect}
        bookmarkEnabled={bookmarkEnabled}
        maximumSelections={maximumSelections}
        isVerseInvalidated={isVerseInvalidated}
        bookDetails={manifest.project}
        targetLanguageDetails={manifest.target_language}
        newSelections={this.state.selections}
        verseChanged={this.state.verseChanged}
        localNothingToSelect={this.state.nothingToSelect}
        dialogModalVisibility={this.state.dialogModalVisibility}
        commentChanged={this.state.commentChanged}
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

/*TODO: Remove the following reducers
  toolsReducer
  groupsDataReducer
  loginReducer

  Remove username as parameter from toggleReminder action
    this.props.actions.toggleReminder(this.props.loginReducer.userdata.username);

*/

export default VerseCheckWrapper;
