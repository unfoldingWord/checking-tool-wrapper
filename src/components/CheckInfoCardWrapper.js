/* eslint-disable no-useless-escape */
import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { CheckInfoCard } from 'tc-ui-toolkit';
import { VerseObjectUtils } from 'word-aligner';
// helpers
import { TRANSLATION_NOTES, TRANSLATION_WORDS } from '../common/constants';
import {
  getPhraseFromTw, getNote, formatRCLink,
} from '../helpers/checkInfoCardHelpers';
import {
  getContextId, getGroupsIndex, getResourcesReducer, getTranslationHelps,
} from '../selectors';
import { contextNotEmpty } from '../utils/utils';
import { getBestVerse } from '../../lib/helpers/verseHelpers';

function CheckInfoCardWrapper({
  translate,
  contextId,
  showHelps,
  toggleHelps,
  groupsIndex,
  translationHelps,
  resourcesReducer,
  tc: { gatewayLanguageCode },
}) {
  /**
   * find verse data for verse or verse span
   * @param {object} biblesForLanguage
   * @param {string} id
   * @param {string} chapter
   * @param {string} verse
   * @return {null|*}
   */
  function getBestVerse_(biblesForLanguage, id, chapter, verse) {
    const currentBible = biblesForLanguage && biblesForLanguage[id];

    if (currentBible) {
      const verseData = getBestVerse(currentBible, chapter, verse);

      if (verseData) {
        return verseData;
      }
    }
    return null;
  }

  function getScriptureFromReference(lang, id, book, chapter, verse) {
    const biblesForLanguage = resourcesReducer.bibles[lang];
    const verseData = getBestVerse_(biblesForLanguage, id, chapter, verse);

    if (verseData) {
      const { verseObjects } = verseData;
      const verseText = VerseObjectUtils.mergeVerseData(verseObjects).trim();
      return verseText;
    }
  }

  function handleClickLink(href) {
    if (href.startsWith('rc://')) {
      // TRICKY: the translation helps wrapper requires a custom link format
      const link = href.replace(/rc:\/\/([^/]+)\/ta\/man\/([^/)]+)\/([^/)]+)/g, '$1/ta/$2/$3');
      window.followLink(link);

      // TRICKY: open the helps so the modal mounts.
      if (!showHelps) {
        toggleHelps();
      }
    } else {
      console.warn(`Unsupported link format ${href}`);
    }
  }

  /**
   * Called to render links found in the note markup.
   * This fixes and formats links
   * @param href
   * @param title
   * @returns {{href: *, title: *}}
   */
  function onRenderLink({ href, title }) {
    if (href.startsWith('rc://')) {
      return formatRCLink(resourcesReducer, gatewayLanguageCode, href, title);
    }
    // unsupported links will be removed.
    console.warn(`Unsupported link will be removed: ${title} ${href}`);
    return {
      href: null,
      title,
    };
  }

  if (contextNotEmpty(contextId)) {
    const {
      groupId, occurrenceNote, tool,
    } = contextId;
    const title = groupsIndex.filter(item => item.id === groupId)[0].name;
    let phrase = '';

    switch (tool) {
    case TRANSLATION_WORDS: {
      const { translationWords } = translationHelps ? translationHelps : {};
      phrase = getPhraseFromTw(translationWords, groupId, translationHelps);
      break;
    }
    case TRANSLATION_NOTES:
      phrase = getNote(occurrenceNote, onRenderLink);
      break;
    default:
      console.error('tool is undefined in contextId');
      break;
    }

    return (
      <CheckInfoCard
        title={title}
        phrase={phrase}
        getScriptureFromReference={getScriptureFromReference}
        seeMoreLabel={translate('see_more')}
        showSeeMoreButton={!showHelps}
        onSeeMoreClick={toggleHelps}
        onLinkClick={handleClickLink}/>
    );
  } else {
    return null;
  }
}

CheckInfoCardWrapper.propTypes = {
  translate: PropTypes.func.isRequired,
  showHelps: PropTypes.bool.isRequired,
  toggleHelps: PropTypes.func.isRequired,
  tc: PropTypes.object.isRequired,
  contextId: PropTypes.object.isRequired,
  groupsIndex: PropTypes.array.isRequired,
  translationHelps: PropTypes.object.isRequired,
  resourcesReducer: PropTypes.object.isRequired,
};

export const mapStateToProps = (state, ownProps) => ({
  contextId: getContextId(state),
  groupsIndex: getGroupsIndex(state),
  translationHelps: getTranslationHelps(ownProps),
  resourcesReducer: getResourcesReducer(ownProps),
});

export default connect(mapStateToProps)(CheckInfoCardWrapper);
