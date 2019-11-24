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
  bibles,
  translate,
  gatewayLanguage,
  selectedToolName,
  projectSaveLocation,
  groupsDataReducer,
  groupsIndexReducer,
  manifest: { project: bookId, toolsSelectedGLs },
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  // TODO:
  tc,
  ownProps,
  ...rest
}) {
  console.log('ownProps', ownProps);
  console.log('gatewayLanguage', gatewayLanguage);

  useEffect(() => {
    console.log('----useEffect 1----');
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);
    loadGroupsData(selectedToolName, projectSaveLocation);
  }, [gatewayLanguage, loadGroupsData, loadGroupsIndex, projectSaveLocation, selectedToolName, translate]);// temp

  console.log('groupsDataReducer', groupsDataReducer);
  console.log('groupsIndexReducer', groupsIndexReducer);
  console.log('tc', tc);
  console.log('bookId', bookId);
  console.log('toolsSelectedGLs', toolsSelectedGLs);
  console.log('bookId', bookId);
  console.log('gatewayLanguage', gatewayLanguage);
  console.log('selectedToolName', selectedToolName);
  console.log('projectSaveLocation', projectSaveLocation);

  useEffect(() => {
    console.log('----useEffect 2----');
    loadCurrentContextId(selectedToolName, bookId, projectSaveLocation, toolsSelectedGLs, bibles);
  }, [bibles, bookId, loadCurrentContextId, projectSaveLocation, selectedToolName, toolsSelectedGLs]);

  return <GroupMenu tc={tc} translate={translate} { ...rest } />;
}

GroupMenuContainer.propTypes = {
  translate: PropTypes.func.isRequired,
  gatewayLanguage: PropTypes.string.isRequired,
  selectedToolName: PropTypes.string.isRequired,
  projectSaveLocation: PropTypes.string.isRequired,
  manifest: PropTypes.object.isRequired,
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
  gatewayLanguage: ownProps.tc.gatewayLanguage,
  selectedToolName: ownProps.tc.selectedToolName,
  projectSaveLocation: ownProps.tc.projectSaveLocation,
  manifest: ownProps.tc.projectDetailsReducer.manifest,
  bibles: ownProps.tc.resourcesReducer.bibles,
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

