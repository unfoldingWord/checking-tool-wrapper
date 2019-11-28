/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import GroupMenu from '../components/GroupMenuWrapper';
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
  glBibles,
  bookName,
  userData,
  translate,
  gatewayLanguage,
  selectedToolName,
  projectSaveLocation,
  contextId,
  groupsData,
  groupsIndex,
  manifest: { project: { id: bookId } },
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  changeCurrentContextId,
}) {
  useEffect(() => {
    console.log('----useEffect 1----');
    loadGroupsIndex(gatewayLanguage, selectedToolName, projectSaveLocation, translate);
  }, [loadGroupsIndex, gatewayLanguage, selectedToolName, projectSaveLocation]);

  useEffect(() => {
    console.log('----useEffect 2----');
    loadGroupsData(selectedToolName, projectSaveLocation);
  }, [loadGroupsData, selectedToolName, projectSaveLocation]);

  useEffect(() => {
    console.log('----useEffect 3----');
    loadCurrentContextId(selectedToolName, bookId, projectSaveLocation, glBibles, userData);
  }, [loadCurrentContextId, selectedToolName, bookId, projectSaveLocation, glBibles, userData]);

  console.log('bookId', bookId);
  console.log('bookName', bookName);
  console.log('userdata', userData);
  console.log('glBibles', glBibles);
  console.log('contextId', contextId);
  console.log('gatewayLanguage', gatewayLanguage);
  console.log('selectedToolName', selectedToolName);
  console.log('groupsData', groupsData);
  console.log('groupsIndex', groupsIndex);
  console.log('projectSaveLocation', projectSaveLocation);

  if (contextId) {
    return (
      <GroupMenu
        glBibles={glBibles}
        userData={userData}
        projectSaveLocation={bookName}
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
  glBibles: PropTypes.object.isRequired,
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
  glBibles: getGatewayLanguageBibles(ownProps),
  bookName: getBookName(ownProps),
});

const mapDispatchToProps = {
  loadGroupsIndex,
  loadGroupsData,
  loadCurrentContextId,
  changeCurrentContextId,
};

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(GroupMenuContainer);

