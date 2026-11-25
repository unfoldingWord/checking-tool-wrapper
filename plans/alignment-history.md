# Plan: word alignments as suggestion history

Started 2026-11-25. Status: plan only, nothing built.

## Goal

When a project has word alignment data, use it as extra history for translationWords
suggestions, alongside the translator's saved selections. The history comes from the current
project and from every other project with the same target language and bible id. A setting
turns it on and off. The setting is saved with the AI settings and shown as a checkbox in
tc-ui-toolkit's Configure AI dialog.

Also, when the verse being checked is already aligned, offer its alignment for the check's quote
directly as a suggestion (Step 5).

## What exists now (checked in the code)

- **History today is selections only.** `fetchPreviousSelectionData`
  (`src/utils/checkingSuggestionsUtils.js`, ~line 4463) scans the projects folder. It keeps
  projects whose folder name has the current `languageId` and `resourceId` (from
  `getDetailsFromProjectNameMini`) and that are Bible books in the same testament. For each one
  it reads `.apps/translationCore/index/<toolName>/<book>/<groupId>.json` and tallies the saved
  `selections` with `getSelectionsForBook` into `{ glPhrase: { targetText: count } }`. The GL
  phrase is the GL bible text aligned to the check's quote (`getAlignedTextFromBible`,
  `cleanGlQuote`).
- **The index file lists every check of the group, not only the done ones.** In
  `ar_avd_heb_book`, `aaron.json` has 3 checks and none has selections. So the same file gives
  the check list for alignment history.
- **Alignment data** is in `.apps/translationCore/alignmentData/<book>/<chapter>.json`:
  `{ <verse>: { alignments: [{ topWords: [original words], bottomWords: [target words] }], wordBank } }`.
- **The code to read it already exists, but only in the tests.**
  `__tests__/buildLlmTrainingData.test.js` uses `getVerseAlignments` and `getAlignedTargetWords`
  (`__tests__/helpers/suggestionsHelpers.js`). These find the target words aligned to a check's
  original-language quote. They skip a quote that is not aligned, or that is aligned together
  with other original words.
- **The fine-tuned models were trained on history built from alignments**, not from saved
  selections (header of `buildLlmTrainingData.test.js`). So alignment history is close to what
  the released models learned from. Their history came only from earlier checks of the same
  group in the same project.
- **Settings flow.**
  - The settings are saved in `checking_settings.json` (e.g. `llmEnableThinking`, `llmGrouping`).
  - tc-ui-toolkit (`src/VerseCheck/CheckArea/index.js`, branch
    `feature-mcleanb-add-suggestions-support`) loads them. The Configure AI dialog edits them as
    draft state (`draftLlmEnableThinking` …), and `saveAiDialog` saves them.
  - `Container.js` reads them from `settingsForSuggestionsRef`. Where an older tc-ui-toolkit
    doesn't pass a field, it falls back to the saved settings (the `llmUseLocalServer` pattern,
    ~line 764).
  - The labels live in the tool's locale files, e.g.
    `translationCore/src/tC_apps/translationWords/src/locale/English-en_US.json`
    (`suggestions.enable_thinking`).

## Decisions to confirm

1. **"Same language name and bible id."** Recommend matching the same way selections match
   now: the `languageId` and `resourceId` in the project folder name
   (`es-419_glt_gal_book` → `es-419`, `glt`). Language *names* (in `manifest.json`) are not
   unique and are spelled in different ways.
2. **Testament.** Selection history keeps only projects in the same testament. Alignment history
   is keyed by GL phrase, so OT and NT projects could both contribute. Recommend following the
   request (all books) and measuring it against same-testament only in Step 4.
3. **Which paths it feeds.** History feeds both the algorithm and the AI. The checkbox is asked
   for in the AI settings, but with AI off the algorithm still uses history. Recommend that the
   setting changes the history for both paths. Then the algorithm results change too, including
   which checks reach `ALGORITHM_CERTAIN_CONFIDENCE` and skip the AI.
4. **Default.** Recommend off until Step 4 shows it helps. Then decide whether to turn it on by
   default.
5. **A check with both a selection and an alignment** counts once, and the selection wins. The
   checker chose it, and alignments include small words a checker often leaves out
   (`plans/fine-tune-qwen3.md`, Step 4B).
6. **Separate checkboxes (decided 2026-11-25).** Using the current verse's alignment as a
   suggestion (Step 5) has its own setting, `llmUseVerseAlignment`, and its own checkbox in the
   same dialog, apart from `llmUseAlignmentHistory`. Then each can be turned on and measured on
   its own.

## Steps

### Step 1: move the alignment readers into `src`

- Move `getQuoteWords`, `getAlignedTargetWords` and `getVerseAlignments` from
  `__tests__/helpers/suggestionsHelpers.js` into a new `src/utils/alignmentHistoryUtils.js`.
  Read files with `fs-extra`, as the rest of `src` does.
- The test helpers re-export them, so the training-data builder keeps the same behavior. The
  training data's parity tests check this.

**Done 2026-11-25.**
- **The new module:** `src/utils/alignmentHistoryUtils.js` has `getQuoteWords`,
  `getAlignedTargetWords` (both moved unchanged), `getVerseAlignments` and
  `getAlignmentChapterPath`.
  - `getVerseAlignments` reads with `readJsonFile` (`fs-extra`) by default, or with a reader
    passed in.
  - The training data builder passes its Node `fs` reader, since `fs-extra` is mocked under jest.
- **Who uses it:**
  - `__tests__/helpers/suggestionsHelpers.js` re-exports the two moved functions, so
    `buildLlmEvalRealCases.test.js` is unchanged.
  - `buildLlmTrainingData.test.js` imports from the new module and no longer has its own copy of
    `getVerseAlignments`.
- **Unit tests:** `__tests__/alignmentHistoryUtils.test.js` (14 tests).
- **Checks:**
  - **Parity:** the training data built for `ar_avd_heb_book`, `vi_glt_1co_book` and
    `vi_glt_heb_book` is byte for byte the same before and after the move (461, 1,068 and 727
    checks).
  - **`npm test`:** passes (424 passed, 25 skipped).

### Step 2: build the alignment history

`fetchAlignmentHistoryData(projectSaveLocation, contextId, glBibles, tsvRelation, toolName,
groupId, gatewayLanguageCode, glOwnerStr, cache)` returns the same shape as selections,
`{ glPhrase: { targetText: count } }`:

- **Projects:** the same project matching as `fetchPreviousSelectionData`, with the testament
  rule from Decision 2. The current project is included.
- **Checks:** for each project, every check in its `<groupId>.json` index:
  - take the aligned target words for the check's quote and occurrence;
  - take the GL phrase from the GL bible, as `getSelectionsForBook` does;
  - tally `glPhrase → targetText`.
- **Skipped checks:**
  - checks with saved selections (Decision 5);
  - checks whose quote is not aligned, or is aligned with other original words (as the
    builder does);
  - **the verse of the check being suggested.** Its alignment is the answer itself. Keeping it
    would make the evaluation meaningless.
- **Cache:** keep each project's alignment chapters and per-group tallies for the session, keyed
  by project and book. History is fetched for every check, and a large book has hundreds of
  chapter files. Clear the cache when the language, bible id or GL bible changes, as
  `glBiblesCache` is cleared.
- **Merge** with the selection tally in a new `getSuggestionHistory(...)`, which `Container.js`
  calls instead of `fetchPreviousSelectionData` in both places (~lines 355 and 769).
- **Saving a selection.** When the user saves one, `updateSelectionsData` updates the selection
  tally in place (`updatedPreviousSelectionsData`). It also needs to remove that check's
  alignment count, if it had one, so the check isn't counted twice. Keep the alignment tally per
  check (`checkKey → { glPhrase, targetText }`) so its count can be removed.

**Done 2026-11-25.** All of it is in `src/utils/alignmentHistoryUtils.js` unless noted.

- **`fetchAlignmentHistoryEntries`** returns one entry per check of the group:
  `{ key, projectName, bookId, chapter, verse, glPhrase, words, source, hasSelection }`.
  - Projects are matched as the selection history matches them. All testaments are included by
    default; `allTestaments: false` keeps only the current one, for the Step 4 comparison.
  - GL phrases come from the same GL bible book as the selection history. Its loading was moved
    out of `fetchPreviousSelectionData` into `loadGlBookForSuggestions`, with
    `getFirstGlBibleId` and `resetGlBiblesCacheForProject`, in `checkingSuggestionsUtils.js`.
    The behavior is unchanged.
  - Target verses are read from `<project>/<book>/<chapter>.json`.
- **A check with a saved selection:**
  - In a project the selection history counts (same testament), its entry keeps the alignment
    with `hasSelection: true`, so it isn't added.
  - In a project of the other testament, which the selection history doesn't read, its entry
    uses the selection (`source: 'selection'`). A selection still wins over an alignment.
- **`getSuggestionHistory(selections, entries, projectName, contextId)`** builds one check's
  history. It returns a new object: the selection history plus one count per entry, leaving out
  the check's own verse in the current project and entries with `hasSelection`. With no entries
  it returns `selections` itself, so with the setting off the history is the same object as
  before.
- **`updateAlignmentEntrySelection`** sets `hasSelection` when the user saves or clears a
  selection, so a check counts once and its alignment comes back if the selection is cleared.
- **`Container.js`:**
  - The entries are read once per group, into `selectionsData.alignmentEntries`, only when the
    saved setting `llmUseAlignmentHistory` is on. The setting has no UI until Step 3, so this is
    off by default.
  - Each request gets `getSelectionsDataForCheck`, the merged history for its check, in both
    places requests are built.
  - `updateSelectionsData` calls `updateAlignmentEntrySelection`.
  - The entries are cleared when the component mounts, since alignments can change in the
    wordAlignment tool.
  - They are left out of the debug file `translation_data.json`.
- **Not cached:** a project's alignment and verse chapter files are read once per group fetch
  and not kept.
- **Unit tests:** 7 more in `__tests__/alignmentHistoryUtils.test.js`:
  - matching projects (resource, language, testament);
  - other-testament selections;
  - a check with no GL phrase;
  - leaving out the own verse, but not the same verse in another project;
  - the unchanged history with no entries;
  - saving and clearing a selection.
- **On the real projects** (`vi_glt_1co_book` with `vi_glt_heb_book`, and `ar_avd_heb_book`),
  eight common groups:
  - each project's entries match the training data's answers for the same checks, 520 of 520;
  - a group takes 1-50 ms to read with two projects;
  - script and output: `llm-eval-results/alignment-history-20261125/`.
- **`npm test`:** passes (428 passed, 29 skipped; the eval scripts in `llm-eval-results/` now run only when
  their own variable is set).
- **Seen in the data:** some alignments give odd word orders, e.g. `thế về Chúa Cứu` for
  `of Christ`, since the words are put in verse order. Step 4 will show whether such entries
  hurt.

### Step 3: the setting and the checkbox

- **The setting:** `llmUseAlignmentHistory` (boolean, default from Decision 4), saved in
  `checking_settings.json`.
- **checking-tool-wrapper:**
  - `Container.js` reads the setting with `data?.llmUseAlignmentHistory ?? saved setting`, so an
    older tc-ui-toolkit still works. It passes the setting to the history fetch.
  - Changing the setting clears the cached suggestions (`LlmRequestQueue`) and regenerates the
    current group, as a change to `llmSuggestionsEnabled` does.
  - Tests: off gives today's history byte for byte; on adds alignments; the current verse is
    left out; a selection wins over an alignment; saving a selection doesn't count a check twice.
- **tc-ui-toolkit** (`src/VerseCheck/CheckArea/index.js`):
  - add the state `llmUseAlignmentHistory` and `draftLlmUseAlignmentHistory`;
  - load it with the other settings (~line 433);
  - add a checkbox in the Configure AI dialog next to "enable thinking" (~line 1334);
  - save it in `saveAiDialog`, and in the other settings-save object (~line 653) so it isn't
    dropped;
  - add a test in the toolkit's suite;
  - publish a new 6.2.11 beta.
- **translationCore:** add `suggestions.use_alignment_history` and its `_tooltip` to the
  translationWords locale files (English text; other languages fall back or get translated
  later).

**Done 2026-11-25** in the three repos, on their `feature-mcleanb-add-suggestions-support`
branches. Nothing is published.

- **checking-tool-wrapper (`Container.js`):**
  - The history reads the saved setting (`settingsForSuggestionsRef`), not a field passed with
    each request. tc-ui-toolkit saves the dialog's settings before any later request, and an
    older toolkit never sets the field, so it stays off there.
  - When `saveSettingsForChecking` sees the setting change, it clears every cached suggestion of
    this tool, GL and target language (new `generateLanguageKeyPrefix`).
  - With AI on, it then remakes the current group, even though the dialog saves with
    `noRestart`.
  - Container has only snapshot tests, so this is not unit tested. The history behind the
    setting is tested in Step 2.
- **tc-ui-toolkit (`src/VerseCheck/CheckArea/index.js`):**
  - adds the state `llmUseAlignmentHistory` and `draftLlmUseAlignmentHistory`, loaded with the
    other settings (default off);
  - adds the checkbox "Use word alignments" in the Configure AI dialog, after "enable thinking";
  - saves it from `saveAiDialog` and in every other settings save.
  - **New test** `src/VerseCheck/CheckArea/__tests__/CheckAreaAiSettings.test.js`. It mounts
    `CheckArea` and checks two things:
    - the checkbox is off when never saved, and saving the dialog saves it on;
    - a saved setting shows in the dialog and is kept when another setting is saved.

    Both tests fail if either save of the setting is removed.
  - **Toolkit `npm test`:** passes (149 passed, 39 skipped). Its 3 lint warnings were there
    before.
  - **Not done yet:** a version bump and beta publish, then updating translationCore's
    dependency.
- **translationWords** (submodule of translationCore, `src/locale/*.json`): adds
  `suggestions.use_alignment_history` ("Use word alignments") and its `_tooltip` to all 24 locale
  files, in English, as for the other suggestion strings.
- **Wrapper `npm test`:** passes (428 passed, 29 skipped).

### Step 4: measure before turning it on by default

Alignments are this project's target answers, so the measurement has to be built with care.

- **Build the eval cases.** Use the projects behind `llmTrainingData` and the promptEval checks
  (FT-DEV, NEW-DEV, DEV, TEST). Give each case two histories:
  - **A, as today:** the selections the app would find.
  - **B:** A plus alignment history from every matching project, without the check's own verse.
    For B, also build a same-testament version (Decision 2).

  This needs a builder like `build:prompt-eval-cases` that calls the new `getSuggestionHistory`.
  The current eval histories (alignments of earlier checks in the group) are a third reference
  point.
- **Run:**
  - the algorithm;
  - the released r0v2 1.7B, 0.6B and 4B;
  - the stock 1.7B.

  Compare A against B with McNemar on top-1, and with the app's merge with the algorithm.
- **Also check:**
  - longer histories change which lines make the 10-line cut in `formatPreviousTranslations`;
  - higher counts can reach `CERTAIN_MIN_HISTORY_COUNT` (5) more often. Check that algorithm
    answers at 100 and at 95 or more are still right about as often as in
    `plans/algorithm-confidence.md`;
  - answers that are too long (the small-words habit of alignments);
  - time to fetch history on the largest project folder.
- **Adoption:** a significant top-1 gain for a shipped model, or for the algorithm, with no
  significant loss on the others, as in D6 of `plans/prompt-span-experiments.md`.

**Done 2026-11-25** (the runs were stopped once and then finished at the author's request).

**Method:**
- The projects behind the eval sets are not on this computer (9 of about 40 are in
  `~/translationCore/projects`). So history B is built from the training files in
  `llmTrainingData/*.json`, which hold each check's aligned answer, GL phrase and reference: the
  same words `fetchAlignmentHistoryEntries` gives (520 of 520 in Step 2).
- **Builder:** `__tests__/buildAlignmentHistoryCases.test.js`, with `LLM_AH_BUILD=1`. It uses the
  app's `getSuggestionHistory` and writes `<set>-ah.json` (all testaments) and `<set>-ahst.json`
  (same testament) for FT-DEV, NEW-DEV and their no-history sets.
  - Entries are the same group's checks in every training file with the same target language,
    resource id and GL.
  - The own verse in the own project is left out.
  - In a set with history, the earlier checks of the case's own file are already its history,
    so they count once.
- **The gap:** the training files leave out the first check of each group and groups with few
  aligned checks, so B is somewhat smaller than the app's history.
- **History A** is each set as it is, scored with the app's prompt: `baseline` with history, N3
  without.

**Coverage** (`answer in history` = an expected answer is one of the history's renderings):

| set | A: answer in history | B (all testaments) | B (same testament) | renderings A → B |
|---|---|---|---|---|
| FT-DEV (539) | 30.1% | 47.3% | 46.9% | 8.2 → 18.1 |
| FT-DEV-NOHIST | 0% | 45.6% | 45.3% | 0 → 17.3 |
| NEW-DEV (1,000) | 51.4% | 65.9% | 65.2% | 8.3 → 18.2 |
| NEW-DEV-NOHIST | 0% | 63.5% | 62.7% | 0 → 17.5 |

**The algorithm, top-1** (McNemar):

| set | A | B, all testaments | lost/won | B, same testament |
|---|---|---|---|---|
| FT-DEV | 258 | 329 (+71) | 3/74, p<.001 | 328 (+70) |
| NEW-DEV | 434 | 509 (+75) | 28/103, p<.001 | 512 (+78) |
| FT-DEV-NOHIST | 0 | 323 | 0/323 | 322 |
| NEW-DEV-NOHIST | 0 | 497 | 0/497 | 499 |

- Same testament only is no better, so the default stays all testaments (Decision 2).
- Wrong answers at 80 or more rose by only 3-9.

**The algorithm's certain answers.** These sets hold only cases the app sends to the AI, so with
A none reach 95. With B:
- **FT-DEV:** 70 cases reach 95 or more and skip the AI. At 100, 26 of 26 are right; at 95-99,
  41 of 44 (93%).
- **NEW-DEV:** at 100, 23 of 25 (92%); at 95-99, 31 of 37 (84%).
- The NEW-DEV 95-99 band is below the ~91% of `plans/algorithm-confidence.md`, on few cases.

**Models** (app's prompt, seed 42, temperature 0.1; top-1 with the app's fallback to the
algorithm; A → B, lost/won, McNemar p). "D3" is the released fine-tune in the eval folder; the
4B is stock Qwen3-4B-Instruct-2507.

| model | FT-DEV | FT-DEV-NOHIST | NEW-DEV | NEW-DEV-NOHIST |
|---|---|---|---|---|
| D3 1.7B | 425 → 439 (+14; 11/25, p 0.029) | 361 → 439 (+78; p<.001) | 549 → 574 (+25; 22/47, p 0.004) | 386 → 569 (+183; p<.001) |
| D3 0.6B | 394 → 423 (+29; 8/37, p<.001) | 261 → 420 (+159; p<.001) | 510 → 525 (+15; 31/46, p 0.110) | 266 → 517 (+251; p<.001) |
| stock 1.7B | 237 → 297 (+60; p<.001) | 122 → 293 (+171; p<.001) | 425 → 501 (+76; p<.001) | 29 → 494 (+465; p<.001) |
| 4B | 320 → 358 (+38; 20/58, p<.001) | 259 → 356 (+97; p<.001) | 467 → 499 (+32; 57/89, p 0.010) | 301 → 495 (+194; p<.001) |

- **Every model gains on every set.** The gains are significant on 15 of the 16 model and set
  pairs; the D3 0.6B on NEW-DEV is +15, p 0.11.
- **With alignment history, the models end up about level.** On FT-DEV, B gives 423-439 for the
  fine-tunes. With no history the D3 1.7B goes from 361 to 439, the same as with history.
- **Algorithm-first answers are better than the model's.** These are the cases B lifts to 95 or
  more, which skip the AI (70 on FT-DEV, 62 on NEW-DEV). The algorithm is right on 67 and 54 of
  them; with A, the D3 1.7B was right on 66 and 40, and the 4B on 55 and 31
  (`algorithm-first.txt`).
- **Answers that are too long** fell for almost every model and set.
- **Confident wrong answers rose on NEW-DEV with history** (D3 1.7B 238 → 275, D3 0.6B
  237 → 296), and all of the rise comes from AI answers, not the algorithm.
  - Without history, A has none at 80 or more, because N5 caps those answers at 70. B has
    history, so they are no longer capped: e.g. D3 1.7B NEW-DEV-NOHIST 0 → 264.
  - FT-DEV's count fell or barely moved. NEW-DEV already had many confident wrong answers with
    A, where its alignment labels often include small words.
  - The UI applies any suggestion with a confidence. So this is the cost to weigh against the
    top-1 gain.
- **Logs:** `run.sh` logs per model; `compare-ah.txt` holds the tables.

- **Files:** builder output in `llmTrainingData/promptEval/*-ah*.json`; results in its
  `results/`; scripts and logs in `llm-eval-results/alignment-history-20261125/` (`run.sh`,
  `compare.js`, `algorithm-confidence.txt`).
- **Decision (author, 2026-11-25):** `llmUseAlignmentHistory` stays off by default (Decision 4);
  users turn it on with the "Use word alignments" checkbox. The code already defaults to off (the
  toolkit loads a missing setting as false, and Container reads only the saved setting), so
  nothing changes in code.

## Risks

- **Small words.** Alignments include small words a checker may leave out. With rule 3 of the
  prompt ("copy exactly those words"), answers may get longer. Decision 5 and the too-long count
  in Step 4 cover this.
- **Unfinished alignments.** A project only partly aligned, or aligned by wordMAP suggestions
  that nobody checked, can add wrong renderings. A possible guard is to count only verses marked
  finished, if translationCore records that. Not checked yet.
- **Speed.** Reading every chapter of several projects for each check could slow the first
  suggestions. The cache in Step 2 and the timing in Step 4 cover this.
- **Retraining.** Not needed for the format: the history lines keep the same format.

### Step 5: offer the current verse's alignment as a suggestion

When the verse being checked is already aligned, the target words aligned to the check's quote
are very likely the answer. Offer them directly, as the algorithm's certain answers are offered
now (`algorithmFirst`).

- **Finding it:** in the current project's alignment data, for the check's quote and occurrence,
  use `getAlignedTargetWords` (Step 1). Skip a quote that is not aligned, or that is aligned with
  other original words, as the training data builder does.
- **The suggestion:** `{ selections, confidence }` like any other option, marked
  `alignmentFirst`. It is placed first, and the result is returned without asking the AI or
  running the algorithm. A check with no usable alignment goes on as today.
  - The selections are the aligned target words in verse order, each with its occurrence in the
    verse, in the form translationCore saves a selection.
  - The words may not be contiguous. Selections allow that, but check that tc-ui-toolkit shows
    and applies them correctly.
- **Confidence:** set from measurement, not assumed. Alignments are the answers in the evals, so
  scoring against them would always give 100% and shows nothing.
- **Measure** on projects with both saved selections and alignments for the same checks: how
  often the alignment equals the saved selection, exactly and ignoring small words. Use that
  share to choose the confidence.
  - The UI applies any suggestion with a confidence. So if the alignment matches the selection
    much less than ~90% of the time, give it a confidence below the auto-apply level.
  - Or offer it as an option without auto-applying, and say so in the plan.
- **Saved selections:** a check that already has a saved selection is not suggested at all, as
  now, so this only affects checks not yet done.
- **Stale alignments:** when an alignment changes in the wordAlignment tool, the cached
  suggestion must not outlive it. The suggestions cache is per session. Check whether
  translationCore reloads the checking tool, or invalidates its checks, after a word-alignment
  edit. If it doesn't, clear the cache for that verse.
- **Setting:** `llmUseVerseAlignment` (Decision 6), with its own checkbox in the Configure AI
  dialog. Add it the same way as `llmUseAlignmentHistory` in Step 3: Container fallback, toolkit
  state, saving, and locale strings `suggestions.use_verse_alignment` and its `_tooltip`.
- **UI label:** tc-ui-toolkit shows the source of a suggestion (`suggestions.model_name`,
  `suggestions.previous_selections`). Add a label such as "From word alignment" so the user
  knows where it came from.
- **Tests:**
  - an aligned verse gives `alignmentFirst` with the aligned words and occurrences;
  - an unaligned verse, or a quote merged with other words, falls through to today's path;
  - with the setting off, nothing changes.
