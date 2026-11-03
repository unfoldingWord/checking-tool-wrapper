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

Note this lives in `src/utils/`, not `src/helpers/`. It implements "auto-select" translationWords suggestions — matching a gateway-language (GL) phrase (`alignedGLText`) to word(s) in the target-language verse. Its tests are in `__tests__/autoCheckingUtils.test.js`.

Flow: `Container.js` → `LlmRequestQueue` (wraps `RequestQueue`; caches results by key, see `alreadyHaveSuggestionsForKey`) → `getBestSelections(jobs)`, which picks one of two paths:
- No `llmQueryUrl` → `getBestTWordSelectionWithConfidenceAlgorithm(wordList, targetLangCode, glPhrase, glLangCode, previousTranslationData)` for each job. This path is deterministic and makes no network call. It looks up the GL phrase in the history (exact key first, then `getPreviousTranslationPartialMatchCounts`). Then it searches the verse for each previous rendering: contiguous match (confidence 100, the only way to reach 100), then ordered with gaps, then best sub-phrase. If no candidate scores above 80, it falls back to Levenshtein fuzzy matching (`scoreAlgorithmicMatch` documents the scoring).
- With `llmQueryUrl` → `getBestTWordSelectionWithConfidenceFromLlm(requests)`, which sends all jobs in a single batched request to an OpenAI-compatible chat-completions server (default `AI_API_URL`). Response parsing (`parseLlmSelectionOptions`, `extractLlmRows`) is defensive: it handles thinking/reasoning tags, JSON or CSV rows, and missing formatting. `translatePhraseWithConfidence` is an older single-phrase AI path.

Both paths return up to 3 `{ selections: [{text, occurrence}], confidence }`, best first, so they are interchangeable. Keep that contract when changing either one.

Previous-selection history comes from `fetchPreviousSelectionData(...)`. It scans the other projects in the tCore projects folder and returns `{ normalizedGlQuote: { selectedTargetText: count } }`, e.g. `{ 'faith': { 'fe': 12, 'la fe': 3 } }`.

Target languages can be any language, including ones with no linguistic resources: compound or inflected words, any script, any word order. Don't add matching logic that assumes English-like or Latin-script target text, or that needs target-language word lists.

`GitApi.js`, `GogsApiHelpers.js`, `Repo.js`, `ProjectAPI.js`, `ResourceAPI.js` deal with git/DCS (Door43 Content Service) interactions for project/resource management, largely wrapping `simple-git` and `gogs-client`.

### Redux

Actions/reducers follow standard redux-thunk conventions under `src/state/actions/` and `src/state/reducers/`. Selectors (`src/selectors/index.js`) are the intended read path — they wrap both this package's own `state.tool.*` slices and the host `tc` prop, so prefer adding a selector over reaching into state shape directly in components.

### Localization

Component/container strings are translated via `react-localize-redux` (`translate` prop, `getTranslateState` selector); locale files are supplied by the consuming tool (see `localeDir` in the README's usage snippet), not stored in this repo.

## Code style notes (from `.eslintrc`)

- Single quotes, 2-space indent, semicolons required, trailing commas on multiline.
- `no-unused-vars`, `no-undef`, `require-await`, `no-return-await`, and `array-callback-return` are errors, not just style — CI lint will fail on these.
- `react/prop-types` is enforced for components.

## Dependent unfoldingWord modules

These are `peerDependencies`: translationCore supplies them at runtime. `devDependencies` pins the versions used for local tests. When behavior depends on one of them (e.g. how `normalizer` handles punctuation or accents), read the installed code in `node_modules/<pkg>`, which matches the pinned version. Don't assume the GitHub default branch matches.

| Package | Dev version | Used for | Imported in |
|---|---|---|---|
| [string-punctuation-tokenizer](https://github.com/unfoldingWord/string-punctuation-tokenizer) | 2.2.0 | `normalizer` for word comparison in auto-select | `utils/autoCheckingUtils.js` |
| [wordmap-lexer](https://github.com/unfoldingWord/wordmap-lexer) | 0.3.6 | Tokenizing verse text into words | `utils/autoCheckingUtils.js` |
| [tc-ui-toolkit](https://github.com/unfoldingWord/tc-ui-toolkit) | 6.2.8 | UI components (`ScripturePane`, `VerseCheck`, `TranslationHelps`, `CheckInfoCard`) and `verseHelpers` | `components/*Wrapper.js`, others |
| [tc-source-content-updater](https://github.com/unfoldingWord/tc-source-content-updater) | 1.4.34 | Resource download/lookup helpers (`apiHelpers`, `resourcesHelpers`) | `helpers/fileHelpers.js`, `helpers/resourcesHelpers.js`, `helpers/ResourceAPI.js` |
| [usfm-js](https://github.com/unfoldingWord/usfm-js) | 2.1.0 | Parsing/converting USFM verse text | `Api.js`, `helpers/verseHelpers.js`, `state/actions/selectionsActions.js` |
| [word-aligner](https://github.com/unfoldingWord/word-aligner) | 0.4.0 | `VerseObjectUtils` for aligned verse objects | `components/CheckInfoCardWrapper.js` |
| [bible-reference-range](https://github.com/unfoldingWord/bible-reference-range) | 1.0.1 | `getVerses` for verse ranges in references | `helpers/verseHelpers.js`, `helpers/gatewayLanguageHelpers.js` |
| [tc-electron-env](https://github.com/unfoldingWord/tc-electron-env) | 0.10.0 | Electron environment paths (e.g. user home for resources) | `common/constants.js`, `helpers/ResourceAPI.js` |
| [tsv-groupdata-parser](https://github.com/unfoldingWord/tsv-groupdata-parser) | 0.10.3 | Declared as a peer dependency, but not imported anywhere in `src/` | — |

Also `tc-tool` (4.0.1, [translationCoreApps/tc-tool](https://github.com/translationCoreApps/tc-tool)): it provides `ToolApi` and `connectTool`, and `src/Api.js` imports it.

