import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenu from '../components/GroupMenuWrapper';

function GroupMenuContainer(props) {
  useEffect(() => {
    props.f();//TODO:
    props.fg();//TODO:
  });

  return <GroupMenu {...props} />;
}

GroupMenuContainer.propTypes = {
  translate: PropTypes.func.isRequired,
  groupsIndex: PropTypes.array.isRequired,
  groupsData: PropTypes.object.isRequired,
  f: PropTypes.func.isRequired,//TODO:
  fg: PropTypes.func.isRequired,//TODO:
};

const mapStateToProps = (state) => ({
  // TODO: Add selectors
  groupsDataReducer: state.groupsDataReducer,
  groupsIndexReducer: state.groupsIndexReducer,
});

const mapDispatchToProps = {
  f: () => console.log('clicked f'),//TODO:
  fg: () => console.log('clicked fg'),//TODO:
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);

