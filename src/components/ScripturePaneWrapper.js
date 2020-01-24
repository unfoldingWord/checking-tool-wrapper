import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { ScripturePane } from 'tc-ui-toolkit';
import { getAvailableScripturePaneSelections } from '../helpers/resourcesHelpers';
import { getLexiconData } from '../helpers/lexiconHelpers';
import {
  getContextId,
  getBibles,
  getProjectManifest,
  getSelections,
  getProjectDetailsReducer,
  getCurrentPaneSettings,
} from '../selectors';

function ScripturePaneWrapper({
  bibles,
  manifest,
  contextId,
  translate,
  selections,
  showPopover,
  editTargetVerse,
  setToolSettings,
  currentPaneSettings,
  projectDetailsReducer,
  makeSureBiblesLoadedForTool,
}) {
  console.log('====================================');
  console.log('ScripturePaneWrapper() manifest', manifest);
  console.log('====================================');

  function makeTitle(manifest) {
    const { target_language, project } = manifest;

    if (target_language && target_language.book && target_language.book.name) {
      return target_language.book.name;
    } else {
      return project.name;
    }
  }

  function getScripturePaneSelections(resourceList) {
    getAvailableScripturePaneSelections(resourceList, contextId, bibles);
  }

  function ensureBiblesAreLoadedForTool() {
    console.log('====================================');
    console.log('ensureBiblesAreLoadedForTool: contextId', contextId);
    console.log('====================================');
    makeSureBiblesLoadedForTool(contextId);
  }

  const expandedScripturePaneTitle = makeTitle(manifest);

  if (contextId) {
    return (
      <ScripturePane
        currentPaneSettings={currentPaneSettings}
        contextId={contextId}
        bibles={bibles}
        handleModalOpen={() => {}}// TODO: Make sure that handleModalOpen is not required in the tc-ui-toolkit as it is not always needed.
        expandedScripturePaneTitle={expandedScripturePaneTitle}
        showPopover={showPopover}
        editTargetVerse={editTargetVerse}
        projectDetailsReducer={projectDetailsReducer}
        translate={translate}
        getLexiconData={getLexiconData}
        selections={selections}
        setToolSettings={setToolSettings}
        getAvailableScripturePaneSelections={getScripturePaneSelections}
        makeSureBiblesLoadedForTool={ensureBiblesAreLoadedForTool}
      />
    );
  } else {
    return null;
  }
}

ScripturePaneWrapper.propTypes = {
  bibles: PropTypes.object.isRequired,
  manifest: PropTypes.object.isRequired,
  contextId: PropTypes.object.isRequired,
  translate: PropTypes.func.isRequired,
  selections: PropTypes.array.isRequired,
  currentPaneSettings: PropTypes.array.isRequired,
  projectDetailsReducer: PropTypes.object.isRequired,
  // actions
  showPopover: PropTypes.func.isRequired,
  editTargetVerse: PropTypes.func.isRequired,
  setToolSettings: PropTypes.func.isRequired,
  makeSureBiblesLoadedForTool: PropTypes.func.isRequired,
};

export const mapStateToProps = (state, ownProps) => ({
  bibles: getBibles(ownProps),
  contextId: getContextId(state),
  selections: getSelections(state),
  manifest: getProjectManifest(ownProps),
  currentPaneSettings: getCurrentPaneSettings(ownProps),
  projectDetailsReducer: getProjectDetailsReducer(ownProps),
  showPopover: ownProps.tc.showPopover,
  setToolSettings: ownProps.tc.setToolSettings,
  makeSureBiblesLoadedForTool: ownProps.tc.makeSureBiblesLoadedForTool,
});

export default connect(mapStateToProps)(ScripturePaneWrapper);
