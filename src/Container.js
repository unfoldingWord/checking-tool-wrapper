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

function Container(props) {
  const [showHelps, setShowHelps] = useState(true);

  useEffect(() => {
    const { bibles } = props.scripturePane;
    settingsHelper.loadCorrectPaneSettings(props, props.tc.actions.setToolSettings, bibles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    tc,
    translate,
    contextId,
  } = props;

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
              {...props.scripturePane}// TODO: Only actions prop left.
            />
          </div>
          {/* <CheckInfoCardWrapper
            tc={tc}
            translate={translate}
            showHelps={showHelps}
            toggleHelps={() => setShowHelps(!showHelps)}
          /> */}
          {/* <VerseCheckWrapper
            tc={tc}
            translate={translate}
            {...props.verseCheck}// TODO: Only actions prop left.
          /> */}
        </div>
        {/* <TranslationHelpsWrapper
          tc={tc}
          showHelps={showHelps}
          translate={translate}
          toggleHelps={() => setShowHelps(!showHelps)}
          {...props.translationHelps}// TODO: Only actions prop left.
        /> */}
      </div>
    </TcuiThemeProvider>
  );
}

Container.propTypes = {
  tc: PropTypes.object.isRequired,
  translate: PropTypes.func.isRequired,
  contextId: PropTypes.object.isRequired,
  verseCheck: PropTypes.object.isRequired,// TODO: Only actions prop left.
  scripturePane: PropTypes.object.isRequired,// TODO: Only actions prop left.
  translationHelps: PropTypes.object.isRequired,// TODO: Only actions prop left.
};

export const mapStateToProps = (state, ownProps) => ({
  tc: getTcState(ownProps),
  contextId: getContextId(state),
  translate: getTranslateState(ownProps),
  verseCheck: getVerseCheckState(ownProps),// TODO: Only actions prop left.
  scripturePane: getScripturePaneState(ownProps),// TODO: Only actions prop left.
  translationHelps: getTranslationHelpsState(ownProps),// TODO: Only actions prop left.
});

export default connect(mapStateToProps)(Container);
