/* eslint-env jest */
import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { createTcuiTheme, TcuiThemeProvider } from 'tc-ui-toolkit';
import { connect } from 'react-redux';
// helpers
import * as settingsHelper from './helpers/settingsHelper';

// components
import GroupMenuWrapper from './containers/GroupMenuContainer';
import VerseCheckWrapper from './components/VerseCheckWrapper';
import TranslationHelpsWrapper from './components/TranslationHelpsWrapper';
import CheckInfoCardWrapper from './components/CheckInfoCardWrapper';
import ScripturePaneWrapper from './components/ScripturePaneWrapper';
import { getGroupMenuState } from './selectors/GroupMenu';
import { getVerseCheckState } from './selectors/VerseCheck';
import { getTranslationHelpsState } from './selectors/TranslationHelps';
import { getScripturePaneState } from './selectors/ScripturePane';
import { getCheckInfoCardState } from './selectors/CheckInfoCard';

const theme = createTcuiTheme({
  typography: { useNextVariants: true },
  scrollbarThumb: { borderRadius: '10px' },
});

function Container(props) {
  const [showHelps, setShowHelps] = useState(true);

  useEffect(() => {
    const { bibles } = props.scripturePane;
    settingsHelper.loadCorrectPaneSettings(props, props.tc.actions.setToolSettings, bibles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

export const mapStateToProps = (state, ownProps) => ({
  groupMenu: ownProps,
  verseCheck: getVerseCheckState(ownProps),
  translationHelps: getTranslationHelpsState(ownProps),
  checkInfoCard: getCheckInfoCardState(ownProps),
  scripturePane: getScripturePaneState(ownProps),
});

export default connect(mapStateToProps)(Container);
