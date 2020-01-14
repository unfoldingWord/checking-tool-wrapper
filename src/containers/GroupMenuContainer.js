/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenuComponent from '../components/GroupMenuComponent';
// Actions
import { loadGroupsIndex, clearGroupsIndex } from '../state/actions/groupsIndexActions';
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
  clearGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  changeCurrentContextId,
}) {
  useEffect(() => {
    console.log('====================================');
    console.log('GroupMenuContainer 1st useEffect loadGroupsIndex()');
    console.log('====================================');
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);

    return () => {
      // Clean up the groupsIndex on unmount
      clearGroupsIndex();
    };
  }, [selectedToolName]);

  useEffect(() => {
    console.log('====================================');
    console.log('GroupMenuContainer 2nd useEffect loadGroupsData()');
    console.log('====================================');
    loadGroupsData(selectedToolName, projectSaveLocation);
  }, [selectedToolName]);

  useEffect(() => {
    console.log('====================================');
    console.log('GroupMenuContainer 3rd useEffect loadCurrentContextId()');
    console.log('====================================');
    loadCurrentContextId();
  }, [selectedToolName]);

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
  loadGroupsIndex: PropTypes.func.isRequired,
  clearGroupsIndex: PropTypes.func.isRequired,
  loadGroupsData: PropTypes.func.isRequired,
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

const mapDispatchToProps = (dispatch, ownProps) => {
  const { gatewayLanguageQuote, tc: { gatewayLanguage } } = ownProps;
  const projectSaveLocation = getProjectPath(ownProps);
  const { project: { id: bookId } } = getProjectManifest(ownProps);
  const toolName = getToolName(ownProps);
  const userData = getUserData(ownProps);

  return {
    loadGroupsIndex: (gatewayLanguage, selectedToolName, projectSaveLocation, translate) => {
      dispatch(loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate));
    },
    clearGroupsIndex: () => clearGroupsIndex(),
    loadGroupsData: (selectedToolName, projectSaveLocation) => {
      dispatch(loadGroupsData(selectedToolName, projectSaveLocation));
    },
    loadCurrentContextId: () => {
      dispatch(loadCurrentContextId(toolName, bookId, projectSaveLocation, userData, gatewayLanguage, gatewayLanguageQuote));
    },
    changeCurrentContextId: () => {
      dispatch(changeCurrentContextId(null, projectSaveLocation, userData, gatewayLanguage, gatewayLanguageQuote));
    },
  };
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);
