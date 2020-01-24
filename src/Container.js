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
  getGatewayLanguage,
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
  contextId,
  translate,
  gatewayLanguage,
  currentPaneSettings,
  gatewayLanguageQuote,
}) {
  const [showHelps, setShowHelps] = useState(true);

  useEffect(() => {
    settingsHelper.loadCorrectPaneSettings(tc.actions.setToolSettings, bibles, gatewayLanguage, currentPaneSettings);
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
  gatewayLanguage: PropTypes.string.isRequired,
  gatewayLanguageQuote: PropTypes.string.isRequired,
  currentPaneSettings: PropTypes.array.isRequired,
};

export const mapStateToProps = (state, ownProps) => {
  const gatewayLanguage = getGatewayLanguage(ownProps);
  const contextId = getContextId(state);
  const glBibles = getGatewayLanguageBibles(ownProps);
  const gatewayLanguageQuote = getAlignedGLTextHelper(contextId, glBibles);

  return {
    contextId,
    gatewayLanguage,
    gatewayLanguageQuote,
    tc: getTcState(ownProps),
    bibles: getBibles(ownProps),
    translate: getTranslateState(ownProps),
    currentPaneSettings: getCurrentPaneSettings(ownProps),
  };
};

export default connect(mapStateToProps)(Container);
