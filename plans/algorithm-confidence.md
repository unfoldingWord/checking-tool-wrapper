# Plan: calibrate the algorithm's suggestion confidences with the training data

**File:** `src/utils/checkingSuggestionsUtils.js` (`getBestTWordSelectionWithConfidenceAlgorithm` and its
scoring helpers)
**Tests:** `__tests__/checkingSuggestionsUtils.test.js`, `__tests__/llmModelSuitability.test.js`
(`ALGORITHM_TOP1`), `__tests__/LlmRequestQueue.test.js`
**Data:** the 39 files in `llmTrainingData/` (26,369 translationWords checks from 26 aligned projects, each
with the translator's aligned words as `expected`) and the saved algorithm results in
`llmTrainingData/results/*_Algorithm.results.json`.
**Written against commit:** `9959078` (2026-11-20). Line numbers below are from that commit; re-check them
if `git diff 9959078 -- src/utils/checkingSuggestionsUtils.js` is not empty.
**Related:** `plans/algorithm-partial-match.md` (how the current scoring came about),
`plans/fine-tune-qwen3.md` (the fine-tuned models that take over below the algorithm's certain cutoff).

## 1. Goal

Make the algorithm's confidence mean what it says, using the measured outcomes in the training data:

1. **Fewer confident false positives:** wrong suggestions shown at high confidence, above all at 100,
   where the AI is never asked (`ALGORITHM_CERTAIN_CONFIDENCE`).
2. **Higher confidence for suggestions that are usually right,** so they rank first and, when they are
   certain enough, skip the AI.
3. **Fuzzy matches (inflected, compound or accent-variant forms) scored by how often they prove right,**
   not by a fixed cap.

**Meaning (Q1, decided by the author 2026-11-21):** the confidence is **how closely the suggestion
matches the most similar target phrase in the user's selection history, weighted by how often that
phrase was selected (its counts), and lower when the history's GL phrase does not match exactly.** The
training data does not change that meaning; it sets the weights of the three parts (match closeness,
frequency, GL-key match) and the shape of each, so that a higher confidence goes with a likelier answer
and fewer confident false positives. 100 stays special: it is the algorithm's "certain" level, where
the app does not ask the AI, so it must be right at least **95%** of the time on held-out projects
(Q3, decided). Step 2 showed that 95% needs checks of the verse beyond the three parts (the phrase
occurs once, no history word next to it, no competing history phrase in the verse); they are used only
to decide 100, not the rest of the scale.

**AI suggestions (Q2, decided):** more AI calls are acceptable. The AI's own confidence numbers are
only good for ordering its suggestions. When there is selection history, each AI suggestion's
confidence is **replaced by the same history-based score** (its closeness to the most similar history
phrase, weighted the same way); the AI's number only orders suggestions that score the same, and is kept
only when there is no history.

Out of scope: finding answers the algorithm does not list today (section 2.4 shows that is most of the
remaining error), suggesting the longer "plus more" selections of 2.2 (Q4, decided: usually the user has
not yet made enough selections for that GL phrase), the AI prompt, and the fine-tuned models.

## 2. What the data shows (baseline)

Measured with `npm run calibrate:algorithm` (Step 0), which runs every case through `getBestSelections`
on the algorithm path and reproduces the saved algorithm results exactly (0 of 26,369 answers differ).
"Right" means the option's words and occurrences equal one of the case's `expected` answers, scored as
`runLlmTrainingData` scores them (`normalizePhrase(optionText(option))`). Split as the broader fine-tune
test (`plans/fine-tune-qwen3.md`, "Broader held-out test"): **test** = the 10 projects `ne_glt_*`,
`bn_glt_eph`, `es-419_est_rut`, `en_ult_tit`, `vi_glt_heb`, `ru_rlob_luk`, `te_glt_luk`, `ar_avd_heb`,
`fa_glt_jas`, `id_glt_1ti` (6,076 checks); **tune** = the other 16 projects (20,293 checks). The full
report is `llmTrainingData/results/algorithmCalibration.report.txt`.

### 2.1 Confidence of the top suggestion against how often it is right

| Confidence | Tune: checks | Tune: right | Test: checks | Test: right |
|---|---|---|---|---|
| 100 | 9,336 | 80.0% | 1,940 | 86.4% |
| 95-99 | 35 | 77% | 4 | 75% |
| 90-94 | 3,763 | 46.4% | 987 | 62.6% |
| 85-89 | 1,119 | 44.7% | 435 | 63.9% |
| 80-84 | 1,741 | 39.9% | 712 | 63.8% |
| 70-79 | 455 | 55.6% | 316 | 67.1% |
| 60-69 | 444 | 46.4% | 196 | 56.6% |
| 40-59 | 430 | 23.5% | 60 | 3.3% |
| 1-39 | 1,636 | 13.0% | 502 | 24.3% |
| no suggestion | 1,334 | | 924 | |

Summary (tune / test): top-1 55.2% / 57.2%. Expected calibration error (ECE: the mean gap between
confidence and accuracy over 10-point bins, weighted by rows) **28.1 / 18.4 points for the top option,
37.8 / 24.3 for all options shown**; Brier score 0.285 / 0.220 (top), 0.327 / 0.243 (all options).
Wrong top suggestions at confidence ≥ 80: 5,559 / 1,049; wrong options of any rank at ≥ 80: 12,368 /
1,585.

So: from 60 to 94 the score does not separate right from wrong (82 and 93 are equally likely to be
right, and 70-79 does better than 90-94), and 100 is wrong for 1 check in 5 (tune) or 7 (test).

### 2.2 Why "certain" (100) answers are wrong (tune: 1,869 wrong of 9,336; test: 264 of 1,940)

| Kind | Tune | Test |
|---|---|---|
| The translator selected the algorithm's words **plus more** | 1,019 (55%) | 118 |
| **Same words, another occurrence** in the verse | 481 (26%) | 60 |
| Different words (another rendering from the history, or a new one) | 291 (16%) | 60 |
| The translator selected fewer words | 78 (4%) | 26 |

- "Plus more" is the `someExpectedWordsNotInHistory` group of the fine-tune plan, whose expected
  answers the author hand-checked and judged right (50 of 50).
- "Another occurrence": the right words, but the translator selected a later run of them in the verse
  (e.g. `ٱللهِ:2` where the algorithm gives the first `ٱللهِ`), although the check is for occurrence 1
  of the original word. Both paths place a rendering at its first match, and `moveSelectionsToOccurrence`
  only moves it for occurrence 2 and up. A rendering that occurs more than once in the verse is
  therefore a strong reason not to be certain (section 4).
- The rendering's share of its history differs only a little between right and wrong answers at 100
  (median 0.80 against 0.71), so history dominance alone will not separate them.

### 2.3 The 2nd and 3rd options

| Confidence of a 2nd or 3rd option | Tune: options | Tune: right | Test: options | Test: right |
|---|---|---|---|---|
| 100 | 1,311 | 38.7% | 125 | 30.4% |
| 90-94 | 2,378 | 10.3% | 200 | 14.5% |
| 85-89 | 1,527 | 6.2% | 104 | 7.7% |
| 80-84 | 2,600 | 6.4% | 210 | 13.3% |
| 70-79 | 176 | 14.2% | 26 | 11.5% |
| 60-69 | 356 | 25.3% | 59 | 18.6% |
| 40-59 | 1,295 | 9.5% | 139 | 6.5% |
| 1-39 | 7,610 | 1.8% | 1,110 | 3.2% |

Most lower options are shown at 80-94 and are right 6-15% of the time: the largest group of confident
false positives a checker sees (6,505 such options on tune).

### 2.4 Where the right answer is (tune, 18,959 checks with a suggestion)

Top option 11,208 (59%), 2nd 1,220, 3rd 172, **not listed 6,359 (34%)**. Re-ranking can gain at most
~1,400 checks; calibration is the main lever, and listing new answers is out of scope.

### 2.5 Projects differ

| Project (split) | At 100: checks / right | At 80-99: checks / right |
|---|---|---|
| `fa_glt_jas` (test) | 27 / 52% | 25 / 32% |
| `vi_glt_1co` (tune) | 517 / 71% | 363 / 23% |
| `vi_glt_luk` (tune) | 3,545 / 73% | 3,084 / 40% |
| `fa_glt_mrk` (tune) | 301 / 74% | 197 / 45% |
| `ru_rlob_gen` (tune) | 2,741 / 84% | 1,580 / 38% |
| `te_glt_luk` (test) | 462 / 84% | 430 / 56% |
| `ar_avt_psa` (tune) | 1,778 / 92% | 1,057 / 73% |
| `ru_rlob_luk` (test) | 714 / 93% | 1,018 / 74% |
| `ar_avd_heb` (test) | 99 / 95% | 103 / 81% |

Accuracy depends on the project (its translators' alignment habits, how consistent its renderings are,
the language) as much as on the score. One project, `vi_glt_luk`, holds a third of the tune checks at
100. A calibration fitted naively would mostly fit Vietnamese Luke (section 6).

## 3. Diagnosis (current code)

The confidence is a hand-made point score, not a measured probability:

- `scoreAlgorithmicMatch` (line 1493): 100 for any full, contiguous match; otherwise coverage (up to
  60) + full match (20) + contiguous (15) + compactness (up to 10) + usage (up to 5), clamped to 1-99.
  History usage, the strongest evidence that a rendering is the usual one, is worth at most 5 points,
  and only relative to the most-used rendering.
- `capForRendering` (line 1113): 100 for any rendering from the exact GL key, else 82-95 by GL-key
  relatedness (`PARTIAL_GL_MATCH_CAP_MIN`/`MAX`, lines 950-952). An exact-key rendering found verbatim
  gets 100 however weakly the history supports it (a rendering used once, beside one used 20 times) and
  however many other renderings of the same key are also in the verse.
- Out-of-order placements: minus `ORDER_PENALTY` (10), capped at `UNORDERED_MAX_CONFIDENCE` 89
  (lines 1323-1325, applied at 1742).
- Fuzzy pass: runs only when no candidate is above 80 (`minimumConfidenceLevel`, line 1828); score
  scaled by mean word similarity and capped at `FUZZY_TARGET_MAX_CONFIDENCE` 90 (line 954, applied at
  1746). The cap is also used by the AI path (line 2265).
- The 2nd and 3rd options get the same point score as the 1st (sorted, `.slice(0, 3)`, line 1895), with
  nothing for having lost to a better candidate.

What reads these confidences:
- `ALGORITHM_CERTAIN_CONFIDENCE` (100, line 3859; per-job `algorithmCertainConfidence`; the
  `llmAlgorithmCertainConfidence` setting): at or above it, `getBestSelections` uses the algorithm and
  does not ask the AI.
- `mergeBestSelections` (`src/utils/LlmRequestQueue.js`): merges the algorithm's options into AI results
  by confidence, so the algorithm's 2nd and 3rd options are shown next to the AI's.
- The checking UI (`../tc-ui-toolkit`, `src/VerseCheck/CheckArea/index.js`): shows each option with its
  confidence and applies the best one to an empty selection whatever its confidence (line 453).
- The fine-tune exporter (`__tests__/helpers/fineTuneHelpers.js`, line 566): drops most checks the
  algorithm gets right at 100, and records `algorithmConfidence` in the metadata.
- `runLlmTrainingData` reports by algorithm confidence band, and the suitability suite's always-run test
  asserts `ALGORITHM_TOP1 = { hand: 25, real: 9 }`.

## 4. Approach

Keep the matching (which words are found) as it is, and replace how a found candidate's confidence is
set with **one scoring function of the Q1 parts**, used for algorithm candidates and AI suggestions
alike:

    confidence = 100 x match closeness x frequency weight x GL-key weight, capped at 99
    unless the 100 rule holds

- **Match closeness** (0-1): 1 for the phrase found verbatim; lower for gaps, missing words, swapped
  order, or similar word forms (fuzzy), by path.
- **Frequency weight** (0-1): from the phrase's count and its share of the history's counts.
- **GL-key weight** (0-1): 1 for the exact GL phrase, lower by relatedness for other keys.
- **The 100 rule:** exact GL key, verbatim, the verse checks, and a rendering chosen at least 5 times
  (Step 4; 3 in Step 3).

The shapes and weights of the three parts are chosen on the tune projects (Step 2) and checked on the
test projects. No per-language lists or tables (CLAUDE.md: target languages can be anything). The
function must stay readable in the code: a few constants with comments citing the measurements.

Candidate features, all available inside `considerCandidate` (lines 1723-1771) or cheap to add:

| Feature | Why |
|---|---|
| Match path: verbatim / in order with gaps / out of order / partial / slice / fuzzy | the current score's main input |
| GL key: exact, or relatedness of the best related key | `capForRendering` today |
| The rendering's share of its history (count / total for the key), and its rank | usage is worth only 5 points today |
| Number of distinct history renderings for the key | a split history is less certain |
| Other history renderings also found verbatim in this verse | competition inside the verse |
| Words of the rendering, and matched fraction | coverage |
| Gap / span, and how often the matched words occur in the verse | compactness, common-word fragments |
| Mean fuzzy similarity (fuzzy path) | goal 3 |
| Whether the matched run has adjacent verse words that other history renderings of the key include | the "plus more" pattern of 2.2: a longer history rendering, or a frequent neighbour, signals that 100 is unsafe |
| How many times the matched words occur as a run in the verse, and the check's occurrence | the "another occurrence" pattern of 2.2 |
| The candidate's rank among the candidates | 2.3 |

## 5. Steps

Each step ends with `npm test` passing and its numbers recorded in a results section at the end of this
plan. Measure on the tune split while choosing, and report the test split only to check.

### Step 0. Measurement harness (OFFLINE, no `src` change)

Add `__tests__/calibrateAlgorithm.test.js`, skipped unless `LLM_ALGO_CALIBRATE=1`, and the npm script
`calibrate:algorithm`. It runs `getBestTWordSelectionWithConfidenceAlgorithm` on every case in
`llmTrainingData/*.json` (as `runLlmTrainingData` does), splits by project as in section 2, and prints:
the table of 2.1 for the top option and for all options, ECE, Brier score, top-1, wrong at ≥ 80 for the
top option and for any option shown, accuracy at 100, the 2.2 breakdown, and per-project accuracy at 100.
It writes the rows (case id, split, project, option rank, confidence, features once Step 1 exists, right)
to `llmTrainingData/results/algorithmCalibration.jsonl` for analysis. Check that it reproduces the
section 2 baseline exactly; move the throwaway scripts' logic here.

### Step 1. Record the features (small `src` change, no behaviour change)

`considerCandidate` computes the section 4 features and keeps them on the candidate. Add an optional
`explain` argument to `getBestTWordSelectionWithConfidenceAlgorithm` that returns them as
`option.features`; without it the result is unchanged (`{ selections, confidence }`), so both paths keep
their contract. Unit test: the features of a few known cases (verbatim exact key, related key, gapped,
out-of-order, fuzzy). Confirm with the harness that confidences and top-1 are byte-identical to Step 0.

### Step 2. Choose the calibration (OFFLINE analysis)

From the Step 1 rows on the tune split only:
1. Accuracy per match path, then within each path by the strongest one or two features (for exact-key
   verbatim matches: the rendering's share and in-verse competition; for fuzzy: similarity).
2. Fit a monotone mapping from each path's features to accuracy (isotonic, or a few bins), weighting
   projects so none counts for more than about a sixth of a bin (2.5).
3. Define the 100 rule: the feature combination whose measured accuracy is at or above the Q3 target on
   tune, and check it on test.
4. Lower options: measure the accuracy of 2nd and 3rd options by the gap to the 1st and by feature, and
   fit their discount.

Record the tables and the chosen rule in this plan before coding Step 3.

### Step 3. Apply the calibration (`src` change)

Replace the final confidence in `considerCandidate` (and the caps that become redundant) with the Step 2
mapping; apply the lower-option discount after sorting (line ~1895), so the order of options does not
change in this step. Keep `FUZZY_TARGET_MAX_CONFIDENCE` for the AI path unless Step 2 shows it should
move too (it caps AI answers matched by similarity, a different question). Re-check, with the harness:
- top-1 unchanged (ordering is untouched); ECE and Brier down on tune **and** test;
- accuracy at 100 at or above the target on test; wrong at ≥ 80 down;
- no project worse calibrated than before at 100 (2.5).

Update the unit tests that assert confidence ranges in `checkingSuggestionsUtils.test.js` (the case
table at line 21, whose rows each give a minimum and maximum confidence, and the range at line 146),
each change with a comment citing the measurement.

### Step 4. Let the calibrated confidence order the options (`src` change)

Sort candidates by the calibrated confidence (today: by point score, then count, word count, span). This
can change which option comes first; keep it only if top-1 rises on tune and does not fall on test.
Update `ALGORITHM_TOP1` if it moves.

### Step 5. Fuzzy matches

Using the Step 1 rows for the fuzzy path: calibrate its confidence by mean similarity and matched
fraction, and test whether the fuzzy pass should also run when the best candidate is between 80 and its
own calibrated level (today it runs only when nothing is above 80). Keep a change only if fuzzy options'
calibration improves and top-1 does not fall.

### Step 5b. Score AI suggestions from the history (`src` change)

When the job has selection history, give each AI suggestion the Step 3 score: match its words against
every history rendering (exactly, then by `wordSimilarity`, as the algorithm does) and score the
closest one with the same match closeness, frequency and GL-key weights. Keep the AI's order for
suggestions that score the same, and keep the AI's own confidence only when there is no history.
`FUZZY_TARGET_MAX_CONFIDENCE` (the cap for AI answers matched to the verse by similarity) is then
replaced by the score's match closeness. Measure with Step 6: the AI's confidences on the held-out
files before and after (ECE, wrong at ≥ 80), and that the merged list (`mergeBestSelections`) still
orders AI and algorithm options sensibly.

### Step 6. The whole app (LIVE, LM Studio and llama.cpp)

The confidence decides when the AI is asked, so measure the app, not only the algorithm, on the held-out
files of the fine-tune plan (`llmTrainingData/finetune/heldout`, 835 checks) and the broader set
(`llmTrainingData/finetune-d3-broad/heldout`, 6,076):
1. `npm run run:llm-training-data` with the algorithm, then with the released fine-tuned model
   (1.7B MLX 5-bit in LM Studio; GGUF Q5_K_M in `llama-server`) and with stock Qwen3-4B: top-1 at each
   `ALGORITHM_CERTAIN_CONFIDENCE`, wrong at ≥ 80, and how many checks now go to the AI.
2. The suitability suite (`scripts/test-llm.sh -r 3 -g 1`) for the same models.
3. Success: app top-1 with the fine-tuned model at the default cutoff not lower than today (68.3% /
   74.2% for the broad twin), fewer wrong at ≥ 80, and the extra AI calls reported (Q2).

### Step 7. Fine-tune data and docs

- The exporter drops checks the algorithm gets right at 100, so the fine-tune data changes when 100
  does. Rebuild it (`npm run build:finetune-data`) and compare the manifests. Retrain only if Step 6
  shows the released model losing accuracy on the checks that now reach it; record the decision.
- Update CLAUDE.md (the algorithm paragraph: what the confidence means, how it is set) and the doc
  comments of the changed functions; note in `plans/algorithm-partial-match.md` that its point scores
  were replaced.

## 6. Risks

- **Projects differ (2.5).** A mapping fitted on 16 projects may not transfer: on 80-94 the tune and
  test splits differ by 15-20 points today. Weight projects, judge only on the test split, and accept a
  calibration that is better on average without being exact for every project.
- **Labels are alignments, not selections.** `expected` is what translators aligned, which can include
  words a checker would not select. The author's hand-check of the "plus more" group found them right,
  so they count as right here; the calibration will therefore lower confidence on short answers that
  usually get extended.
- **The meaning of the number changes for users.** Checkers see the confidence, and translationCore
  users may have set `llmAlgorithmCertainConfidence`; a calibrated 90 is not today's 90. Note it in the
  release notes.
- **More AI calls.** Fewer 100s send more checks to the AI: slower per verse, and the fine-tuned model
  sees checks it was trained on less (Step 7).
- **Overfitting the 100 rule** to a few large projects; check it per project.

## 7. Open questions for the author

- **Q1. Meaning.** Should confidence N mean "right about N% of the time" for every option shown?
  - Answer: it is how closely the suggestion matches the most similar target phrase in the historical user selections (selectionData) and weighted by how frequently that phrase was selected (based on the counts in selectionData).  Also lower weight should be given to historical user selections where the GL language phrase does not exactly match. The AI suggestions are an exception that it can make use of its language training data when there is not much in the user selection history.  Depending on the model this could be an advantage or fiction.  So if there is user selection history the AI confidence values should be replaced by the confidence numbers generated by the algorithm.
- **Q2. AI calls.** Fewer 100s send more checks to the AI. With the fine-tuned model that should raise
  accuracy (it beats the algorithm in every band below 100), but it costs time. Acceptable, and is there
  a limit?
  - Answer: it's OK if it costs more time.  Unfortunately the confidence numbers from AI are suspect and only useful for sorting the AI recommendataions.  The confidence value in the AI suggestions should be replaced using the same algorithm mentioned in Q1.
- **Q3. Target for 100.** What accuracy should "certain" need: 95% (proposed), or higher, since
  certain answers are not checked by the AI?
  - Answer: 95% would work.
- **Q4. The "plus more" pattern (2.2).** It is the largest error at 100. Calibration can only lower the
  confidence; actually suggesting the longer selection (for example, extending to adjacent words that
  other renderings of the key include) would be a separate matching change. In scope, or a later plan?
  - Answer: This is out of scope for now.  Typically, this is because the user has not yet done enough selections for this Gateway language phrase for the algorithm to determine the extra words to be included.

## Results

### Step 0 (2026-11-20): measurement harness

`__tests__/calibrateAlgorithm.test.js` (`npm run calibrate:algorithm`, skipped in `npm test`) with its
helpers in `__tests__/helpers/algorithmCalibrationHelpers.js`, whose unit tests run in `npm test`.
Runs the 39 files (26,369 cases) through `getBestSelections` in about a minute, reproduces the saved
algorithm results exactly (0 differences) and writes `llmTrainingData/results/algorithmCalibration.jsonl`
(one row per option) and `algorithmCalibration.report.txt`. Section 2 was rewritten from its report: the
first draft's throwaway scripts had put the Nepali projects in the tune split and under-counted the
"another occurrence" errors (39 instead of 481).

### Step 1 (2026-11-20): features

`getBestTWordSelectionWithConfidenceAlgorithm(..., { explain: true })` returns each option's
`features` (path, GL key, history count/share/rank, words matched, gap, similarity, `runsInVerse`,
`neighbourInHistory`, `verbatimRenderings`, point score and cap, candidates and rank; documented in its
doc comment). `getBestSelections` passes it for a job with `explainAlgorithm`. Without it the result is
unchanged: the harness still reproduces the saved results exactly (0 of 26,369 differ), and
`npm test` passes. Three unit tests in `checkingSuggestionsUtils.test.js` cover the features. The
harness rows also carry the check's occurrence.

### Step 2 (2026-11-20): the calibration, chosen on tune

**What separates right from wrong** among today's 100s (top option, verbatim, exact GL key; tune,
9,336; "balanced" = weighting projects so none is more than a sixth of a cell):

| Feature | Value | Checks | Right | Balanced |
|---|---|---|---|---|
| `runsInVerse` (the rendering's runs in the verse) | 1 | 8,088 | 85.0% | 82.4% |
| | 2 or more | 1,248 | 47.2% | 54.4% |
| `neighbourInHistory` (history word next to it) | 0 | 7,470 | 87.2% | 81.8% |
| | 1 or 2 | 1,866 | 51.2% | 53.8% |
| `verbatimRenderings` (history renderings verbatim in the verse) | 1 | 6,512 | 87.1% | 84.2% |
| | 2 or more | 2,824 | 63.5% | 56.8% |
| History share of the rendering | ≥ 0.9 … < 0.3 | | 75-84% | 75-86% |

The first three are strong; history share barely matters (as 2.2 found). Call a match **clean** when it
occurs once in the verse, has no history word next to it, and is the only verbatim rendering. Clean
matches are 5,140 of the 9,336 and right 93.1% (balanced 89.2%); the rest are right 64.0%. Within clean,
the rendering's history count decides the rest: 10 or more 97.5% (1,835), 3-9 92.5% (1,811), 1-2 88.2%
(1,494). History length, words in the rendering and the number of candidates add little.

Elsewhere: fuzzy matches' accuracy does **not** rise with word similarity (related key: similarity
0.7-0.8 59%, 0.8-0.9 43%, ≥ 0.9 46%); partial, ordered, slice and out-of-order matches are rarely right
(1-32%); 2nd and 3rd options are right 1-41% by cell, highest when they are verbatim from the exact key
with no neighbour (63%).

**The mapping:** cells by rank (top / lower), path, GL key (exact / related), and for verbatim matches
clean (by history count 1-2 / 3-9 / 10+) or `runsInVerse` × `neighbourInHistory` × `verbatimRenderings`,
for fuzzy matches the similarity band. A cell's confidence is its balanced accuracy on tune, rounded,
1-99; a cell with fewer than 100 tune rows uses its parent's. About 40 cells; the fitted values are in
the throwaway output and would become a commented constant table in Step 3.

**Held-out check** (test split, never used for fitting; top-1 is unchanged because the order is):

| | ECE top | ECE all options | Brier (all) | Wrong options at ≥ 80 | At 100 | Right at 100 |
|---|---|---|---|---|---|---|
| Today | 18.4 | 24.3 | 0.243 | 1,585 | 1,940 | 86.4% |
| Calibrated, 100 = clean | 11.1 | 8.7 | 0.151 | 152 | 1,448 | 92.6% |
| Calibrated, 100 = clean and count ≥ 3 | 9.6 | 7.6 | 0.150 | 152 | 695 | 94.7% |
| Calibrated, 100 = clean and count ≥ 10 | 9.1 | 7.2 | 0.149 | 152 | 157 | 97.5% |

On tune the calibrated ECE is 1-3 points (in-sample); the 7-9 points left on test are the project
differences of 2.5. Wrong options shown at ≥ 80 fall by 90% on test whichever 100 rule is used.

**Decision needed (Q2, Q3):** which 100 rule. A stricter rule is more often right but sends more checks
to the AI, and the held-out projects have short histories (few renderings used 10+ times), so "count ≥
10" keeps only 157 of their 1,940 certain answers. Proposed: **clean and count ≥ 3** (94.7% right on
test, about the 95% target, 36% of today's certain answers kept); Step 6 then measures what the extra AI
calls give with the fine-tuned model.

### Step 2, revised for the Q1 answer (2026-11-21): the history-based score

The score of section 4 (100 x match closeness x frequency weight x GL-key weight, 100 only by the rule
"exact key, verbatim, occurs once, no history word next to it, the only verbatim rendering, count ≥ 3"),
with each part's shape fitted on tune by minimising the Brier score (coordinate search over a grid),
then checked on test. The same harness rows as Step 2; option order unchanged unless stated.

| Held-out (test) | Today | Q1 score | Q1 score + verse checks | Q1 + verse, frequency forced share^0.25 × count/(count+1) | … forced share^0.5 × count/(count+2) |
|---|---|---|---|---|---|
| AUC (all options) | 0.789 | 0.844 | **0.874** | 0.846 | 0.812 |
| Brier (all options) | 0.243 | 0.188 | **0.151** | 0.201 | 0.263 |
| ECE top / all options | 18.4 / 24.3 | 22.3 / 14.6 | **13.1 / 8.4** | 25.2 / 17.2 | 35.5 / 25.7 |
| Wrong options at ≥ 80 | 1,585 | 132 | 121 | 41 | 39 |
| At 100 / right | 1,940 / 86.4% | 695 / 94.7% | 695 / 94.7% | 695 / 94.7% | 695 / 94.7% |
| Top-1 if options re-ordered by the score (tune; today 11,208) | | 11,241 | **11,664** | 11,332 | 10,795 |

Fitted parts (tune):
- **Q1 score:** closeness verbatim 1, in order with gaps 0.4 × 0.5 per gap word, out of order 0.3 ×
  0.5 per gap, partial or slice (words found / rendering words)², fuzzy the same with **no effect of word
  similarity** (exponent 0); frequency share^0.1 × count/(count + 0.5), nearly flat; GL key 1 exact,
  0.36-0.6 for related keys (0.6 × (0.6 + 0.4 × relatedness)).
- **+ verse checks** (a factor for the phrase occurring more than once, 0.6; a history word next to it,
  0.5; another history phrase verbatim in the verse, 0.7): the fit sets the **frequency weight to 1
  (no effect)**; closeness in order with gaps 0.2 × 0.5 per gap, partial or slice 0.6 × (found/words)^1.5,
  GL key as above.

Findings:
- **Frequency does not predict the right answer** once the verse is considered: the fit removes it, and
  forcing it in lowers AUC and calibration and, at share^0.5, re-ordering by the score would lose 413
  right top answers on tune. The likely reason: the history holds many inflected forms of a term, each
  chosen a few times; whichever form is in this verse verbatim is usually right, however rarely it was
  chosen before. History count still matters for 100 (count ≥ 3) and as today's tie-breaker in the order.
- **Word similarity does not predict whether a fuzzy match is right** (exponent 0 in both fits); found
  words per rendering word does.
- **The verse checks matter beyond 100:** without them, verbatim exact-key matches that fail them (right
  50-64%) score 85-99, and the top option's ECE on test gets worse than today (22.3 against 18.4).
- Re-ordering by the score gains up to 456 right top answers on tune (Step 4); on test it is flat
  (3,473-3,487 against 3,476).

**Decision needed:** the author's Q1 definition weights by frequency, but the data says frequency does
not help and can hurt. Proposed: **the Q1 score plus the verse checks, with frequency used only for 100
(count ≥ 3) and to order options that score the same**; or keep a nominal frequency weight
(share^0.25 × count/(count+1)) at the cost shown in the fourth column.

### Step 3 (2026-11-21): the history-based score in the algorithm (author's choice A)

Option A of the Step 2 decision: the Q1 score with the verse checks, frequency used only for 100
(count ≥ 3) and the existing tie-breaker. In `src/utils/checkingSuggestionsUtils.js`:
- `scoreSuggestionFromHistory(features)` with the weights in `HISTORY_SCORE` and
  `CERTAIN_MIN_HISTORY_COUNT = 3`, documented with the measurements. It takes the `explain` features, so
  Step 5b can score AI suggestions with it.
- One change from the Step 2 fit: a fuzzy match through the exact GL key gets closeness
  `fuzzyExactKey` 0.85 instead of 1. With 1 it scored 99 while such matches were right 79% (tune) and
  92% (test) of the time; a separate factor fitted to 0.85 at no measurable cost (test AUC 0.874 either
  way) and matches Q1 (another word form is less close).
- The candidate's old point score is kept as `matchScore` and still chooses between candidates for the
  same words, triggers the fuzzy pass, and orders the options, so **the options and their order are
  unchanged**; each returned option's `confidence` is the new score. Features are now computed for every
  candidate (they were only computed for `explain`).

Harness (`npm run calibrate:algorithm`): options or their order differ from the saved results in **0**
of 26,369 cases; 21,346 differ only in confidence.

| | Tune | Test |
|---|---|---|
| Top-1 | 55.2% (unchanged) | 57.2% (unchanged) |
| AUC, all options | 0.830 → **0.909** | 0.789 → **0.874** |
| ECE top / all options | 28.1 / 37.8 → **8.1 / 3.5** | 18.4 / 24.3 → **13.4 / 8.6** |
| Brier, all options | 0.327 → **0.115** | 0.243 → **0.151** |
| At 100 / right | 9,336 / 80.0% → **3,646 / 95.0%** | 1,940 / 86.4% → **695 / 94.7%** |
| Wrong at 100 that are "another occurrence" | 481 → 3 | 60 → 0 |

Tests: 13 confidence ranges in `checkingSuggestionsUtils.test.js` updated, each with the new value and
reason (related keys now 10-60, fuzzy and partial matches 30-60); the explain test's `la iglesia` (twice
in its verse) is 60, not 100; three new tests for the 100 rule (count below 3 gives 99, a repeated
rendering 60, a competing rendering 70). In `checkingSuggestionsUtilsLlm.test.js` the custom
`algorithmCertainConfidence` test uses 50 (its related-key option now scores in the 50s), and in
`LlmRequestQueue.test.js` the algorithm-first job has one rendering (with `iglesia` too, two renderings
compete and it is not certain). `npm test`: 24 suites, 301 tests pass; `ALGORITHM_TOP1` unchanged. Doc
comments of the algorithm, `getBestSelections` and `ALGORITHM_CONFIDENCE_BANDS` updated; CLAUDE.md is
Step 7.

**For Step 4:** because the order is kept, a lower option can now show a higher confidence than the top
one. In AI mode `mergeBestSelections` sorts by confidence, so such an option would be shown first. Example
(unit test "independent of history key order", GL `the faith`, history `the law: la ley`, `faith: fe`,
verse `Por la fe Abraham ... la ley ...`): the right `fe` scores 20 (related key; `la`, a word of the
unrelated rendering `la ley`, is next to it; `la ley` is also verbatim in the verse) and the wrong 2nd
option `la ley` 29. The neighbour check counts words of every pooled rendering, including unrelated
keys'; Step 4 should measure re-ordering with and without limiting it to renderings of related keys.

The saved algorithm results in `llmTrainingData/results/` still hold the old confidences; re-run
`npm run run:llm-training-data` (algorithm) before Step 6, and note that the fine-tune exporter reads
them (Step 7).

### Step 4 (2026-11-21): order the options by the confidence

**Re-ordering.** All candidates now get `scoreSuggestionFromHistory` and are ordered by it (ties by
match score, count, words, compactness) before the top 3 are taken, so the confidences shown fall from
first to last (in AI mode `mergeBestSelections` sorts by confidence anyway).

**The neighbour check.** Re-ordering exposed a mis-ranking: when a short exact-key rendering and a longer
related-key rendering containing it are both in the verse (`foi` from `fe` and `la foi` from `la fe`;
`disciples` and `ses disciples` from `his disciples`), the longer one's first word sits next to the short
one, so the short one was marked down and the longer one ranked first. In the data the short exact-key
rendering is right about twice as often (tune 145 against 68 of 328 such cases; test 12 against 4 of
21), and three hand-written suite cases (`es-the-faith`, `fr-gl-es`, `fr-long-history`) flipped to wrong.
Four versions of the check were recorded as features and compared (each refitted on tune):

| Neighbour counted when it is a word of… | Test AUC | Test at 100 / right | Test top-1 re-ordered (of 5,152) | Tune top-1 re-ordered (of 18,959) | That situation: right first, tune / test |
|---|---|---|---|---|---|
| any history rendering (Step 3) | 0.874 | 695 / 94.7% | 3,472 | 11,693 | 155 / 11 |
| a rendering of the exact or a related key (relatedness ≥ 0.5) | 0.874 | 704 / 94.5% | 3,476 | 11,652 | 150 / 10 |
| a rendering that also holds one of the match's words | 0.872 | 714 / 94.1% | 3,481 | 11,683 | |
| **a rendering of the exact GL key** (chosen) | 0.872 | 721 / 94.2% | **3,478** | 11,606 | **179 / 16** |

"Exact GL key" matches what the check is for (the user's own selections for this GL phrase include the
neighbour), fixes the mis-ranking and the three suite cases, and is the best on test; it costs about 46
right top answers on tune against the related-key version. Refitted factors: phrase repeated in the verse
0.5 (was 0.6), exact-key neighbour 0.4 (was 0.5); the rest unchanged.

**The 100 rule.** With the narrower neighbour check, count ≥ 3 left certain answers at 94.2% (tune and
test), below the 95% target. Minimum count for 100: 3 gives 94.2% / 94.2%, 4 gives 95.0% / 94.5%, **5
gives 95.2% / 95.0%** (tune / test), 6 gives 95.4% / 94.8%. `CERTAIN_MIN_HISTORY_COUNT` is now **5**.

**Result** (harness; options or order differ from the saved results in 4,522 of 26,369 cases):

| | Tune | Test |
|---|---|---|
| Top-1 | 55.2% → **57.1%** (11,208 → 11,590) | 57.2% (3,476 → 3,478) |
| AUC, all options | 0.909 | 0.872 |
| ECE top / all options | 5.9 / 3.7 | 12.3 / 8.0 |
| Brier, all options | 0.115 | 0.152 |
| At 100 / right | 3,149 / **95.2%** | 423 / **95.0%** |

Against the original baseline (section 2) on test: AUC 0.789 → 0.872, ECE all options 24.3 → 8.0, right at
100 86.4% → 95.0% (1,940 → 423 certain answers, so more checks go to the AI), top-1 unchanged.

Tests: ranges updated for the new factors (related-key cases 25-60; `la iglesia` twice in a verse 50);
the 100-rule test uses 4 uses (99); `ALGORITHM_TOP1` stays `{ hand: 25, real: 9 }` (the three hand cases
that flipped with the any-rendering check are right again). `npm test`: 24 suites, 301 tests pass. The
features `neighbourInHistory`, `neighbourInRelatedHistory` and `neighbourExtendsRendering` stay in
`explain` for later analysis; the score uses `neighbourInExactKeyHistory`.

### Step 5 (2026-11-21): fuzzy matches

**Their confidence** was already set in Step 3 by the Q1 score: closeness (words found / rendering
words)^1.5, × `fuzzyExactKey` 0.85 through the exact GL key, × the related-key weight otherwise; mean word
similarity is not used (it did not predict whether a fuzzy match was right). By band (mean confidence /
right):

| Fuzzy options | Tune (4,427) | Test (1,732) |
|---|---|---|
| 80-89 | 85 / 82% | 85 / 92% |
| 40-59 | 53 / 59% | 52 / 69% |
| 20-39 | 31 / 19% | 33 / 51% |
| 1-19 | 10 / 4% | 10 / 18% |

Ordered on both splits; close on tune, 7-18 points under-confident on test (the project differences of
2.5).

**When the fuzzy pass runs.** It ran only when no candidate's old match score was above 80. A new option,
`fuzzyPassBelow` (and `LLM_ALGO_OPTIONS` in the harness, passed as the job's `algorithmOptions`), runs it
when no candidate's confidence reaches a cutoff instead:

| Fuzzy pass runs when… | Tune top-1 | Test top-1 | Test AUC | Test ECE all | Harness time |
|---|---|---|---|---|---|
| no match score above 80 (old) | 11,590 | 3,478 | 0.872 | 8.0 | 12 s |
| **no confidence reaches 50** | **11,625** | **3,487** | 0.871 | 7.8 | 15 s |
| … 70 / 90 / 100 | 11,625 | 3,487 | 0.869-0.868 | 7.5-7.1 | |
| always | 11,625 | 3,487 | 0.867 | 6.9 | 22 s |

Every confidence cutoff finds the same extra right top answers (+35 tune, +9 test); higher ones only add
low-ranked fuzzy options. **`FUZZY_PASS_BELOW_CONFIDENCE` = 50** is the default; at 100 nothing changes
(3,149 / 95.2% tune, 423 / 95.0% test). About 0.1 ms more per check. Doc comments updated (the match score
now only chooses between candidates for the same words and breaks ties).

**Result after Step 5** (harness): top-1 tune 57.3% (11,625), test **57.4%** (3,487, from 3,476 at the
start); test AUC 0.871, ECE top / all 12.1 / 7.8, Brier 0.152, at 100 423 / 95.0%. `npm test`: 24 suites,
301 tests pass; `ALGORITHM_TOP1` unchanged.
