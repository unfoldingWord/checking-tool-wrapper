import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenu from '../components/GroupMenuWrapper';
// actions
import { loadGroupsIndex } from '../state/actions/groupsIndexActions';
import { loadGroupsData } from '../state/actions/groupsDataActions';

function GroupMenuContainer({
  translate,
  tc: {
    gatewayLanguage,
    selectedToolName,
    projectSaveLocation,
  },
  loadGroupsIndex,
  loadGroupsData,
  groupsDataReducer,
  groupsIndexReducer,
  // TODO:
  tc,
  ...rest
}) {
  useEffect(() => {
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);
    loadGroupsData(selectedToolName, projectSaveLocation);
  }, [gatewayLanguage, loadGroupsData, loadGroupsIndex, projectSaveLocation, selectedToolName, translate]);// temp
  console.log('PROPS', { tc, ...rest });
  console.log('groupsDataReducer', groupsDataReducer);
  console.log('groupsIndexReducer', groupsIndexReducer);

  return <GroupMenu tc={tc} translate={translate} { ...rest } />;
}

GroupMenuContainer.propTypes = {
  tc: PropTypes.object.isRequired,
  translate: PropTypes.func.isRequired,
  loadGroupsIndex: PropTypes.func.isRequired,
  loadGroupsData: PropTypes.func.isRequired,
  // TODO:
  tool: PropTypes.shape({
    groupsDataReducer: PropTypes.object.isRequired,
    groupsIndexReducer: PropTypes.array.isRequired,
  }),
};

const mapStateToProps = (state) => ({
  // TODO: Add selectors
  groupsDataReducer: state.tool.groupsDataReducer,
  groupsIndexReducer: state.tool.groupsIndexReducer,
});

const mapDispatchToProps = {
  loadGroupsIndex,
  loadGroupsData,
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);

