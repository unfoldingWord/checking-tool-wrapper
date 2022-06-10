/* eslint-env jest */
import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { createTcuiTheme, TcuiThemeProvider } from 'tc-ui-toolkit';
import { connect } from 'react-redux';
// helpers
import * as settingsHelper from './helpers/settingsHelper';
import { getThelpsManifestRelation } from './helpers/resourcesHelpers';
// components
import GroupMenuContainer from './containers/GroupMenuContainer';
import VerseCheckWrapper from './components/VerseCheckWrapper';
import TranslationHelpsWrapper from './components/TranslationHelpsWrapper';
import CheckInfoCardWrapper from './components/CheckInfoCardWrapper';
import ScripturePaneWrapper from './components/ScripturePaneWrapper';
// selectors
import {
  getBibles,
  getContextId,
  getCurrentPaneSettings,
  getCurrentToolName,
  getGatewayLanguageBibles,
  getGatewayLanguageCode,
  getTcState,
  getToolApi,
  getTranslateState,
} from './selectors';
import { getAlignedGLTextHelper } from './helpers/gatewayLanguageHelpers';

const theme = createTcuiTheme({
  typography: { useNextVariants: true },
  scrollbarThumb: { borderRadius: '10px' },
});

const styles = {
  containerDiv:{
    display: 'flex',
    flexDirection: 'row',
    width: '100vw',
  },
  centerDiv: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    overflowX: 'auto',
  },
  scripturePaneDiv: {
    display: 'flex',
    flexShrink: '0',
    height: '250px',
    paddingBottom: '20px',
  },
};

function Container({
  tc,
  bibles,
  toolApi,
  translate,
  contextId,
  setToolSettings,
  gatewayLanguageCode,
  currentPaneSettings,
  gatewayLanguageQuote,
}) {
  const [showHelps, setShowHelps] = useState(true);

  useEffect(() => {
    settingsHelper.loadCorrectPaneSettings(setToolSettings, bibles, gatewayLanguageCode, currentPaneSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TcuiThemeProvider theme={theme}>
      <div style={styles.containerDiv}>
        <GroupMenuContainer
          tc={tc}
          translate={translate}
          gatewayLanguageQuote={gatewayLanguageQuote}
        />
        <div style={styles.centerDiv}>
          <div style={styles.scripturePaneDiv}>
            <ScripturePaneWrapper
              tc={tc}
              toolApi={toolApi}
              translate={translate}
            />
          </div>
          <CheckInfoCardWrapper
            tc={tc}
            translate={translate}
            showHelps={showHelps}
            toggleHelps={() => setShowHelps(!showHelps)}
          />
          <VerseCheckWrapper
            tc={tc}
            toolApi={toolApi}
            translate={translate}
            contextId={contextId}
            gatewayLanguageQuote={gatewayLanguageQuote}
          />
        </div>
        <TranslationHelpsWrapper
          tc={tc}
          showHelps={showHelps}
          translate={translate}
          toggleHelps={() => setShowHelps(!showHelps)}
        />
      </div>
    </TcuiThemeProvider>
  );
}

Container.propTypes = {
  tc: PropTypes.object.isRequired,
  bibles: PropTypes.object.isRequired,
  toolApi: PropTypes.object.isRequired,
  translate: PropTypes.func.isRequired,
  contextId: PropTypes.object.isRequired,
  setToolSettings: PropTypes.func.isRequired,
  currentPaneSettings: PropTypes.array.isRequired,
  gatewayLanguageCode: PropTypes.string.isRequired,
  gatewayLanguageQuote: PropTypes.string.isRequired,
};

export const mapStateToProps = (state, ownProps) => {
  const gatewayLanguageCode = getGatewayLanguageCode(ownProps);
  const contextId = getContextId(state);
  const glBibles = getGatewayLanguageBibles(ownProps);
  const toolName = getCurrentToolName(ownProps);
  const tsvRelation = getThelpsManifestRelation(gatewayLanguageCode, toolName);
  const gatewayLanguageQuote = getAlignedGLTextHelper(contextId, glBibles, gatewayLanguageCode, tsvRelation, true);
  const tc = getTcState(ownProps);
  const toolApi = getToolApi(ownProps);

  return {
    tc,
    toolApi,
    contextId,
    gatewayLanguageCode,
    gatewayLanguageQuote,
    bibles: getBibles(ownProps),
    translate: getTranslateState(ownProps),
    setToolSettings: tc.setToolSettings,
    currentPaneSettings: getCurrentPaneSettings(ownProps),
  };
};

export default connect(mapStateToProps)(Container);
