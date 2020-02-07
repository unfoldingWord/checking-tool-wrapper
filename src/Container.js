/* eslint-env jest */
import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { createTcuiTheme, TcuiThemeProvider } from 'tc-ui-toolkit';
import { connect } from 'react-redux';
// helpers
import * as settingsHelper from './helpers/settingsHelper';
// components
import GroupMenuContainer from './containers/GroupMenuContainer';
import VerseCheckWrapper from './components/VerseCheckWrapper';
import TranslationHelpsWrapper from './components/TranslationHelpsWrapper';
import CheckInfoCardWrapper from './components/CheckInfoCardWrapper';
import ScripturePaneWrapper from './components/ScripturePaneWrapper';
// selectors
import {
  getTcState,
  getTranslateState,
  getContextId,
  getBibles,
  getGatewayLanguageCode,
  getCurrentPaneSettings,
  getGatewayLanguageBibles,
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
    height: '250px',
    paddingBottom: '20px',
  },
};

function Container({
  tc,
  bibles,
  translate,
  contextId,
  setToolSettings,
  gatewayLanguage,
  currentPaneSettings,
  gatewayLanguageQuote,
}) {
  const [showHelps, setShowHelps] = useState(true);

  useEffect(() => {
    settingsHelper.loadCorrectPaneSettings(setToolSettings, bibles, gatewayLanguage, currentPaneSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  console.log('tc', tc);
  console.log('contextId', contextId);

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
  translate: PropTypes.func.isRequired,
  contextId: PropTypes.object.isRequired,
  alignedText: PropTypes.string.isRequired,
  setToolSettings: PropTypes.func.isRequired,
  gatewayLanguage: PropTypes.string.isRequired,
  currentPaneSettings: PropTypes.array.isRequired,
  gatewayLanguageQuote: PropTypes.string.isRequired,
};

export const mapStateToProps = (state, ownProps) => {
  const gatewayLanguage = getGatewayLanguageCode(ownProps);
  const contextId = getContextId(state);
  const glBibles = getGatewayLanguageBibles(ownProps);
  const gatewayLanguageQuote = getAlignedGLTextHelper(contextId, glBibles);
  const tc = getTcState(ownProps);

  return {
    tc,
    contextId,
    gatewayLanguage,
    gatewayLanguageQuote,
    bibles: getBibles(ownProps),
    translate: getTranslateState(ownProps),
    setToolSettings: tc.setToolSettings,
    currentPaneSettings: getCurrentPaneSettings(ownProps),
  };
};

export default connect(mapStateToProps)(Container);
