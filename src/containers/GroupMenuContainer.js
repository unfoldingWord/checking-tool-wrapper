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
  state,
  tc,
  loadGroupsIndex,
  // TODO:
  tool,
  ...rest
}) {
  useEffect(() => {
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);
  }, [gatewayLanguage, loadGroupsIndex, projectSaveLocation, selectedToolName, translate]);// temp
  console.log('state', state);
  console.log('PROPS', { tc, ...rest });
  console.log('tool', tool);
  console.log('groupsDataReducer', tool.groupsDataReducer);
  console.log('groupsIndexReducer', tool.groupsIndexReducer);

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
  state: state,
  groupsDataReducer: state.groupsDataReducer,
  groupsIndexReducer: state.groupsIndexReducer,
});

const mapDispatchToProps = {
  loadGroupsIndex,
  loadGroupsData,
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);

