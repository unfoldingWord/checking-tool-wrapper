import React from 'react';
import PropTypes from 'prop-types';
import {CheckInfoCard} from 'tc-ui-toolkit';
import {VerseObjectUtils} from 'word-aligner';

class CheckInfoCardWrapper extends React.Component {
  constructor(props) {
    super(props);
    this.getScriptureFromReference = this.getScriptureFromReference.bind(this);
  }

  getPhraseFromTw(translationWords, articleId, translationHelps) {
    let currentFile = '';
    if (translationWords && translationWords[articleId]) {
      currentFile = translationHelps.translationWords[articleId];
    }

    let splitLine = currentFile.split('\n');
    if (splitLine.length === 1 && splitLine[0] === "") return "";
    let finalArray = [];
    for (let i = 0; i < splitLine.length; i++) {
      if (splitLine[i] !== '' && !~splitLine[i].indexOf("#")) {
        finalArray.push(splitLine[i]);
      }
    }
    let maxLength = 225;
    let finalString = "";
    let chosenString = finalArray[0];
    let splitString = chosenString.split(' ');
    for (let word of splitString) {
      if ((finalString + ' ' + word).length >= maxLength) {
        finalString += '...';
        break;
      }
      finalString += ' ';
      finalString += word;
    }
    return finalString;
  }

  getNote(occurrenceNote) {
    return occurrenceNote.replace(/\(See:.*/g, "");
  }

  getScriptureFromReference(lang, id, book, chapter, verse) {
    const chapterParsed = parseInt(chapter);
    const verseParsed = parseInt(verse);
    const currentBible = this.props.resourcesReducer.bibles[lang];
    if (currentBible &&
      currentBible[id] &&
      currentBible[id][chapterParsed] &&
      currentBible[id][chapterParsed][verseParsed]) {
      const {verseObjects} = currentBible[id][chapterParsed][verseParsed];
      const verseText = VerseObjectUtils.mergeVerseData(verseObjects).trim();
      return verseText;
    }
  }

  render() {
    const {
      translate,
      translationHelps,
      groupsIndex,
      contextId,
      showHelps,
      toggleHelps
    } = this.props;

    const {groupId, occurrenceNote, tool} = contextId;
    const title = groupsIndex.filter(item => item.id === groupId)[0].name;
    let phrase = '';

    switch (tool) {
      case 'translationWords': {
        const {translationWords} = translationHelps ? translationHelps : {};
        phrase = this.getPhraseFromTw(translationWords, contextId.groupId, translationHelps);
        break;
      }
      case 'translationNotes':
        phrase = this.getNote(occurrenceNote);
        break;
      default:
        console.error('tool is undefined in contextId');
        break;
    }

    return (
      <CheckInfoCard
        title={title}
        phrase={phrase}
        getScriptureFromReference={this.getScriptureFromReference}
        seeMoreLabel={translate('see_more')}
        showSeeMoreButton={!showHelps}
        onSeeMoreClick={toggleHelps} />
    );
  }
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
