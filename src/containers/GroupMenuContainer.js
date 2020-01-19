/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenuComponent from '../components/GroupMenuComponent';
// Actions
import { loadGroupsIndex, clearGroupsIndex } from '../state/actions/groupsIndexActions';
import { loadGroupsData, clearGroupsData } from '../state/actions/groupsDataActions';
import {
  loadCurrentContextId, changeCurrentContextId, clearContextId,
} from '../state/actions/contextIdActions';
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
  clearGroupsData,
  loadCurrentContextId,
  changeCurrentContextId,
  clearContextId,
}) {
  useEffect(() => {
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);

    return () => {
      // Clean up groupsIndex on unmount
      clearGroupsIndex();
    };
  }, [selectedToolName]);

  useEffect(() => {
    loadGroupsData(selectedToolName, projectSaveLocation);

    return () => {
      // Clean up groupsData on unmount
      clearGroupsData();
    };
  }, [selectedToolName]);

  useEffect(() => {
    loadCurrentContextId();

    return () => {
      clearContextId();
    };
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
  clearGroupsData: PropTypes.func.isRequired,
  loadCurrentContextId: PropTypes.func.isRequired,
  clearContextId: PropTypes.func.isRequired,
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
    clearGroupsData: () => clearGroupsData(),
    loadCurrentContextId: () => {
      dispatch(loadCurrentContextId(toolName, bookId, projectSaveLocation, userData, gatewayLanguage, gatewayLanguageQuote));
    },
    changeCurrentContextId: (item = null) => {
      const contextId = item.contextId || null;
      dispatch(changeCurrentContextId(contextId, projectSaveLocation, userData, gatewayLanguage, gatewayLanguageQuote));
    },
    clearContextId: () => clearContextId(),
  };
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);
