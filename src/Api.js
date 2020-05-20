/* eslint-disable no-unused-vars */
import {
  getActiveLanguage,
  setActiveLocale,
  ToolApi,
} from 'tc-tool';
import path from 'path-extra';
import usfm from 'usfm-js';
import fs from 'fs-extra';
import isEqual from 'deep-equal';
import { checkSelectionOccurrences } from 'selections';
import { getGroupsData, getGroupsDataLoaded } from './selectors/index';
import { updateGroupDataForVerseEdit } from './state/actions/verseEditActions';
import {
  clearGroupsData,
  loadGroupsData,
  verifyGroupDataMatchesWithFs,
} from './state/actions/groupsDataActions';
import { getGroupDataForVerse } from './helpers/groupDataHelpers';
import { getSelectionsFromChapterAndVerseCombo, generateTimestamp } from './helpers/validationHelpers';
import { getQuoteAsString } from './helpers/checkAreaHelpers';
import { sameContext } from './helpers/contextIdHelpers';
import { loadVerseEdit } from './helpers/checkDataHelpers';
import { WORD_ALIGNMENT } from './common/constants';
import { clearContextId } from './state/actions/contextIdActions';
import { changeSelections } from './state/actions/selectionsActions';

export default class Api extends ToolApi {
  constructor() {
    super();
    this.getAlignmentMemory = this.getAlignmentMemory.bind(this);
    this.getInvalidChecks = this.getInvalidChecks.bind(this);
    this.getProgress = this.getProgress.bind(this);
    this.validateVerse = this.validateVerse.bind(this);
    this.validateVerseAlignments = this.validateVerseAlignments.bind(this);
    this.validateVerseSelectionsInOtherTools = this.validateVerseSelectionsInOtherTools.bind(this);
    this._loadBookSelections = this._loadBookSelections.bind(this);
    this._loadVerseSelections = this._loadVerseSelections.bind(this);
    this._loadCheckData = this._loadCheckData.bind(this);
  }

  /**
   * Lifecycle method
   */
  toolWillConnect() {
    const { clearContextId, clearGroupsData } = this.props;
    clearContextId();
    clearGroupsData();
    this.validateBook(true);
  }

  validateBook(silent) {
    const {
      tc: { targetBook },
      tool: { name: toolName },
    } = this.props;
    const groupsData = this._getGroupData();
    const groupsDataKeys = Object.keys(groupsData);
    const chapters = Object.keys(targetBook);
    const modifiedTimestamp = generateTimestamp();

    for (let i = 0, l = chapters.length; i < l; i++) {
      const chapter = chapters[i];

      if (isNaN(chapter) || parseInt(chapter) === -1) {
        continue;
      }
      this.validateChapter(chapter, groupsData, groupsDataKeys, silent, modifiedTimestamp);
    }
  }

  /**
   * verifies all the selections for chapter to make sure they are still valid.
   * This expects the book resources to have already been loaded.
   * Books are loaded when a project is selected.
   * @param {String} chapter
   * @param {Object} groupsData
   * @param {Array} groupsDataKeys - quick lookup for keys in groupsData
   * @param {boolean} silent - if true then don't show alerts
   * @param {String} modifiedTimestamp
   */
  validateChapter(chapter, groupsData, groupsDataKeys, silent, modifiedTimestamp) {
    const { tc: { targetBook } } = this.props;

    if (targetBook[chapter]) {
      const bibleChapter = targetBook[chapter];

      if (bibleChapter) {
        const verses = Object.keys(bibleChapter);

        for (let i = 0, l = verses.length; i < l; i++) {
          const verse = verses[i];
          const targetVerse = bibleChapter[verse];
          this._validateVerse(targetVerse, chapter, verse, groupsData, groupsDataKeys, silent, modifiedTimestamp);
        }
      }
    }
  }

  /**
   * checks the alignments for changes
   * @param {String} chapter
   * @param {String} verse
   * @param {boolean} silent - if true then don't show alerts
   * @returns {boolean} true if valid
   */
  validateVerseAlignments(chapter, verse, silent=false) {
    const {
      tc: { tools },
      tool: { name: toolName },
    } = this.props;
    const wA_api = tools && tools[WORD_ALIGNMENT];

    if (wA_api) {
      try {
        return wA_api.trigger('validateVerse', chapter, verse, silent);
      } catch (e) {
        console.error(`validateVerseAlignments(${toolName}) - validateVerse failed`, e);
      }
    }
    return false;
  }

  /**
   * checks the alignments for changes
   * @param {String} chapter
   * @param {String} verse
   * @param {boolean} silent - if true then don't show alerts
   * @returns {boolean} true if valid
   */
  validateVerseSelectionsInOtherTools(chapter, verse, silent=false) {
    const {
      tc: { tools },
      tool: { name: currentTool },
    } = this.props;
    let invalidatedSelections = false;
    const toolNames = Object.keys(tools);

    for (const toolName of toolNames) {
      if (toolName === WORD_ALIGNMENT) {
        continue; // skip since wA doesn't do selections
      }

      if (toolName === currentTool) {
        continue; // skip since this is the current tool
      }

      const tool_api = tools && tools[toolName];

      if (tool_api) {
        let validSelections = false;

        try {
          validSelections = tool_api.trigger('validateVerse', chapter, verse, silent);
        } catch (e) {
          console.error(`${currentTool}.validateVerseSelectionsInOtherTools(${toolName}) - validateVerse failed`, e);
          validSelections = false;
        }

        console.log(`${currentTool}.SelectionsInOtherTools(${toolName}) - validateVerse returned: ${validSelections}`);

        if (!validSelections) { // capture if selections became invalid
          invalidatedSelections = true;
        }
      } else {
        console.error(`${currentTool}.validateVerseSelectionsInOtherTools(${toolName}) - tool API not found`);
      }
    }

    console.log(`${currentTool}.SelectionsInOtherTools() - validate : ${!invalidatedSelections}`);
    return !invalidatedSelections;
  }

  /**
   * validateVerse that can be called by main app
   * @param {String} chapter
   * @param {String} verse
   * @param {boolean} silent - if true then don't show alerts
   * @param {Object} groupsData
   * @return {boolean} returns true if no selections invalidated
   */
  validateVerse(chapter, verse, silent = false, groupsData) {
    const {
      tc: {
        targetBook,
        bookId,
        project: { _projectPath: projectSaveLocation },
      },
      tool: { name: toolName },
      updateGroupDataForVerseEdit,
    } = this.props;
    let _groupsData = groupsData || this._getGroupData();
    const groupsDataKeys = Object.keys(_groupsData);
    const bibleChapter = targetBook[chapter];
    const targetVerse = bibleChapter[verse];
    const selectionsValid = this._validateVerse(targetVerse, chapter, verse, _groupsData, groupsDataKeys, silent);
    console.log(`${toolName}.validateVerse() - ${chapter}:${verse} selections valid: ${selectionsValid}`);

    // check for verse edit
    const contextId = {
      reference: {
        bookId,
        chapter,
        verse,
      },
    };
    const isVerseEdited = loadVerseEdit(projectSaveLocation, contextId);

    if (isVerseEdited) { // if verse has been edited, make sure checks in groupData for verse have the verse edit set
      console.log(`${toolName}.validateVerse() - ${chapter}:${verse} verse edited: ${isVerseEdited}`);
      updateGroupDataForVerseEdit(projectSaveLocation, toolName, contextId);
    }
    return selectionsValid;
  }

  /**
   * verify all selections for current verse
   * @param {Object} targetVerse
   * @param {String} chapter
   * @param {String} verse
   * @param {Object} groupsData
   * @param {Array} groupsDataKeys - quick lookup for keys in groupsData
   * @param {boolean} silent - if true then don't show alerts
   * @param {String} modifiedTimestamp
   * @return {boolean} returns true if no selections invalidated
   */
  _validateVerse(targetVerse, chapter, verse, groupsData, groupsDataKeys, silent, modifiedTimestamp) {
    let {
      tc: {
        bookId,
        gatewayLanguageCode,
        username,
        project: { _projectPath: projectSaveLocation },
      },
      tool: { name: toolName },
      changeSelections,
    } = this.props;
    const contextId = {
      reference: {
        bookId,
        chapter: parseInt(chapter),
        verse: parseInt(verse),
      },
    };
    const groupsDataForVerse = getGroupDataForVerse(groupsData, contextId);
    let filtered = null;
    let selectionsChanged = false;
    const groupItems = Object.keys(groupsDataForVerse);

    for (let i = groupItems.length - 1; i >= 0; i--) {
      const groupItem = groupsDataForVerse[groupItems[i]];

      for (let j = groupItem.length - 1; j >= 0; j--) {
        const checkingOccurrence = groupItem[j];
        const selections = checkingOccurrence.selections;

        if (!sameContext(contextId, checkingOccurrence.contextId)) {
          if (selections && selections.length) {
            if (!filtered) { // for performance, we filter the verse only once and only if there is a selection
              filtered = usfm.removeMarker(targetVerse); // remove USFM markers
              console.log(`${toolName}._validateVerse(): verse text: ${filtered}`);
            }

            const validSelections = checkSelectionOccurrences(filtered, selections);

            if (selections.length !== validSelections.length) {
              const selectionsObject = getSelectionsFromChapterAndVerseCombo(
                bookId,
                chapter,
                verse,
                projectSaveLocation,
                checkingOccurrence.contextId.quote,
                checkingOccurrence.contextId.occurrence
              );

              if (selectionsObject.contextId) {
                console.log(`${toolName}._validateVerse(): invalidating: ${JSON.stringify(selectionsObject.contextId)}`);
                // If selections are no longer valid, they need to be cleared and invalidated
                changeSelections(
                  [], true, selectionsObject.contextId, null, false, username, toolName,
                  gatewayLanguageCode, selectionsObject.contextId.quote, projectSaveLocation
                );
                selectionsChanged = true;
              } else {
                console.warn(`Api._validateVerse() - could not find selections for verse ${chapter}:${verse}, checkingOccurrence: ${JSON.stringify(checkingOccurrence)}`);
              }
            }
          }
        }
      }
    }

    if (selectionsChanged && !silent) {
      this._showResetDialog();
    }
    return !selectionsChanged;
  }

  writeCheckData(payload = {}, checkPath, modifiedTimestamp) {
    modifiedTimestamp = modifiedTimestamp || generateTimestamp();
    const newFilename = modifiedTimestamp + '.json';
    payload.modifiedTimestamp = modifiedTimestamp;
    fs.outputJSONSync(path.join(checkPath, newFilename.replace(/[:"]/g, '_')), payload, { spaces: 2 });
  }

  /**
   * makes sure that the groups data has been initialized and returns latest
   */
  _getGroupData() {
    const {
      tc: {
        project: { _projectPath: projectSaveLocation },
        bookId,
      },
      tool: { name: toolName },
      loadGroupsData,
      verifyGroupDataMatchesWithFs,
    } = this.props;
    const store = this.context.store; // TRICKY - we need the latest store since we may be updating
    const isGroupDataLoaded = getGroupsDataLoaded(store.getState());

    if (!isGroupDataLoaded) { // if groups data not loaded
      console.log(`_getGroupData(${toolName}) loading group data`);
      loadGroupsData(toolName, projectSaveLocation);
      // make sure data is in sync
      console.log(`_getGroupData(${toolName}) verifying group data is up to date`);
      verifyGroupDataMatchesWithFs(toolName, projectSaveLocation, bookId);
    }

    const groupsData = getGroupsData(store.getState()); // get recently updated data
    return groupsData;
  }

  /**
   * Returns the percent progress of completion for the project.
   * @returns {number} - a value between 0 and 1
   */
  getProgress() {
    const { tc: { project }, tool: { name } } = this.props;
    let totalChecks = 0;
    let completedChecks = 0;
    const selectedCategories = project.getSelectedCategories(name, true);
    const groupsData = this._getGroupData();

    for (const categoryName in selectedCategories) {
      const groups = selectedCategories[categoryName];

      for (const group of groups) {
        const data = groupsData[group];

        if (data && data.constructor === Array) {
          for (const check of data) {
            totalChecks++;
            completedChecks += (check.selections || check.nothingToSelect) ? 1 : 0;
          }
        } else {
          console.warn(`Api.getProgress() - Invalid group data found for "${group}"`);
        }
      }
    }

    if (totalChecks === 0) {
      return 0;
    } else {
      return completedChecks / totalChecks;
    }
  }

  /**
   * Lifecycle method
   * @param nextState
   * @param prevState
   */
  stateChangeThrottled(nextState, prevState) {
    // TODO: implement
  }

  /**
   * Lifecycle method
   * @param state
   * @param props
   */
  mapStateToProps(state, props) {
    return { getActiveLanguage: () => getActiveLanguage(state) };
  }

  /**
   * Lifecycle method
   * @param dispatch
   */
  mapDispatchToProps(dispatch) {
    const methods = {
      clearContextId,
      clearGroupsData,
      loadGroupsData,
      setActiveLocale,
      changeSelections,
      updateGroupDataForVerseEdit,
      verifyGroupDataMatchesWithFs,
    };

    const dispatchedMethods = {};

    // eslint-disable-next-line array-callback-return
    Object.keys(methods).map(key => {
      dispatchedMethods[key] = (...args) => dispatch(methods[key](...args));
    });

    return dispatchedMethods;
  }

  /**
   * Lifecycle method
   */
  toolWillDisconnect() {
    // TODO: implement
  }

  /**
   * Lifecycle method
   * @param nextProps
   */
  toolWillReceiveProps(nextProps) {
    try {
      const { tc: { currentToolName: nextCurrentToolName } } = nextProps;
      const {
        tc: { appLanguage, currentToolName },
        tool: { isReady },
      } = this.props;

      const isCurrentTool = (nextCurrentToolName === currentToolName);

      if (isCurrentTool && isReady) {
        const currentLang = this.props.getActiveLanguage();
        const langId = currentLang && currentLang.code;

        if (langId && (langId !== appLanguage)) { // see if locale language has changed
          this.props.setActiveLocale(appLanguage);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Loads the most recent check data for the context id
   * @param {string} check - the check to look up e.g. "invalidated"
   * @param {object} contextId - the context id for the check to look up
   * @returns {object|null} - the check data record or null if one cannot be found
   * @private
   */
  _loadCheckData(check, contextId) {
    const { tc: { project } } = this.props;
    const {
      reference: {
        bookId, chapter, verse,
      }, groupId, quote, occurrence,
    } = contextId;
    const loadPath = path.join('checkData', check, bookId, `${chapter}`,
      `${verse}`);

    if (project.dataPathExistsSync(loadPath)) {
      // sort and filter check records
      const files = project.readDataDirSync(loadPath).filter(file => path.extname(file) === '.json');
      let sortedRecords = files.sort().reverse();
      const isQuoteArray = Array.isArray(quote);
      let jsonData;

      // load check data
      for (let i = 0, len = sortedRecords.length; i < len; i++) {
        const record = sortedRecords[i];
        const recordPath = path.join(loadPath, record);
        jsonData = null;

        try {
          jsonData = project.readDataFileSync(recordPath);
          const recordData = JSON.parse(jsonData);

          // return first match
          if (recordData.contextId.groupId === groupId &&
            (isQuoteArray ? isEqual(recordData.contextId.quote, quote) : (recordData.contextId.quote === quote)) &&
            recordData.contextId.occurrence === occurrence) {
            return recordData;
          }
        } catch (e) {
          console.warn(`Api.loadCheckData() - Failed to load check record from ${recordPath}, recordData: ${jsonData}`, e);
        }
      }
    }

    return null;
  }

  /**
   * Returns the total number of invalidated checks
   * TODO: move category selection management into the tool so we don't need this param
   * @param {string[]} groups - an array of categories to include in the calculation (sub categories).
   * @returns {number} - the number of invalid checks
   */
  getInvalidChecks(groups) {
    let invalidChecks = 0;
    const groupsData = this._getGroupData();

    for (const group of groups) {
      const data = groupsData[group];

      if (data && data.constructor === Array) {
        for (const check of data) {
          if (check.invalidated === true) {
            invalidChecks++;
          }
        }
      } else {
        console.warn(`Api.getInvalidChecks() - Invalid group data found for "${group}"`);
      }
    }
    return invalidChecks;
  }

  /**
   * Returns the alignment memory generated from selections made in tW.
   * @return {{sourceText : string, targetText : string}[]}
   */
  getAlignmentMemory() {
    // TODO: perform initial selection loading when the tool connects.
    // This must wait until after all selection logic is migrated to tW.
    const selections = this._loadBookSelections(this.props);
    const alignmentMemory = [];

    // format selections as alignment memory
    for (const chapter of Object.keys(selections)) {
      for (const verse of Object.keys(selections[chapter])) {
        for (const selection of selections[chapter][verse]) {
          if (selection.selections.length === 0) {
            continue;
          }

          let sourceText = null;

          if (Array.isArray(selection.contextId.quote)) {
            sourceText = selection.contextId.quoteString || // in tN quoteString is present
              getQuoteAsString(selection.contextId.quote); // if not such as for tW then we build quote
          } else {
            sourceText = selection.contextId.quote;
          }

          const targetText = selection.selections.map(s => s.text).join(' ');

          alignmentMemory.push({
            sourceText,
            targetText,
          });
        }
      }
    }

    return alignmentMemory;
  }

  /**
   * Loads the selection data for the entire book
   * @param props
   * @private
   */
  _loadBookSelections(props) {
    const { tc: { targetBook } } = props;

    const selections = {};

    for (const chapter of Object.keys(targetBook)) {
      for (const verse of Object.keys(targetBook[chapter])) {
        const verseSelections = this._loadVerseSelections(chapter, verse,
          props);

        if (verseSelections.length > 0) {
          if (!selections[chapter]) {
            selections[chapter] = {};
          }
          selections[chapter][verse] = verseSelections;
        }
      }
    }
    // TODO: store selection data in tool reducer.
    return selections;
  }

  /**
   * Loads the selection data for a verse
   * @param {string} chapter
   * @param {string} verse
   * @param props
   * @return {Array}
   * @private
   */
  _loadVerseSelections(chapter, verse, props) {
    const {
      tc: {
        bookId,
        projectDataPathExistsSync,
        readProjectDataSync,
        readProjectDataDirSync,
      },
    } = props;

    const verseDir = path.join('checkData/selections/', bookId, chapter, verse);
    const selections = [];
    const foundSelections = [];

    if (projectDataPathExistsSync(verseDir)) {
      let files = readProjectDataDirSync(verseDir);
      files = files.filter(f => path.extname(f) === '.json');
      files = files.sort().reverse();

      for (let i = 0; i < files.length; i++) {
        let filePath = path.join(verseDir, files[i]);

        let data;

        try {
          data = JSON.parse(readProjectDataSync(filePath));
        } catch (err) {
          console.error(`failed to read selection data from ${filePath}`, err);
          continue;
        }

        if (data && data.contextId) {
          const id = `${data.contextId.groupId}:${data.contextId.quote}`;

          if (foundSelections.indexOf(id) === -1) {
            foundSelections.push(id);
            selections.push(data);
          }
        }
      }
    }
    return selections;
  }

  _showResetDialog() {
    const { tool: { translate } } = this.props;
    this.props.tc.showIgnorableDialog('selections_invalidated', translate('selections_invalidated'));
  }
}
