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
  translate,
  gatewayLanguage,
  selectedToolName,
  projectSaveLocation,
  groupsDataReducer,
  groupsIndexReducer,
  contextIdReducer,
  manifest: { project: bookId, toolsSelectedGLs },
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
    loadCurrentContextId(selectedToolName, bookId, projectSaveLocation, glBible);
  }, [glBible, bookId, loadCurrentContextId, projectSaveLocation, selectedToolName, toolsSelectedGLs]);

  console.log('ownProps', ownProps);
  console.log('gatewayLanguage', gatewayLanguage);
  console.log('groupsDataReducer', groupsDataReducer);
  console.log('groupsIndexReducer', groupsIndexReducer);
  console.log('contextIdReducer', contextIdReducer);
  console.log('tc', tc);
  console.log('bookId', bookId);
  console.log('toolsSelectedGLs', toolsSelectedGLs);
  console.log('bookId', bookId);
  console.log('gatewayLanguage', gatewayLanguage);
  console.log('selectedToolName', selectedToolName);
  console.log('projectSaveLocation', projectSaveLocation);

  return <GroupMenu tc={tc} translate={translate} { ...rest } />;
}

GroupMenuContainer.propTypes = {
  translate: PropTypes.func.isRequired,
  gatewayLanguage: PropTypes.string.isRequired,
  selectedToolName: PropTypes.string.isRequired,
  projectSaveLocation: PropTypes.string.isRequired,
  manifest: PropTypes.object.isRequired,
  glBible: PropTypes.object.isRequired,
  loadGroupsIndex: PropTypes.func.isRequired,
  loadGroupsData: PropTypes.func.isRequired,
  loadCurrentContextId: PropTypes.func.isRequired,
  // TODO:
  groupsDataReducer: PropTypes.object.isRequired,
  groupsIndexReducer: PropTypes.array.isRequired,
  tc: PropTypes.object.isRequired,// TODO: remove
  ownProps: PropTypes.object.isRequired,// TODO: remove
};

const mapStateToProps = (state, ownProps) => ({
  // TODO: Add selectors
  ownProps: ownProps,
  groupsDataReducer: state.tool.groupsDataReducer,
  groupsIndexReducer: state.tool.groupsIndexReducer,
  contextIdReducer: state.tool.contextIdReducer,
  gatewayLanguage: ownProps.tc.gatewayLanguage,
  selectedToolName: ownProps.tc.selectedToolName,
  projectSaveLocation: ownProps.tc.projectSaveLocation,
  manifest: ownProps.tc.projectDetailsReducer.manifest,
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

