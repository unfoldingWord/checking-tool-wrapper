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
  userdata,
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
  ownProps,//TODO: REMOVE
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
    loadCurrentContextId(selectedToolName, bookId, projectSaveLocation, glBibles, userdata);
  }, [loadCurrentContextId, selectedToolName, bookId, projectSaveLocation, glBibles, userdata]);

  console.log('ownProps', ownProps);
  console.log('bookId', bookId);
  console.log('bookName', bookName);
  console.log('userdata', userdata);
  console.log('glBible', glBibles);
  console.log('contextId', contextId);
  console.log('gatewayLanguage', gatewayLanguage);
  console.log('selectedToolName', selectedToolName);
  console.log('groupsData', groupsData);
  console.log('groupsIndex', groupsIndex);
  console.log('projectSaveLocation', projectSaveLocation);

  if (contextId) {
    return (
      <GroupMenu
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
  userdata: PropTypes.object.isRequired,
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
  // TODO:
  ownProps: PropTypes.object.isRequired,// TODO: remove
};

const mapStateToProps = (state, ownProps) => ({
  ownProps: ownProps,
  groupsData: getGroupsData(state),
  groupsIndex: getGroupsIndex(state),
  contextId: getContextId(state),
  gatewayLanguage: getGatewayLanguage(ownProps),
  selectedToolName: getToolName(ownProps),
  projectSaveLocation: getProjectPath(ownProps),
  manifest: getProjectManifest(ownProps),
  userdata: getUserData(ownProps),
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

