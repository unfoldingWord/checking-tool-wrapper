import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { TranslationHelps } from 'tc-ui-toolkit';
import { connect } from 'react-redux';
// helpers
import * as tHelpsHelpers from '../helpers/tHelpsHelpers';
// selectors
import {
  getTranslationHelpsArticle,
  getGatewayLanguage,
  getContextId,
  getToolName,
  getResourcesReducer,
} from '../selectors/index';

// resourcesReducer needs to be global so that the followTHelpsLink has the new article's content
let resourcesReducer = {};

function useTnArticleState(initialState) {
  const [
    {
      showHelpsModal, modalArticle, articleCategory,
    },
    setTnArticleState,
  ] = useState(initialState);

  return {
    showHelpsModal,
    modalArticle,
    articleCategory,
    setThState: (updatedValues) => {
      setTnArticleState(prevState => ({ ...prevState, ...updatedValues }));
    },
  };
}

function TranslationHelpsWrapper({
  contextId: { groupId = '' },
  showHelps,
  toggleHelps,
  translate,
  actions,
  currentFile,
  gatewayLanguage,
  selectedToolName,
  resourcesReducer: resourcesReducerProp,
}) {
  resourcesReducer = resourcesReducerProp;

  const initialState = {
    showHelpsModal: false,
    modalArticle: '',
    articleCategory: '',
  };
  const {
    showHelpsModal,
    modalArticle,
    articleCategory,
    setThState,
  } = useTnArticleState(initialState);

  /**
   * extract article from reducer if present.
   * @param {String} resourceType - subpath for resource such as 'translationAcademy'
   * @param {String} article - name of article to find
   * @return {String|null} - returns article if found
   */
  function getArticleFromReducer(resourceType, article) {
    const resources = resourcesReducer.translationHelps[resourceType];
    let articleData = resources && resources[article];
    return articleData;
  }

  /**
   * load the resource article for the link and display
   * @param {String} link
   * @return {boolean}
   */
  function followTHelpsLink(link) {
    const linkParts = link.split('/'); // link format: <lang>/<resource>/<category>/<article>
    const [lang, type, category, article] = linkParts;
    const resourceSubDir = tHelpsHelpers.getResourceDirByType(type);
    let articleData = getArticleFromReducer(resourceSubDir, article);

    if (!articleData) { // if not cached
      actions.loadResourceArticle(resourceSubDir, article, lang, category); // do synchronous load
      articleData = getArticleFromReducer(resourceSubDir, article);
    }
    setThState({
      showHelpsModal: true,
      modalArticle: articleData || 'Cannot find an article for ' + link,
      articleCategory: category,
    });
    return true;
  }
  window.followLink = followTHelpsLink;

  useEffect(() => {
    actions.loadResourceArticle(selectedToolName, groupId, gatewayLanguage, '', true); // do asynchronous load
  }, [actions, selectedToolName, groupId, gatewayLanguage]);

  useEffect(() => {
    const page = document.getElementById('helpsbody');

    if (page) {
      page.scrollTop = 0;
    }
  }, []);

  function toggleHelpsModal() {
    setThState({
      showHelpsModal: !showHelpsModal,
      modalArticle: '',
    });
  }

  const currentFileMarkdown = tHelpsHelpers.convertMarkdownLinks(currentFile, gatewayLanguage);
  const tHelpsModalMarkdown = tHelpsHelpers.convertMarkdownLinks(modalArticle, gatewayLanguage, articleCategory);

  return (
    <TranslationHelps
      translate={translate}
      article={currentFileMarkdown}
      modalArticle={tHelpsModalMarkdown}
      openExpandedHelpsModal={toggleHelpsModal}
      isShowHelpsSidebar={showHelps}
      sidebarToggle={toggleHelps}
      isShowHelpsExpanded={showHelpsModal} />
  );
}

TranslationHelpsWrapper.propTypes = {
  translate: PropTypes.func.isRequired,
  contextId: PropTypes.object.isRequired,
  showHelps: PropTypes.bool.isRequired,
  toggleHelps: PropTypes.func.isRequired,
  currentFile: PropTypes.string.isRequired,
  gatewayLanguage: PropTypes.string.isRequired,
  selectedToolName: PropTypes.string.isRequired,
  resourcesReducer: PropTypes.object.isRequired,
  actions: PropTypes.shape({ loadResourceArticle: PropTypes.func.isRequired }),
};

export const mapStateToProps = (state, ownProps) => {
  const contextId = getContextId(state) || {};

  return {
    contextId,
    selectedToolName: getToolName(ownProps),
    gatewayLanguage: getGatewayLanguage(ownProps),
    resourcesReducer: getResourcesReducer(ownProps),
    currentFile: getTranslationHelpsArticle(ownProps, contextId),
  };
};

export default connect(mapStateToProps)(TranslationHelpsWrapper);
