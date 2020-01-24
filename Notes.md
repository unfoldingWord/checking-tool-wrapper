# DELETE THIS FILE AFTER COMPLETION

## TO DOs

- Expanded scripture pane verse editor isnt working properly.
- Change toggleReminder to toggleBookmark function name in tc-ui-toolkit
- Move Container.js to the containers folder and rename it to Main.js or App.js. Also make the respective changes in both tools (tw & tn) repos.
- Go over TODOs added to tools' codebase.
- Remove reducers, actions & code that is no longer needed in tC codebase.
- Remove verseCheck prop selector from container.js
  - Remove usage of validateSelections
- "No selection needed" is displaying 2 checks in the grouped menu.
- Invalidations are not being recorded and/or displayed.
- Invalidating a verse isn't removing the selection previously recorded.
- Move locale strings that were previously used in tcore and now are used in the tools.

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
