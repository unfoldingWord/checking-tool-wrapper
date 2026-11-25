/* eslint-env jest */
import React, {
  useEffect,
  useRef,
  useState,
} from 'react';
import PropTypes from 'prop-types';
import { createTcuiTheme, TcuiThemeProvider } from 'tc-ui-toolkit';
import { connect } from 'react-redux';
import isEqual from 'deep-equal';
import path from 'path-extra';
// helpers
import * as settingsHelper from './helpers/settingsHelper';
import { getThelpsManifestRelation } from './helpers/resourcesHelpers';
// components
import GroupMenuContainer from './containers/GroupMenuContainer';
import VerseCheckWrapper from './components/VerseCheckWrapper';
import TranslationHelpsWrapper from './components/TranslationHelpsWrapper';
import CheckInfoCardWrapper from './components/CheckInfoCardWrapper';
import ScripturePaneWrapper from './components/ScripturePaneWrapper';
// selectors
import {
  getBibles,
  getContextId,
  getCurrentPaneSettings,
  getCurrentToolName,
  getGatewayLanguageBibles,
  getGatewayLanguageCode,
  getProjectManifest,
  getTargetBible,
  getTcState,
  getToolApi,
  getTranslateState,
} from './selectors';
import * as gatewayLanguageHelpers from './helpers/gatewayLanguageHelpers';
import {
  cleanGlQuote,
  cleanQuote,
  compareUnicodeStrings,
  fetchPreviousSelectionData,
  getLocalAiServerStatus,
  normalizeForCompare,
  queryAiAPIModels,
  readSettingsForChecking_,
  redactOptions,
  saveAlignmentData,
  saveSettingsForChecking_,
  updatedPreviousSelectionsData,
  updateLlmMetrics,
  usesAiServer,
} from './utils/checkingSuggestionsUtils';
import { LlmRequestQueue } from './utils/LlmRequestQueue';
import {
  fetchAlignmentHistoryEntries,
  getSuggestionHistory,
  updateAlignmentEntrySelection,
} from './utils/alignmentHistoryUtils';
import delay from './utils/delay';
import { getVerseText } from './helpers/verseHelpers';
import { getQuoteAsString } from './helpers/checkAreaHelpers';

const theme = createTcuiTheme({
  typography: { useNextVariants: true },
  scrollbarThumb: { borderRadius: '10px' },
});

const styles = {
  containerDiv:{
    display: 'flex',
    flexDirection: 'row',
    width: '100vw',
  },
  centerDiv: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    overflowX: 'auto',
  },
  scripturePaneDiv: {
    display: 'flex',
    flexShrink: '0',
    height: '250px',
    paddingBottom: '20px',
  },
};

const selectionsData = {
  groupId: null,
  selections: {},
  // alignment history of the group `alignmentGroupId` (plans/alignment-history.md), or null when
  // the `llmUseAlignmentHistory` setting is off
  alignmentEntries: null,
  alignmentGroupId: null,
};

const glBiblesCache = {
  glBibleId: null,
  targetLangId: null,
  resourceId: null,
  bibles: {},
};

const __suggestionsCache = {};
const __previousSelectionsCache = {};

/**
 * The project folder name of a project path.
 * @param {string} projectSaveLocation
 * @returns {string}
 */
function getProjectName(projectSaveLocation) {
  return projectSaveLocation ? path.parse(projectSaveLocation).base : '';
}

/** number of suggestion requests bundled into each AI query */
const DEFAULT_SUGGESTION_REQUESTS_PER_CALL = 1;

/**
 * Top-level checking-tool layout: group menu, scripture pane, check info card, verse check,
 * and translation helps, wired together with the auto-suggestion and selection-history helpers.
 * @param {object} props
 * @param {object} props.bibles - target-language bible resources
 * @param {object} props.contextId - current check's context (checkId, groupId, reference)
 * @param {Array} props.currentPaneSettings - scripture pane display settings
 * @param {string} props.gatewayLanguageCode - gateway language code
 * @param {string} props.gatewayLanguageQuote - aligned gateway-language quote for the current check
 * @param {Array} props.glBibles - available gateway-language bibles
 * @param {Function} props.setToolSettings - persists tool settings to the host app
 * @param {object} props.tc - host tCore state (target book, resources, project info)
 * @param {object} props.toolApi - this tool's Api instance
 * @param {string} props.toolName - current tool name
 * @param {Function} props.translate - localization function
 * @param {Array} props.tsvRelation - tHelps manifest relation data
 * @returns {JSX.Element}
 */
function Container({
  bibles,
  contextId,
  currentPaneSettings,
  gatewayLanguageCode,
  gatewayLanguageQuote,
  glBibles,
  manifest,
  setToolSettings,
  targetBible,
  tc,
  toolApi,
  toolName,
  translate,
  tsvRelation,
}) {
  const [showHelps, setShowHelps] = useState(true);
  const [editVerseInScrPane, setEditVerseInScrPane] = useState(null); // trigger to edit first verse in Expanded Scripture Pane
  const settingsForSuggestionsRef = useRef(null);
  const [triggerGenerateSuggestionsStart, setTriggerGenerateSuggestionsStart] = useState(false);
  const generateSuggestionsRestartRef = useRef(false);
  const generateSuggestionsRunningRef = useRef(false);
  const suggestionsRequestQueueRef = useRef(new LlmRequestQueue(__suggestionsCache));
  const {
    checkId, groupId, reference,
  } = contextId || {};
  const { chapter, verse } = reference || {};

  /**
   * Whether AI suggestions are in use: suggestions and AI suggestions turned on, with a server URL or
   * the local AI server.
   * Only AI suggestions are cached, so only then are suggestions made ahead of time.
   * @returns {boolean} - true when AI suggestions are in use
   */
  function isAiSuggestionsOn() {
    const settings = settingsForSuggestionsRef.current;
    return !!(settings?.suggestionsEnabled && settings.llmSuggestionsEnabled && usesAiServer(settings));
  }

  /**
   * Generates auto-select suggestions for all groups in the checking tool. Manages a suggestion
   * generation process that can be paused, restarted, and prioritized. When invoked while already
   * running, it shuts down the current process and restarts.
   *
   * The function processes groups sequentially, creating suggestion requests for checks that lack
   * selections. It respects priority flags and scope options to control which groups are processed.
   *
   * @param {boolean} [priority=false] - whether to prioritize these requests in the suggestion queue
   * @param {boolean} [force=false] - whether to force regeneration of suggestions even if they exist in cache
   * @param {boolean} [currentGroupOnly=false] - whether to limit processing to only the current group
   * @param {boolean} [skipCurrentGroup=false] - whether to skip the current group and process only other groups
   * @returns {Promise<void>}
   */
  async function generateSuggestionsForGroups(priority = false, force = false, currentGroupOnly = false, skipCurrentGroup = false) {
    if (!isAiSuggestionsOn()) {
      // algorithm suggestions aren't cached, so there is nothing to make ahead of time; a run
      // already going stops at its next check
      return;
    }

    if (generateSuggestionsRunningRef.current) { // if process already running, shut it down first
      // console.log(`generateSuggestionsForGroups - alreading running, restarting`);
      generateSuggestionsRestartRef.current = true;

      while (generateSuggestionsRunningRef.current) {
        // eslint-disable-next-line no-await-in-loop
        await delay(100); // waiting
      }
    }

    setTriggerGenerateSuggestionsStart(false);
    generateSuggestionsRestartRef.current = false;
    generateSuggestionsRunningRef.current = true;
    const projectSaveLocation = tc?.projectSaveLocation;
    const glOwnerStr = tc.gatewayLanguageOwner;
    const targetLanguageDetails = manifest.target_language;
    const targetLanguageId = targetLanguageDetails?.id;
    await delay(1);

    const groupsData = toolApi._getGroupData();
    // console.log(`generateSuggestionsForGroups - got groupsData`);
    await generateSuggestionsForGroupSub(groupsData, targetLanguageId, force, targetLanguageDetails, projectSaveLocation, glOwnerStr, priority, currentGroupOnly, skipCurrentGroup);
    // eslint-disable-next-line require-atomic-updates
    generateSuggestionsRunningRef.current = false;
  }

  /**
   * Processes groups of checks to generate LLM suggestions for items without selections.
   * Manages scope and ordering of group processing based on match criteria.
   *
   * @param {object} groupsData - all groups data containing checks to process
   * @param {string} targetLanguageId - target language identifier
   * @param {boolean} force - whether to force regeneration of existing suggestions
   * @param {object} targetLanguageDetails - complete target language metadata
   * @param {string} projectSaveLocation - file system path to project save directory
   * @param {string} glOwnerStr - gateway language owner identifier
   * @param {boolean} priority - whether these requests should be prioritized in queue
   * @param {boolean} currentGroupOnly - limits processing to only the current group
   * @param {boolean} skipCurrentGroup - skips the current group and processes others
   * @returns {Promise<void>}
   */
  async function generateSuggestionsForGroupSub(groupsData, targetLanguageId, force, targetLanguageDetails, projectSaveLocation, glOwnerStr, priority, currentGroupOnly, skipCurrentGroup) {
    const defaultsuggestionrequestspercall = settingsForSuggestionsRef.current?.llmGrouping || DEFAULT_SUGGESTION_REQUESTS_PER_CALL;

    /**
     * Generates suggestions for a subset of groups based on match criteria.
     * Iterates through groups and creates suggestion requests for checks lacking selections.
     *
     * @param {string|null} matchGroupId - processes only this specific group when provided
     * @param {string|null} matchAfterGroupId - processes only groups after this group ID
     * @param {string|null} matchBeforeGroupId - processes only groups before this group ID
     * @returns {Promise<void>}
     */
    async function generateSuggestionForSubgroup(matchGroupId = null, matchAfterGroupId = null, matchBeforeGroupId = null) {
      let findGroupId = matchGroupId;
      // let count = 0;

      if (matchAfterGroupId) {
        findGroupId = matchAfterGroupId;
      } else if (matchBeforeGroupId) {
        findGroupId = matchBeforeGroupId;
      }

      if (generateSuggestionsRestartRef.current
        || !isAiSuggestionsOn()) {
        return;
      }

      const groupIds = Object.keys(groupsData) || [];
      let foundMatch = false;
      let pendingRequests = [];
      let pendingForce = false;

      function submitSuggestionRequest(suggestionsRequestQueue, request, force_) {
        suggestionsRequestQueue.makeSuggestionRequest(
          request,
          null, // nobody waits for these, so clearing the queue may drop them
          false,
          force_,
        );
      }

      // bundles requests so that DEFAULT_SUGGESTION_REQUESTS_PER_CALL are sent per AI query
      function flushPendingRequests() {
        if (pendingRequests.length) {
          submitSuggestionRequest(suggestionsRequestQueueRef?.current, pendingRequests, pendingForce);
          pendingRequests = [];
          pendingForce = false;
        }
      }

      for (const groupId of groupIds) {
        if (generateSuggestionsRestartRef.current
          || !isAiSuggestionsOn()) {
          break;
        }

        const matchedGroupId = groupId === findGroupId;

        if (matchedGroupId) {
          foundMatch = true;
        }

        if (matchGroupId) { // in this case we are only processing the same group
          if (!foundMatch) {
            continue;
          } else if (!matchedGroupId) {
            break;
          }
        } else if (matchAfterGroupId) { // in this case we process only groups after this groupId
          if (!foundMatch) {
            continue;
          } else if (matchedGroupId) {
            continue;
          }
        } else if (matchBeforeGroupId) {
          if (foundMatch) {
            break;
          }
        }

        const group = groupsData[groupId];
        // eslint-disable-next-line no-await-in-loop
        await delay(1);
        // console.log(`generateSuggestionsForGroups for group ${groupId}`);

        for (const check of group) {
          if (generateSuggestionsRestartRef.current
            || !isAiSuggestionsOn()) {
            break;
          }

          if (!check?.selections?.length) {
            // count++;
            const suggestionsRequestQueue = suggestionsRequestQueueRef?.current;

            // console.log(`generateSuggestionsForGroups - no selection for check ${check}`);
            const contextId = check?.contextId;
            const reference = contextId?.reference;
            const {
              bookId, chapter, verse,
            } = reference || {};
            const checkId = contextId?.checkId;
            const key = generateKey(targetLanguageId, groupId, bookId, chapter, verse, checkId);

            if (force || !suggestionsRequestQueue.alreadyHaveSuggestionsForKey(key)) {
              const { verseText } = getVerseText(targetBible, contextId, true);
              const gatewayLanguageQuote_ = gatewayLanguageHelpers.getAlignedGLTextHelper(
                contextId,
                glBibles,
                gatewayLanguageCode,
                tsvRelation,
                true
              );

              if (gatewayLanguageQuote_) {
                const llmQueryUrl_ = settingsForSuggestionsRef.current.llmSuggestionsEnabled ? settingsForSuggestionsRef.current.llmQueryUrl : '';
                const llmUseLocalServer_ = !!(settingsForSuggestionsRef.current.llmSuggestionsEnabled &&
                  settingsForSuggestionsRef.current.llmUseLocalServer);
                const data = {
                  algorithmCertainConfidence: settingsForSuggestionsRef.current.llmAlgorithmCertainConfidence,
                  apiToken: settingsForSuggestionsRef.current.llmApiToken,
                  alignedGLText: gatewayLanguageQuote_,
                  contextId,
                  currentModel: settingsForSuggestionsRef.current.currentModel,
                  force,
                  gatewayLanguageCode,
                  key,
                  llmEnableThinking: !!settingsForSuggestionsRef.current.llmEnableThinking,
                  llmExtraParams: settingsForSuggestionsRef.current.llmExtraParams,
                  llmSuggestionsEnabled: settingsForSuggestionsRef.current.llmSuggestionsEnabled,
                  llmTemperature: settingsForSuggestionsRef.current.llmTemperature,
                  llmQueryUrl: llmQueryUrl_,
                  llmUseLocalServer: llmUseLocalServer_,
                  targetLanguageDetails,
                  verseText,
                };

                const selectionsForWord = fetchPreviousSelectionData(
                  projectSaveLocation,
                  contextId,
                  glBibles,
                  tsvRelation,
                  toolName,
                  groupId,
                  gatewayLanguageCode,
                  glOwnerStr,
                  data,
                  glBiblesCache
                );

                selectionsData.quoteString = contextId?.quoteString || getQuoteAsString(contextId?.quote);
                selectionsData.groupId = groupId;
                selectionsData.selections = selectionsForWord;
                updateAlignmentHistory(projectSaveLocation, groupId, glOwnerStr);

                // eslint-disable-next-line no-await-in-loop
                await delay(1);

                saveAlignmentData(projectSaveLocation, __previousSelectionsCache, getSelectionsDataToSave());

                // eslint-disable-next-line no-await-in-loop
                await delay(1);

                // console.log(selectionsForWord);

                const request = {
                  ...data,
                  // copy - selectionsData is reused for each check
                  selectionsData: getSelectionsDataForCheck(projectSaveLocation, contextId),
                };

                // eslint-disable-next-line no-await-in-loop
                await delay(1);
                pendingRequests.push(request);
                pendingForce = pendingForce || force;

                if (pendingRequests.length >= defaultsuggestionrequestspercall) {
                  flushPendingRequests();
                }
              } else {
                console.log(`generateSuggestionForSubgroup no glQuote`, check);
              }
            }
          }
        }
      }

      if (!generateSuggestionsRestartRef.current
        && isAiSuggestionsOn()) {
        flushPendingRequests(); // send the remainder
      }
      // console.log(`generateSuggestionForSubgroup added ${count} checks`);
    }

    if (generateSuggestionsRestartRef.current
      || !isAiSuggestionsOn()) {
      return;
    }

    if (!skipCurrentGroup) {
      await generateSuggestionForSubgroup(groupId);
    }

    if (!currentGroupOnly) {
      await generateSuggestionForSubgroup(null, groupId);
      await generateSuggestionForSubgroup(null, null, groupId);
    }
  }

  // Effect hook that runs once on component mount to:
  // 1. Load and apply correct scripture pane display settings
  // 2. Restart suggestion generation if settings were previously loaded
  // 3. Clean up by stopping suggestion generation and clearing pending requests on unmount
  useEffect(() => {
    // alignments may have changed in another tool since the group's alignment history was read
    selectionsData.alignmentGroupId = null;
    selectionsData.alignmentEntries = null;

    settingsHelper.loadCorrectPaneSettings(
      setToolSettings,
      bibles,
      gatewayLanguageCode,
      currentPaneSettings
    );

    if (settingsForSuggestionsRef.current) { // if we already have loaded settings
      setTriggerGenerateSuggestionsStart(false);
      delay(100).then(() => {
        setTriggerGenerateSuggestionsStart(true);
      });
    }

    return () => {
      console.log('Container is closing');
      generateSuggestionsRestartRef.current = true;
      const suggestionsRequestQueue = suggestionsRequestQueueRef?.current;
      suggestionsRequestQueue.clearPendingRequests(false); // nothing on screen is waiting any more
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect hook that triggers suggestion generation when requested.
  // Monitors `triggerGenerateSuggestionsStart` state to initiate or restart
  // the suggestion generation process for all groups in the checking tool.
  // If generation is already running, sets a restart flag to stop the current
  // process and begin a new one. Only proceeds if suggestions are enabled in settings.
  useEffect(() => {
    if (triggerGenerateSuggestionsStart) {
      if (!generateSuggestionsRunningRef.current) {
        if (isAiSuggestionsOn()) {
          const suggestionsRequestQueue = suggestionsRequestQueueRef?.current;
          suggestionsRequestQueue.clearPendingRequests();
          const currentGroupOnly = !settingsForSuggestionsRef.current.llmMaximizeRequests;
          generateSuggestionsForGroups(true, true, currentGroupOnly).then(() => { });
        }
      } else { // currently running, need to restart
        generateSuggestionsRestartRef.current = true;
      }
    }
  }, [triggerGenerateSuggestionsStart]);

  // Effect hook that clears verse edit mode when the check context changes.
  // Monitors changes to checkId, groupId, chapter, or verse and resets
  // the editVerseInScrPane state to null, ensuring the Expanded Scripture Pane
  // exits edit mode when navigating to a different check or verse.
  useEffect(() => {
    // if context changes, clear edit verse
    setEditVerseInScrPane(null);
  }, [checkId, groupId, chapter, verse]);

  // Effect hook that runs when the current groupId in contextId changes,
  // i.e. when the user navigates to a different check group.
  useEffect(() => {
    if (!groupId) {
      return;
    }

    console.log(`Container - groupId changed to ${groupId}`);
    setTriggerGenerateSuggestionsStart(false);
    delay(100).then(() => {
      setTriggerGenerateSuggestionsStart(true);
    });
  }, [groupId]);

  /**
   * Triggers edit mode for a verse in the Expanded Scripture Pane.
   * @param {string|number} verseRef - verse reference to edit
   */
  function editVerseInExpandedScripturePane(verseRef) {
    if (verseRef) {
      setEditVerseInScrPane(verseRef + '');
    }
  }

  /**
   * Clears edit mode when the Expanded Scripture Pane closes.
   * @param {boolean} shown - whether the pane is now shown
   */
  function onExpandedScripturePaneShow(shown) {
    if (!shown) {
      // when expanded scripture pane is closed, clear edit mode
      setEditVerseInScrPane(null);
    }
  }


  /**
   * Reads the alignment history of `groupId` into `selectionsData` when the
   * `llmUseAlignmentHistory` setting is on and it was not read yet for that group; clears it when
   * the setting is off (plans/alignment-history.md, Step 2).
   * @param {string} projectSaveLocation - path to the current project folder
   * @param {string} groupId_ - the group the history is for
   * @param {string} glOwnerStr - owner of the gateway-language bible
   */
  function updateAlignmentHistory(projectSaveLocation, groupId_, glOwnerStr) {
    if (!settingsForSuggestionsRef.current?.llmUseAlignmentHistory) {
      selectionsData.alignmentEntries = null;
      selectionsData.alignmentGroupId = null;
      return;
    }

    if (selectionsData.alignmentGroupId !== groupId_) {
      selectionsData.alignmentEntries = fetchAlignmentHistoryEntries(
        projectSaveLocation,
        glBibles,
        toolName,
        groupId_,
        gatewayLanguageCode,
        glOwnerStr,
        glBiblesCache,
      );
      selectionsData.alignmentGroupId = groupId_;
    }
  }

  /**
   * `selectionsData` without the alignment history, for `saveAlignmentData` (the entries can be
   * large and are read again from the projects).
   * @returns {object}
   */
  function getSelectionsDataToSave() {
    // eslint-disable-next-line no-unused-vars
    const { alignmentEntries, ...rest } = selectionsData;
    return rest;
  }

  /**
   * The history data sent with a check's suggestion request: a copy of `selectionsData` whose
   * `selections` also hold the group's alignment history, without the check's own verse.
   * @param {string} projectSaveLocation - path to the current project folder
   * @param {object} checkContextId - the check the request is for
   * @returns {object}
   */
  function getSelectionsDataForCheck(projectSaveLocation, checkContextId) {
    const { alignmentEntries, ...rest } = selectionsData;
    return {
      ...rest,
      selections: getSuggestionHistory(selectionsData.selections, alignmentEntries,
        getProjectName(projectSaveLocation), checkContextId),
    };
  }

  /**
   * Updates the cached previous-selection history when a check's selections change.
   * @param {object} data
   * @param {object} data.contextId - context of the changed check
   * @param {string} data.alignedGLText - aligned gateway-language text for the check
   * @param {Array} data.newSelections - selections after the change
   * @param {Array} data.oldSelections - selections before the change
   */
  function updateSelectionsData(data) {
    const alignedGLText = cleanGlQuote(data?.alignedGLText);
    const newSelections = data?.newSelections;
    const oldSelections = data?.oldSelections;
    const savedSelections = selectionsData?.selections;

    updatedPreviousSelectionsData(
      oldSelections,
      savedSelections,
      alignedGLText,
      newSelections
    );

    if (selectionsData.alignmentEntries) {
      // a saved selection wins over the check's alignment, which comes back if it is cleared
      updateAlignmentEntrySelection(selectionsData.alignmentEntries, getProjectName(tc?.projectSaveLocation),
        data?.contextId, newSelections);
    }

    if (settingsForSuggestionsRef.current?.suggestionsEnabled) {
      // only regenerate right away if using llm suggestions - algorithm suggestions are cheap to
      // recompute when needed
      if (settingsForSuggestionsRef.current.llmSuggestionsEnabled) {
        // force resuggest current group with new alignment data
        generateSuggestionsForGroups(true, true, true).then(() => {
          if (settingsForSuggestionsRef.current.llmMaximizeRequests) {
            // continue processing other groups
            generateSuggestionsForGroups(false, false, false, true).then(() => { });
          }
        });
      } else {
        // only AI suggestions are cached - drop this group's, since they were made from the old
        // selection history, so turning AI back on asks again
        const groupId = data?.contextId?.groupId;
        const suggestionsRequestQueue = suggestionsRequestQueueRef.current;

        if (groupId && suggestionsRequestQueue) {
          const prefix = generateGroupKeyPrefix(manifest?.target_language?.id, groupId);
          suggestionsRequestQueue.clearSuggestionsMemoryForKeyPrefix(prefix);
        }
      }
    }
  }

  /**
   * Saves checking settings to the tCore folder.
   * @param {object} data - settings data to save
   * @param {boolean} [noRestart=false] - whether to skip restarting suggestion generation after saving
   */
  function saveSettingsForChecking(data, noRestart = false) {
    const projectSaveLocation = tc?.projectSaveLocation;
    // const llmApiToken = data?.llmApiToken;

    // if (!llmApiToken) {
    //   console.warn(`saveSettingsForChecking llmApiToken is being cleared ${llmApiToken}`);
    // }

    saveSettingsForChecking_(projectSaveLocation, data);

    if (!isEqual(data, settingsForSuggestionsRef.current)) {
      const historyChanged = !!data?.llmUseAlignmentHistory !==
        !!settingsForSuggestionsRef.current?.llmUseAlignmentHistory;
      // save current settings
      settingsForSuggestionsRef.current = data;

      const suggestionsRequestQueue = suggestionsRequestQueueRef.current;

      if (historyChanged && suggestionsRequestQueue) {
        // the cached AI suggestions were made from the other history (plans/alignment-history.md)
        suggestionsRequestQueue.clearSuggestionsMemoryForKeyPrefix(
          generateLanguageKeyPrefix(manifest?.target_language?.id));
      }

      // only regenerate if using llm suggestions; the configure AI dialog saves with noRestart,
      // so a history change remakes the current group here
      if (data.llmSuggestionsEnabled && (!noRestart || historyChanged)) {
        // force resuggest current group
        generateSuggestionsForGroups(true, true, true).then(() => {
          if (settingsForSuggestionsRef.current.llmMaximizeRequests) {
            // continue processing other groups
            generateSuggestionsForGroups(false, true, false, true).then(() => { });
          }
        });
      }
    }
  }

  /**
   * Reads checking settings from the tCore folder.
   * @returns {object|null} - saved settings data or null if not found
   */
  function readSettingsForChecking() {
    const projectSaveLocation = tc?.projectSaveLocation;
    const data = readSettingsForChecking_(projectSaveLocation);

    // save settings  to state
    saveSettingsForChecking_(projectSaveLocation, data);

    if (!isEqual(data, settingsForSuggestionsRef.current)) {
      // save current settings
      settingsForSuggestionsRef.current = data;
    }
    setTriggerGenerateSuggestionsStart(true);

    return data || null;
  }

  /**
   * Queries the OpenAI-compatible to retrieve available models.
   * @param {object} options - query options
   * @param {string} options.baseUrl - base URL for the OpenAI-compatible
   * @returns {Promise<{models: Array|null, error: boolean}>} - object containing models array (or null on error) and error flag
   */
  // eslint-disable-next-line require-await
  async function getModelsForChecking(options) {
    return new Promise((resolve, reject) => {
      let error = false;
      let models = null;

      const suggestionsRequestQueue = suggestionsRequestQueueRef?.current;

      if (suggestionsRequestQueue) {
        suggestionsRequestQueue.requestPause(async () => {
          try {
            models = await queryAiAPIModels(options);
            console.log('getModelsForChecking models', models);
          } catch (e) {
            console.log('getModelsForChecking error', e);
            error = e.toString() || e;
          }

          const results = { models, error };
          console.log('getModelsForChecking results', results);
          resolve(results);
        });
      } else {
        reject();
      }
    });
  }

  /**
   * Enqueues a suggestion request to the LLM processing queue and returns a promise
   * that resolves with the suggestion results. The function waits for the LLM to
   * process the request and return the best selections based on the provided context.
   *
   * @param {object} request - The LLM request configuration object
   * @param {string} request.alignedGLText - Aligned gateway-language text to translate
   * @param {string} request.currentModel - Currently selected LLM model identifier
   * @param {string} request.gatewayLanguageCode - Gateway language code
   * @param {string} request.key - Unique key identifying this request
   * @param {boolean} request.force - force request of new suggestion
   * @param {string|null} request.llmQueryUrl - URL for LLM query endpoint (or null if disabled)
   * @param {number} request.llmTemperature - LLM temperature parameter (0.0 to 1.0)
   * @param {object} request.selectionsData - Previous selection history data
   * @param {object} request.targetLanguageDetails - Target language details, including `id`
   * @param {string} request.verseText - Target-language verse text
   * @returns {Promise<{error: string|boolean, bestSelections: Array, elapsedStr: string, model: string}>}
   *          Promise that resolves with an object containing error status, array of suggested
   *          selections, elapsed time string, and model identifier used for the suggestion
   */
  // eslint-disable-next-line require-await
  async function makeLlmRequestAndWaitForResponse(request) {
    return new Promise((resolve, reject) => {
      const suggestionsRequestQueue = suggestionsRequestQueueRef?.current;

      if (suggestionsRequestQueue) {
        console.log(`makeLlmRequestAndWaitForResponse request`, redactOptions(request));

        suggestionsRequestQueue.makeSuggestionRequest(
          request,
          data => { // callback function
            console.log(`makeLlmRequestAndWaitForResponse result`, data);
            resolve(data);
          },
          true,
          request.force,
        );
      } else {
        console.error(`makeLlmRequestAndWaitForResponse suggestionsRequestQueue not defined`);
        reject();
      }
    });
  }

  function generateKey(targetLanguageId, groupId, bookId, chapter, verse, checkId) {
    const key = `${generateGroupKeyPrefix(targetLanguageId, groupId)}${bookId}_${chapter}_${verse}_${checkId}`;
    return key;
  }

  /**
   * Generates the start shared by the suggestion cache keys of every check in a group
   * (see {@link generateKey}), ending in `_` so 'god' doesn't also match 'godly'.
   * @param {string} targetLanguageId - target language code
   * @param {string} groupId - check group id
   * @returns {string} - key prefix for the group
   */
  function generateGroupKeyPrefix(targetLanguageId, groupId) {
    return `${generateLanguageKeyPrefix(targetLanguageId)}${groupId}_`;
  }

  /**
   * Generates the start shared by the suggestion cache keys of every check of this tool, gateway
   * language and target language (see {@link generateKey}).
   * @param {string} targetLanguageId - target language code
   * @returns {string} - key prefix
   */
  function generateLanguageKeyPrefix(targetLanguageId) {
    return `${toolName}_${gatewayLanguageCode}_${targetLanguageId}_`;
  }

  /**
   * Computes auto-select suggestions for the current check, fetching and caching previous
   * selection history for the group the first time it's needed.
   * @param {object} data - suggestion request data
   * @param {object} data.contextId - context of the check being suggested for
   * @param {string} data.currentModel - currently selected LLM model identifier
   * @param {string} data.alignedGLText - aligned gateway-language quote to translate
   * @param {boolean} data.force - force request of new suggestion
   * @param {boolean} data.llmSuggestionsEnabled - whether LLM suggestions are enabled
   * @param {number} data.llmTemperature - 0.0 to 1.0
   * @param {object} [data.llmExtraParams] - extra chat-completion request body fields; when missing,
   *   `llmExtraParams` from the saved settings is used
   * @param {number} [data.algorithmCertainConfidence] - with AI suggestions, the algorithm's answer is
   *   used without asking the AI when its top option has at least this confidence; when missing,
   *   `llmAlgorithmCertainConfidence` from the saved settings is used, else `ALGORITHM_CERTAIN_CONFIDENCE`
   * @param {string} data.llmQueryUrl - URL for LLM query endpoint
   * @param {boolean} [data.llmEnableThinking] - true to have the AI reason before answering; when missing,
   *   `llmEnableThinking` from the saved settings is used
   * @param {boolean} [data.llmUseLocalServer] - true to use translationCore's local AI server in place of
   *   `llmQueryUrl`; when missing, `llmUseLocalServer` from the saved settings is used
   * @param {object} data.targetLanguageDetails - target language details, including `id`
   * @param {string} data.verseText - target-language verse text
   * @returns {Promise<{error: string|boolean, bestSelections: Array, elapsedStr: string, model: string, contextId: object}>} -
   *   object containing error status, suggested selections array, elapsed time string, model used, and
   *   `data.contextId` so the caller can tell which check the result is for. On error only
   *   `{error: true, contextId}` is returned.
   */
  async function getSuggestions(data) {
    const projectSaveLocation = tc?.projectSaveLocation;
    const glOwnerStr = tc.gatewayLanguageOwner;

    const {
      alignedGLText: _alignedGLText,
      contextId,
      currentModel,
      force,
      llmApiToken,
      llmSuggestionsEnabled,
      llmTemperature,
      llmQueryUrl,
      targetLanguageDetails,
      verseText,
    } = data || {};
    // the caller (tc-ui-toolkit) may not know about extra params, so fall back to the saved settings
    const llmExtraParams = data?.llmExtraParams ?? settingsForSuggestionsRef.current?.llmExtraParams;
    const algorithmCertainConfidence = data?.algorithmCertainConfidence ??
      settingsForSuggestionsRef.current?.llmAlgorithmCertainConfidence;

    const alignedGLText = cleanQuote(_alignedGLText);
    const groupId = contextId?.groupId || '';
    const llmQueryUrl_ = llmSuggestionsEnabled ? llmQueryUrl : null;
    // an older tc-ui-toolkit doesn't pass llmEnableThinking, so fall back to the saved settings
    const llmEnableThinking = !!(data?.llmEnableThinking ?? settingsForSuggestionsRef.current?.llmEnableThinking);
    // an older tc-ui-toolkit doesn't pass llmUseLocalServer, so fall back to the saved settings
    const llmUseLocalServer_ = !!(llmSuggestionsEnabled &&
      (data?.llmUseLocalServer ?? settingsForSuggestionsRef.current?.llmUseLocalServer));

    if (selectionsData?.groupId !== groupId) {
      const selectionsForWord = fetchPreviousSelectionData(
        projectSaveLocation,
        contextId,
        glBibles,
        tsvRelation,
        toolName,
        groupId,
        gatewayLanguageCode,
        glOwnerStr,
        data,
        glBiblesCache
      );

      selectionsData.quoteString = contextId?.quoteString || getQuoteAsString(contextId?.quote);
      selectionsData.groupId = groupId;
      selectionsData.selections = selectionsForWord;
    }
    updateAlignmentHistory(projectSaveLocation, groupId, glOwnerStr);

    const reference = contextId?.reference;
    const {
      bookId, chapter, verse,
    } = reference || {};

    const targetLanguageId = targetLanguageDetails?.id;
    const checkId = contextId?.checkId;
    const key = generateKey(targetLanguageId, groupId, bookId, chapter, verse, checkId);
    // console.log(key);

    await delay(1);

    saveAlignmentData(projectSaveLocation, __previousSelectionsCache, getSelectionsDataToSave());

    await delay(1);

    const results = await makeLlmRequestAndWaitForResponse({
      algorithmCertainConfidence,
      apiToken: llmApiToken,
      alignedGLText,
      contextId,
      currentModel,
      force,
      gatewayLanguageCode,
      key,
      llmEnableThinking,
      llmExtraParams,
      llmQueryUrl: llmQueryUrl_,
      llmUseLocalServer: llmUseLocalServer_,
      llmTemperature,
      selectionsData: getSelectionsDataForCheck(projectSaveLocation, contextId),
      targetLanguageDetails,
      verseText,
    });

    const {
      error,
      bestSelections,
      elapsedStr,
      model,
      cached,
    } = results || {};

    if (!error) {
      console.log('getSuggestions metrics', {
        elapsedStr,
        model,
        suggestionsCount: bestSelections.length,
      });

      const _bestSuggestion = (bestSelections?.length && bestSelections[0]) || { selections: [] };
      const isSelectionCurrentlyEmpty = _bestSuggestion?.length === 0;

      if (!isSelectionCurrentlyEmpty) {
        // warn if selections don't exactly match verse
        for (const selection of _bestSuggestion.selections) {
          if (!verseText.includes(selection.text)) {
            console.log(`cannot find ${selection.text}`);
            const normalizedVerseText = normalizeForCompare(verseText);
            const normalizedSelection = normalizeForCompare(selection.text);

            if (!normalizedVerseText.includes(normalizedSelection)) {
              console.log(`cannot find ${selection.text}`);
            } else {
              if (normalizedVerseText !== verseText) {
                console.log(`not normalized verseText: ${verseText}`);
                compareUnicodeStrings(normalizedVerseText, verseText);
              }

              if (normalizedSelection !== selection.text) {
                console.log(`not normalized selection.text: ${selection.text}`);
                compareUnicodeStrings(normalizedSelection, selection.text);
              }
            }
          }
        }
      }

      if (!cached) {
        delay(100).then(() => {
          updateLlmMetrics(projectSaveLocation, llmUseLocalServer_ ? 'localServer' : llmQueryUrl, model, elapsedStr);
        });
      }
    } else {
      console.log('getSuggestions error', {});
      return { error: true, contextId };
    }

    return {
      ...results,
      contextId,
    };
  }

  return (
    <TcuiThemeProvider theme={theme}>
      <div style={styles.containerDiv}>
        <GroupMenuContainer
          tc={tc}
          translate={translate}
          gatewayLanguageQuote={gatewayLanguageQuote}
        />
        <div style={styles.centerDiv}>
          <div style={styles.scripturePaneDiv}>
            <ScripturePaneWrapper
              tc={tc}
              toolApi={toolApi}
              translate={translate}
              onExpandedScripturePaneShow={onExpandedScripturePaneShow}
              editVerseInScrPane={editVerseInScrPane}
            />
          </div>
          <CheckInfoCardWrapper
            tc={tc}
            translate={translate}
            showHelps={showHelps}
            toggleHelps={() => setShowHelps(!showHelps)}
          />
          <VerseCheckWrapper
            tc={tc}
            toolApi={toolApi}
            translate={translate}
            contextId={contextId}
            gatewayLanguageQuote={gatewayLanguageQuote}
            editVerseInScripturePane={editVerseInExpandedScripturePane}
            getSuggestions={data => getSuggestions(data)}
            updateSelectionsData={data => updateSelectionsData(data)}
            saveSettingsForChecking={data => saveSettingsForChecking(data)}
            readSettingsForChecking={() => readSettingsForChecking()}
            getModelsForChecking={options => getModelsForChecking(options)}
            getLocalServerStatus={getLocalAiServerStatus}
          />
        </div>
        <TranslationHelpsWrapper
          tc={tc}
          showHelps={showHelps}
          translate={translate}
          toggleHelps={() => setShowHelps(!showHelps)}
        />
      </div>
    </TcuiThemeProvider>
  );
}

Container.propTypes = {
  bibles: PropTypes.object.isRequired,
  contextId: PropTypes.object.isRequired,
  currentPaneSettings: PropTypes.array.isRequired,
  gatewayLanguageCode: PropTypes.string.isRequired,
  gatewayLanguageQuote: PropTypes.string.isRequired,
  glBibles: PropTypes.array.isRequired,
  manifest: PropTypes.object.isRequired,
  setToolSettings: PropTypes.func.isRequired,
  targetBible: PropTypes.object.isRequired,
  tc: PropTypes.object.isRequired,
  toolApi: PropTypes.object.isRequired,
  toolName: PropTypes.string.isRequired,
  translate: PropTypes.func.isRequired,
  tsvRelation: PropTypes.array.isRequired,
};

/**
 * Redux `mapStateToProps` for `Container`, deriving gateway-language quote/context/tool data
 * from the host `tc` state and this tool's own selectors.
 * @param {object} state - redux state
 * @param {object} ownProps - own props, including the host `tc` state
 * @returns {object} - props consumed by `Container`
 */
export const mapStateToProps = (state, ownProps) => {
  const gatewayLanguageCode = getGatewayLanguageCode(ownProps);
  const contextId = getContextId(state);
  const targetBible = getTargetBible(ownProps);
  const glBibles = getGatewayLanguageBibles(ownProps);
  const toolName = getCurrentToolName(ownProps);
  const tsvRelation = getThelpsManifestRelation(gatewayLanguageCode, toolName);
  const gatewayLanguageQuote = gatewayLanguageHelpers.getAlignedGLTextHelper(
    contextId,
    glBibles,
    gatewayLanguageCode,
    tsvRelation,
    true
  );
  const tc = getTcState(ownProps);
  const toolApi = getToolApi(ownProps);

  return {
    bibles: getBibles(ownProps),
    contextId,
    currentPaneSettings: getCurrentPaneSettings(ownProps),
    gatewayLanguageCode,
    gatewayLanguageQuote,
    glBibles,
    manifest: getProjectManifest(ownProps),
    setToolSettings: tc.setToolSettings,
    targetBible,
    tc,
    toolApi,
    toolName,
    translate: getTranslateState(ownProps),
    tsvRelation,
  };
};

export default connect(mapStateToProps)(Container);
