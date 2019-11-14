import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenu from '../components/GroupMenuWrapper';

function GroupMenuContainer({ f, fg }) {
  useEffect(() => {
    f();
    fg();
  });

  return GroupMenu;
}

GroupMenuContainer.propTypes = {
  translate: PropTypes.func.isRequired,
  groupsIndex: PropTypes.array.isRequired,
  groupsData: PropTypes.object.isRequired,
};

const mapStateToProps = (state) => ({
  // TODO: Add selectors
  groupsDataReducer: state.groupsDataReducer,
  groupsIndexReducer: state.groupsIndexReducer,
});

const mapDispatchToProps = {
  f: () => console.log('clicked f'),
  fg: () => console.log('clicked fg'),
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);

