/* eslint-env jest */
import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { createTcuiTheme, TcuiThemeProvider } from 'tc-ui-toolkit';
import { connect } from 'react-redux';
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
  getTcState,
  getToolApi,
  getTranslateState,
} from './selectors';
import * as gatewayLanguageHelpers from './helpers/gatewayLanguageHelpers';
import {
  compareUnicodeStrings,
  fetchPreviousSelectionData,
  getBestSelections,
  normalizeForCompare,
  queryLmStudioModels,
  readSettingsForChecking_,
  saveAlignmentData,
  saveSettingsForChecking_,
  updatedPreviousSelectionsData,
  updateLlmMetrics,
} from './utils/autoCheckingUtils';
import delay from './utils/delay';

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
  setToolSettings,
  tc,
  toolApi,
  toolName,
  translate,
  tsvRelation,
}) {
  const [showHelps, setShowHelps] = useState(true);
  const [editVerseInScrPane, setEditVerseInScrPane] = useState(null); // trigger to edit first verse in Expanded Scripture Pane
  const {
    checkId, groupId, reference,
  } = contextId || {};
  const { chapter, verse } = reference || {};

  useEffect(() => {
    settingsHelper.loadCorrectPaneSettings(
      setToolSettings,
      bibles,
      gatewayLanguageCode,
      currentPaneSettings
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    updatedPreviousSelectionsData(oldSelections, savedSelections, alignedGLText, newSelections);
  }

  /**
   * Saves checking settings to the tCore folder.
   * @param {object} data - settings data to save
   */
  function saveSettingsForChecking(data) {
    const projectSaveLocation = tc?.projectSaveLocation;
    saveSettingsForChecking_(projectSaveLocation, data);
  }

  /**
   * Reads checking settings from the tCore folder.
   * @returns {object|null} - saved settings data or null if not found
   */
  function readSettingsForChecking() {
    const projectSaveLocation = tc?.projectSaveLocation;
    const data = readSettingsForChecking_(projectSaveLocation);
    return data || null;
  }

  /**
   * Queries the LM Studio API to retrieve available models.
   * @param {object} options - query options
   * @param {string} options.baseUrl - base URL for the LM Studio API
   * @returns {Promise<{models: Array|null, error: boolean}>} - object containing models array (or null on error) and error flag
   */
  async function getModelsForChecking(options) {
    let error = false;
    let models = null;

    try {
      models = await queryLmStudioModels(options);
      console.log('getModelsForChecking models', models);
    } catch (e) {
      console.log('getModelsForChecking error', e);
      error = e.toString() || e;
    }

    const results = { models, error };
    console.log('getModelsForChecking results', results);
    return results;
  }

  /**
   * Computes auto-select suggestions for the current check, fetching and caching previous
   * selection history for the group the first time it's needed.
   * @param {object} data - suggestion request data
   * @param {object} data.contextId - context of the check being suggested for
   * @param {string} data.currentModel - currently selected LLM model identifier
   * @param {string} data.alignedGLText - aligned gateway-language quote to translate
   * @param {boolean} data.llmSuggestionsEnabled - whether LLM suggestions are enabled
   * @param {string} data.llmQueryUrl - URL for LLM query endpoint
   * @param {object} data.targetLanguageDetails - target language details, including `id`
   * @param {string} data.verseText - target-language verse text
   * @returns {Promise<{error: string|boolean, bestSelections: Array, elapsedStr: string, model: string}>} - object containing error status, suggested selections array, elapsed time string, and model used
   */
  async function getSuggestions(data) {
    const projectSaveLocation = tc?.projectSaveLocation;
    const glOwnerStr = tc.gatewayLanguageOwner;

    const {
      contextId,
      currentModel,
      alignedGLText,
      llmSuggestionsEnabled,
      llmQueryUrl,
      targetLanguageDetails,
      verseText,
    } = data || {};

    const groupId = contextId?.groupId || '';
    const llmQueryUrl_ = (llmSuggestionsEnabled && llmQueryUrl_) || null;

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

    await delay(1);

    saveAlignmentData(projectSaveLocation, selectionsData);

    await delay(1);

    const {
      error,
      bestSelections,
      elapsedStr,
      model,
    } = await getBestSelections(
      verseText,
      llmQueryUrl,
      targetLanguageDetails,
      alignedGLText,
      gatewayLanguageCode,
      selectionsData,
      currentModel,
    );

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

      delay(100).then(() => {
        updateLlmMetrics(projectSaveLocation, llmQueryUrl, model, elapsedStr);
      });
    } else {
      console.log('getSuggestions error', {});
      return { error: true };
    }

    return {
      error,
      bestSelections,
      elapsedStr,
      model,
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
  setToolSettings: PropTypes.func.isRequired,
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
    setToolSettings: tc.setToolSettings,
    tc,
    toolApi,
    toolName,
    translate: getTranslateState(ownProps),
    tsvRelation,
  };
};

export default connect(mapStateToProps)(Container);
