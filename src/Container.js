/* eslint-env jest */
import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import isEqual from 'deep-equal';
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
  getBibles,
} from './selectors';
// helpers
import * as settingsHelper from './helpers/settingsHelper';
import * as selectionHelpers from './helpers/selectionHelpers';
import * as verseHelpers from './helpers/verseHelpers';
import * as checkAreaHelpers from './helpers/checkAreaHelpers';

// components
import GroupMenuWrapper from './components/GroupMenuWrapper';
import VerseCheckWrapper from './components/VerseCheckWrapper';
import TranslationHelpsWrapper from './components/TranslationHelpsWrapper';
import CheckInfoCardWrapper from './components/CheckInfoCardWrapper';
import ScripturePaneWrapper from './components/ScripturePaneWrapper';

function Container(props) {
  const theme = createTcuiTheme({
    typography: { useNextVariants: true },
    scrollbarThumb: { borderRadius: '10px' },
  });
  const [showHelps, setShowHelps] = useState(true);

  useEffect(() => {
    const { bibles } = props.scripturePane;
    settingsHelper.loadCorrectPaneSettings(props, props.tc.actions.setToolSettings, bibles);
  }, [props]);

  const { contextIdReducer: { contextId } } = props;

  if (contextId !== null) {
    return (
      <TcuiThemeProvider theme={theme}>
        <div style={{
          display: 'flex', flexDirection: 'row', width: '100vw',
        }}>
          <GroupMenuWrapper {...props.groupMenu} />
          <div style={{
            display: 'flex', flexDirection: 'column', width: '100%', overflowX: 'auto',
          }}>
            <div style={{ height: '250px', paddingBottom: '20px' }}>
              <ScripturePaneWrapper {...props.scripturePane} />
            </div>
            <CheckInfoCardWrapper
              toggleHelps={() => setShowHelps(!showHelps)}
              showHelps={showHelps}
              {...props.checkInfoCard}
            />
            <VerseCheckWrapper {...props.verseCheck} />
          </div>
          <TranslationHelpsWrapper
            toggleHelps={() => setShowHelps(!showHelps)}
            showHelps={showHelps}
            {...props.translationHelps} />
        </div>
      </TcuiThemeProvider>
    );
  } else {
    return null;
  }
}

Container.propTypes = {
  translationHelps: PropTypes.any,
  groupMenu: PropTypes.any,
  verseCheck: PropTypes.any,
  checkInfoCard: PropTypes.any,
  translate: PropTypes.func,
  settingsReducer: PropTypes.shape({ toolsSettings: PropTypes.shape({ ScripturePane: PropTypes.object }) }),
  contextIdReducer: PropTypes.shape({ contextId: PropTypes.shape({ groupId: PropTypes.any }) }),
  groupsIndexReducer: PropTypes.shape({ groupsIndex: PropTypes.array }),
  projectDetailsReducer: PropTypes.shape({ manifest: PropTypes.object.isRequired }),
  tc: PropTypes.shape({
    actions: PropTypes.shape({
      setToolSettings: PropTypes.func.isRequired,
      loadResourceArticle: PropTypes.func.isRequired,
      getGLQuote: PropTypes.func.isRequired,
      getSelectionsFromContextId: PropTypes.func.isRequired,
      onInvalidCheck: PropTypes.func.isRequired,
    }),
  }),
  scripturePane: PropTypes.object.isRequired,
};

export const mapStateToProps = (state, ownProps) => {
  const legacyToolsReducer = { currentToolName: ownProps.tc.selectedToolName };
  // TODO: Move code below to selectors once we have reducers w/ tools.
  const { targetBible } = ownProps.tc.resourcesReducer.bibles.targetLanguage;
  const { contextId } = ownProps.tc.contextIdReducer;
  const { verseText, unfilteredVerseText } = verseHelpers.getVerseText(targetBible, contextId);
  const { groupsData } = ownProps.tc.groupsDataReducer;
  let currentGroupItem;

  if (groupsData[contextId.groupId]) {
    currentGroupItem = groupsData[contextId.groupId].find(groupData => isEqual(groupData.contextId, contextId));
  } else {
    currentGroupItem = null;
  }

  const isVerseEdited = !!(currentGroupItem && currentGroupItem.verseEdits);
  const isVerseInvalidated = !!(currentGroupItem && currentGroupItem.invalidated);
  const currentToolName = ownProps.tc.selectedToolName;
  const manifest = ownProps.tc.projectDetailsReducer.manifest;
  const { toolsSelectedGLs } = manifest;
  const bibles = getBibles(ownProps);

  const alignedGLText = checkAreaHelpers.getAlignedGLText(
    toolsSelectedGLs,
    contextId,
    bibles,
    currentToolName,
    ownProps.translate,
  );

  return {
    groupMenu: {
      tc: ownProps.tc,
      groupsDataReducer: ownProps.tc.groupsDataReducer,
      groupsIndexReducer: ownProps.tc.groupsIndexReducer,
      translate: ownProps.translate,
    },
    verseCheck: {
      translate: ownProps.translate,
      manifest,
      targetBible,
      contextId,
      verseText,
      unfilteredVerseText,
      isVerseEdited,
      isVerseInvalidated,
      alignedGLText,
      maximumSelections: selectionHelpers.getMaximumSelections(ownProps.tc.selectedToolName),
      actions: ownProps.tc.actions,
      commentsReducer: ownProps.tc.commentsReducer,
      selectionsReducer: ownProps.tc.selectionsReducer,
      remindersReducer: ownProps.tc.remindersReducer,
    },
    translationHelps: {
      translate: ownProps.translate,
      toolsSelectedGLs: getToolsSelectedGLs(ownProps),
      toolsReducer: legacyToolsReducer,
      resourcesReducer: ownProps.tc.resourcesReducer,
      contextIdReducer: ownProps.tc.contextIdReducer,
      actions: ownProps.tc.actions,
    },
    checkInfoCard: {
      translate: ownProps.translate,
      translationHelps: getResourceByName(ownProps, 'translationHelps'),
      groupsIndex: getGroupsIndex(ownProps),
      contextId: getContextId(ownProps),
      resourcesReducer: ownProps.tc.resourcesReducer,
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
      makeSureBiblesLoadedForTool: ownProps.tc.actions.makeSureBiblesLoadedForTool,
    },
  };
};


export default Container;
