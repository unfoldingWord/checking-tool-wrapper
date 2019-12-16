# DELETE THIS FILE AFTER USED

## Findings

- InvalidatedReducer is used in the core codebase. Is it even used in the tools?
- wa tool uses groupsDataReducer & groupsIndexReducer from tc.

### VerseCheckWrapper (actions)

- onInvalidCheck
- goToNext /
- goToPrevious /
- addComment /
- editTargetVerse
- changeSelections
- openAlertDialog
- toggleReminder/toggleBookmark
- validateSelections

### scripturePane (actions)

- showPopover
- editTargetVerse
- getLexiconData
- setToolSettings
- getAvailableScripturePaneSelections
- makeSureBiblesLoadedForTool

### TranslationHelpsWrapper (actions)

- loadResourceArticle
