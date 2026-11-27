# Plan: original-language history on the AI path

Started 2026-11-26, split out of `plans/original-language-history.md` (its Step 5). Status: not
started. Part 1 of that step (ordering the prompt's history lines by OL match, variant `O1`) was
measured there and gave no gain; this plan holds what is left.

## Where things stand

- The algorithm gets original-language (OL) history in the app (`plans/original-language-history.md`,
  Steps 2-4): the same project's checks, the other books of every project the selection history
  reads (also where the GL bible lacks the book), and the word alignments when that setting is on.
- The AI prompt does not use it. It gains only indirectly: more answers reach 95+ and skip the AI,
  and the algorithm's options are merged into the AI's.
- `O1` (same history, lines ordered by OL match) changed few answers and gained nothing on the
  shipped fine-tunes `uw-tw-qwen3-1.7b-Q5_K_M`, `uw-tw-qwen3-0.6b-Q6_K` or stock Qwen3-1.7B
  (p ≥ 0.25 on DEV and TEST; table in the other plan, Step 5). Within the lines that fit the verse,
  the order barely matters to these models.
- So what is left is history the AI does not get today: renderings only the OL history has
  (Part 1), or the OL key itself in the prompt (Part 2).

## Part 1: OL-only renderings in the prompt (variant `O2`), with other-book history

No retraining: `O2` keeps the app's prompt format and adds renderings only the OL history has,
shown as chosen for the GL phrase (`withOlHistoryOrder(true)` in `__tests__/helpers/promptVariants.js`,
`addOlRenderings` in `formatPreviousTranslations`, experiments only).

**Why it is worth a run.** With same-project OL history, O2 added lines to 11 DEV cases and no TEST
case, so it was not run. The OL history from other books is where the GL history loses renderings:
GL bibles with missing books (es-419, id and fa `glt`, ru `rlob`). There the algorithm gained
63.0% → 69.2% on the 227 held-out cases with lost history (Step 4). The AI sees none of that today.

**Expected size.** Small overall: the gains sit in a few es-419, ru, id and fa files.

Steps:
1. **Runner.** Add a cross-book mode to `buildRunOlHistories` (`__tests__/helpers/olHistoryHelpers.js`),
   e.g. `LLM_TRAINING_OL_HISTORY=books`, reusing how `__tests__/olCrossBook.test.js` builds the
   other books' history (training files of the same target language and resource id, same
   testament). Result files get `_ol-books`.
2. **GL history too.** The other books' checks also add GL-keyed history where the case file's GL
   bible keys them, which changes the baseline prompt. Decide whether the mode adds both (as the
   app does) and rerun the baseline with it; don't compare with the `_ol-same` runs.
3. **Algorithm.** Run it first with the new mode on DEV and TEST
   (`LLM_TRAINING_DATA_DIR=llmTrainingData/promptEval npm run run:llm-training-data`), since it
   decides which cases skip the AI. Count how many AI-bound prompts O2 changes before running models.
4. **Models.** Baseline and O2 on DEV and TEST, the same server and settings as Part 1 of the other
   plan (bundled `llama-server`, temperature 0.1, seed 42): the two shipped fine-tunes and stock
   `qwen3-1.7b-stock-Q5_K_M`.
5. **Compare** with `scripts/compare-prompt-variants.js -a <set>_Algorithm_ol-books.results.json`,
   overall and on the cases with lost history; also wrong answers at 80+.

**Adopt** if O2 wins on TEST for the shipped fine-tunes with no clear loss elsewhere. Then it moves
into the app's prompt (`formatPreviousTranslations` gets the OL tally from `selectionsData.olHistory`),
the parity tests (`promptVariants.test.js`, `buildFineTuneData.test.js`) change with it, and the
fine-tuning data is rebuilt for the next training run.

## Part 2: the OL key in the prompt (a retrain)

Showing the OL word (lemma, maybe form) in the prompt or in the history lines is a new format: the
fine-tuned models were not trained on it, so it needs new fine-tuning data and a retrain
(`plans/fine-tune-qwen3.md`, `llmTraining/`).

Only worth starting if Part 1 shows the AI uses OL-derived history, or if the algorithm's OL gains
(H2, telling a group's lemmas apart; H3, form) suggest the model could too. Before that:
- decide the format (a line per request with the OL lemmas; or OL keys on the history lines) and
  measure it on stock models first as a prompt variant;
- check the training data has the OL words (`olWords`, `npm run add:ol-words`) for every case, and
  how the no-history share should look;
- the cost: rebuild `build:finetune-data`, retrain the 1.7B (and 0.6B, 4B), rescore on TEST, new
  release builds.

## Open questions

- The alignment history with OL keys (`llmUseAlignmentHistory`) is not measured: the training data
  has no alignment-history cases with OL keys.
- Do older projects record an OL version that matches the `ugnt`/`uhb` used for the lemma lookup?
  (Also open in the other plan.)
