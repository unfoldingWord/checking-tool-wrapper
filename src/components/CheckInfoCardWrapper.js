/* eslint-disable no-useless-escape */
import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { CheckInfoCard } from 'tc-ui-toolkit';
import { VerseObjectUtils } from 'word-aligner';
// helpers
import { TRANSLATION_NOTES, TRANSLATION_WORDS } from '../common/constants';
import { getPhraseFromTw, getNote } from '../helpers/checkInfoCardHelpers';
import {
  getContextId, getGroupsIndex, getResourcesReducer, getTranslationHelps,
} from '../selectors';

function CheckInfoCardWrapper({
  translate,
  contextId,
  showHelps,
  toggleHelps,
  groupsIndex,
  translationHelps,
  resourcesReducer,
}) {
  function getScriptureFromReference(lang, id, book, chapter, verse) {
    const chapterParsed = parseInt(chapter);
    const verseParsed = parseInt(verse);
    const currentBible = resourcesReducer.bibles[lang];

    if (currentBible &&
      currentBible[id] &&
      currentBible[id][chapterParsed] &&
      currentBible[id][chapterParsed][verseParsed]) {
      const { verseObjects } = currentBible[id][chapterParsed][verseParsed];
      const verseText = VerseObjectUtils.mergeVerseData(verseObjects).trim();
      return verseText;
    }
  }

  if (contextId !== null) {
    const {
      groupId, occurrenceNote, tool,
    } = contextId || {};
    const title = groupsIndex.filter(item => item.id === groupId)[0].name;
    let phrase = '';

    switch (tool) {
    case TRANSLATION_WORDS: {
      const { translationWords } = translationHelps ? translationHelps : {};
      phrase = getPhraseFromTw(translationWords, groupId, translationHelps);
      break;
    }
    case TRANSLATION_NOTES:
      phrase = getNote(occurrenceNote);
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
        onSeeMoreClick={toggleHelps} />
    );
  } else {
    return null;
  }
}

CheckInfoCardWrapper.propTypes = {
  translate: PropTypes.func.isRequired,
  showHelps: PropTypes.bool.isRequired,
  toggleHelps: PropTypes.func.isRequired,
  contextId: PropTypes.object.isRequired,
  groupsIndex: PropTypes.object.isRequired,
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
