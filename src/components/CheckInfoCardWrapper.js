import React from 'react';
import PropTypes from 'prop-types';
import {CheckInfoCard} from 'tc-ui-toolkit';

class CheckInfoCardWrapper extends React.Component {
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
    return occurrenceNote.replace(/\(See:.*/g,"");
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
      case 'translationWords':
        const {translationWords} = translationHelps ? translationHelps : {};
        phrase = this.getPhraseFromTw(translationWords, contextId.groupId, translationHelps);
        break;
      case 'translationNotes':
        phrase = getNote(occurrenceNote);
        break;
      default:
        console.error('tool is undefined in contextId')
        break;
    }

    return (
      <CheckInfoCard
        title={title}
        phrase={phrase}
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
};

export default CheckInfoCardWrapper;
