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
import { getCheckInfoCardState } from './selectors/CheckInfoCard';
import { getTcState, getTranslateState } from './selectors';
import { getContextId } from './state/reducers/contextIdReducer';

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
    contextIdReducer: { contextId },
    _contextId,
  } = props;

  console.log('_contextId', _contextId);

  if (contextId !== null) {
    return (
      <TcuiThemeProvider theme={theme}>
        <div style={styles.containerDiv}>
          <GroupMenuContainer tc={tc} translate={translate} />
          <div style={styles.centerDiv}>
            <div style={styles.scripturePaneDiv}>
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
  _contextId: PropTypes.object.isRequired,
  translationHelps: PropTypes.any,
  verseCheck: PropTypes.any,
  checkInfoCard: PropTypes.any,
  translate: PropTypes.func.isRequired,
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
  }).isRequired,
  scripturePane: PropTypes.object.isRequired,
};

export const mapStateToProps = (state, ownProps) => ({
  tc: getTcState(ownProps),
  _contextId: getContextId(state),
  translate: getTranslateState(ownProps),
  verseCheck: getVerseCheckState(ownProps),
  translationHelps: getTranslationHelpsState(ownProps),
  checkInfoCard: getCheckInfoCardState(ownProps),
  scripturePane: getScripturePaneState(ownProps),
});

export default connect(mapStateToProps)(Container);
