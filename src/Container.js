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
import { getVerseCheckState } from './selectors/VerseCheck';
import { getTranslationHelpsState } from './selectors/TranslationHelps';
import { getScripturePaneState } from './selectors/ScripturePane';
import {
  getTcState,
  getTranslateState,
  getContextId,
  getBibles,
  getGatewayLanguage,
  getCurrentPaneSettings,
} from './selectors';

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
  verseCheck,// TODO: Only actions prop left.
  scripturePane,// TODO: Only actions prop left.
  translationHelps,// TODO: Only actions prop left.
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
        <GroupMenuContainer tc={tc} translate={translate} />
        <div style={styles.centerDiv}>
          <div style={styles.scripturePaneDiv}>
            <ScripturePaneWrapper
              tc={tc}
              translate={translate}
              {...scripturePane}// TODO: Only actions prop left.
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
            {...verseCheck}// TODO: Only actions prop left.
          />
        </div>
        <TranslationHelpsWrapper
          tc={tc}
          showHelps={showHelps}
          translate={translate}
          toggleHelps={() => setShowHelps(!showHelps)}
          {...translationHelps}// TODO: Only actions prop left.
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
  gatewayLanguage: PropTypes.string.isRequired,
  currentPaneSettings: PropTypes.array.isRequired,
  verseCheck: PropTypes.object.isRequired,// TODO: Only actions prop left.
  scripturePane: PropTypes.object.isRequired,// TODO: Only actions prop left.
  translationHelps: PropTypes.object.isRequired,// TODO: Only actions prop left.
};

export const mapStateToProps = (state, ownProps) => ({
  tc: getTcState(ownProps),
  bibles: getBibles(ownProps),
  contextId: getContextId(state),
  translate: getTranslateState(ownProps),
  gatewayLanguage: getGatewayLanguage(ownProps),
  currentPaneSettings: getCurrentPaneSettings(ownProps),
  verseCheck: getVerseCheckState(ownProps),// TODO: Only actions prop left.
  scripturePane: getScripturePaneState(ownProps),// TODO: Only actions prop left.
  translationHelps: getTranslationHelpsState(ownProps),// TODO: Only actions prop left.
});

export default connect(mapStateToProps)(Container);
