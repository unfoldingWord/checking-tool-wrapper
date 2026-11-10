# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`checking-tool-wrapper` is a shared npm package used by translationCore's checking tools (`translationWords`, `translationNotes`). It is not a standalone app — it's consumed by a tCore tool's own `index.js`, which wires up `Api`, `Container`, and `reducers` from this package via `tc-tool`'s `connectTool`. See `README.md` for the exact integration snippet.

`src/index.js` is the public entry point and only exports: `Api`, `Container`, `reducers`, `getQuoteAsString`, `getAlignedTextFromBible`.

## Commands

- `npm test` — runs `eslint ./src` then `jest`. This is what CI and `prepublishOnly` run; both lint and tests must pass.
- `npm run lint` / `npm run lint:fix` — eslint only, `--fix` variant available as `npm run fix`.
- `npx jest __tests__/verseHelpers.test.js` — run a single test file.
- `npx jest -t "name of test"` — run tests matching a name.
- `npm run build` — babel-compiles `src` to `lib` (production `NODE_ENV`); `lib` is what gets published (see `files` in `package.json`). Don't hand-edit `lib`.
- `npm run test:llm` — runs `__tests__/llmModelSuitability.test.js`, which checks whether a model on a live OpenAI-compatible server (e.g. LM Studio) gives good AI suggestions for the cases in `__tests__/__fixtures__/llmEval/cases.json` (hand-written) and `realCases.json` (from translators' aligned projects). Requests go through `getBestSelections`, as the app sends them. Its live tests are skipped unless `LLM_EVAL_MODEL` is set, so `npm test` makes no network call; its always-running tests check the case files and that the algorithm path still gets the recorded number of cases right (`ALGORITHM_TOP1`). Settings and pass/fail thresholds are `LLM_EVAL_*` environment variables, listed in the test file's header.
- `npm run build:llm-eval-cases` — rebuilds `__tests__/__fixtures__/llmEval/realCases.json` from the aligned projects in `~/translationCore/projects` (see the header of `__tests__/buildLlmEvalRealCases.test.js`; skipped in `npm test`). After rebuilding, update `ALGORITHM_TOP1`.

Scripts in `scripts/` wrap that suite. Each prints its usage with `-h`. They write logs and JSON results to `llm-eval-results/`, which is git-ignored.
- `scripts/test-llm.sh [-u URL] [-r RUNS] [-g GROUPING] [-t TEMP] [-k TOKEN] [-o DIR] model ...` — runs the suite once per model and prints each report plus a pass/fail summary. `-l` lists the server's models. Defaults: `http://localhost:1234`, falling back to `$LLM_EVAL_FALLBACK_URL` or `http://192.168.142.56:1234` when it does not answer and no `-u` was given; 2 runs; 4 requests per batched query; temperature 0.1 (the app's default). The reference models are `qwen/qwen3-1.7b` and `qwen/qwen3-4b-2507`; compare changes with `-r 3`. Exits 1 when any model fails a bar and 2 for a usage or server error.
- `scripts/compare-llm-runs.js [-c] [DIR [STAMP]]` — shows the models from one `test-llm.sh` run side by side (the latest run in `llm-eval-results/` by default). `-c` adds top-1 per case. Its "failed bars" row leaves out the request-error, thinking-off and batch-marker tests, so check the `.log` for those.
- `scripts/test-llm-temperatures.sh [test-llm.sh options] model ...` — runs `test-llm.sh` at each temperature in `LLM_EVAL_TEMPERATURES` (default 0.1 to 0.8) and prints a comparison table.

Tests live in `__tests__/` (not colocated with `src/`), with fixtures in `__tests__/__fixtures__/` and snapshots in `__tests__/__snapshots__/`. Enzyme (React 16 adapter) is configured in `jest.setup.js`. `fs-extra` is mocked globally via `__mocks__/fs-extra.js`.

## Architecture

### Data flow: tCore → this package

The host app (translationCore) passes down a large `tc` prop (see `getTcState`/`getContextId`/`getBibles` etc. in `src/selectors/index.js`) containing the current project's target book, resources (bibles, translationHelps, lexicons), project manifest, and settings. Nearly everything this package does is either:
1. reading from that `tc` state plus its own Redux slice (`state.tool.*`, combined in `src/state/reducers/index.js`: contextId, groupsIndex, groupsData, groupMenu, comments, selections, bookmarks, verseEdit, invalidated), or
2. reading/writing project files on disk directly via `fs-extra`/`path-extra` (check data, selections, group data JSON under `.apps/translationCore/...` in the project folder — see `src/common/constants.js` for the path constants).

`src/Container.js` is the top-level React component (function component using hooks) that lays out the checking UI: `ScripturePaneWrapper`, `VerseCheckWrapper`, `TranslationHelpsWrapper`, `CheckInfoCardWrapper`, `GroupMenuContainer`, wrapped in `TcuiThemeProvider`.

`Api.js` (`class Api extends ToolApi` from `tc-tool`) is the tool's lifecycle/API surface — validating verse alignments/selections when the book changes, loading verse/book selections and check data, and reacting to changes in other tools (e.g. word alignment invalidating selections).

### Helpers (`src/helpers/`)

Most business logic lives here as plain functions, organized by concern rather than by component — e.g. `groupDataHelpers`, `selectionHelpers`, `checkDataHelpers`, `verseEditHelpers`, `validationHelpers`, `gatewayLanguageHelpers`, `resourcesHelpers`, `contextIdHelpers`. When changing behavior, look for the relevant helper module before touching components/containers.

`fileHelpers.js` has low-level JSON/text/folder-tree read helpers plus version-folder resolution (`v9` vs `v10`-style comparisons) used when picking the most recent gateway-language bible resource.

### Auto-select suggestions (`src/utils/autoCheckingUtils.js`)

Note this lives in `src/utils/`, not `src/helpers/`. It implements "auto-select" translationWords suggestions — matching a gateway-language (GL) phrase (`alignedGLText`) to word(s) in the target-language verse. Its tests are in `__tests__/autoCheckingUtils.test.js` (algorithm path), `__tests__/autoCheckingUtilsLlm.test.js` (AI parsing and batching, network mocked) and `__tests__/LlmRequestQueue.test.js`. To measure AI suggestion quality against a live model, use `__tests__/llmModelSuitability.test.js` and the `scripts/` described under Commands. `plans/improve-llm-suggestions.md` holds the measured results and the improvement plan.

Flow: `Container.js` → `LlmRequestQueue` (in its own module, `src/utils/LlmRequestQueue.js`, alongside the `RequestQueue` it wraps; caches results by key, see `alreadyHaveSuggestionsForKey`; supports pause/resume via `requestPause`) → `getBestSelections(jobs)` in `autoCheckingUtils.js`, which picks one of two paths:
- No `llmQueryUrl` → `getBestTWordSelectionWithConfidenceAlgorithm(wordList, targetLangCode, glPhrase, glLangCode, previousTranslationData)` for each job. This path is deterministic and makes no network call. The history holds one translationWords group, so `rankGlKeys` scores every history key against the GL phrase (exact key, else weighted word overlap with short GL words down-weighted and inflections matched by `wordSimilarity`) and `poolRenderings` merges the renderings of all keys. Confidence is capped per rendering by `capForRendering`: 100 only for the exact GL key plus a verbatim contiguous match in the verse; renderings reached through a related key are capped at 82-95 by relatedness, kept above the 80 cutoff so a verbatim target match still beats target-side fuzzy matching. Each pooled rendering is searched in the verse: contiguous, then in order with gaps (polynomial tightest placement), then a tight out-of-order window (10-point penalty, max 89), then the rendering words the verse contains. If no candidate scores above 80, an order-aware fuzzy pass matches inflected or compound forms with `wordSimilarity` (capped at 90). `scoreAlgorithmicMatch` documents the scoring; `plans/algorithm-partial-match.md` holds the rationale.
- With `llmQueryUrl` → the algorithm runs first, and a job whose top option has confidence 100 (exact GL key, rendering found word for word) gets that answer marked `algorithmFirst` without asking the AI. The rest go to `getBestTWordSelectionWithConfidenceFromLlm(requests)`, which sends them in one batched query (how many per query comes from the `llmGrouping` setting, default `DEFAULT_SUGGESTION_REQUESTS_PER_CALL` in `Container.js`) to an OpenAI-compatible chat-completions server (default `AI_API_URL`). `queryAiAPI` goes through the Electron main process when translationCore provides `window.AiAPIs` (see `getAiAPIs`), and otherwise calls the server directly over HTTP. The prompt (`buildTranslationOptionsPrompt`) has a fixed system prompt per path, so the server's prompt cache keeps working: `LLM_SINGLE_SYSTEM_PROMPT` for one request per query and `LLM_BATCH_BASE_SYSTEM_PROMPT` plus `LLM_BATCH_SYSTEM_PROMPT` for batches. They differ on purpose (rule 3 and the inflected-form example), because each wording was measured on both paths; change them only with measurements (see the plan). `queryAiAPI` puts `/no_think` at the start of the system prompt when thinking is off; at the end it made small models drop the batch markers. The history lines (`formatPreviousTranslations`) are every rendering of the group, ranked with `rankGlKeys`, ordered by whether the rendering is in the verse (exactly, or as another form by `wordSimilarity`), then exact key, relatedness and count; at most 10, or 5 when none fits the verse. Response parsing (`parseLlmSelectionOptions`, `extractLlmRows`) is defensive: it handles thinking/reasoning tags, JSON or CSV rows, and missing formatting; a batched answer without `### REQUEST n` markers is split by line only when it has exactly one row per request. Answer words are matched to verse words exactly, then ignoring accents, then by `wordSimilarity`; more than half the words must be found, a match by similarity caps the confidence at `FUZZY_TARGET_MAX_CONFIDENCE` (90), and rows with confidence 0 are dropped. The default temperature is 0.1 (`LLM_DEFAULT_TEMPERATURE`), and a setting of 0 is used as given. If the AI gives no suggestion, `LlmRequestQueue` falls back to the algorithm path and marks the result `algorithmFallback`. `translatePhraseWithConfidence` is an older single-phrase AI path.

Both paths return up to 3 `{ selections: [{text, occurrence}], confidence }`, best first, so they are interchangeable. Keep that contract when changing either one. Both place a rendering at its first match in the verse; `getBestSelections` then moves each option to the check's `contextId.occurrence` with `moveSelectionsToOccurrence` when the words occur that many times as separate runs (a heuristic: the nth original word is taken to be rendered by the nth run).

Previous-selection history comes from `fetchPreviousSelectionData(...)`. It scans the other projects in the tCore projects folder and returns `{ normalizedGlQuote: { selectedTargetText: count } }`, e.g. `{ 'faith': { 'fe': 12, 'la fe': 3 } }`.

Suggestion cache: results are cached in `LlmRequestQueue` by the keys from `generateKey` in `Container.js` (`{toolName}_{glCode}_{targetLangId}_{groupId}_{bookId}_{chapter}_{verse}_{checkId}`; `generateGroupKeyPrefix` builds the part shared by a group). When the user saves a selection, `updateSelectionsData` updates the history in place with `updatedPreviousSelectionsData` and, if suggestions are enabled, clears that group's cached suggestions with `clearSuggestionsMemoryForKeyPrefix`; with AI suggestions on it also regenerates the group right away.

Target languages can be any language, including ones with no linguistic resources: compound or inflected words, any script, any word order. Don't add matching logic that assumes English-like or Latin-script target text, or that needs target-language word lists.

Lowercase language text with `toLowerCaseForLang(text, langId)` (or `normalizeForCompare(word, langId)`), not `toLocaleLowerCase`. Only Turkish, Azerbaijani and Lithuanian lowercase differently from `toLowerCase`, so the helper uses the locale only for those. `toLocaleLowerCase` throws for `''`, follows the computer's language when the code is missing, and is 80-450x slower for codes like `es-419`, `el-x-koine` or `hbo`.

`GitApi.js`, `GogsApiHelpers.js`, `Repo.js`, `ProjectAPI.js`, `ResourceAPI.js` deal with git/DCS (Door43 Content Service) interactions for project/resource management, largely wrapping `simple-git` and `gogs-client`.

### Redux

Actions/reducers follow standard redux-thunk conventions under `src/state/actions/` and `src/state/reducers/`. Selectors (`src/selectors/index.js`) are the intended read path — they wrap both this package's own `state.tool.*` slices and the host `tc` prop, so prefer adding a selector over reaching into state shape directly in components.

### Localization

Component/container strings are translated via `react-localize-redux` (`translate` prop, `getTranslateState` selector); locale files are supplied by the consuming tool (see `localeDir` in the README's usage snippet), not stored in this repo.

## Code style notes (from `.eslintrc`)

- Single quotes, 2-space indent, semicolons required, trailing commas on multiline.
- `no-unused-vars`, `no-undef`, `require-await`, `no-return-await`, and `array-callback-return` are errors, not just style — CI lint will fail on these.
- `react/prop-types` is enforced for components.

## Dependency Modules from unfoldingWord

These are `peerDependencies`: translationCore supplies them at runtime. `devDependencies` pins the versions used for local tests. When behavior depends on one of them (e.g. how `normalizer` handles punctuation or accents), read the installed code in `node_modules/<pkg>`, which matches the pinned version. Don't assume the GitHub default branch matches.

These modules are under our control and may need to be modified as well to implement features or fix bugs.

| Package | Dev version | Used for | Imported in |
|---|---|---|---|
| [string-punctuation-tokenizer](https://github.com/unfoldingWord/string-punctuation-tokenizer) | 2.2.0 | `normalizer` for word comparison in auto-select | `utils/autoCheckingUtils.js` |
| [wordmap-lexer](https://github.com/unfoldingWord/wordmap-lexer) | 0.3.6 | Tokenizing verse text into words | `utils/autoCheckingUtils.js` |
| [tc-ui-toolkit](https://github.com/unfoldingWord/tc-ui-toolkit) | 6.2.8 | UI components (`ScripturePane`, `VerseCheck`, `TranslationHelps`, `CheckInfoCard`) and `verseHelpers`. The suggestions UI (`getSuggestions`, auto-apply, the Refresh Suggestions button, in `src/VerseCheck/CheckArea/index.js`) is not in 6.2.8; it is in the 6.2.11 betas, developed on the `feature-mcleanb-add-suggestions-support` branch of the sibling checkout `../tc-ui-toolkit` | `components/*Wrapper.js`, others |
| [tc-source-content-updater](https://github.com/unfoldingWord/tc-source-content-updater) | 1.4.34 | Resource download/lookup helpers (`apiHelpers`, `resourcesHelpers`) | `helpers/fileHelpers.js`, `helpers/resourcesHelpers.js`, `helpers/ResourceAPI.js` |
| [usfm-js](https://github.com/unfoldingWord/usfm-js) | 2.1.0 | Parsing/converting USFM verse text | `Api.js`, `helpers/verseHelpers.js`, `state/actions/selectionsActions.js` |
| [word-aligner](https://github.com/unfoldingWord/word-aligner) | 0.4.0 | `VerseObjectUtils` for aligned verse objects | `components/CheckInfoCardWrapper.js` |
| [bible-reference-range](https://github.com/unfoldingWord/bible-reference-range) | 1.0.1 | `getVerses` for verse ranges in references | `helpers/verseHelpers.js`, `helpers/gatewayLanguageHelpers.js` |
| [tc-electron-env](https://github.com/unfoldingWord/tc-electron-env) | 0.10.0 | Electron environment paths (e.g. user home for resources) | `common/constants.js`, `helpers/ResourceAPI.js` |
| [tsv-groupdata-parser](https://github.com/unfoldingWord/tsv-groupdata-parser) | 0.10.3 | Declared as a peer dependency, but not imported anywhere in `src/` | — |

Also `tc-tool` (4.0.1, [translationCoreApps/tc-tool](https://github.com/translationCoreApps/tc-tool)): it provides `ToolApi` and `connectTool`, and `src/Api.js` imports it.

This package is consumed by [translationCore](https://github.com/unfoldingWord/translationCore); changes to the `Api`/`Container` contract or to on-disk file formats must stay compatible with it. In the translationCore repo (not this one), `electronite/queryAiApisFromMainProcess.js` queries the models from the Electron main process, and `electronite/preloadAiApi.js` exposes that to this package as `window.AiAPIs`.

