/* eslint-disable no-extra-boolean-cast */
import React from 'react';
import PropTypes from 'prop-types';
import BookmarkIcon from '@material-ui/icons/Bookmark';
import BlockIcon from '@material-ui/icons/Block';
import ModeCommentIcon from '@material-ui/icons/ModeComment';
import EditIcon from '@material-ui/icons/Edit';
import {GroupedMenu, generateMenuData, generateMenuItem, InvalidatedIcon, CheckIcon} from 'tc-ui-toolkit';

export function generateItemId(occurrence, bookId, chapter, verse, quote) {
  let quoteId = "";
  if (Array.isArray(quote)) { // is a bit more complicated
    const parts = [];
    for (let i = 0, l = quote.length; i < l; i++) {
      const quotePart = quote[i];
      parts.push(quotePart.occurrence + ":" + quotePart.word);
    }
    quoteId = parts.join(":");
  } else {
    quoteId = `${occurrence}:${quote}`;
  }
  return `${quoteId}:${verse}:${chapter}:${bookId}`;
}

class GroupMenuWrapper extends React.Component {

  /**
   * Handles click events from the menu
   * @param {object} contextId - the menu item's context id
   */
  handleClick = ({contextId}) => {
    const {tc: {actions: {changeCurrentContextId}}} = this.props;
    changeCurrentContextId(contextId);
  };

  /**
   * Preprocess a menu item
   * @param {object} item - an item in the groups data
   * @returns {object} the updated item
   */
  onProcessItem = item => {
    const {tc: {project}} = this.props;
    const bookName = project.getBookName();

    const {
      contextId: {
        quote,
        occurrence,
        reference: {bookId, chapter, verse}
      }
    } = item;

    // build selection preview
    let selectionText = "";
    if(item.selections) {
      selectionText = item.selections.map(s => s.text).join(" ");
    }

    // build passage title
    let passageText = `${bookName} ${chapter}:${verse}`;
    if(selectionText) {
      passageText = `${bookId} ${chapter}:${verse}`;
    }

    console.log('item', item);

    return {
      ...item,
      title: `${passageText} ${selectionText}`,
      itemId: generateItemId(occurrence, bookId, chapter, verse, quote),
      finished: !!item.selections && !item.invalidated,
      nothingToSelect: !!item.nothingToSelect,
      tooltip: selectionText
    };
  };

  render() {
    const {
      translate,
      tc: {
        contextId,
        groupsDataReducer: {groupsData},
        groupsIndexReducer: {groupsIndex}
      }
    } = this.props;
    const filters = [
      {
        label: translate('menu.invalidated'),
        key: 'invalidated',
        icon: <InvalidatedIcon/>
      },
      {
        label: translate('menu.bookmarks'),
        key: 'reminders',
        icon: <BookmarkIcon/>
      },
      {
        label: translate('menu.selected'),
        key: 'finished',
        disables: ['not-finished'],
        icon: <CheckIcon/>
      },
      {
        label: translate('menu.no_selection'),
        id: 'not-finished',
        key: 'finished',
        value: false,
        disables: ['finished'],
        icon: <BlockIcon/>
      },
      {
        label: translate('menu.verse_edit'),
        key: 'verseEdits',
        icon: <EditIcon/>
      },
      {
        label: translate('menu.comments'),
        key: 'comments',
        icon: <ModeCommentIcon/>
      }
    ];

    const statusIcons = [
      {
        key: 'invalidated',
        icon: <InvalidatedIcon style={{color: "white"}}/>
      },
      {
        key: 'reminders',
        icon: <BookmarkIcon style={{color: "white"}}/>
      },
      {
        key: 'finished',
        icon: <CheckIcon style={{color: "#58c17a"}}/>
      },
      {
        key: 'nothingToSelect',
        icon: <CheckIcon style={{color: "#58c17a"}}/>
      },
      {
        key: 'verseEdits',
        icon: <EditIcon style={{color: "white"}}/>
      },
      {
        key: 'comments',
        icon: <ModeCommentIcon style={{color: "white"}}/>
      }
    ];

    console.log('groupsIndex', groupsIndex);
    console.log('groupsData', groupsData);

    const entries = generateMenuData(
      groupsIndex,
      groupsData,
      'selections',
      this.onProcessItem
    );

    const activeEntry = generateMenuItem(contextId, this.onProcessItem);
    const sorted = entries.sort((a, b) => {
      const aName = (a.title || a.id).toLowerCase();
      const bName = (b.title || b.id).toLowerCase();
      return (aName < bName) ? -1 : (aName > bName) ? 1 : 0;
    });
    return (
      <GroupedMenu
        filters={filters}
        entries={sorted}
        active={activeEntry}
        statusIcons={statusIcons}
        emptyNotice={translate('menu.no_results')}
        title={translate('menu.menu')}
        onItemClick={this.handleClick}
      />
    );
  }
}

GroupMenuWrapper.propTypes = {
  tc: PropTypes.object.isRequired,
  translate: PropTypes.func.isRequired,
  groupsIndexReducer: PropTypes.object,
  groupsDataReducer: PropTypes.object
};

export default GroupMenuWrapper;
