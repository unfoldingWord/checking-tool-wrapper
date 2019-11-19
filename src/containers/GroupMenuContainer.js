import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenu from '../components/GroupMenuWrapper';
// actions
import { loadGroupsIndex } from '../state/actions/groupsIndexActions';
import { loadGroupsData } from '../state/actions/groupsDataActions';
import { loadCurrentContextId } from '../state/actions/contextIdActions';

function GroupMenuContainer({
  translate,
  tc: {
    gatewayLanguage,
    selectedToolName,
    projectSaveLocation,
  },
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  groupsDataReducer,
  groupsIndexReducer,
  // TODO:
  tc,
  ...rest
}) {
  useEffect(() => {
    console.log('----useEffect 1----');
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);
    loadGroupsData(selectedToolName, projectSaveLocation);
  }, [gatewayLanguage, loadGroupsData, loadGroupsIndex, projectSaveLocation, selectedToolName, translate]);// temp

  console.log('groupsDataReducer', groupsDataReducer);
  console.log('groupsIndexReducer', groupsIndexReducer);
  console.log('tc', tc);

  // useEffect(() => {
  //   loadCurrentContextId(selectedToolName, bookId, projectSaveLocation, toolsSelectedGLs, bibles);
  // });

  return <GroupMenu tc={tc} translate={translate} { ...rest } />;
}

GroupMenuContainer.propTypes = {
  tc: PropTypes.object.isRequired,
  translate: PropTypes.func.isRequired,
  loadGroupsIndex: PropTypes.func.isRequired,
  loadGroupsData: PropTypes.func.isRequired,
  loadCurrentContextId: PropTypes.func.isRequired,
  // TODO:
  groupsDataReducer: PropTypes.object.isRequired,
  groupsIndexReducer: PropTypes.array.isRequired,
};

const mapStateToProps = (state) => ({
  // TODO: Add selectors
  groupsDataReducer: state.tool.groupsDataReducer,
  groupsIndexReducer: state.tool.groupsIndexReducer,
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

