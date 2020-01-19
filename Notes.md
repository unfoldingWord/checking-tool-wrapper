# DELETE THIS FILE AFTER USED

## Findings

- InvalidatedReducer is used in the core codebase. Is it even used in the tools?
- wA tool uses groupsDataReducer & groupsIndexReducer from tc.

## TO DOs

- Fix loadResourceArticle.
- Change toggleReminder to toggleBookmark namespace in tc-ui-toolkit
- DEPRECATE makeSureBiblesLoadedForTool. It should only be called in the core codebase before loading/opening a tool.
- Remove prop selectors for wrappers in container.js
- Go over TODOs added to tools' codebase.
- Move Container.js to the containers folder and rename it to Main.js or App.js. Also make the respective changes in both tools (tw & tn) repos.
- Move locale strings that were previously used on the core and now are used in the tools.

### Actions

- onInvalidCheck /
- goToNext /
- goToPrevious /
- addComment /
- editTargetVerse /
- changeSelections /
- openAlertDialog (showAlert) /
- toggleBookmark (toggleReminder) /
- validateSelections /
- showPopover /
- getLexiconData (Add & Convert to helper function) /
- setToolSettings /
- getAvailableScripturePaneSelections (Add & Convert to helper function) /
- loadResourceArticle /
