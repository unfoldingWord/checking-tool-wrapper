/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenu from '../components/GroupMenuWrapper';
// Actions
import { loadGroupsIndex } from '../state/actions/groupsIndexActions';
import { loadGroupsData } from '../state/actions/groupsDataActions';
import { loadCurrentContextId, changeCurrentContextId } from '../state/actions/contextIdActions';
// Selectors
import {
  getGroupsIndex,
  getGroupsData,
  // getContextId,
} from '../selectors/index';

// TODO: Connect loadCurrentContextId
function GroupMenuContainer({
  glBible,
  userdata,
  translate,
  gatewayLanguage,
  selectedToolName,
  projectSaveLocation,
  contextId,
  groupsData,
  groupsIndex,
  manifest: { project: { id: bookId } },
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  changeCurrentContextId,
  // TODO:
  tc,
  ownProps,
}) {
  useEffect(() => {
    console.log('----useEffect 1----');
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);
  }, [loadGroupsIndex, gatewayLanguage, selectedToolName, projectSaveLocation]);

  useEffect(() => {
    console.log('----useEffect 2----');
    loadGroupsData(selectedToolName, projectSaveLocation);
  }, [loadGroupsData, selectedToolName, projectSaveLocation]);

  useEffect(() => {
    console.log('----useEffect 3----');
    loadCurrentContextId(selectedToolName, bookId, projectSaveLocation, glBible, userdata);
  }, [loadCurrentContextId, selectedToolName, bookId, projectSaveLocation, glBible, userdata]);

  console.log('tc', tc);
  console.log('bookId', bookId);
  console.log('ownProps', ownProps);
  console.log('contextId', contextId);
  console.log('gatewayLanguage', gatewayLanguage);
  console.log('selectedToolName', selectedToolName);
  console.log('groupsData', groupsData);
  console.log('groupsIndex', groupsIndex);
  console.log('projectSaveLocation', projectSaveLocation);

  if (contextId) {
    return (
      <GroupMenu
        tc={tc}
        translate={translate}
        contextId={contextId}
        groupsData={groupsData}
        groupsIndex={groupsIndex}
        changeCurrentContextId={changeCurrentContextId}
      />
    );
  } else {
    return null;
  }
}

GroupMenuContainer.propTypes = {
  translate: PropTypes.func.isRequired,
  userdata: PropTypes.object.isRequired,
  gatewayLanguage: PropTypes.string.isRequired,
  selectedToolName: PropTypes.string.isRequired,
  projectSaveLocation: PropTypes.string.isRequired,
  manifest: PropTypes.object.isRequired,
  glBible: PropTypes.object.isRequired,
  contextId: PropTypes.object.isRequired,
  groupsData: PropTypes.object.isRequired,
  groupsIndex: PropTypes.object.isRequired,
  // Actions
  loadGroupsData: PropTypes.func.isRequired,
  loadGroupsIndex: PropTypes.func.isRequired,
  loadCurrentContextId: PropTypes.func.isRequired,
  // TODO:
  tc: PropTypes.object.isRequired,// TODO: remove
  ownProps: PropTypes.object.isRequired,// TODO: remove
};

const mapStateToProps = (state, ownProps) => ({
  // TODO: Add selectors
  ownProps: ownProps,
  groupsData: getGroupsData(state),
  groupsIndex: getGroupsIndex(state),
  contextId: state.tool.contextIdReducer.contextId,
  gatewayLanguage: ownProps.tc.gatewayLanguage,
  selectedToolName: ownProps.tc.selectedToolName,
  projectSaveLocation: ownProps.tc.projectSaveLocation,
  manifest: ownProps.tc.projectDetailsReducer.manifest,
  userdata: ownProps.tc.loginReducer.userdata,
  glBible: ownProps.tc.resourcesReducer.bibles[ownProps.tc.gatewayLanguage],
});

const mapDispatchToProps = {
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  changeCurrentContextId,
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);

