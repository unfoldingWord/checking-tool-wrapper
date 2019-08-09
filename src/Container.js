/* eslint-env jest */
import React from 'react';
import PropTypes from 'prop-types';
import { createTcuiTheme, TcuiThemeProvider } from 'tc-ui-toolkit';
//selectors
import {
  getContextId,
  getManifest,
  getToolsSelectedGLs,
  getGroupsIndex,
  getResourceByName,
  getSelections,
  getCurrentPaneSettings,
  getBibles
} from './selectors';
// helpers
import * as settingsHelper from './helpers/settingsHelper';
import * as selectionHelpers from './helpers/selectionHelpers';
// components
import GroupMenuWrapper from './components/GroupMenuWrapper';
import VerseCheckWrapper from './components/VerseCheckWrapper';
import TranslationHelpsWrapper from './components/TranslationHelpsWrapper';
import CheckInfoCardWrapper from './components/CheckInfoCardWrapper';
import ScripturePaneWrapper from './components/ScripturePaneWrapper';

class Container extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      showHelps: true,
      tHelpsLink: null,
    };
    this.toggleHelps = this.toggleHelps.bind(this);
    this.onThelpsLinkClick = this.onThelpsLinkClick.bind(this);
  }
  componentWillMount() {
    const { bibles } = this.props.scripturePane;
    settingsHelper.loadCorrectPaneSettings(this.props, this.props.tc.actions.setToolSettings, bibles);
  }

  toggleHelps() {
    this.setState({showHelps: !this.state.showHelps});
  }

  onThelpsLinkClick(link) {
    this.setState({showHelps: true, tHelpsLink: link});
  }

  render() {
    const {
      contextIdReducer: {contextId}
    } = this.props;

    const theme = createTcuiTheme({
      typography: {
        useNextVariants: true,
      },
      scrollbarThumb: {borderRadius: '10px'}
    });

    if (contextId !== null) {
      return (
        <TcuiThemeProvider theme={theme}>
          <div style={{display: 'flex', flexDirection: 'row', width: '100vw'}}>
            <GroupMenuWrapper {...this.props.groupMenu} />
            <div style={{display: 'flex', flexDirection: 'column', width: '100%', overflowX: 'auto'}}>
              <div style={{ height: '250px', paddingBottom: '20px' }}>
                <ScripturePaneWrapper {...this.props.scripturePane} />
              </div>
              <CheckInfoCardWrapper
                toggleHelps={this.toggleHelps.bind(this)}
                showHelps={this.state.showHelps}
                onThelpsLinkClink={this.onThelpsLinkClick.bind(this)}
                {...this.props.checkInfoCard}
              />
              <VerseCheckWrapper {...this.props.verseCheck} />
            </div>
            <TranslationHelpsWrapper
              toggleHelps={this.toggleHelps.bind(this)}
              showHelps={this.state.showHelps}
              tHelpsLink={this.state.tHelpsLink}
              {...this.props.translationHelps} />
          </div>
        </TcuiThemeProvider>
      );
    } else {
      return null;
    }
  }
}

Container.propTypes = {
  translationHelps: PropTypes.any,
  groupMenu: PropTypes.any,
  verseCheck: PropTypes.any,
  checkInfoCard: PropTypes.any,
  translate: PropTypes.func,
  settingsReducer: PropTypes.shape({
    toolsSettings: PropTypes.shape({
      ScripturePane: PropTypes.object
    })
  }),
  contextIdReducer: PropTypes.shape({
    contextId: PropTypes.shape({
      groupId: PropTypes.any
    })
  }),
  groupsIndexReducer: PropTypes.shape({
    groupsIndex: PropTypes.array
  }),
  projectDetailsReducer: PropTypes.shape({
    manifest: PropTypes.object.isRequired
  }),
  tc: PropTypes.shape({
    actions: PropTypes.shape({
      setToolSettings: PropTypes.func.isRequired,
      loadResourceArticle: PropTypes.func.isRequired,
      getGLQuote: PropTypes.func.isRequired,
      getSelectionsFromContextId: PropTypes.func.isRequired,
      onInvalidCheck: PropTypes.func.isRequired
    })
  }),
  scripturePane: PropTypes.object.isRequired
};

export const mapStateToProps = (state, ownProps) => {
  const legacyToolsReducer = {currentToolName: ownProps.tc.selectedToolName};
  return {
    groupMenu: {
      tc: ownProps.tc,
      groupsDataReducer: ownProps.tc.groupsDataReducer,
      groupsIndexReducer: ownProps.tc.groupsIndexReducer,
      translate: ownProps.translate
    },
    verseCheck: {
      translate: ownProps.translate,
      currentToolName: ownProps.tc.selectedToolName,
      projectDetailsReducer: ownProps.tc.projectDetailsReducer,
      loginReducer: ownProps.tc.loginReducer,
      resourcesReducer: ownProps.tc.resourcesReducer,
      commentsReducer: ownProps.tc.commentsReducer,
      selectionsReducer: ownProps.tc.selectionsReducer,
      contextIdReducer: ownProps.tc.contextIdReducer,
      toolsReducer: legacyToolsReducer,
      groupsDataReducer: ownProps.tc.groupsDataReducer,
      remindersReducer: ownProps.tc.remindersReducer,
      actions: ownProps.tc.actions,
      maximumSelections: selectionHelpers.getMaximumSelections(ownProps.tc.selectedToolName)
    },
    translationHelps: {
      translate: ownProps.translate,
      toolsSelectedGLs: getToolsSelectedGLs(ownProps),
      toolsReducer: legacyToolsReducer,
      resourcesReducer: ownProps.tc.resourcesReducer,
      contextIdReducer: ownProps.tc.contextIdReducer,
      actions: ownProps.tc.actions
    },
    checkInfoCard: {
      translate: ownProps.translate,
      translationHelps: getResourceByName(ownProps, 'translationHelps'),
      groupsIndex: getGroupsIndex(ownProps),
      contextId: getContextId(ownProps),
      resourcesReducer: ownProps.tc.resourcesReducer
    },
    scripturePane: {
      translate: ownProps.translate,
      manifest: getManifest(ownProps),
      selections: getSelections(ownProps),
      currentPaneSettings: getCurrentPaneSettings(ownProps),
      bibles: getBibles(ownProps),
      contextId: getContextId(ownProps),
      projectDetailsReducer: ownProps.tc.projectDetailsReducer,
      showPopover: ownProps.tc.actions.showPopover,
      editTargetVerse: ownProps.tc.actions.editTargetVerse,
      getLexiconData: ownProps.tc.actions.getLexiconData,
      setToolSettings: ownProps.tc.actions.setToolSettings,
      getAvailableScripturePaneSelections: ownProps.tc.actions.getAvailableScripturePaneSelections,
      makeSureBiblesLoadedForTool: ownProps.tc.actions.makeSureBiblesLoadedForTool
    }
  };
};


export default Container;
