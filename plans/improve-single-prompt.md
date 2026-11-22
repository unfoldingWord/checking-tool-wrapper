# Plan: improve the single-request AI prompt for small models (GGUF only)

Written 2026-11-22 against commit `13c4774` on branch `feature-mcleanb-add-suggestions-support`.
**Line numbers are for `13c4774`.** If `src/utils/checkingSuggestionsUtils.js` has changed, find
each function by name.

Goal: find changes to the prompt the app sends for **one request per query** (`llmGrouping` 1,
the default) that make **small models** pick the words a translator would select more often,
with confidences that can be trusted. The batched prompt (`LLM_BATCH_BASE_SYSTEM_PROMPT` +
`LLM_BATCH_SYSTEM_PROMPT`) is out of scope and must not change.

Questions this plan answers with measurements, not opinion:
1. Would more data in the request help (GL verse, history marked as found in the verse, the
   algorithm's candidates, the translationWords term)?
2. Should the instructions be shorter, or more detailed?
3. Does it help to drop the system prompt and put everything in the user message, or to give the
   examples as earlier chat turns?
4. With **no selection history**, what prompt works best?

Testing uses **GGUF models only, served by plain llama.cpp (`llama-server`)**. GGUF runs on Mac,
Windows and Linux; plain `llama-server` matched the transformers reference on 538 of 543 answers,
while LM Studio's bundled llama.cpp engine on the Mac did not (`plans/fine-tune-qwen3.md`, results
of 2026-11-18, "Which engine is right").

## 1. What we already know

**The current single prompt** (`buildLlmSystemPrompt`, `checkingSuggestionsUtils.js:851`, with
`LLM_PREVIOUS_TRANSLATION_RULE_SINGLE` at `:818` and `LLM_INFLECTED_FORM_EXAMPLE` at `:828`;
assembled as `LLM_SINGLE_SYSTEM_PROMPT` at `:899`): a fixed system prompt of about 600 tokens
(intro, field list, 8 rules, 2 worked examples, a "wrong answers" list), then a user message built
by `buildTranslationOptionsPrompt` (`:919`):

```
TARGET VERSE (<lang>): <verse words>

PREVIOUS TRANSLATIONS:            <- left out when there is no history
"<rendering>" (chosen N times for "<GL key>")
...

GATEWAY PHRASE (<lang>): <phrase>

Answer:
```

`queryAiAPI` (`:362`) puts `/no_think\n` at the start of the system prompt and of the user message
(`applyThinkingDirective`, `:295`). The history lines come from `formatPreviousTranslations`
(`:707`): renderings found in the verse first, at most 10 (`MAX_PROMPT_PREVIOUS_TRANSLATIONS`,
`:23`), or at most 5 (`MAX_PROMPT_UNMATCHED_TRANSLATIONS`, `:25`) when none fits the verse.

**Earlier prompt experiments** (`plans/improve-llm-suggestions.md`, Step 7 and section 9): seven
wording variants (P1-P7) were measured on the 53-55-case suitability suite with 3 runs. Most
differences were 1-2 cases, which that suite cannot tell from noise. Adopted for single requests:
P3b (the "copy exactly those words" rule 3) and P5 (Example 2, the inflected form). Rejected:
P1, P2, P3, P6 (made-up-language examples), P7. Not tried: anything other than rewording the
system prompt (structure, extra data, no-history handling). Section 8 there left out "sending
more context" because "no measured case needed it"; this plan measures it.

Weaknesses found then that a prompt could still address (numbering from that plan):
- **W3**: small models answer with the history's spelling instead of the verse's word form.
- **W4**: span boundaries: small words added or dropped.
- **W5**: confidence not calibrated (e.g. `"la casa",60` when nothing fits).
- **W10**: the example answer leaks into answers, worst with **no history** (`es-no-history`
  answered with the example's `"la iglesia",98`).

**The fine-tuned models are tied to this prompt.** `uw-tw-qwen3-1.7b-d3` (68% held-out top-1)
and its 0.6B companion were trained on the exact messages the app sends
(`npm run build:finetune-data`, parity test at `__tests__/buildFineTuneData.test.js:156`). Any
change to the single prompt changes their input, so it can lower their accuracy until they are
retrained (about 2.8 hours for the 1.7B on the Mac). This plan therefore screens on **stock**
models and treats retraining as a separate, later step (Step 7).

**No-history cases are not in the training data.** The builder drops a check whose history is
empty (`__tests__/buildLlmTrainingData.test.js:168-172`), so all 26,369 cases in
`llmTrainingData/*.json` have history, and the fine-tune never saw a request without
`PREVIOUS TRANSLATIONS`. The suite has 10 no-history cases (5 hand-written, 5 real). In the app a
no-history request is the first check of a group in a project with no history in other projects.
The algorithm needs history, so for these the AI's answer is all the user gets (confirm in Step 0).

## 2. Hypotheses

Small models (0.6B-1.7B, thinking off) do one forward pass per token with no scratch space. What
tends to help them, and what each variant below tests:

- **Do the matching for them.** The hardest parts of the task are string work: is a previous
  translation in the verse, and in what form? Code already knows this (`verseFit` in
  `formatPreviousTranslations`, `wordSimilarity`). Saying it in the input ("found in verse",
  "verse has: Gläubigen") turns a search into a copy. Targets W3 and W4. *Expected to help most.*
- **Turn writing into choosing.** Give the algorithm's candidate spans (the AI only sees cases
  where the algorithm is below 95). Risk: the model anchors on a wrong candidate.
- **Context for meaning.** The GL verse shows where the phrase sits in its sentence. It matters
  most without history, where the model must align by meaning. Costs about 30-60 tokens per
  request.
- **Shorter rules, or one procedure.** Eight rules with priorities that pull against each other
  (rule 2 "fewest words" vs rule 3 "copy exactly") may be harder for a small model than either
  (a) fewer rules, or (b) one ordered procedure ("first look for ..., if none ..."). Test both
  directions; neither is assumed.
- **Examples as chat turns.** Worked examples written as earlier user/assistant turns match the
  real input exactly and end where the model's answer starts. That may copy the format better and
  leak less example text (W10) than examples inside the system prompt.
- **System prompt merged into the user message.** Qwen3 is trained mostly with a short or empty
  system prompt; small models may weigh the user turn more. The server's prompt cache still works
  when the fixed text comes first in the user message. *Unclear; measure it.*
- **No history.** Today the PREVIOUS TRANSLATIONS block just disappears, every example has
  history, and rules 3 and 5 talk about previous translations. The model has no example of the
  no-history case, so it copies the example. An explicit "none", a no-history example, a lower
  confidence ceiling without history, and the GL verse should each help.

## 3. Decisions

- **D1. Engine and models.** Plain `llama-server` (Homebrew, record `llama-server --version`),
  one slot (`-np 1`), `-c 8192`, `--jinja`, on `http://localhost:8080` (keep 1234 for LM
  Studio). Models, all GGUF, every build's file name and sha256 recorded in the results:
  - **Primary: stock Qwen3-1.7B, Q8_0.** The fine-tune's base and the model a prompt change must
    help.
  - **Stock Qwen3-0.6B, Q8_0.** The low-memory end.
  - **Stock Qwen3-4B-Instruct-2507, Q8_0 (or Q4_K_M if memory needs it).** Reference only: a
    change must not hurt it much.
  - **Fine-tunes D3 1.7B Q5_K_M and 0.6B Q6_K** (the released builds): only in Step 6 (to measure
    what a change costs them before retraining) and Step 7.
  Build the stock GGUFs from the Hugging Face weights with the steps in `llmTraining/README.md`
  (bf16 convert, then `llama-quantize`), as was done for stock 1.7B on 2026-11-18, so stock and
  fine-tune builds come from the same converter.
- **D2. Sampling.** Temperature 0.1 (the app's default) with `{"seed":42}` in the extra params,
  so a rerun gives the same answers and two variants can be compared case by case. Confirm the
  winner at the app's settings without a seed, 2 runs (Step 8).
- **D3. Data sets.** Stock models never trained on any project, so every training case is a fair
  test for them. Split to avoid tuning the prompt to the cases it is scored on:
  - **DEV** (screening, Steps 3-5): a fixed random sample of the cases the app sends to the AI
    (algorithm top confidence below 95), from the projects that are **not** D3's test projects,
    about 1,500 cases, stratified by target language so no language passes 25%. Seed and case IDs
    saved in `llmTrainingData/promptEval/dev.json`.
  - **DEV-NOHIST**: the DEV cases with `history` set to `{}`, about 750 (half of DEV, same seed).
  - **TEST** (confirmation only, Step 8): D3's 9 held-out test files (`testFiles` in
    `llmTrainingData/finetune-d3/manifest.json`), all cases sent to the AI, plus the same cases
    without history (**TEST-NOHIST**). TEST is the only set where stock models and fine-tunes can
    be compared fairly. Do not look at TEST results until Step 8.
  - The suitability suite (`scripts/test-llm.sh -g 1`) as a smoke check for format and the
    hand-written traps, not for adoption.
- **D4. Scoring.** As the app shows it, through `getBestSelections` (falling back to the
  algorithm when the AI gives nothing), with the per-band table the runner already prints. Report
  for each run: top-1, top-3, wrong at confidence ≥ 80, empty answers, CSV format share, prompt
  tokens (fixed part and per request), median ms. On the no-history sets also the mean confidence
  of right and of wrong answers.
- **D5. Adoption rule.** A variant beats its parent when, on the primary model:
  - top-1 is higher with McNemar p < 0.05 on DEV, or on DEV-NOHIST for a no-history variant;
  - wrong at ≥ 80 is not higher by more than 1% of cases;
  - the other set (DEV or DEV-NOHIST) is not significantly worse (p < 0.05);
  - on 0.6B and 4B, top-1 is not significantly worse.
  Variants that tie are kept only if they make the prompt shorter. Every variant gets a row in the
  results, adopted or not.
- **D6. Experiments do not touch the app's prompt.** Variants live in a test helper and reach the
  real code path through one override hook (Step 1). The app's prompt changes once, in Step 9,
  with the adopted variant.
- **D7. Batched prompt unchanged.** Nothing here changes the `forBatch` path or the batch
  constants; the existing batch tests must keep passing untouched.

## 4. Steps

### Step 0. Check the starting point (OFFLINE)

`git log -1` shows `13c4774` or later; `npm test` passes; the function names above exist. Confirm
that `getBestTWordSelectionWithConfidenceAlgorithm` returns no option when the history is `{}`
(a unit test call is enough), so DEV-NOHIST is scored on the AI alone.

**Done when:** `npm test` passes and the no-history algorithm result is written down here.

### Step 1. Prompt variant hook and runner settings (OFFLINE, small `src` change)

1. In `checkingSuggestionsUtils.js`, export `setSinglePromptOverrideForEval(builder)` (`null`
   clears it). When set, `getBestTWordSelectionWithConfidenceFromLlm` (`:2734`) calls
   `builder(request)` for a **single** request instead of `buildTranslationOptionsPrompt`, and
   sends the `messages` it returns. Batches ignore it.
2. Let `queryAiAPI` and `streamChatMessage` take an optional `messages` array that replaces the
   system + user pair (thinking directive still applied: to the first system message if there is
   one, else to the first user message). Make `installNodeAiApis`
   (`__tests__/helpers/suggestionsHelpers.js`) pass it through. Without `messages` nothing changes.
3. `__tests__/helpers/promptVariants.js`: a map of variant id → builder. `baseline` must produce
   exactly today's messages; a unit test checks that against `buildTranslationOptionsPrompt` +
   `applyThinkingDirective`.
4. `runLlmTrainingData.test.js` and `llmModelSuitability.test.js`: read `LLM_PROMPT_VARIANT`
   (default `baseline`), install the override, and put the variant id in the result file names.
   Add `LLM_TRAINING_CASE_IDS` (a JSON file of case IDs) and `LLM_TRAINING_STRIP_HISTORY=1` to
   the runner for DEV / DEV-NOHIST.
5. A script `scripts/compare-prompt-variants.js A B` reading two runs' `results.json`: paired
   counts (A-only right / B-only right), McNemar p, and the D4 metrics for both. (The fine-tune
   plan's comparisons used `llmTraining/compare/`; reuse its McNemar code if it fits.)

**Done when:** `npm test` passes, with the new baseline parity test, and a run with
`LLM_PROMPT_VARIANT=baseline` sends byte-identical requests to a run without it (compare the
logged bodies of 5 cases).

### Step 2. Build the data sets and the baseline (OFFLINE, then LIVE)

1. Write `llmTrainingData/promptEval/dev.json` and `test.json` per D3 (a small script, seeded).
   They are case IDs only.
2. Run the algorithm on all files first if `results/` is stale (`npm run run:llm-training-data`).
3. Start `llama-server` per D1 with the stock 1.7B; run `baseline` on DEV, DEV-NOHIST and the
   suite. Repeat for 0.6B and 4B. Run DEV twice on 1.7B to confirm D2's seed makes it repeatable
   (expect 0 differing answers; if not, note the count and use it as the noise floor).

**Done when:** the baseline rows for all three models are in section 7, with prompt token counts.

### Step 3. Extra data in the request (LIVE, DEV)

Each variant starts from `baseline` and adds one thing. Run on 1.7B first; run 0.6B and 4B only for
variants that pass on 1.7B.

- **X1. History marked against the verse.** Each history line ends with what code found:
  `"iglesia" (chosen 7 times for "church") - in verse` or
  `"Glaube" (chosen 5 times for "faith") - verse has "Gläubigen"` (the verse word found by
  `wordSimilarity`) or `- not in verse`. Rules 3 and 5 and the examples are updated to use these
  marks. Targets W3/W4.
- **X2. Lines not in the verse left out** when at least one line is in the verse (today they come
  last but are still sent). Combine with X1 if both help.
- **X3. GL verse.** A line `GATEWAY VERSE (<lang>): <GL verse, with the phrase in [brackets]>`
  before GATEWAY PHRASE. The runner needs the GL verse per case: add `glVerse` to the cases in
  `buildLlmTrainingData.test.js` (it already loads `glBook`, `:133`) and rebuild the files, or
  load it in the runner from `~/translationCore/resources/<gl>/bibles/<glBibleName>` using the
  `source` field. Prefer the builder (one place). In the app, `Container.js` has `glBibles` and
  `contextId` where it builds each job (`:320-345`), so the job can carry `glVerseText`.
- **X4. Algorithm candidates.** A block `POSSIBLE ANSWERS:` listing the algorithm's options (up to
  3, text only, no confidence), with a rule that the answer may be one of them or other verse
  words. `getBestSelections` already computes them before the AI call (`getAlgorithmResultForJob`).
  Left out when the algorithm has none.
- **X5. Occurrence.** When the check's `contextId.occurrence` > 1 and a candidate word repeats in
  the verse, add `OCCURRENCE: 2` with a one-line rule. Small; only if DEV has enough such cases
  (count first; skip if under 30).
- **X6. translationWords term.** `TERM: <groupId>` (e.g. `bear`, `holyplace`), the tW article id.
  Cheap; may help meaning when the GL phrase is an inflected or idiomatic form.

Not tested, with reasons: the original-language quote (Greek/Hebrew script, which 0.6-1.7B models
read poorly, and the GL verse carries the same position information); the full tW article text
(hundreds of tokens per request); numbering verse words (`word:position`), which invites
numbers in the answer, and the parser matches words.

**Done when:** each of X1-X6 has a row, adopted ones are combined into one variant `X*`, and
`X*` passes D5 against `baseline`.

### Step 4. Instruction length and structure (LIVE, DEV)

Start from `X*` (or `baseline` if nothing in Step 3 was adopted).

- **S1. Short.** Intro, one line per field, 4 rules (copy verse words only; prefer a marked
  previous translation; format; confidence bands), Example 1 only, no "wrong answers" list.
  Expect around half the tokens.
- **S2. Procedure.** Replace the rules with numbered steps the model follows in order: "1. If a
  previous translation is marked `in verse`, answer it ... 2. Else if one is marked `verse has`,
  answer that verse word ... 3. Else choose the fewest verse words that mean GATEWAY PHRASE ...
  4. If none fit, answer `"",0`", each step with its confidence range. Same examples.
- **S3. Merged.** No system message: the whole fixed text, then the request, in one user
  message. `/no_think` goes at the start of the user message only. In translationCore
  (`electronite/queryAiApisFromMainProcess.js:207`) an empty `systemPrompt` already sends no system
  message, but `applyThinkingDirective` would turn `''` into `'/no_think\n'`: the hook in Step 1
  handles that; Step 9 must too if S3 is adopted.
- **S4. Examples as chat turns.** System prompt with the rules only; each example as a user turn
  (exactly the request layout) and an assistant turn (the answer rows); then the real request.
  Needs `messages` support in translationCore's main process if adopted (Step 9, Q3).
- **S5. Reminder at the end.** Keep the system prompt; end the user message with one line before
  `Answer:` repeating the most-broken rule (e.g. `Copy words exactly as in TARGET VERSE.`).
  Cheap, cache-safe (the request part is not cached anyway).
- **S6. Field order.** GATEWAY PHRASE first, then TARGET VERSE, then the history, so the evidence
  sits right before `Answer:`. Examples reordered to match.

Run S1-S6 each against the current best; combine the adopted ones and check the combination
once more (D5).

**Done when:** each of S1-S6 has a row, and the best combination is named `S*`.

### Step 5. No history (LIVE, DEV-NOHIST)

Start from `S*`. These change only what is sent when the history is empty (except N2, which adds
an example every request sees), so DEV must not change except for N2: check that.

- **N1. Explicit none.** `PREVIOUS TRANSLATIONS: none` instead of leaving the block out, so the
  layout matches the examples.
- **N2. A no-history example.** A third worked example with no history whose answer is a meaning
  match at confidence 60-70, in a language other than the examples' (to test W10, check the
  answers do not repeat its words). Costs tokens on every request, so it must pass D5 on DEV too.
- **N3. A separate no-history system prompt.** Rules that do not mention previous translations,
  examples without history, a confidence ceiling of 70. A second fixed prompt, so it caches too.
  Compare N3 against N1+N2.
- **N4. GL verse only without history.** If X3 was not adopted for all requests (its token cost),
  test it for no-history requests only, where it should help most.
- **N5. Confidence cap in code.** Not a prompt change: cap AI confidence without history at 70
  (or the value where DEV-NOHIST answers are right half the time) so a guess is not shown at 90.
  Measure the right/wrong confidence split first; adopt only if wrong-at-≥80 drops without
  changing top-1.
- **N6. Unrelated history treated like none.** When no history line fits the verse
  (`noRelatedWordInHistory` cases: today up to 5 unrelated lines are sent), send the no-history
  form instead. Measure on the DEV cases with that tag
  (`npm run check:llm-training-data` lists them).

**Done when:** each of N1-N6 has a row and the adopted ones are combined into the final variant
`F`, which passes D5 against `baseline` on both DEV and DEV-NOHIST.

### Step 6. Cost to the released fine-tunes (LIVE, TEST)

Run `baseline` and `F` on D3 1.7B Q5_K_M and the 0.6B Q6_K, on TEST and TEST-NOHIST. This shows
what switching the app's prompt would cost users of the released models before retraining, and how
the fine-tunes do without history (never trained).

**Done when:** four rows per fine-tune are in section 7.

### Step 7. Retrain on the new prompt (OFFLINE build, MLX training, LIVE GGUF scoring)

Only if `F` is adopted and Step 6 shows a loss for the fine-tunes (or Q1 says to retrain anyway).

1. Put `F` into the app (Step 9 first, on a branch) so `npm run build:finetune-data` produces the
   new prompt; the parity test proves the match.
2. Decide with the author (Q4) whether to add no-history training examples: the existing cases
   with history removed and the expected answer labelled at the no-history confidence, about 10%
   of the training set.
3. Train with `llmTraining/lora-r16-d3.yaml` (new data dir), fuse, convert to GGUF Q5_K_M
   (`llmTraining/README.md`), score on TEST and TEST-NOHIST with `llama-server`.

**Done when:** the retrained model is at or above D3 on TEST (McNemar not significantly worse)
and better on TEST-NOHIST, or the result is recorded as "not worth retraining".

### Step 8. Confirm (LIVE, TEST)

On the stock 1.7B, 0.6B and 4B: `baseline` and `F` on TEST and TEST-NOHIST, at the app's settings
without a seed, 2 runs pooled; plus the suite with `scripts/test-llm.sh -r 3 -g 1 -u
http://localhost:8080`. This is the first look at TEST.

**Done when:** `F` is not worse than `baseline` on TEST for 1.7B (if it is, the DEV gain was
tuning to DEV: report it and stop), and the rows are in section 7.

### Step 9. Put the result in the app (OFFLINE)

1. Move the adopted variant from `promptVariants.js` into `buildLlmSystemPrompt` /
   `buildTranslationOptionsPrompt` for the single path only; batch constants untouched (D7).
2. If X3 or N4 is adopted: carry `glVerseText` in the job from `Container.js` to the request.
3. If S3 or S4 is adopted: the change crosses into translationCore
   (`electronite/queryAiApisFromMainProcess.js`, and `preloadAiApi.js` if a `messages` option is
   added); write down the exact change for the author rather than making it here.
4. Keep `setSinglePromptOverrideForEval` (it is useful for the next round) but document it as
   eval-only.
5. Update the tests that assert prompt text, the fine-tune parity test, `CLAUDE.md` (the prompt
   description in "Auto-select suggestions"), and the comment above `LLM_SINGLE_SYSTEM_PROMPT`.

**Done when:** `npm test` passes, the batch tests are unchanged, and `baseline` in
`promptVariants.js` is renamed `v1` so old runs stay reproducible.

## 5. Risks

- **Tuning to DEV.** Many variants on one set will find some that win by chance. D3's split and
  the single look at TEST guard against it; with about 1,500 cases, a real gain of 2 points is
  usually detectable, 1 point is not.
- **A prompt that helps stock models can hurt the fine-tune**, which learned the old prompt.
  Step 6 measures this before anything ships; Q2 asks whether the app should pick the prompt by
  model.
- **Expected answers are alignments, not selections** (`plans/fine-tune-qwen3.md`, Risks), so a
  variant that prefers shorter spans may look worse than it is. Hand-check 30 disagreements of
  the final variant.
- **X4 can make the AI only as good as the algorithm**, by anchoring. The "no algorithm answer"
  and 1-59 bands show it: they must not drop.
- **Extra data costs time on every request**. Report prompt tokens and median ms; a variant that
  adds more than 30% to the median time needs a clear top-1 gain.
- **llama.cpp versions differ** between the Mac test and users' Windows/Linux servers; record the
  version, and recheck the final variant on another build if one is available.

## 6. Open questions for the author

- **Q1. Which models is this for?** The released fine-tune is the recommended model, and it
  learned today's prompt. Options: (a) improve the prompt for stock models and retrain the
  fine-tunes on it (Step 7); (b) improve it for stock models only and keep today's prompt for the
  fine-tunes (Q2); (c) only adopt changes that do not hurt the fine-tunes without retraining.
  The plan assumes (a).
  - Answer: improve for fine-tuned models
- **Q2. Prompt chosen by model?** If (b): should the app keep two single prompts and pick by
  model name (`uw-tw-*` → v1)? It is simple but ties code to model names.
  - Answer: no
- **Q3. translationCore changes.** S3 (no system message) works with translationCore as is if
  the thinking directive is handled here; S4 (examples as chat turns) needs translationCore to
  accept a `messages` array. Is a translationCore change acceptable if S4 wins?
  - Answer: i need more clarity on this questions

- **Q4. No-history training data.** Should Step 7 train on cases with the history removed, so
  the fine-tune learns the no-history case? It makes the training set larger (about 10%) and the
  expected answer is often harder to find without history.
  - Answer: yes

- **Q5. Stock GGUF builds.** Convert the stock models ourselves (same converter as the fine-tune,
  as D1 says) or use the publishers' GGUF files (what users would download)? Converting is the
  fairer comparison; the publishers' files are what stock users run.
  - Answer: convert

- **Q6. Aligned verses.** When the target verse is already aligned in translationCore's word
  alignment tool, the aligned words answer the check directly (the training data is built that
  way). Is using alignment data for suggestions wanted? It is outside this plan, but would make
  the no-history case moot for aligned projects.
  - Answer: yes, but move this to a later plan


## 7. Results

(Rows go here: variant, model, set, cases, top-1, top-3, wrong ≥ 80, empty, CSV %, fixed / per-request
tokens, median ms, paired vs parent (A-only / B-only, p), decision.)
