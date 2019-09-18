import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { TranslationHelps } from 'tc-ui-toolkit';
// helpers
import * as tHelpsHelpers from '../helpers/tHelpsHelpers';

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
  toolsSelectedGLs,
  toolsReducer: { currentToolName },
  resourcesReducer,
  contextIdReducer: { contextId },
  showHelps,
  toggleHelps,
  translate,
  actions,
}) {
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
  // const [showHelpsModal, setShowHelpsModal] = useState(false);
  // const [modalArticle, setModalArticle] = useState('');
  // const [articleCategory, setArticleCategory] = useState('');
  const groupId = contextId.groupId;
  const languageId = toolsSelectedGLs[currentToolName];
  window.followLink = followTHelpsLink;

  useEffect(() => {
    // if (groupId) { // may not be needed
    actions.loadResourceArticle(currentToolName, groupId, languageId);
    // }
  }, [actions, currentToolName, groupId, languageId]);

  useEffect(() => {
    const page = document.getElementById('helpsbody');

    if (page) {
      page.scrollTop = 0;
    }
  }, [contextId]);

  function toggleHelpsModal() {
    setThState({
      showHelpsModal: !showHelpsModal,
      modalArticle: '',
    });
  }

  function followTHelpsLink(link) {
    const linkParts = link.split('/'); // link format: <lang>/<resource>/<category>/<article>

    const [lang, type, category, article] = linkParts;
    const resourceDir = tHelpsHelpers.getResourceDirByType(type);

    actions.loadResourceArticle(resourceDir, article, lang, category);
    const articleData = resourcesReducer.translationHelps[resourceDir][article];

    setThState({
      showHelpsModal: true,
      modalArticle: articleData || `Cannot find an article for ${link}`,
      articleCategory: category,
    });
    //todo: Shouldn't need to to set state and return state in the same function
    // Seems like an anti pattern
    return true;
  }

  const currentFile = tHelpsHelpers.getArticleFromState(resourcesReducer, contextId, currentToolName);
  const currentFileMarkdown = tHelpsHelpers.convertMarkdownLinks(currentFile, languageId);
  const tHelpsModalMarkdown = tHelpsHelpers.convertMarkdownLinks(modalArticle, languageId, articleCategory);
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
  toolsSelectedGLs: PropTypes.object,
  translate: PropTypes.func,
  resourcesReducer: PropTypes.object,
  contextIdReducer: PropTypes.shape({ contextId: PropTypes.object.isRequired }),
  toolsReducer: PropTypes.object,
  actions: PropTypes.shape({ loadResourceArticle: PropTypes.func.isRequired }),
  showHelps: PropTypes.bool.isRequired,
  toggleHelps: PropTypes.func.isRequired,
};
export default TranslationHelpsWrapper;
