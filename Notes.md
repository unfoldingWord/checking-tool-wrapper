# DELETE THIS FILE AFTER USED

## Findings

- InvalidatedReducer is used in the core codebase. Is it even used in the tools?
- wA tool uses groupsDataReducer & groupsIndexReducer from tc.

## TO DOs

- TO DOs.
- Move Container.js to the containers folder and rename it to Main.js or App.js. Also make the respective changes in both tools (tw & tn) repos.
- makeSureBiblesLoadedForTool should be called in the core codebase before loading/opening tool. (Maybe remove its usage in the tool?)
- Add/Convert getLexiconData & getAvailableScripturePaneSelections to helper functions

- Move locle strings that were previously used on the core and now are used in the tools.

### VerseCheckWrapper (actions)

- onInvalidCheck /
- goToNext /
- goToPrevious /
- addComment /
- editTargetVerse /
- changeSelections /
- openAlertDialog (showAlert) /
- toggleBookmark (toggleReminder) /
- validateSelections /

### scripturePane (actions)

- showPopover /
- editTargetVerse -
- getLexiconData // Add & Convert to helper function
- setToolSettings /
- getAvailableScripturePaneSelections (Add & Convert to helper function) /
- makeSureBiblesLoadedForTool

### TranslationHelpsWrapper (actions)

- loadResourceArticle /
