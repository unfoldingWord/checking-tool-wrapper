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
  getGatewayLanguageBibles,
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
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);
  }, [loadGroupsIndex, gatewayLanguage, selectedToolName, projectSaveLocation]);

  useEffect(() => {
    loadGroupsData(selectedToolName, projectSaveLocation);
  }, [loadGroupsData, selectedToolName, projectSaveLocation]);

  useEffect(() => {
    loadCurrentContextId();
  }, [loadCurrentContextId, selectedToolName]);

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

const mapDispatchToProps = {
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,//TODO: ADD ARGUMENTS
  changeCurrentContextId, //TODO: ADD ARGUMENTS
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);

