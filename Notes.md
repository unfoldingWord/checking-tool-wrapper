# DELETE THIS FILE AFTER COMPLETION

## TO DOs

- #6656
- Remove reducers, actions & code that is no longer needed in tC codebase.
- Go over TODOs added to tools' codebase.
- Move Container.js to the containers folder and rename it to Main.js or App.js. Also make the respective changes in both tools (tw & tn) repos.

- Remove usage of validateSelections
- "No selection needed" is displaying 2 checks in the grouped menu.
- Invalidations are not being recorded and/or displayed.
- Invalidating a verse isn't removing the selection previously recorded.
- Resolve issues with updateVerseEditStatesAndCheckAlignments

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
