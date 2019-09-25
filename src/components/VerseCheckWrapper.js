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
    this.getVerseText = this.getVerseText.bind(this);
    this.saveSelection = this.saveSelection.bind(this);
    this.cancelSelection = this.cancelSelection.bind(this);
    this.clearSelection = this.clearSelection.bind(this);
    this.handleSkip = this.handleSkip.bind(this);
    this.findIfVerseEdited = this.findIfVerseEdited.bind(this);
    this.findIfVerseInvalidated = this.findIfVerseInvalidated.bind(this);
    this.onInvalidQuote = this.onInvalidQuote.bind(this);

    //TODO: factor out actions object to individual functions
    //Will require changes to the ui kit
    const _this = this;

    this.actions = {
      handleGoToNext() {
        if (!_this.props.loginReducer.loggedInUser) {
          _this.props.actions.selectModalTab(1, 1, true);
          _this.props.actions.openAlertDialog('You must be logged in to save progress');
          return;
        }
        props.actions.goToNext();
      },
      handleGoToPrevious() {
        if (!_this.props.loginReducer.loggedInUser) {
          _this.props.actions.selectModalTab(1, 1, true);
          _this.props.actions.openAlertDialog('You must be logged in to save progress');
          return;
        }
        props.actions.goToPrevious();
      },
      handleOpenDialog(goToNextOrPrevious) {
        _this.setState({ goToNextOrPrevious });
        _this.setState({ dialogModalVisibility: true });
      },
      handleCloseDialog() {
        _this.setState({ dialogModalVisibility: false });
      },
      skipToNext() {
        _this.setState({ dialogModalVisibility: false });
        props.actions.goToNext();
      },
      skipToPrevious() {
        _this.setState({ dialogModalVisibility: false });
        props.actions.goToPrevious();
      },
      changeSelectionsInLocalState(selections) {
        const { nothingToSelect } = _this.props.selectionsReducer;

        if (selections.length > 0) {
          _this.setState({ nothingToSelect: false });
        } else {
          _this.setState({ nothingToSelect });
        }
        _this.setState({ selections });
      },
      changeMode(mode) {
        _this.setState({
          mode: mode,
          selections: _this.props.selectionsReducer.selections,
        });
      },
      handleComment(e) {
        const comment = e.target.value;

        _this.setState({ comment: comment });
      },
      handleCheckComment(e) {
        const newcomment = e.target.value || '';
        const oldcomment = _this.props.commentsReducer.text || '';

        _this.setState({ commentChanged: newcomment !== oldcomment });
      },
      cancelComment() {
        _this.setState({
          mode: 'default',
          selections: _this.props.selectionsReducer.selections,
          comment: undefined,
          commentChanged: false,
        });
      },
      saveComment() {
        if (!_this.props.loginReducer.loggedInUser) {
          _this.props.actions.selectModalTab(1, 1, true);
          _this.props.actions.openAlertDialog('You must be logged in to leave a comment', 5);
          return;
        }
        _this.props.actions.addComment(_this.state.comment, _this.props.loginReducer.userdata.username);
        _this.setState({
          mode: 'default',
          selections: _this.props.selectionsReducer.selections,
          comment: undefined,
          commentChanged: false,
        });
      },
      handleTagsCheckbox(tag) {
        let newState = _this.state;

        if (newState.tags === undefined) {
          newState.tags = [];
        }

        if (!newState.tags.includes(tag)) {
          newState.tags.push(tag);
        } else {
          newState.tags = newState.tags.filter(_tag => _tag !== tag);
        }
        _this.setState(newState);
      },
      handleEditVerse(e) {
        const verseText = e.target.value;

        _this.setState({ verseText: verseText });
      },
      handleCheckVerse(e) {
        let { chapter, verse } = _this.props.contextIdReducer.contextId.reference;
        const newverse = e.target.value || '';
        const oldverse = _this.props.resourcesReducer.bibles.targetLanguage.targetBible[chapter][verse] || '';

        if (newverse === oldverse) {
          _this.setState({
            verseChanged: false,
            tags: [],
          });
        } else {
          _this.setState({ verseChanged: true });
        }
      },
      cancelEditVerse() {
        _this.setState({
          mode: 'default',
          selections: _this.props.selectionsReducer.selections,
          verseText: undefined,
          verseChanged: false,
          tags: [],
        });
      },
      saveEditVerse() {
        let {
          loginReducer, actions, contextIdReducer, resourcesReducer,
        } = _this.props;
        let { chapter, verse } = contextIdReducer.contextId.reference;
        let before = resourcesReducer.bibles.targetLanguage.targetBible[chapter][verse];
        let username = loginReducer.userdata.username;

        // verseText state is undefined if no changes are made in the text box.
        if (!loginReducer.loggedInUser) {
          _this.props.actions.selectModalTab(1, 1, true);
          _this.props.actions.openAlertDialog('You must be logged in to edit a verse');
          return;
        }

        const save = () => {
          actions.editTargetVerse(chapter, verse, before, _this.state.verseText, _this.state.tags, username);
          _this.setState({
            mode: 'default',
            selections: _this.props.selectionsReducer.selections,
            verseText: undefined,
            verseChanged: false,
            tags: [],
          });
        };

        if (_this.state.verseText) {
          save();
        } else {
          // alert the user if the text is blank
          let message = 'You are saving a blank verse. Please confirm.';

          _this.props.actions.openOptionDialog(message, (option) => {
            if (option !== 'Cancel') {
              save();
            }
            _this.props.actions.closeAlertDialog();
          }, 'Save Blank Verse', 'Cancel');
        }
      },
      validateSelections(verseText) {
        _this.props.actions.validateSelections(verseText);
      },
      toggleReminder() {
        _this.props.actions.toggleReminder(_this.props.loginReducer.userdata.username);
      },
      openAlertDialog(message) {
        _this.props.actions.openAlertDialog(message);
      },
      selectModalTab(tab, section, vis) {
        _this.props.actions.selectModalTab(tab, section, vis);
      },
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

  /**
   * get filtered and unfiltered verse text
   * @return {{verseText: string, unfilteredVerseText: string}}
   */
  getVerseText() {
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


  cancelSelection() {
    const { nothingToSelect } = this.props.selectionsReducer;
    this.setState({ nothingToSelect });
    this.actions.changeSelectionsInLocalState(this.props.selectionsReducer.selections);
    this.actions.changeMode('default');
  }

  clearSelection() {
    this.setState({ selections: [] });
  }

  saveSelection() {
    let { verseText } = this.getVerseText();
    // optimize the selections to address potential issues and save
    let selections = optimizeSelections(verseText, this.state.selections);
    const { username } = this.props.loginReducer.userdata;
    this.props.actions.changeSelections(selections, username, this.state.nothingToSelect);
    this.actions.changeMode('default');
  }

  /**
   * returns true if current verse has been edited
   * @return {boolean}
   */
  findIfVerseEdited() {
    const groupItem = this.getGroupDatumForCurrentContext();
    return !!(groupItem && groupItem.verseEdits);
  }

  /**
   * returns true if current verse has been invalidated
   * @return {boolean}
   */
  findIfVerseInvalidated() {
    const groupItem = this.getGroupDatumForCurrentContext();
    return !!(groupItem && groupItem.invalidated);
  }

  /**
   * finds group data for current context (verse)
   * @return {*}
   */
  getGroupDatumForCurrentContext() {
    const { contextIdReducer: { contextId }, groupsDataReducer: { groupsData } } = this.props;
    let groupItem = null;

    if (groupsData[contextId.groupId]) {
      groupItem = groupsData[contextId.groupId].find(groupData => isEqual(groupData.contextId, contextId));
    }
    return groupItem;
  }

  handleSkip(e) {
    e.preventDefault();

    if (this.state.goToNextOrPrevious == 'next') {
      this.actions.skipToNext();
    } else if (this.state.goToNextOrPrevious == 'previous') {
      this.actions.skipToPrevious();
    }
  }

  onInvalidQuote(contextId, selectedGL) {
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
    const verseEdited = this.findIfVerseEdited();
    const isVerseInvalidated = this.findIfVerseInvalidated();

    return (
      <VerseCheck
        translate={translate}
        mode={this.state.mode}
        tags={this.state.tags}
        bibles={bibles}
        verseText={verseText}
        unfilteredVerseText={unfilteredVerseText}
        contextId={contextId}
        selections={selections}
        verseEdited={verseEdited}
        commentText={commentText}
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
        toggleNothingToSelect={this.toggleNothingToSelect}
        saveSelection={this.saveSelection}
        cancelSelection={this.cancelSelection}
        clearSelection={this.clearSelection}
        handleSkip={this.handleSkip}
        {...this.actions}//TODO: After refactoring the actions object pass methods explicitly.
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
*/

export default VerseCheckWrapper;
