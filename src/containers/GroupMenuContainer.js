/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenuComponent from '../components/GroupMenuComponent';
// Actions
import { loadGroupsIndex } from '../state/actions/groupsIndexActions';
import { loadGroupsData } from '../state/actions/groupsDataActions';
import { loadCurrentContextId, changeCurrentContextId } from '../state/actions/contextIdActions';
// Selectors
import {
  getGroupsIndex,
  getGroupsData,
  getContextId,
  getGatewayLanguage,
  getToolName,
  getProjectPath,
  getProjectManifest,
  getUserData,
  getBookName,
} from '../selectors/index';

function GroupMenuContainer({
  bookName,
  translate,
  gatewayLanguage,
  selectedToolName,
  projectSaveLocation,
  contextId,
  groupsData,
  groupsIndex,
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  changeCurrentContextId,
}) {
  useEffect(() => {
    console.log('====================================');
    console.log('GroupMenuContainer 1st useEffect');
    console.log('====================================');
    console.log('loadGroupsIndex', loadGroupsIndex);
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);
  }, [loadGroupsIndex, gatewayLanguage, selectedToolName, projectSaveLocation]);

  useEffect(() => {
    console.log('====================================');
    console.log('GroupMenuContainer 2nd useEffect');
    console.log('====================================');
    console.log('loadGroupsData', loadGroupsData);
    loadGroupsData(selectedToolName, projectSaveLocation);
  }, [loadGroupsData, selectedToolName, projectSaveLocation]);

  // useEffect(() => {
  //   console.log('====================================');
  //   console.log('GroupMenuContainer 3rd useEffect');
  //   console.log('====================================');
  //   loadCurrentContextId();
  // }, [loadCurrentContextId, selectedToolName]);

  if (contextId) {
    return (
      <GroupMenuComponent
        bookName={bookName}
        translate={translate}
        contextId={contextId}
        groupsData={groupsData}
        groupsIndex={groupsIndex}
        changeCurrentContextId={changeCurrentContextId}
      />
    );
  } else {
    return null;
  }
}

GroupMenuContainer.propTypes = {
  translate: PropTypes.func.isRequired,
  userData: PropTypes.object.isRequired,
  gatewayLanguage: PropTypes.string.isRequired,
  selectedToolName: PropTypes.string.isRequired,
  projectSaveLocation: PropTypes.string.isRequired,
  manifest: PropTypes.object.isRequired,
  contextId: PropTypes.object.isRequired,
  groupsData: PropTypes.object.isRequired,
  groupsIndex: PropTypes.object.isRequired,
  // Actions
  loadGroupsData: PropTypes.func.isRequired,
  loadGroupsIndex: PropTypes.func.isRequired,
  loadCurrentContextId: PropTypes.func.isRequired,
};

const mapStateToProps = (state, ownProps) => ({
  groupsData: getGroupsData(state),
  groupsIndex: getGroupsIndex(state),
  contextId: getContextId(state),
  gatewayLanguage: getGatewayLanguage(ownProps),
  selectedToolName: getToolName(ownProps),
  projectSaveLocation: getProjectPath(ownProps),
  manifest: getProjectManifest(ownProps),
  userData: getUserData(ownProps),
  bookName: getBookName(ownProps),
});

const mapDispatchToProps = (dispatch, ownProps) =>
// const { gatewayLanguageQuote, tc: { gatewayLanguage } } = ownProps;
// const projectSaveLocation = getProjectPath(ownProps);
// const { project: { id: bookId } } = getProjectManifest(ownProps);
// const toolName = getToolName(ownProps);
// const userData = getUserData(ownProps);

  ({
    loadGroupsIndex: () => {
      console.log('loadGroupsIndex');
      dispatch(loadGroupsIndex());
    },
    loadGroupsData: () => {
      console.log('loadGroupsData');
      dispatch(loadGroupsData());
    },
    loadCurrentContextId: () => console.log('loadCurrentContextId'),
    changeCurrentContextId: () => console.log('changeCurrentContextId'),
    // loadCurrentContextId: () => {
    //   dispatch(loadCurrentContextId(toolName, bookId, projectSaveLocation, userData, gatewayLanguage, gatewayLanguageQuote));
    // },
    // changeCurrentContextId: () => {
    //   dispatch(changeCurrentContextId(null, projectSaveLocation, userData, gatewayLanguage, gatewayLanguageQuote));
    // },
  });
export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);

