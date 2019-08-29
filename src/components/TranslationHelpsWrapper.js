import React from 'react';
import PropTypes from 'prop-types';
import isEqual from "deep-equal";
import {TranslationHelps} from 'tc-ui-toolkit';
// helpers
import * as tHelpsHelpers from '../helpers/tHelpsHelpers';

class TranslationHelpsWrapper extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      showHelpsModal: false,
      modalArticle: '',
      articleCategory: ''
    };

    this.toggleHelpsModal = this.toggleHelpsModal.bind(this);
    this.followTHelpsLink = this.followTHelpsLink.bind(this);
    window.followLink = this.followTHelpsLink;
  }

  componentWillMount() {
    this._reloadArticle(this.props);
  }

  componentDidUpdate(prevProps) {
    const {contextIdReducer} = this.props || {};
    const prevContextIdReducer = prevProps.contextIdReducer;
    if (this.getGroupId(contextIdReducer) !==  this.getGroupId(prevContextIdReducer)) { // we only need to reload article when groupId changes
      this._reloadArticle(this.props);
    }
    if (!isEqual(contextIdReducer, prevContextIdReducer)) { // we need to scroll to top whenever contextId changes
      const page = document.getElementById("helpsbody");
      if (page) page.scrollTop = 0;
    }
  }

  /**
   * safely get groupId from contextIdReducer
   * @param {Object} contextIdReducer
   * @return {String}
   */
  getGroupId(contextIdReducer) {
    return contextIdReducer && contextIdReducer.contextId && contextIdReducer.contextId.groupId;
  }

  toggleHelpsModal() {
    this.setState({
      showHelpsModal: !this.state.showHelpsModal,
      modalArticle: ''
    });
  }

  /**
   * Loads the resource article
   * @param props
   * @private
   */
  _reloadArticle(props) {
    const {contextIdReducer, toolsReducer, toolsSelectedGLs, actions} = props;
    const contextId = contextIdReducer && contextIdReducer.contextId;
    if (contextId) {
      const articleId = contextId.groupId;
      const {currentToolName} = toolsReducer;
      const languageId = toolsSelectedGLs[currentToolName];
      actions.loadResourceArticle(currentToolName, articleId, languageId);
    }
  }

  followTHelpsLink(link) {
    let linkParts = link.split('/'); // link format: <lang>/<resource>/<category>/<article>

    const [lang, type, category, article] = linkParts;
    const resourceDir = tHelpsHelpers.getResourceDirByType(type);

    this.props.actions.loadResourceArticle(resourceDir, article, lang, category);
    const articleData = this.props.resourcesReducer.translationHelps[resourceDir][article];

    let newState;
    const showHelpsModal = true;
    const articleCategory = category;
    if (articleData) {
      newState = {
        showHelpsModal,
        articleCategory,
        modalArticle: articleData
      };
    } else {
      newState = {
        showHelpsModal,
        articleCategory,
        modalArticle: 'Cannot find an article for ' + link
      };
    }
    //todo: Shouldn't need to to set state and return state in the same function
    // Seems like an anti pattern
    this.setState(newState);
    return newState;
  }

  render() {
    const {
      toolsSelectedGLs,
      toolsReducer: {currentToolName},
      resourcesReducer,
      contextIdReducer: {contextId},
      showHelps,
      toggleHelps,
      translate
    } = this.props;
    const languageId = toolsSelectedGLs[currentToolName];
    const currentFile = tHelpsHelpers.getArticleFromState(resourcesReducer, contextId, currentToolName);
    const currentFileMarkdown = tHelpsHelpers.convertMarkdownLinks(currentFile, languageId);
    const tHelpsModalMarkdown = tHelpsHelpers.convertMarkdownLinks(this.state.modalArticle, languageId, this.state.articleCategory);
    return (
      <TranslationHelps
        translate={translate}
        article={currentFileMarkdown}
        modalArticle={tHelpsModalMarkdown}
        openExpandedHelpsModal={() => this.toggleHelpsModal()}
        isShowHelpsSidebar={showHelps}
        sidebarToggle={toggleHelps}
        isShowHelpsExpanded={this.state.showHelpsModal} />
    );
  }
}

TranslationHelpsWrapper.propTypes = {
  toolsSelectedGLs: PropTypes.object,
  translate: PropTypes.func,
  resourcesReducer: PropTypes.object,
  contextIdReducer: PropTypes.shape({
    contextId: PropTypes.object.isRequired
  }),
  toolsReducer: PropTypes.object,
  actions: PropTypes.shape({
    loadResourceArticle: PropTypes.func.isRequired,
  }),
  showHelps: PropTypes.bool.isRequired,
  toggleHelps: PropTypes.func.isRequired,
};

export default TranslationHelpsWrapper;
