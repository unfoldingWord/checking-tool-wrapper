/* eslint-disable no-useless-escape */
import React from 'react';
import PropTypes from 'prop-types';
import { CheckInfoCard } from 'tc-ui-toolkit';
import { VerseObjectUtils } from 'word-aligner';
// helpers
import { TRANSLATION_NOTES, TRANSLATION_WORDS } from '../helpers/consts';
import { getPhraseFromTw, getNote } from '../helpers/checkingInfoHelpers';

function CheckInfoCardWrapper({
  translate,
  translationHelps,
  groupsIndex,
  contextId,
  resourcesReducer,
  showHelps,
  toggleHelps,
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

  const {
    groupId, occurrenceNote, tool,
  } = contextId;
  const title = groupsIndex.filter(item => item.id === groupId)[0].name;
  let phrase = '';

  switch (tool) {
  case TRANSLATION_WORDS: {
    const { translationWords } = translationHelps ? translationHelps : {};
    phrase = getPhraseFromTw(translationWords, contextId.groupId, translationHelps);
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
}

CheckInfoCardWrapper.propTypes = {
  translate: PropTypes.func,
  translationHelps: PropTypes.any,
  groupsIndex: PropTypes.any,
  contextId: PropTypes.object.isRequired,
  showHelps: PropTypes.bool.isRequired,
  toggleHelps: PropTypes.func.isRequired,
  resourcesReducer: PropTypes.object.isRequired,
};

export default CheckInfoCardWrapper;
