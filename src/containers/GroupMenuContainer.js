import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenu from '../components/GroupMenuWrapper';
// Actions
import { loadGroupsIndex } from '../state/actions/groupsIndexActions';
import { loadGroupsData } from '../state/actions/groupsDataActions';
import { loadCurrentContextId } from '../state/actions/contextIdActions';

// TODO: Connect loadCurrentContextId
function GroupMenuContainer({
  glBible,
  userdata,
  translate,
  gatewayLanguage,
  selectedToolName,
  projectSaveLocation,
  groupsDataReducer: { groupsData },
  groupsIndexReducer: { groupsIndex },
  contextId,
  manifest: { project: { id: bookId } },
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  // TODO:
  tc,
  ownProps,
  ...rest
}) {
  useEffect(() => {
    console.log('----useEffect 1----');
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);
    loadGroupsData(selectedToolName, projectSaveLocation);
  }, [gatewayLanguage, loadGroupsData, loadGroupsIndex, projectSaveLocation, selectedToolName, translate]);// temp

  useEffect(() => {
    console.log('----useEffect 2----');
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

  return (
    <GroupMenu
      tc={tc}
      translate={translate}
      groupsData={groupsData}
      groupsIndex={groupsIndex}
      { ...rest }
    />
  );
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
  groupsDataReducer: PropTypes.object.isRequired,
  groupsIndexReducer: PropTypes.object.isRequired,
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
  groupsDataReducer: state.tool.groupsDataReducer,
  groupsIndexReducer: state.tool.groupsIndexReducer,
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
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);

