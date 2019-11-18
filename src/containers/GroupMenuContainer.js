import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenu from '../components/GroupMenuWrapper';
// actions
import { loadGroupsIndex } from '../state/actions/groupsIndexActions';
import { loadGroupsData } from '../state/actions/groupsDataActions';

function GroupMenuContainer(props) {
  console.log('props', props);
  // useEffect(() => {
  //   loadGroupsIndex(language, toolName, projectDir, translate);
  // }, [groupsIndexReducer]);// temp

  return <GroupMenu {...props} />;
}

GroupMenuContainer.propTypes = {
  translate: PropTypes.func.isRequired,
  groupsIndexReducer: PropTypes.array.isRequired,
  groupsData: PropTypes.object.isRequired,
  loadGroupsIndex: PropTypes.func.isRequired,
  loadGroupsData: PropTypes.func.isRequired,
};

const mapStateToProps = (state) => ({
  // TODO: Add selectors
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

