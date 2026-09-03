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

`Container.js` is the top-level React component (function component using hooks) that lays out the checking UI: `ScripturePaneWrapper`, `VerseCheckWrapper`, `TranslationHelpsWrapper`, `CheckInfoCardWrapper`, `GroupMenuContainer`, wrapped in `TcuiThemeProvider`.

`Api.js` (`class Api extends ToolApi` from `tc-tool`) is the tool's lifecycle/API surface — validating verse alignments/selections when the book changes, loading verse/book selections and check data, and reacting to changes in other tools (e.g. word alignment invalidating selections).

### Helpers (`src/helpers/`)

Most business logic lives here as plain functions, organized by concern rather than by component — e.g. `groupDataHelpers`, `selectionHelpers`, `checkDataHelpers`, `verseEditHelpers`, `validationHelpers`, `gatewayLanguageHelpers`, `resourcesHelpers`, `contextIdHelpers`. When changing behavior, look for the relevant helper module before touching components/containers.

`fileHelpers.js` has low-level JSON/text/folder-tree read helpers plus version-folder resolution (`v9` vs `v10`-style comparisons) used when picking the most recent gateway-language bible resource.

`autoCheckingUtils.js` implements "auto-select" translationWords suggestions — matching a gateway-language phrase to word(s) in the target verse. It has two interchangeable paths with matching signatures:
- `getBestTWordSelectionWithConfidenceAlgorithm(...)` — deterministic, no network call; matches against previous-translation history (exact/ordered/fuzzy matching + Levenshtein), used as the default/offline path.
- `getBestTWordSelectionWithConfidence(...)` / `translatePhraseWithConfidence(...)` — query a local LM Studio server (OpenAI-compatible chat-completions endpoint, `LM_STUDIO_URL` constant) for AI-assisted matching; response parsing is defensive (handles verbose/thinking-mode output, missing CSV formatting, etc.).
Both return `{ selections: [{text, occurrence}], confidence }[]`, so callers (`Container.js`) can swap between them.

`GitApi.js`, `GogsApiHelpers.js`, `Repo.js`, `ProjectAPI.js`, `ResourceAPI.js` deal with git/DCS (Door43 Content Service) interactions for project/resource management, largely wrapping `simple-git` and `gogs-client`.

### Redux

Actions/reducers follow standard redux-thunk conventions under `src/state/actions/` and `src/state/reducers/`. Selectors (`src/selectors/index.js`) are the intended read path — they wrap both this package's own `state.tool.*` slices and the host `tc` prop, so prefer adding a selector over reaching into state shape directly in components.

### Localization

Component/container strings are translated via `react-localize-redux` (`translate` prop, `getTranslateState` selector); locale files are supplied by the consuming tool (see `localeDir` in the README's usage snippet), not stored in this repo.

## Code style notes (from `.eslintrc`)

- Single quotes, 2-space indent, semicolons required, trailing commas on multiline.
- `no-unused-vars`, `no-undef`, `require-await`, `no-return-await`, and `array-callback-return` are errors, not just style — CI lint will fail on these.
- `react/prop-types` is enforced for components.