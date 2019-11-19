import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenu from '../components/GroupMenuWrapper';
// actions
import { loadGroupsIndex } from '../state/actions/groupsIndexActions';
import { loadGroupsData } from '../state/actions/groupsDataActions';
import { loadCurrentContextId } from '../state/actions/contextIdActions';

function GroupMenuContainer({
  bibles,
  translate,
  // gatewayLanguage,
  // selectedToolName,
  // projectSaveLocation,
  groupsDataReducer,
  groupsIndexReducer,
  manifest: { project: bookId, toolsSelectedGLs },
  tc: {
    gatewayLanguage,
    selectedToolName,
    projectSaveLocation,
  },
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  // TODO:
  tc,
  ...rest
}) {
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

  // useEffect(() => {
  //   loadCurrentContextId(selectedToolName, bookId, projectSaveLocation, toolsSelectedGLs, bibles);
  // });

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
};

const mapStateToProps = (state) => ({
  // TODO: Add selectors
  groupsDataReducer: state.tool.groupsDataReducer,
  groupsIndexReducer: state.tool.groupsIndexReducer,
  gatewayLanguage: state.tc.gatewayLanguage,
  selectedToolName: state.tc.selectedToolName,
  projectSaveLocation: state.tc.projectSaveLocation,
  manifest: state.tc.projectDetailsReducer.manifest,
  bibles: state.resourcesReducer.bibles,
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

