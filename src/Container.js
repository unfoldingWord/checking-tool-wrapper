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
  compareUnicodeStrings,
  fetchPreviousSelectionData,
  LlmRequestQueue,
  normalizeForCompare,
  queryLmStudioModels,
  readSettingsForChecking_,
  saveAlignmentData,
  saveSettingsForChecking_,
  updatedPreviousSelectionsData,
  updateLlmMetrics,
} from './utils/autoCheckingUtils';
import delay from './utils/delay';
import { getVerseText } from './helpers/verseHelpers';

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
};

const glBiblesCache = {
  glBibleId: null,
  targetLangId: null,
  resourceId: null,
  bibles: {},
};

const __suggestionsCache = {};

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
    if (generateSuggestionsRunningRef.current) { // if process already running, shut it down first
      console.log(`generateSuggestionsForGroups - alreading running, restarting`);
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
    console.log(`generateSuggestionsForGroups - got groupsData`);
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
      let count = 0;

      if (matchAfterGroupId) {
        findGroupId = matchAfterGroupId;
      } else if (matchBeforeGroupId) {
        findGroupId = matchBeforeGroupId;
      }

      if (generateSuggestionsRestartRef.current
        || !settingsForSuggestionsRef.current.suggestionsEnabled) {
        return;
      }

      const groupIds = Object.keys(groupsData) || [];
      let foundMatch = false;

      for (const groupId of groupIds) {
        if (generateSuggestionsRestartRef.current
          || !settingsForSuggestionsRef.current.suggestionsEnabled) {
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
        console.log(`generateSuggestionsForGroups for group ${groupId}`);

        for (const check of group) {
          if (generateSuggestionsRestartRef.current
            || !settingsForSuggestionsRef.current.suggestionsEnabled) {
            break;
          }

          // if llm suggestions turned off, don't use previous llm suggestion in memory
          const force_ = force || !settingsForSuggestionsRef.current.llmSuggestionsEnabled;

          if (!check?.selections?.length) {
            count++;
            const suggestionsRequestQueue = suggestionsRequestQueueRef?.current;

            console.log(`generateSuggestionsForGroups - no selection for check ${check}`);
            const contextId = check?.contextId;
            const reference = contextId?.reference;
            const {
              bookId, chapter, verse,
            } = reference || {};
            const checkId = contextId?.checkId;
            const key = generateKey(targetLanguageId, groupId, bookId, chapter, verse, checkId);

            if (!suggestionsRequestQueue.alreadyHaveSuggestionsForKey(key)) {
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
                const data = {
                  alignedGLText: gatewayLanguageQuote_,
                  contextId,
                  currentModel: settingsForSuggestionsRef.current.currentModel,
                  force,
                  gatewayLanguageCode,
                  key,
                  llmSuggestionsEnabled: settingsForSuggestionsRef.current.llmSuggestionsEnabled,
                  llmTemperature: settingsForSuggestionsRef.current.llmTemperature,
                  llmQueryUrl: llmQueryUrl_,
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
                console.log(selectionsForWord);

                const request = {
                  ...data,
                  selectionsData,
                };

                // eslint-disable-next-line no-await-in-loop
                await delay(1);

                suggestionsRequestQueue.makeSuggestionRequest(
                  request,
                  data => { // callback function
                    console.log(`generateSuggestionForSubgroup result`, data);
                  },
                  false,
                  force_,
                );
              } else {
                console.log(`generateSuggestionForSubgroup no glQuote`, check);
              }
            }
          }
        }
      }
      console.log(`generateSuggestionForSubgroup added ${count} checks`);
    }

    if (generateSuggestionsRestartRef.current
      || !settingsForSuggestionsRef.current.suggestionsEnabled) {
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
      suggestionsRequestQueue.clearPendingRequests();
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
        if (settingsForSuggestionsRef.current?.suggestionsEnabled) {
          const suggestionsRequestQueue = suggestionsRequestQueueRef?.current;
          suggestionsRequestQueue.clearPendingRequests();
          generateSuggestionsForGroups().then(() => { });
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
   * Updates the cached previous-selection history when a check's selections change.
   * @param {object} data
   * @param {object} data.contextId - context of the changed check
   * @param {string} data.alignedGLText - aligned gateway-language text for the check
   * @param {Array} data.newSelections - selections after the change
   * @param {Array} data.oldSelections - selections before the change
   */
  function updateSelectionsData(data) {
    // const contextId = data?.contextId;
    const alignedGLText = data?.alignedGLText;
    const newSelections = data?.newSelections;
    const oldSelections = data?.oldSelections;
    const savedSelections = selectionsData?.selections;

    updatedPreviousSelectionsData(
      oldSelections,
      savedSelections,
      alignedGLText,
      newSelections
    );

    // force resuggest current group with new alignment data
    generateSuggestionsForGroups(true, true, true).then(() => {
      // continue processing other groups
      generateSuggestionsForGroups(false, false, false, true).then(() => {});
    });
  }

  /**
   * Saves checking settings to the tCore folder.
   * @param {object} data - settings data to save
   */
  function saveSettingsForChecking(data) {
    const projectSaveLocation = tc?.projectSaveLocation;

    saveSettingsForChecking_(projectSaveLocation, data);

    if (!isEqual(data, settingsForSuggestionsRef.current)) {
      // save current settings
      settingsForSuggestionsRef.current = data;

      // force resuggest current group
      generateSuggestionsForGroups(true, true, true).then(() => {
        // continue processing other groups
        generateSuggestionsForGroups(false, true, false, true).then(() => {});
      });
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
   * Queries the LM Studio API to retrieve available models.
   * @param {object} options - query options
   * @param {string} options.baseUrl - base URL for the LM Studio API
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
            models = await queryLmStudioModels(options);
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
        console.log(`makeLlmRequestAndWaitForResponse request`, request);

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
    const key = `${toolName}_${gatewayLanguageCode}_${targetLanguageId}_${groupId}_${bookId}_${chapter}_${verse}_${checkId}`;
    return key;
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
   * @param {string} data.llmQueryUrl - URL for LLM query endpoint
   * @param {object} data.targetLanguageDetails - target language details, including `id`
   * @param {string} data.verseText - target-language verse text
   * @returns {Promise<{error: string|boolean, bestSelections: Array, elapsedStr: string, model: string}>} - object containing error status, suggested selections array, elapsed time string, and model used
   */
  async function getSuggestions(data) {
    const projectSaveLocation = tc?.projectSaveLocation;
    const glOwnerStr = tc.gatewayLanguageOwner;

    const {
      alignedGLText,
      contextId,
      currentModel,
      force,
      llmSuggestionsEnabled,
      llmTemperature,
      llmQueryUrl,
      targetLanguageDetails,
      verseText,
    } = data || {};

    const groupId = contextId?.groupId || '';
    const llmQueryUrl_ = llmSuggestionsEnabled ? llmQueryUrl : null;

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

      selectionsData.groupId = groupId;
      selectionsData.selections = selectionsForWord;
    }

    const reference = contextId?.reference;
    const {
      bookId, chapter, verse,
    } = reference || {};

    const targetLanguageId = targetLanguageDetails?.id;
    const checkId = contextId?.checkId;
    const key = generateKey(targetLanguageId, groupId, bookId, chapter, verse, checkId);
    console.log(key);

    await delay(1);

    saveAlignmentData(projectSaveLocation, selectionsData);

    await delay(1);

    const results = await makeLlmRequestAndWaitForResponse({
      alignedGLText,
      currentModel,
      force,
      gatewayLanguageCode,
      key,
      llmQueryUrl: llmQueryUrl_,
      llmTemperature,
      selectionsData,
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
          updateLlmMetrics(projectSaveLocation, llmQueryUrl, model, elapsedStr);
        });
      }
    } else {
      console.log('getSuggestions error', {});
      return { error: true };
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
            saveSattingsForChecking={data => saveSettingsForChecking(data)}
            readSettingsForChecking={() => readSettingsForChecking()}
            getModelsForChecking={options => getModelsForChecking(options)}
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
