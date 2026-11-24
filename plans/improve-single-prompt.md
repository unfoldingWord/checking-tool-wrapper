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

### Revised after the author's answers (2026-11-22): the fine-tunes are the target

The answers in section 6 change what success means. Where this section and a later one disagree,
this section wins.
- **The fine-tuned models are the target (Q1).** The goal is a better `uw-tw-qwen3-1.7b` (and the
  0.6B companion) retrained on the new prompt. Stock models are a **cheap screen**: one run on
  DEV takes minutes, a retrain takes hours. Their scores only shortlist variants.
- **One prompt for every model (Q2).** No prompt chosen by model name. So the prompt that ships
  must still be acceptable for stock models: D5's "not significantly worse on stock 1.7B, 0.6B and
  4B" stays as a guard, not as the goal.
- **What a fine-tune can gain from a prompt change.** A fine-tune learns the task and the answer
  format from about 10,000 examples, so rewording the rules (S1, S2, S5, S6) should matter little
  to its accuracy. What can help it is **information it does not have today**: X1-X6 and the
  no-history handling (N1, N3, N4). One instruction change can still matter for **speed**: a
  fine-tune may not need the 600-token system prompt at all, so S1 (short) is retrained to see
  whether a much shorter prompt keeps the accuracy (fewer tokens per request, less time).
- **No-history examples go into training (Q4)**, in every retrain of Step 7, including the
  control run R0, so a comparison measures the prompt, not the extra data.
- **Stock GGUFs are converted here (Q5)**, as D1 says.
- **S4 (examples as chat turns) stays in (Q3, author 2026-11-22)**, and translationCore gets a
  `messages` option now (Step 1A), since sending any list of messages is useful for experiments.
  S4 is also a candidate for a retrain (R3) if it does well on stock 1.7B.
- **Aligned verses (Q6) move to a later plan.**

The order becomes: Steps 0, 1, 1A (translationCore) and 2 as written; Steps 3-5 on stock 1.7B only (0.6B and 4B only for the
shortlist, as the guard); then Step 7 retrains up to 4 candidates; then Steps 6, 8 and 9.

Testing uses **GGUF models only, served by plain llama.cpp (`llama-server`)**. GGUF runs on Mac,
Windows and Linux; plain `llama-server` matched the transformers reference on 538 of 543 answers,
while LM Studio's bundled llama.cpp engine on the Mac did not (`plans/fine-tune-qwen3.md`, results
of 2026-11-18, "Which engine is right"). LM Studio was considered and set aside for that reason
(author, 2026-11-22).

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

- **D1. Engine and models.** Plain `llama-server` (Homebrew; `version: 1.0.0 (build 12359,
  commit b1b770d90)` on 2026-11-22, the build that matched the reference in the fine-tune plan;
  record `llama-server --version` with every run), one slot (`-np 1`), `-c 8192`, `--jinja`, on
  `http://localhost:8080`, one model per server, e.g.
  `llama-server -m <file>.gguf -np 1 -c 8192 --jinja --port 8080`. Keep port 1234 for LM Studio,
  and quit LM Studio's server (or unload its models) during runs so the two do not share the GPU.
  Models, all GGUF, every build's file name and sha256 recorded in the results:
  - **Primary: stock Qwen3-1.7B, Q8_0.** The fine-tune's base and the model a prompt change must
    help.
  - **Stock Qwen3-0.6B, Q8_0.** The low-memory end.
  - **Stock Qwen3-4B-Instruct-2507, Q8_0 (or Q4_K_M if memory needs it).** Reference only: a
    change must not hurt it much.
  - **Fine-tunes D3 1.7B Q5_K_M and 0.6B Q6_K** (the released builds): only in Step 6 (to measure
    what a change costs them before retraining) and Step 7.
  Build the stock GGUFs from the Hugging Face weights with the steps in `llmTraining/README.md`
  (bf16 convert, then `llama-quantize`), as was done for stock 1.7B on 2026-11-18, so stock and
  fine-tune builds come from the same converter (Q5). **On 2026-11-22 no stock Qwen3 GGUF is on
  disk** (LM Studio's `qwen3-1.7b-stock`, `qwen3-0.6b-stock` and `qwen/qwen3-4b-2507` are MLX), so
  all three must be converted; put them in `llmTraining/outputs/<model>-stock-GGUF/`. The
  released fine-tunes are already built: `llmTraining/outputs/release/uw-tw-qwen3-1.7b-GGUF/uw-tw-qwen3-1.7b-Q5_K_M.gguf`
  and `llmTraining/outputs/release/uw-tw-qwen3-0.6b-GGUF/uw-tw-qwen3-0.6b-Q6_K.gguf`.
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

**Done 2026-11-22** at `a6f2928`: `npm test` passed (301 tests). With `history: {}` the
algorithm gives no option for any of the 25 real suite cases, so every no-history case is
answered by the AI alone. This is now a test in `__tests__/promptVariants.test.js`.

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

**Done 2026-11-22.** What was built:
- `checkingSuggestionsUtils.js`: `setSinglePromptOverrideForEval(builder)`, used only for single
  requests and throwing on invalid messages. `queryAiAPI` and `streamChatMessage` take
  `options.messages`, with these new exported helpers: `getValidChatMessages`,
  `applyThinkingDirectiveToMessages` (`/no_think` goes on the first system message and the
  last user message), `chatMessagesToSystemAndQuery` (fallback for an older translationCore) and
  `buildChatMessages`. `getBestSelections` adds `contextId` and `algorithmBestSelections` to
  each AI request. The app's prompt does not use them; they are for the variants.
- `__tests__/helpers/promptVariants.js`: `PROMPT_VARIANTS` (only `baseline` so far),
  `installPromptVariant`, `getPromptVariantFromEnv`.
- `LLM_PROMPT_VARIANT` in `runLlmTrainingData.test.js` (result files get `_prompt-<id>` after
  the model name, through the new `settings.runLabel`) and in `llmModelSuitability.test.js`
  (single requests only; `scripts/test-llm.sh` passes it through from the environment).
- `installNodeAiApis` and the suite's bridge now build messages as translationCore does:
  `options.messages` when valid, otherwise no system message for an empty system prompt. They
  also declare `features: { messages: true }`.
- `scripts/compare-prompt-variants.js CASES A.results B.results`: the D4 metrics it can get
  from the result files, plus paired counts and exact McNemar. CSV format share and token counts
  are not in the result files; use the suite for those.
- `__tests__/promptVariants.test.js` (23 tests): the helpers, both `features` cases, the
  comparison script, and **baseline parity**: on the 25 real suite cases, `baseline` sends
  byte-identical request bodies to the app's own prompt over HTTP.

Changed from the step as written: items 4's `LLM_TRAINING_CASE_IDS` and
`LLM_TRAINING_STRIP_HISTORY` were not added. Step 2.1 writes the DEV, DEV-NOHIST, TEST and
TEST-NOHIST cases as ordinary case files, and the runner already runs any case file
(`LLM_TRAINING_DATA_DIR=llmTrainingData/promptEval LLM_TRAINING_FILES=dev`).

**Found: `/no_think` is missing from the user message through translationCore (Q7).**
`queryAiAPI` gives `window.AiAPIs.query` the raw `query` as its first argument, and
translationCore's main process sends that argument as the user message. So in the app, and in
every earlier eval that went through `installNodeAiApis` or the suite's bridge, the user message
has **no** `/no_think`; only the system message has it. The direct HTTP path
(`streamChatMessage`) and the fine-tune training data (`applyThinkingDirective`) put it in both.
This step left the no-`messages` path as it was. A variant goes through `messages`, so it gets
`/no_think` in the user message like the training data. So through the bridge, a `baseline`
**run** differs from a run with no variant by that one line. Answer Q7 before recording the
Step 2 baselines.

### Step 1A. `messages` option in translationCore (OFFLINE, `../translationCore`)

On translationCore's branch `feature-mcleanb-add-suggestions-support` (checked 2026-11-22 at
`6800ef66d`; it has uncommitted changes to `package.json`, `package-lock.json` and the
`src/tC_apps/translationWords` submodule, which this step must not touch or commit).

1. `electronite/queryAiApisFromMainProcess.js`: `queryAiApiFromMainProcess` reads an optional
   `options.messages` and passes it to `streamChatMessageFromMainProcess`. When it is a non-empty
   array whose items are `{ role: 'system' | 'user' | 'assistant', content: string }`, the body's
   `messages` is a copy of it and `systemPrompt` / `query` are ignored; otherwise the body is
   built exactly as today. `messages` still cannot be overridden by `extraParams`. JSDoc both.
2. `electronite/preloadAiApi.js`: no change to `query` (it passes `options` through, and
   `electronite/index.js:49` hands them on). Add `features: { messages: true }` to
   `window.AiAPIs` (and `window.lmStudio`), so the checking tool can tell an old translationCore,
   which would silently ignore `messages`, from a new one.
3. A unit test, if translationCore has tests for this file; otherwise a manual check: one query
   with `messages` against `llama-server` returns an answer, and one without is unchanged.
4. In this repo, `queryAiAPI` sends `messages` through `window.AiAPIs` only when
   `AiAPIs.features?.messages` is true. Otherwise it falls back to the system + user form of the
   same prompt and logs a warning. Note that a model fine-tuned on S4 would then see a prompt it
   was not trained on, so if S4 ships, the checking tool's release notes need the minimum
   translationCore version.

**Done when:** translationCore's lint/tests pass, the manual check works, the changes are left
uncommitted for the author to review, and this repo's tests cover both `features` cases with
`window.AiAPIs` mocked.

**Done 2026-11-22**, uncommitted in `../translationCore` (only `electronite/` was changed; the
author's own `package.json`, lock file and submodule changes were not touched):
`getValidChatMessages` and the `messages` option in `queryAiApisFromMainProcess.js`, and
`features: { messages: true }` (frozen) on `window.AiAPIs` and `window.lmStudio` in
`preloadAiApi.js`. translationCore's `npm test` and lint cover only `src/`, so the check was
manual. A Node script called `queryAiApiFromMainProcess` against a local HTTP server that
recorded the request bodies and passed four checks: valid chat turns are sent as given (extra
fields removed); without `messages` the body is unchanged; an invalid list falls back to
`systemPrompt` + query; and `extraParams.messages` cannot override them.

### Step 2. Build the data sets and the baseline (OFFLINE, then LIVE)

1. Write `llmTrainingData/promptEval/dev.json` and `test.json` per D3 (a small script, seeded).
   They are case IDs only.
2. Run the algorithm on all files first if `results/` is stale (`npm run run:llm-training-data`).

**Items 1-2 done 2026-11-22** (at `a6f2928` plus the uncommitted Step 1 changes). Changed from
item 1: the sets are full case files, not case IDs, so the runner runs them as they are.
`npm run build:prompt-eval-cases` (`__tests__/buildPromptEvalCases.test.js`, helpers in
`__tests__/helpers/promptEvalCases.js`, seed 20261122) writes `dev.json`, `dev-nohist.json`,
`test.json` and `test-nohist.json` in `llmTrainingData/promptEval/`, with
`meta/manifest.json` (in a subfolder, because the runner runs every `.json` in the folder). Case
ids are `<file>/<id>`, plus `#nohist` in the no-history sets, because the same check appears in
several files (one per GL). A second build gave byte-identical files.
- **DEV:** 1,500 cases from 25,534 candidates outside the test projects. 2,073 were examined;
  the algorithm was certain about 573 of them (left out). Three languages hit the 25% cap: `ar`,
  `vi` and `ru` 375 each, then `te` 176, `fa` 113, `bn` 37, `id` 29, `es-419` 20. By GL: `en`
  1,171, `ar` 178, `ru` 128, `es-419` 23.
- **DEV-NOHIST:** the first 750 of DEV, history removed.
- **TEST:** all 835 cases of the 9 test files, the same count as Step 6 (b) of the fine-tune
  plan. **TEST-NOHIST:** the same 835 with no history.
- Algorithm (`LLM_TRAINING_DATA_DIR=llmTrainingData/promptEval npm run run:llm-training-data`,
  saved in `llmTrainingData/promptEval/results/`): DEV top-1 41%, top-3 49%, no option 16%; TEST
  top-1 54% (the fine-tune plan had 53.5% before the algorithm calibration); DEV-NOHIST and
  TEST-NOHIST no option for every case, as Step 0 found.
- The case files are not git-ignored (about 6 MB). They can be rebuilt with one command, so
  committing them is optional.
3. Start `llama-server` per D1 with the stock 1.7B; run `baseline` on DEV, DEV-NOHIST and the
   suite. Repeat for 0.6B and 4B. Run DEV twice on 1.7B to confirm D2's seed makes it repeatable
   (expect 0 differing answers; if not, note the count and use it as the noise floor).

**Done when:** the baseline rows for all three models are in section 7, with prompt token counts.

### Step 3. Extra data in the request (LIVE, DEV)

**Before Step 3 (added after the baselines):** keep each AI answer's raw text in the results, so
"AI gave no option" can be split into `"",0`, answers whose words are not in the verse, and
unparseable rows. On DEV the stock 1.7B gave no option for 389 of 1,500 cases, and X1 and X4 are
meant to change exactly that. For example, `getBestTWordSelectionWithConfidenceFromLlm` could
return the answer text as `rawAnswer` (not used by the app), and `runTestCase` could save it.
**Done 2026-11-22:** `getBestTWordSelectionWithConfidenceFromLlm` returns `rawAnswer` (the
answer text before parsing) for a single request the server answered, and `getBestSelections`
passes it through, so every `*.results.json` keeps it in `result.rawAnswer`. The app does not use
it. Tested in `__tests__/promptVariants.test.js` for a parsed answer, words not in the verse, and
`"",0`. The 1.7B and 0.6B baselines above were run before this, so their result files have no
`rawAnswer`; rerun them (about 7 and 4 minutes) before Step 3 so every variant can be compared
with a baseline that has it.

Each variant starts from `baseline` and adds one thing. Run on 1.7B first; run 0.6B and 4B only for
variants that pass on 1.7B.

- **X1. History marked against the verse.** Each history line ends with what code found:
  `"iglesia" (chosen 7 times for "church") - in verse` or
  `"Glaube" (chosen 5 times for "faith") - verse has "Gläubigen"` (the verse word found by
  `wordSimilarity`) or `- not in verse`. Rules 3 and 5 and the examples are updated to use these
  marks. Targets W3/W4.
  **X1 measured 2026-11-22 (`LLM_PROMPT_VARIANT=X1`, D1/D2 settings; logs in
  `llm-eval-results/prompt-X1-20261122/`).** Built as edits to the app's prompt
  (`X1_SYSTEM_PROMPT` in `__tests__/helpers/promptVariants.js`) and `formatPreviousTranslations(...,
  { markVerseFit: true })`. Two example changes were needed so the examples show what the code
  sends: Example 1 loses "las iglesias" (the app never sends it next to lines in the verse) and
  Example 2's rendering is "Gläubige" for "believer" (`wordSimilarity` does not link "Glaube" to
  "Gläubigen"; it does link "Gläubige", 0.94). Before the runs, on DEV a marked line holds the exact
  answer in about 850 of 1,500 cases (first line `verse has`: 200 of 299 right; first line
  `in verse`: 400 of 779). Some `verse has` marks are wrong matches of short syllables (e.g.
  Vietnamese "Thưa thầy" → "Đầy thực").

  | Model | Set | top-1 baseline → X1 | paired (baseline-only / X1-only, p) | wrong ≥ 80 | no option |
  |---|---|---|---|---|---|
  | 1.7B | DEV | 41.0% → 41.5% | 65 / 72, p 0.61 | 513 → **360** | 389 → 378 |
  | 1.7B | DEV-NOHIST | 16.4% → 17.6% | 24 / 33, p 0.29 | 273 → **202** | 225 → 165 |
  | 0.6B | DEV | 38.4% → 37.8% | 42 / 33, p 0.36 | 394 → 419 | 738 → 687 |
  | 0.6B | DEV-NOHIST | 1.1% → 1.2% | 3 / 4, p 1.0 | 78 → 91 | 663 → 648 |
  | 4B | DEV | 51.5% → 50.4% | 95 / 78, p 0.22 | 495 → **399** | 163 → 221 |
  | 4B | DEV-NOHIST | 34.0% → 34.4% | 27 / 30, p 0.79 | 367 → **296** | 76 → 88 |

  Median time unchanged (1.7B 128 → 130 ms, 4B 271 → 253 ms). How the 1.7B used the marks on DEV:
  first line `in verse` → copied it 549 of 779; first line `verse has` → gave the marked verse words
  245 of 299; nothing in the verse (first line `not in verse`) → still copied a rendering 223 of 422,
  against rule 3. Its new confidence-0 rows (12 → 93) are mostly a not-in-verse rendering given at
  0, which the parser drops: part of why confident wrong answers fell.

  **Decision: not adopted (D5).** Top-1 does not rise on any model (1.7B +7 net, 0.6B -9, 4B -17,
  none significant) and the prompt is longer. On the 1.7B the model mostly does what the marks
  say, and that is about as often right as what it did before, so the marks add little the
  model did not already work out. The one clear gain is fewer confident wrong answers on 1.7B
  and 4B (-153 and -96 on DEV), a calibration effect, and the fine-tunes are trained on
  labelled confidences anyway. Kept in `promptVariants.js` for reference; whether it is worth a
  retrain is Q8.

- **X2. Lines not in the verse left out** when at least one line is in the verse (today they come
  last but are still sent). Combine with X1 if both help. *Found while building X1 (2026-11-22):
  this is already the app's behavior. `formatPreviousTranslations` keeps only lines that fit the
  verse when any does, and sends up to 5 others only when none fits; only the system prompt's
  Example 1 shows a line not in the verse ("las iglesias"). So X2 is dropped; X1's Example 1
  leaves that line out.*
- **X3. GL verse.** A line `GATEWAY VERSE (<lang>): <GL verse, with the phrase in [brackets]>`
  before GATEWAY PHRASE. The runner needs the GL verse per case: add `glVerse` to the cases in
  `buildLlmTrainingData.test.js` (it already loads `glBook`, `:133`) and rebuild the files, or
  load it in the runner from `~/translationCore/resources/<gl>/bibles/<glBibleName>` using the
  `source` field. Prefer the builder (one place). In the app, `Container.js` has `glBibles` and
  `contextId` where it builds each job (`:320-345`), so the job can carry `glVerseText`.
  **Built 2026-11-22, on top of X4b** (the adopted Step 3 best), so it is compared with X4b on DEV
  and with the baseline on DEV-NOHIST (where X4b is the baseline).
  - *Data.* `glVerse` was added to the four set files in place (`LLM_PROMPT_EVAL_ADD_GL_VERSE=1
    npx jest __tests__/buildPromptEvalCases.test.js`; same cases and ids, so earlier results stay
    comparable; a full rebuild adds it too). It is read from the GL bible named in each case's
    `source` and made plain text with `verseDataToText` (`helpers/promptEvalCases.js`). Found for
    all 3,920 cases. Not added to `llmTrainingData/*.json` yet: the fine-tune exporter needs it only
    if X3 goes to a retrain (Step 7.1).
  - *Request.* `testCaseToSelectionOptions` passes it as `glVerseText` in the job, and
    `getBestSelections` passes the job's `glVerseText` to the request (the app's prompt ignores it).
  - *Prompt.* `GATEWAY VERSE (<gl>): <verse>` right before GATEWAY PHRASE, the phrase in [brackets]
    by `markGlPhraseInVerse` (verse words cleaned as `cleanGlQuote` cleans the phrase, matched in
    order with gaps, shortest stretch; ULT's braces removed, dashes spaced). It brackets 1,497 of
    1,500 DEV and 834 of 835 TEST phrases; the others are sent unbracketed. The system prompt adds
    `GATEWAY VERSE - the same verse in the gateway language, with GATEWAY PHRASE in [brackets] (may
    be missing). It shows what the phrase means in the verse.`, and both examples show the line
    ("to the [church] in Ephesus", "all the [believers] were together"). Requests with algorithm
    options use X4's system prompt with these edits (`X3_X4_SYSTEM_PROMPT`), the others the app's
    (`X3_SYSTEM_PROMPT`).
  **X3 measured 2026-11-22** (logs in `llm-eval-results/prompt-X3-20261122/`). DEV against X4b,
  DEV-NOHIST against the baseline (= X4b there):

  | Model | Set | Top-1 | Right only in A / B | Wrong at ≥ 80 | Median ms |
  |---|---|---|---|---|---|
  | 1.7B | DEV | 44.6% → 43.7% | 40 / 26 (p 0.11) | 492 → **634** | 165 → 170 |
  | 1.7B | DEV-NOHIST | 16.4% → 18.7% | 38 / 55 (p 0.097) | 273 → **364** | 123 → 130 |
  | 0.6B | DEV | 39.5% → 38.3% | 55 / 36 (p 0.059) | 343 → 439 | 81 → 91 |
  | 0.6B | DEV-NOHIST | 1.1% → 0.4% | 6 / 1 (p 0.13) | 78 → 71 | 81 → 92 |
  | 4B | DEV | 51.7% → 52.6% | 56 / 69 (p 0.28) | 529 → 618 | 267 → 278 |
  | **4B** | **DEV-NOHIST** | 34.0% → **39.5%** | 50 / 91 (**p 0.0007**) | 367 → 390 | 244 → 250 |

  **Decision: not adopted (D5).** The 1.7B gains nothing with history and gives 142 more confident
  wrong answers on DEV (9.5% of cases, against the 1% limit); every model raises its confidences
  (mean confidence when wrong: 1.7B 82.8 → 87.0). Without history it is the best variant so far
  for the 4B (+5.5 points; X6 gave +3.6, X3 against X6 is 77 / 63, p 0.27) and helps the 1.7B
  somewhat (+2.3, not significant, X6 gave +1.6), but with more confident wrong answers. The GL
  verse is the main candidate for N4 (no-history requests only, Step 5), where a confidence cap
  (N5) can deal with the confident wrong answers, and for a retrain, where the fine-tune can learn
  when the line helps.
- **X4. Algorithm candidates.** A block `POSSIBLE ANSWERS:` listing the algorithm's options (up to
  3, text only, no confidence), with a rule that the answer may be one of them or other verse
  words. `getBestSelections` already computes them before the AI call (`getAlgorithmResultForJob`).
  Left out when the algorithm has none.
  **X4 measured 2026-11-22** (built on the app's prompt, since X1 was not adopted; logs in
  `llm-eval-results/prompt-X4-20261122/`). `X4_SYSTEM_PROMPT` describes the block ("may be
  missing, and may be wrong"), adds to rule 3 "POSSIBLE ANSWERS are often right: check them first,
  but answer with other verse words when none of them means GATEWAY PHRASE", and Example 1 shows the
  block with what the algorithm gives for its input ("iglesia", "la iglesia"); Example 2 has none
  (the algorithm gives nothing for it). The block is in 1,262 of 1,500 DEV requests and in no
  DEV-NOHIST request.

  | Model | Set | top-1 baseline → X4 | paired (baseline-only / X4-only, p) | wrong ≥ 80 | no option |
  |---|---|---|---|---|---|
  | 1.7B | DEV | 41.0% → **43.9%** | 79 / 123, **p 0.002** | 513 → 476 | 389 → 186 |
  | 1.7B | DEV-NOHIST | 16.4% → 17.7% | 21 / 31, p 0.21 | 273 → 175 | 225 → 147 |
  | 0.6B | DEV | 38.4% → 39.6% | 61 / 79, p 0.15 | 394 → 342 | 738 → 326 |
  | 0.6B | DEV-NOHIST | 1.1% → 1.3% | 3 / 5, p 0.73 | 78 → 135 | 663 → 582 |
  | 4B | DEV | 51.5% → 51.4% | 80 / 78, p 0.94 | 495 → 538 | 163 → 149 |
  | 4B | DEV-NOHIST | 34.0% → **30.1%** | 41 / 12, **p 8e-5** | 367 → 390 | 76 → 103 |

  Median time: 1.7B 128 → 166 ms, 0.6B 96 → 80, 4B 271 → 263. The 1.7B's top answer was the
  algorithm's first candidate in 1,160 of the 1,262 requests with the block (0.6B 924, 4B 909);
  against the algorithm alone it is 43.9% vs 41.3% (11 / 50, p 5e-7), the first prompt with which
  the stock 1.7B beats the algorithm, but it still gives the algorithm's low-confidence candidates
  high confidence (476 wrong at ≥ 80, algorithm 10). Split by whether the block was there
  (scored without occurrence suffixes, so the counts differ slightly from the table): with the
  block the 1.7B gains (69 / 121), without it X4 loses for the 1.7B (14 / 4) and the 4B (10 / 5),
  as on DEV-NOHIST, where only the system prompt differs.

  **Decision: not adopted as is (D5).** It passes for the primary model (top-1 up, p 0.002;
  confident wrong down; DEV-NOHIST not worse) and for the 0.6B, but the 4B is significantly worse
  on DEV-NOHIST (p 8e-5). Proposed next (**X4b**, waiting for the author): X4's system prompt only
  for requests with a POSSIBLE ANSWERS block, the app's otherwise, so requests without candidates
  are as in the baseline; the cost is a second fixed system prompt. For the fine-tunes, X4 makes
  stock models follow the algorithm, while the fine-tune already beats the algorithm by a wide
  margin, so anchoring could cost it; only a retrain (R1 or R3 against R0) can tell.

  **X4b measured 2026-11-22** (`buildX4b` in `promptVariants.js`; author's go-ahead): X4 for
  requests where the algorithm has options, the app's prompt unchanged otherwise. Run on DEV only:
  every DEV-NOHIST request is byte-identical to the baseline's and seeded runs repeat exactly, so
  its DEV-NOHIST results are the baseline's.

  | Model | DEV top-1 baseline → X4b | paired vs baseline | vs X4 (X4-only / X4b-only) | wrong ≥ 80 | no option | median ms |
  |---|---|---|---|---|---|---|
  | 1.7B | 41.0% → **44.6%** | 65 / 119, **p 8e-5** | 4 / 14, p 0.03 | 513 → 492 | 389 → 176 | 128 → 165 |
  | 0.6B | 38.4% → 39.5% | 61 / 78, p 0.17 | 1 / 0 | 394 → 343 | 738 → 328 | 96 → 81 |
  | 4B | 51.5% → 51.7% | 70 / 73, p 0.87 | 5 / 10, p 0.30 | 495 → 529 | 163 → 140 | 271 → 267 |

  Against the algorithm alone the 1.7B with X4b is 44.6% vs 41.3% (11 / 60, p 3e-9).

  **Decision: adopted as Step 3's current best (D5).** Primary model: top-1 up 3.6 points
  (p 8e-5), confident wrong answers down (513 → 492), DEV-NOHIST unchanged by construction; 0.6B
  and 4B not significantly worse on either set (the 4B's DEV-NOHIST loss under X4 is gone). The
  4B gives 34 more confident wrong answers on DEV (+2.3% of cases); the 1% guard of D5 is for the
  primary model, so this is noted, not blocking. The 1.7B is 29% slower per request (the block
  adds tokens), just inside the 30% limit of the Risks. The fine-tune caution under X4 applies
  (stock models gain by following the algorithm; the fine-tune already beats it).

- **X5. Occurrence.** When the check's `contextId.occurrence` > 1 and a candidate word repeats in
  the verse, add `OCCURRENCE: 2` with a one-line rule. Small; only if DEV has enough such cases
  (count first; skip if under 30).
  **Counted and measured 2026-11-22.** 34 DEV cases have `contextId.occurrence` > 1; in 32 the
  answer word repeats in the verse (vi 15, ru 8, te 6, ar 2, id 1), so it ran. The model cannot give
  an occurrence (the parser drops `word:n`; `moveSelectionsToOccurrence` places the answer), so the
  line can only change which words are chosen. In those 32, X4b is right in 14 for each model and
  only 4-5 more have the right words at the wrong occurrence. X5 (on X4b): `OCCURRENCE: n` under
  GATEWAY PHRASE when the check's occurrence is above 1 and a word of an algorithm option or a
  history rendering repeats in the verse, plus rule 6 "When OCCURRENCE is given, answer with the
  words that translate that occurrence of the phrase." DEV only (no DEV-NOHIST request has a
  candidate word, so it is the baseline there). Against X4b: 1.7B 669 → 669 (0 / 0), 0.6B 593 → 593
  (1 / 1), 4B 776 → 774 (3 / 1, p 0.63); wrong at ≥ 80 +2, +6, +1. **Not adopted.** Placing the
  answer at the right occurrence is the code's job; the 5 cases per model it gets wrong are a matter
  for `moveSelectionsToOccurrence`, not the prompt.
- **X6. translationWords term.** `TERM: <groupId>` (e.g. `bear`, `holyplace`), the tW article id.
  Cheap; may help meaning when the GL phrase is an inflected or idiomatic form.

**X6 measured 2026-11-22** (built on the app's prompt; logs in `llm-eval-results/prompt-X6-20261122/`).
`TERM: <contextId.groupId>` right under GATEWAY PHRASE (341 different terms on DEV, every case has
one, DEV-NOHIST included); the system prompt adds "TERM - the Bible term the phrase is an example
of (a hint to its meaning; may be missing)" and both examples show a TERM (`church`, `believe`).

| Model | Set | top-1 baseline → X6 | paired (baseline-only / X6-only, p) | wrong ≥ 80 | no option |
|---|---|---|---|---|---|
| 1.7B | DEV | 41.0% → 41.7% | 50 / 60, p 0.39 | 513 → 476 | 389 → 408 |
| 1.7B | DEV-NOHIST | 16.4% → 18.0% | 23 / 35, p 0.15 | 273 → **330** | 225 → 175 |
| 0.6B | DEV | 38.4% → 38.2% | 26 / 23, p 0.78 | 394 → 369 | 738 → 808 |
| 0.6B | DEV-NOHIST | 1.1% → 0.4% | 6 / 1, p 0.13 | 78 → 33 | 663 → 714 |
| 4B | DEV | 51.5% → 52.1% | 34 / 43, p 0.36 | 495 → 520 | 163 → 140 |
| 4B | DEV-NOHIST | 34.0% → **37.6%** | 14 / 41, **p 0.0004** | 367 → 381 | 76 → 43 |

Median time unchanged or a little lower (1.7B 128 → 120 ms).

**Decision: not adopted (D5)** for the primary model: no significant top-1 gain on DEV or
DEV-NOHIST, and on DEV-NOHIST the 1.7B answers more often (no option 225 → 175) but is
confidently wrong more often (273 → 330, +7.6% of the set). The term does help a model that can
use it where there is no history: the 4B gains 3.6 points on DEV-NOHIST (p 0.0004), which is what
X6 was meant to do. So it is a candidate for the no-history work of Step 5 (with N3 or N4) and
for a retrain, where the fine-tune could learn to use it; it costs about 5 tokens per request.

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
  Uses the `messages` option of Step 1A. For a retrain, the exporter writes the same turns and
  the loss must fall on the **last** assistant turn only; check how the installed `mlx-lm`
  masks multi-turn examples (`mask_prompt`) before training, and with `check_data.py`.
- **S5. Reminder at the end.** Keep the system prompt; end the user message with one line before
  `Answer:` repeating the most-broken rule (e.g. `Copy words exactly as in TARGET VERSE.`).
  Cheap, cache-safe (the request part is not cached anyway).
- **S6. Field order.** GATEWAY PHRASE first, then TARGET VERSE, then the history, so the evidence
  sits right before `Answer:`. Examples reordered to match.

Run S1-S6 each against the current best; combine the adopted ones and check the combination
once more (D5).

**S1-S6 measured 2026-11-22** (each built on X4b, applied to both of its system prompts; logs in
`llm-eval-results/prompt-S<n>-20261122/`). DEV is compared with X4b, DEV-NOHIST with `baseline`
(X4b sends DEV-NOHIST the app's prompt). Every S run has the N5 cap, so wrong ≥ 80 on DEV-NOHIST
is 0 for all of them and is left out; the baseline there had 273 (1.7B), 78 (0.6B), 367 (4B).
S2 is worded for the current prompt (X1's `in verse` marks were not adopted): previous
translation word for word (90+), another form of one (60-89), a meaning match, then `"",0`.

| Variant | Model | DEV top-1 (X4b → S, only-X4b / only-S, p) | DEV wrong ≥ 80 | DEV no option | DEV-NOHIST top-1 (p) | median ms (1.7B DEV) |
|---|---|---|---|---|---|---|
| S1 short | 1.7B | 44.6 → 44.1%, 35 / 27, p 0.37 | 492 → 565 | 176 → 265 | 16.4 → 19.3%, p 0.021 | 165 → 162 |
| | 0.6B | 39.5 → 41.0%, 43 / 65, p 0.043 | 343 → **653** | 328 → 240 | 1.1 → 1.6%, p 0.39 | |
| | 4B | 51.7 → 50.1%, 56 / 31, **p 0.0097** | 529 → 544 | 140 → 180 | 34.0 → 33.2%, p 0.54 | |
| S2 procedure | 1.7B | 44.6 → 43.3%, 29 / 10, **p 0.0034** | 492 → 430 | 176 → 158 | 16.4 → 13.5%, **p 0.0032** | 165 → 169 |
| | 0.6B | 39.5 → 40.3%, p 0.26 | 343 → 442 | 328 → 196 | 1.1 → 2.3%, p 0.049 | |
| | 4B | 51.7 → 50.7%, p 0.11 | 529 → 492 | 140 → 144 | 34.0 → 34.4%, p 0.80 | |
| S3 merged | 1.7B | 44.6 → 41.2%, 78 / 27, **p 6.5e-7** | 492 → 596 | 176 → 197 | 16.4 → 13.2%, **p 0.0056** | 165 → 174 |
| | 0.6B | 39.5 → 37.0%, **p 0.0013** | 343 → 285 | 328 → 591 | 1.1 → 1.2% | |
| | 4B | 51.7 → 49.3%, **p 0.0002** | 529 → 459 | 140 → 158 | 34.0 → 30.4%, **p 0.0045** | |
| S4 chat turns | 1.7B | 44.6 → 45.1%, 27 / 34, p 0.44 | 492 → **278** | 176 → 225 | 16.4 → **23.2%**, 23 / 74, **p 2e-7** | 165 → 128 |
| | 0.6B | 39.5 → **41.5%**, 33 / 62, p 0.0038 | 343 → **6** | 328 → 350 | 1.1 → 0.8%, p 0.75 | |
| | 4B | 51.7 → 49.4%, 77 / 42, **p 0.0017** | 529 → 437 | 140 → 211 | 34.0 → 35.2%, p 0.36 | |
| S5 reminder | 1.7B | 44.6 → 43.1%, 44 / 22, **p 0.0092** | 492 → 404 | 176 → 160 | 16.4 → 13.3%, **p 0.0059** | 165 → 156 |
| | 0.6B | 39.5 → 40.6%, p 0.064 | 343 → 319 | 328 → 307 | 1.1 → 1.2% | |
| | 4B | 51.7 → 51.1%, p 0.37 | 529 → 572 | 140 → 92 | 34.0 → 31.9%, **p 0.033** | |
| S6 field order | 1.7B | 44.6 → 44.5%, 38 / 37, p 1.0 | 492 → 634 | 176 → 180 | 16.4 → 9.9%, **p 6e-6** (no option 225 → 469) | 165 → 161 |
| | 0.6B | 39.5 → 39.7%, p 0.92 | 343 → 356 | 328 → 298 | 1.1 → 2.9%, p 0.0026 | |
| | 4B | 51.7 → 51.3%, p 0.71 | 529 → 445 | 140 → 148 | 34.0 → 32.8%, p 0.49 | |

**Decisions (D5): none adopted; `S*` = X4b.**
- S2, S3, S5: significantly worse for the 1.7B on both sets. S3 is worse on every model; the
  system message matters. S5's reminder lowers confident wrong answers but costs right ones.
- S6: no change on DEV; with no history the 1.7B gives up twice as often (no option 225 → 469).
- S1: no DEV gain for the 1.7B, 4B worse (p 0.0097), 0.6B's confident wrong answers double. The
  shorter prompt does not make stock runs faster (165 → 162 ms median), since llama-server
  caches the fixed system prompt. It stays a retrain candidate (Step 7) only as the plan says:
  to see whether a fine-tune keeps its accuracy without the long prompt.
- **S4 is the closest and the strongest retrain candidate**, but fails D5 on two counts: the
  1.7B's DEV gain is not significant (p 0.44), and the 4B is worse on DEV (p 0.0017). What it
  does gain: confident wrong answers on DEV fall for every model (1.7B 492 → 278, 0.6B 343 → 6,
  4B 529 → 437), the 1.7B gains 6.8 points with no history (p 2e-7), the 0.6B gains on DEV
  (p 0.0038), and the 1.7B is faster (128 ms median). Mean confidence falls too (1.7B right
  86 → 80, wrong 83 → 76), so the effect is partly that the model copies the examples'
  lower confidences.
  Where S4 loses: on DEV requests with no algorithm options (238 cases), the answers it loses
  are mostly `"",0` (1.7B: 14 of 15; 4B: 22 of 26). On requests with options the 1.7B gains
  (25 / 12) and the 4B loses (51 / 28, 14 of them empty).
- Nothing adopted, so there is no combination to check.

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

**N4 + N5 measured 2026-11-22** (logs in `llm-eval-results/prompt-N4-20261122/`).
- *N4* is a variant (`buildN4`): X3's GATEWAY VERSE line only when the request has no history,
  X4b otherwise. A unit test shows it sends X4b's prompt with history and X3's without; DEV has no
  empty-history case and DEV-NOHIST only those, so N4 is X4b on DEV and X3 on DEV-NOHIST.
- *N5* is in the app (`LLM_NO_HISTORY_MAX_CONFIDENCE` = 70 and `capConfidenceWithoutHistory` in
  `checkingSuggestionsUtils.js`, applied in `getBestSelections` to single and batched AI results).
  Split first, DEV-NOHIST, top answer right by its confidence: 1.7B 22-28% in every band from 70
  (baseline 20-26%); 4B 22-26% below 90, 40-47% at 90-94, 51-57% at 95-100; 0.6B 0-21%. No band
  of the 1.7B reaches half, so the plan's default 70 was used; any cap below 80 gives the same
  numbers below, so the value is a choice of what translators see, not a measured one (50 would
  match the 1.7B's accuracy better). tc-ui-toolkit applies any suggestion with a confidence, with
  no threshold, and without history the algorithm has no options to merge, so the cap changes
  only the number shown.
- Rerun of N4 with the cap on DEV-NOHIST: every answer the same as X3's (0 differ, for all three
  models), highest confidence 70.

| Model | DEV-NOHIST top-1, baseline → N4 + N5 | Right only in A / B | Wrong at ≥ 80 |
|---|---|---|---|
| 1.7B | 16.4% → 18.7% | 38 / 55 (p 0.097) | 273 → 0 |
| 0.6B | 1.1% → 0.4% | 6 / 1 (p 0.13) | 78 → 0 |
| 4B | 34.0% → **39.5%** | 50 / 91 (**p 0.0007**) | 367 → 0 |

**Decisions:** **N5 adopted** (its rule: wrong at ≥ 80 drops, here to 0, with top-1 unchanged).
**N4 not adopted for now (D5):** the 1.7B's gain is not significant (p 0.097), though no model is
significantly worse and N5 removes the confident wrong answers X3 added. It stays the main
no-history candidate for the retrain (R1), where the fine-tune can learn to use the line, and
for F if a larger sample confirms the 1.7B's gain.

**N1 and N6 measured 2026-11-22** (on X4b, with N5 in the code; logs in
`llm-eval-results/prompt-N1-20261122/`, `prompt-N6-20261122/`).
- *N1* (`PREVIOUS TRANSLATIONS: none` when there is no history; system prompt unchanged; X4b
  otherwise, so DEV cannot change), DEV-NOHIST against the baseline: 1.7B 16.4% → **0.8%**
  (117 / 0, p 1e-35): it reads "none" as "no answer" and replies `"",0` to 719 of 750 requests
  (no option 225 → 734); 0.6B 1.1% → 0.5% (7 / 3); 4B 34.0% → 33.5% (22 / 18, p 0.64), with more
  empty answers (76 → 97). **Not adopted.** Leaving the block out, as the app does, is better.
  (Wrong at ≥ 80 is not compared: the baseline was run before N5.)
- *N6* (history whose renderings none fit the verse, by `formatPreviousTranslations`' own verse
  fit, is sent as no history; algorithm options kept): it changes 422 of 1,500 DEV requests
  (28%). Against X4b (all other requests are the same, so the paired counts are the same on DEV
  and on the 422):

  | Model | DEV top-1 | The 422: top-1 | Right only in A / B | Wrong at ≥ 80 (DEV) | No option (DEV) |
  |---|---|---|---|---|---|
  | 1.7B | 44.6% → 44.8% | 20.4% → 21.1% | 25 / 28 (p 0.78) | 492 → 506 | 176 → 79 |
  | 0.6B | 39.5% → 39.5% | 10.0% → 9.7% | 5 / 4 (p 1.0) | 343 → 352 | 328 → 320 |
  | 4B | 51.7% → 52.9% | 36.0% → 40.0% | 36 / 53 (p 0.089) | 529 → 594 | 140 → 79 |

  Without the unrelated lines the 1.7B and 4B answer far more often (no option 176 → 79) but are
  not more often right, and give more confident wrong answers (N5 does not cap these: they have
  history). **Not adopted** (no gain for the 1.7B). The 4B's +4 points on these requests is not
  significant.

**N2 measured 2026-11-22** (on X4b; logs in `llm-eval-results/prompt-N2-20261122/`). Example 3 in
both system prompts, after Example 2: `TARGET VERSE (sw): Yesu aliwaponya wagonjwa wengi`, no
history, `GATEWAY PHRASE (en): the sick`, answer `"wagonjwa",65` (Swahili is in no eval set, so
its words in an answer show copying).

| Model | DEV top-1 (vs X4b) | DEV right only A / B | DEV wrong at ≥ 80 | DEV-NOHIST top-1 (vs baseline) | NOHIST right only A / B | Raw answers with "wagonjwa"/"Yesu" (DEV / NOHIST) |
|---|---|---|---|---|---|---|
| 1.7B | 44.6% → 44.2% | 18 / 12 (p 0.36) | 492 → 453 | 16.4% → 15.3% | 32 / 24 (p 0.35) | 3 / **59** |
| 0.6B | 39.5% → 39.3% | 42 / 39 (p 0.82) | 343 → 195 | 1.1% → 0.5% | 6 / 2 (p 0.29) | **241 / 417** |
| 4B | 51.7% → 51.8% | 25 / 26 (p 1.0) | 529 → 515 | 34.0% → 35.6% | 22 / 34 (p 0.14) | 0 / 8 |

**Not adopted.** No model gains. The small models copy the example (W10): the 0.6B puts its words
in 417 of 750 no-history answers, the 1.7B in 59. The parser drops those (the words are not in the
verse), so they show as no option (1.7B NOHIST 225 → 265). The drop in confident wrong answers on
DEV comes from fewer answers, not better ones.

**N3 measured 2026-11-22** (logs in `llm-eval-results/prompt-N3-20261122/`). `N3_SYSTEM_PROMPT` for
requests with no history: no mention of previous translations; rule 3 "Find the verse words with
the same meaning as GATEWAY PHRASE. They may be another form of the word, or a different word with
that meaning."; confidence 0 to 70; three examples without history (the app's two at 70/55 and 65,
and N2's Swahili one); the app's output rules word for word. The request text is the app's, and
requests with history get X4b, so DEV cannot change: DEV-NOHIST only. (N1+N2, the plan's
comparison, was not built: N1 failed outright; N3 is compared with the baseline and with N4.)

| Model | DEV-NOHIST top-1, baseline → N3 | Right only in A / B | No option | N4 → N3 (right only in A / B) |
|---|---|---|---|---|
| 1.7B | 16.4% → 16.5% | 25 / 26 (p 1.0) | 225 → 144 | 18.7% → 16.5% (58 / 42, p 0.13) |
| 0.6B | 1.1% → 1.6% | 4 / 8 (p 0.39) | 663 → 581 | 0.4% → 1.6% (2 / 11, p 0.022) |
| 4B | 34.0% → **41.2%** | 16 / 70 (**p 3e-9**) | 76 → 56 | 39.5% → 41.2% (71 / 84, p 0.34) |

The models keep to the ceiling (mean confidence 60-67), and copying is rare (answers with any
example's words: 1.7B 1, 0.6B 53, 4B 2), unlike N2, where the same example came after two with
history. **Not adopted for now (D5):** the 1.7B answers more often (no option 225 → 144) but is
not more often right. It is the best no-history prompt for the 4B (+7.2 points, the largest gain
of Step 5), so it stays a candidate. Next to try: N3 with N4's GATEWAY VERSE line (both helped the
4B separately; the 1.7B gained most from the verse).

  **N3 + N4 measured 2026-11-23** (variant `N34`; logs in `llm-eval-results/prompt-N34-20261122/`).
  With no history: N3's prompt plus X3's GATEWAY VERSE field, a GATEWAY VERSE in each of its three
  examples (Example 3: "Jesus healed many of [the sick]"), and N4's request text; X4b otherwise.
  DEV is identical to X4b on every model (0 / 0 changed cases), as it should be.

  | Model | DEV-NOHIST top-1, baseline → N34 (only A / B, p) | vs N3 | vs N4 | No option |
  |---|---|---|---|---|
  | 1.7B | 16.4 → 16.1%, 48 / 46, p 0.92 | 16.5%, p 0.84 | 18.7%, **N4 better, p 0.034** | 225 → 167 |
  | 0.6B | 1.1 → 0.9%, p 1.0 | 1.6%, p 0.18 | 0.4%, p 0.34 | 663 → 690 |
  | 4B | 34.0 → **42.9%**, 45 / 112, **p 9e-8** | 41.2%, p 0.29 | 39.5%, **p 0.013** | 76 → 37 |

  **Not adopted (D5):** no gain for the primary model; the 1.7B does better with N4 alone, so for
  it the N3 prompt cancels what the verse gives. For the 4B it is the best no-history prompt
  measured (+8.9 points). A candidate for the retrains only if no-history examples are trained
  with this prompt; otherwise N4 stays the 1.7B's best (not adopted either, p 0.097 vs baseline).
- **N6. Unrelated history treated like none.** When no history line fits the verse
  (`noRelatedWordInHistory` cases: today up to 5 unrelated lines are sent), send the no-history
  form instead. Measure on the DEV cases with that tag
  (`npm run check:llm-training-data` lists them).

**Done when:** each of N1-N6 has a row and the adopted ones are combined into the final variant
`F`, which passes D5 against `baseline` on both DEV and DEV-NOHIST.

### Step 5A. Qwen3 settings: sampling and thinking (LIVE, DEV; added 2026-11-23)

Not prompt text: the two Qwen3 settings the app fixes. Both on X4b, logs in
`llm-eval-results/qwen-sampling-20261123/` and `qwen-thinking-20261123/`; result files carry
`-qsamp` / `-think` after the model name. DEV against X4b, DEV-NOHIST against `baseline` (X4b
sends it the app's prompt; wrong ≥ 80 there is 0 from the N5 cap).

**Q-SAMP. Qwen3's recommended non-thinking sampling:** temperature 0.7, top_p 0.8, top_k 20,
min_p 0 (seed 42), thinking off. **No effect:** 1.7B DEV 44.6 → 44.3% (7 / 3, p 0.34), NOHIST
16.4 → 16.1%; 0.6B DEV 39.5 → 38.7% (p 0.17); 4B 51.7 → 51.9%, NOHIST 34.0 → 34.0%. Confident
wrong answers and times unchanged. The 0.1 default stays.

**Q-THINK. Thinking on** (`llmEnableThinking`, a new eval-only option of `getBestSelections`, off
in the app; `LLM_TRAINING_THINKING=1` in the runner): no `/no_think`, Qwen3's thinking sampling
(temperature 0.6, top_p 0.95, top_k 20, min_p 0), `max_tokens` 2048. 1.7B only so far.

| Set | top-1 | paired (only A / only think, p) | wrong ≥ 80 | no option | median ms (p90) |
|---|---|---|---|---|---|
| DEV, X4b → think | 44.6 → **50.3%** | 50 / 136, **p 2e-10** | 492 → 474 | 176 → 210 | 165 → 6,073 (15,076) |
| DEV-NOHIST, baseline → think | 16.4 → **36.1%** | 36 / 184, **p 4e-25** | (capped) | 225 → 197 | 123 → 9,436 (17,109) |

The largest gain measured in this plan, on both sets: the thinking 1.7B is level with the
non-thinking 4B on DEV (50.3 vs 51.7%, p 0.18); with no history it beats the 4B on the app's
prompt (36.1 vs 34.0%) but not the 4B with N34 (42.9%, p 0.001). Thinking takes 847 tokens at the median (p90 2,022); 221 of 2,250 requests
(10%) hit the 2,048 cap, which likely leaves no answer (counted as the algorithm's fallback), so a
higher cap may gain more, at more time. **Cost: about 40-75x slower** (6-9 s median per check, up
to 23 s), so it passes D5 on accuracy but is a product decision, not a prompt one: it suits a
background queue that fills a group's suggestions ahead of the user, not a check the user is
waiting on. **Decision (author, 2026-11-23): not used; thinking is too slow even on a fast
computer.** Not run for that reason: 0.6B and 4B with thinking, a higher cap, a fine-tune with
thinking. What it does show: the 1.7B can reach 4B-level accuracy on this task when it works the
answer out, so the gap is reasoning, not knowledge of the languages.

### Step 6. Cost to the released fine-tunes (LIVE, TEST)

Run `baseline` and `F` on D3 1.7B Q5_K_M and the 0.6B Q6_K, on TEST and TEST-NOHIST. This shows
what switching the app's prompt would cost users of the released models before retraining, and how
the fine-tunes do without history (never trained).

**Done when:** four rows per fine-tune are in section 7.

**Measured 2026-11-23** (`F` = X4b, the only adopted prompt change; the N5 cap applies to both
prompts; release GGUFs, checksums equal to the GitHub release; logs in
`llm-eval-results/step6-20261123/`). TEST-NOHIST requests are identical under both prompts (no
history, so no algorithm options), so those runs match exactly.

| Fine-tune | Set | top-1 baseline → X4b | only A / only B, p | wrong ≥ 80 | median ms |
|---|---|---|---|---|---|
| 1.7B Q5_K_M | TEST | 67.4 → 66.7% | 32 / 26, p 0.51 | 99 → **141** | 77 → 81 |
| 1.7B Q5_K_M | TEST-NOHIST | 54.3% (same) | 0 / 0 | 0 (cap) | 109 |
| 0.6B Q6_K | TEST | 64.0 → 63.5% | 20 / 16, p 0.62 | 96 → **154** | 50 |
| 0.6B Q6_K | TEST-NOHIST | 36.2% (same) | 0 / 0 | 0 (cap) | 67 |

- **Switching the app to X4b before retraining costs the released models nothing significant in
  top-1, but raises confident wrong answers by 42% (1.7B) and 60% (0.6B):** the fine-tunes copy a
  POSSIBLE ANSWER with high confidence when it is wrong. So X4b must not ship without a retrain.
- **Without history the fine-tunes do far better than the stock models** (1.7B 54.3% vs the stock
  1.7B's 16.4% on DEV-NOHIST; 0.6B 36.2% vs 1.1%; different sets, so indicative), though they were
  never trained on it: the training data's `noRelatedWordInHistory` cases are close to no history.
  With the N5 cap their confident wrong answers there are 0; mean confidence is about 56-61, right
  and wrong alike.

### Step 7. Retrain on the candidate prompts (OFFLINE build, MLX training, LIVE GGUF scoring)

This is the main step (Q1). Each retrain of the 1.7B takes about 2.8 hours on the Mac, so retrain
at most 4 runs, one at a time:
- **R0 (control):** today's prompt + the no-history examples. It shows what the extra data alone
  gives, so R1-R3 are compared with R0, not with D3.
- **R1:** the best Step 3 + Step 5 variant (extra data and no-history handling).
- **R2:** R1 with S1's short instructions (the speed question).
- **R3:** S4 (examples as chat turns) on top of R1, if it did well on stock 1.7B; otherwise
  one more shortlisted variant, if Steps 3-5 left a close second.

1. Let `npm run build:finetune-data` build from a variant: `LLM_FINETUNE_PROMPT_VARIANT` uses the
   builder from `promptVariants.js`, and the parity test runs per variant. Add any per-case data
   a variant needs (e.g. `glVerse` for X3) to the exporter.
2. No-history examples (Q4): add `LLM_FINETUNE_NO_HISTORY_SHARE` (default 0.1) to the exporter.
   It copies that share of the training cases with `history` set to `{}`, labelled at the
   no-history confidence chosen in Step 5. Keep the projects' train/valid/test split, so no test
   verse is trained on. Run `check_data.py` on the result.
3. Train with `llmTraining/lora-r16-d3.yaml` (new data dir and output dir per run), fuse, convert
   to GGUF Q5_K_M (`llmTraining/README.md`), score on TEST and TEST-NOHIST with `llama-server` (D1).
4. If R1 or R2 is adopted for the 1.7B, train the 0.6B the same way (`lora-r16-d3-0.6b.yaml`, Q6_K)
   and check it is not worse than the released 0.6B on TEST.

Fine-tunes can only be scored on TEST (DEV cases are training data), so with few runs TEST is used
to choose among R0-R3. That is a small risk of tuning to TEST; report it with the results.

**Done when:** for each run, TEST and TEST-NOHIST rows are in section 7, with paired counts
against D3 and against R0. A run is adopted when it is at or above D3 on TEST (not significantly
worse), better than D3 on TEST-NOHIST, and not slower per request than D3 by more than 30%. If
R0 wins over R1-R3, the prompt stays as it is and only the no-history training data ships.

**R0 and R1 measured 2026-11-23.** Built with the exporter's new settings
(`LLM_FINETUNE_PROMPT_VARIANT`, `LLM_FINETUNE_NO_HISTORY_SHARE=0.1`, GL verses from
`~/translationCore`); the no-history share defaults to 0 so earlier builds are unchanged. Both
have the same 12,143 train examples (1,075 of them no-history copies, labelled 55; 322
negatives), so only the prompt differs; that is more than D3's 10,265 because the algorithm was
recalibrated after D3 was built, which changes which cases are sent to the AI. `check_data.py`
passed on both. Config of D3 (`lora-r16-r0.yaml`, `lora-r16-r1.yaml`; 3,036 iters, about 3.2 h
(R0) and 3.6 h (R1) on the Mac); final validation loss R0 0.056, R1 0.052. Scored as GGUF
Q5_K_M with llama-server (D1, D2), each with the prompt it was trained on (R1: `N34`); logs in
`llm-eval-results/step7/`. D3 is the released 1.7B Q5_K_M on the app's prompt (Step 6).

| Run | Set | top-1 | vs D3 (only D3 / only run, p) | vs R0 | wrong ≥ 80 | no option | median ms |
|---|---|---|---|---|---|---|---|
| D3 | TEST | 67.4% | | | 99 | 3 | 77 |
| R0 | TEST | 69.1% | 28 / 42, p 0.12 | | **77** | 3 | 80 |
| R1 | TEST | 69.2% | 27 / 42, p 0.091 | 37 / 38, p 1.0 | 82 | 0 | 82 |
| D3 | TEST-NOHIST | 54.3% | | | 0 (cap) | 34 | 109 |
| R0 | TEST-NOHIST | 56.0% | 36 / 51, p 0.13 | | 0 | 9 | 105 |
| R1 | TEST-NOHIST | 52.7% | 89 / 76, p 0.35 | 88 / 60, **p 0.026 worse** | 0 | **123** | 117 |

R1's 123 empty answers (`""`) are all in `en_ult_tit`, the one project whose target is English
(GLs ar, id, es-419, fa, ru). Split by that project:

| Set | Cases | D3 | R0 | R1 | R0-only / R1-only, p |
|---|---|---|---|---|---|
| TEST, other projects | 544 | 70.6% | 72.8% | 71.3% | 26 / 18, p 0.29 |
| TEST, `en_ult_tit` | 291 | 61.5% | 62.2% | 65.3% | 11 / 20, p 0.15 |
| TEST-NOHIST, other projects | 544 | 61.8% | 63.2% | 64.9% | 33 / 42, p 0.36 |
| TEST-NOHIST, `en_ult_tit` | 291 | 40.2% | 42.6% | **29.9%** | 55 / 18, **p 2e-5** |

The training data has no English-target example at all (the only English-target project is held
out), and the GL phrase is bracketed in every one of these GL verses, so the marking did not fail.
Why R1 gives up there and R0 does not is not proven; the likely reason is that N34's no-history
request (a GATEWAY VERSE in another language next to an English verse) is a combination R1 never
saw, while R0's no-history request is the plain layout it also sees with history.

- **R0: not adopted by the rule, but the best run.** Top-1 up on both sets (+1.7 points each,
  neither significant), confident wrong answers down 99 → 77 (-22%), empty answers with no
  history 34 → 9, same speed. The no-history examples help a little and cost nothing.
- **R1: not adopted.** Level with R0 on TEST, and the POSSIBLE ANSWERS no longer raise confident
  wrong answers (82, against 141 for the untrained D3 with X4b, Step 6): training fixes that.
  But it is significantly worse than R0 with no history, all of it on English targets.
- TEST chose between these runs (the risk named above).
- Next candidate: **R1b = X4b only** (POSSIBLE ANSWERS with history, the app's prompt with
  none), which keeps what R1 does with history and R0's no-history request.

**R1b measured 2026-11-23** (`lora-r16-r1b.yaml`, data built with `LLM_FINETUNE_PROMPT_VARIANT=X4b`;
the same examples as R0, its 1,075 no-history examples byte-identical to R0's, POSSIBLE ANSWERS in
8,888 of 12,143; 3.5 h; final validation loss 0.049; scored with X4b).

| Set | D3 → R1b (only D3 / only R1b, p) | R0 → R1b (only R0 / only R1b, p) | wrong ≥ 80 (D3 / R0 / R1b) | no option | median ms |
|---|---|---|---|---|---|
| TEST | 67.4 → 69.3%, 27 / 43, p 0.072 | 69.1 → 69.3%, 36 / 38, p 0.91 | 99 / 77 / 84 | 3 / 3 / 2 | 77 / 80 / 83 |
| TEST-NOHIST | 54.3 → 56.3%, 43 / 60, p 0.11 | 56.0 → 56.3%, 48 / 50, p 0.92 | 0 (cap) | 34 / 9 / 5 | 109 / 105 / 105 |

By project, R1b is level with R0 everywhere, English targets included (TEST-NOHIST `en_ult_tit`:
R0 42.6%, R1 29.9%, R1b 44.0%; other projects 63.2 / 64.9 / 62.9%). Its no-history answers differ
from R0's although the requests are the same, since the model was trained differently on the other
examples.

**Decision: R1b not adopted; R0 wins (D5's tie rule: a tie is kept only if it shortens the prompt,
and X4b lengthens it).** Once trained on them, the POSSIBLE ANSWERS neither help the fine-tune nor
hurt it: it already matches the algorithm's candidates by itself. So **the prompt stays as it is,
and what Step 7 found is the no-history training data (R0)**: compared with D3, +1.7 points on TEST
and on TEST-NOHIST (neither significant alone, p 0.12 and 0.13), confident wrong answers 99 → 77,
empty no-history answers 34 → 9, same speed. R2 and R3 were built on R1 and are not run.

### Step 8. Confirm (LIVE, TEST)

On the stock 1.7B, 0.6B and 4B: `baseline` and `F` on TEST and TEST-NOHIST, at the app's settings
without a seed, 2 runs pooled; plus the suite with `scripts/test-llm.sh -r 3 -g 1 -u http://localhost:8080`. This is the first
look at TEST.

**Done when:** `F` is not worse than `baseline` on TEST for 1.7B (if it is, the DEV gain was
tuning to DEV: report it and stop), and the rows are in section 7.

### Step 9. Put the result in the app (OFFLINE)

1. Move the adopted variant from `promptVariants.js` into `buildLlmSystemPrompt` /
   `buildTranslationOptionsPrompt` for the single path only; batch constants untouched (D7).
2. If X3 or N4 is adopted: carry `glVerseText` in the job from `Container.js` to the request.
3. If S4 is adopted: it relies on Step 1A's translationCore change; record the minimum
   translationCore version. If S3 is adopted, no translationCore change is needed (an empty
   `systemPrompt` already sends no system message), but `applyThinkingDirective` must not turn
   `''` into `'/no_think\n'`.
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
  - Clarification (2026-11-22): today the app sends every model exactly two messages: a
    **system** message (the rules and the worked examples) and a **user** message (this verse,
    history and phrase). translationCore's main process builds those two from two strings,
    `systemPrompt` and `query`. S4 would instead send a short pretend conversation: user (Example
    1's request), assistant (Example 1's answer), user (Example 2's request), assistant (its
    answer), then the real request. translationCore cannot send that today: its main process
    and `preloadAiApi.js` would have to accept a list of messages, and checking tools could
    only rely on it once that translationCore version is installed. S3 (everything in one user
    message) needs no translationCore change.
  - Proposed: since the target is now the fine-tunes (Q1), which already answer in the right
    format every time, drop S4 and make no translationCore change. Confirm or overrule.
  - Answer: go ahead and make that change to translationCore since that would be useful for experimenting. the open translationCore project is at: ../translationCore

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
- **Q7. `/no_think` in the user message (found in Step 1).** Through translationCore, the app
  sends the user message without `/no_think` (only the system message has it). The fine-tune was
  trained with it in both, and the direct HTTP path sends it in both. Options:
  (a) fix `queryAiAPI` to pass the directive-added query to `window.AiAPIs.query` (one line), so
  the app sends what the fine-tune was trained on; then rerun Step 6 (b) of the fine-tune plan on
  D3 to see whether the released model scores differently;
  (b) leave the app as it is, and train and evaluate without `/no_think` in the user message.
  Recommended: (a). It matches the training data and the code's own documentation
  (`nodeAiApisQuery` said the query comes "with `/no_think` already added"), and the variants of
  this plan already send it that way.
  - Answer (2026-11-22): (a). Done: `queryAiAPI` now passes the directive-added query to
    `window.AiAPIs.query`, so with or without a variant the user message starts with `/no_think`
    on every path, and a `baseline` run sends the same messages as a run with no variant. Scores
    of the released models measured through the bridge before this (fine-tune plan, Step 6) were
    taken without it; re-scoring D3 is left for Step 6 of this plan, where `baseline` on TEST
    gives the new number.


- **Q8. X1 for the fine-tune?** X1 did not raise top-1 on any stock model, but it cut confident
  wrong answers by 10% of DEV cases on the 1.7B and 6% on the 4B. D5 rejects it (no top-1 gain,
  longer prompt). A fine-tune might use the marks better than a stock model, since it would learn
  from 10,000 examples what they mean, but nothing measured here shows that. Recommended: leave it
  out of the retrain shortlist unless Steps 3-5 find nothing better; R0 (today's prompt plus
  no-history data) is the comparison that matters.
  - Answer (2026-11-22): agreed; X1 is left off the shortlist.

## 7. Results

(Rows go here: variant, model, set, cases, top-1, top-3, wrong ≥ 80, empty, CSV %, fixed / per-request
tokens, median ms, paired vs parent (A-only / B-only, p), decision.)

### 2026-11-22: stock GGUF builds (D1, Q5)

Converted with `llmTraining/.llama.cpp` at `b1b770d90` (the converter matching the installed
`llama-server` 1.0.0, build 12359) from the Hugging Face cache, bf16 then `llama-quantize` Q8_0:
`llmTraining/outputs/qwen3-1.7b-stock-GGUF/qwen3-1.7b-stock-Q8_0.gguf` (2.17 GB) and
`llmTraining/outputs/qwen3-0.6b-stock-GGUF/qwen3-0.6b-stock-Q8_0.gguf` (0.80 GB); sha256 in
`llm-eval-results/prompt-baseline-20261122/sha256.txt`. They are larger than the fine-tune GGUFs
(1.83 GB at Q8_0 for the 1.7B): Qwen's checkpoints store `lm_head.weight` although
`tie_word_embeddings` is true, so the converter writes a separate `output.weight`. It was
checked to be identical to `embed_tokens` in both checkpoints, so the model is the same; only the
file is larger. The fine-tune GGUFs have no copy (the MLX fuse drops it).

### 2026-11-22: Step 2.3 baselines, stock 1.7B and 0.6B

`llama-server -m <gguf> --alias <name> -np 1 -c 8192 --jinja --port 8080`,
`LLM_PROMPT_VARIANT=baseline`, temperature 0.1, `{"seed":42}`, through `installNodeAiApis`
(after the Q7 fix). Logs in `llm-eval-results/prompt-baseline-20261122/`; results in
`llmTrainingData/promptEval/results/*_prompt-baseline.results.json`. Scored as the app shows
them with `scripts/compare-prompt-variants.js` (the algorithm's answer when the AI gives none):

| Set | | Algorithm alone | Stock 1.7B Q8_0 | Stock 0.6B Q8_0 |
|---|---|---|---|---|
| DEV (1,500) | top-1 | 620 (41.3%) | 615 (41.0%) | 576 (38.4%) |
| | top-3 | 735 (49.0%) | 636 (42.4%) | 654 (43.6%) |
| | wrong at ≥ 80 | 10 | **513** | 394 |
| | AI gave no option | (238 none) | 389 | 738 |
| | mean confidence right / wrong | 52.6 / 36.6 | 81.5 / 74.4 | 75.6 / 64.8 |
| | median ms | | 134 | 96 |
| | paired vs algorithm (algorithm-only / model-only right) | | 121 / 116, p 0.80 | 85 / 41, p 1e-4 |
| DEV-NOHIST (750) | top-1 | 0 (no answers) | **123 (16.4%)** | 8 (1.1%) |
| | wrong at ≥ 80 | 0 | 273 | 78 |
| | AI gave no option | 750 | 225 | 663 |
| | mean confidence right / wrong | | 82.5 / 83.0 | 86.9 / 90.8 |
| | median ms | | 117 | 81 |
| Suite (55, `-r 1 -g 1`) | top-1 (user-visible) | 62% | 56% (58%) | 51% (56%) |
| | wrong at ≥ 80 | | 27% | 24% |
| | CSV format / empty | | 100% / 7 | 100% / 14 |
| | prompt + answer tokens per request | | 560 + 15 (smallest prompt 540) | 560 + 14 |

1.7B vs 0.6B on DEV: 144 / 105 right only in one (p 0.016).

**Stock Qwen3-4B-Instruct-2507** (downloaded 2026-11-22, converted the same way:
`llmTraining/outputs/qwen3-4b-2507-stock-GGUF/qwen3-4b-2507-stock-Q8_0.gguf`, 4.28 GB), same
settings:

| Set | | Algorithm alone | Stock 4B-2507 Q8_0 |
|---|---|---|---|
| DEV | top-1 | 41.3% | **773 (51.5%)** |
| | top-3 | 49.0% | 52.9% |
| | wrong at ≥ 80 | 10 | 495 |
| | AI gave no option | | 163 |
| | mean confidence right / wrong | | 88.1 / 82.4 |
| | median ms | | 279 |
| | paired vs algorithm | | 82 / 235, p 3e-18 |
| DEV-NOHIST | top-1 | 0 | **255 (34.0%)** |
| | wrong at ≥ 80 | | 367 |
| | AI gave no option | | 76 |
| | mean confidence right / wrong | | 90.4 / 85.8 |
| Suite | top-1 (user-visible) | 62% | 67% (67%), wrong at ≥ 80 24%, CSV 100%, 556 + 11 tokens, median 247 ms |

Paired against the 1.7B: DEV 88 / 246 (p 2e-18), DEV-NOHIST 47 / 179 (p 3e-19). So the 4B beats
the algorithm on DEV by 10 points and doubles the 1.7B's no-history score, but it is as often
confidently wrong (495 on DEV, 367 of 674 answers on DEV-NOHIST), and its confidence separates
right from wrong little better (88 vs 82). This is the bar the fine-tunes must reach: D3 already
passed stock 4B on TEST (fine-tune plan), and Step 6 checks that on these sets.

**Reruns with `rawAnswer` (2026-11-22):** DEV and DEV-NOHIST rerun for all three models after
`rawAnswer` was added. 0 answers differ from the first runs in all six result files, and every
result now has `rawAnswer` (the first runs are kept in
`llmTrainingData/promptEval/results/before-rawAnswer/`).

**Why the AI gave no option** (each raw answer classified: no row; `"",0`; only rows at
confidence 0; or rows whose words the parser could not find in the verse, split by whether the
text is a history rendering, the GL phrase or part of it, or something else):

| | 1.7B DEV | 1.7B NOHIST | 0.6B DEV | 0.6B NOHIST | 4B DEV | 4B NOHIST |
|---|---|---|---|---|---|---|
| no option, total | 389 | 225 | 738 | 663 | 163 | 76 |
| not in verse: a history rendering | **167** | | 195 | | **83** | |
| not in verse: the GL phrase | 51 | 49 | **285** | **467** | | 4 |
| not in verse: other | 119 | 66 | 251 | 193 | 9 | 6 |
| said nothing fits `"",0` | 39 | **93** | | | 68 | **65** |
| only confidence 0 | 12 | 16 | | | 2 | 1 |
| no `"words",confidence` row | 1 | 1 | 7 | 3 | 1 | |

A sample of ten of the 1.7B's "other" answers on DEV: answers in the GL's language other than the
GL phrase itself (Russian `"написано"`, `"Некоторые из них"` for a Vietnamese verse with GL `ru`),
so the GL count is a lower bound; transliterations (`"yehoshua"`, `"jamāʿat"`); another spelling of a
history rendering (Arabic `أَقْوِيَاءُ` for history `ٱلْأَقْوِيَاءُ`); and part of a rendering.

What it shows:
- **Copying a history rendering that is not in the verse** is the biggest single failure with
  history (1.7B 167, 4B 83): weakness W3. X1's marks tell the model which renderings are not in the
  verse and which verse words are their other forms, so X1 should cut this group.
- **Answering in the gateway language** is the 0.6B's main failure (285 on DEV, 467 of 663 without
  history) and a large one for the 1.7B. Rule 1 already forbids it; the plan's earlier answer to
  Q10 (a rule that a verse word spelled like a GATEWAY PHRASE word is not the answer) was about
  the opposite case. A variant to try in Step 4 or 5: show the answer must be target-language
  words, e.g. a wrong example `"believers",90 - gateway words are not in TARGET VERSE` next to
  the right one, or the GL phrase repeated with `(do not answer with these words)`.
- **Without history the 4B mostly says nothing fits** (65 of 76), which is honest; the 1.7B does
  that 93 times and gives unmatched words 115 times.
- Format is not the problem: rows that cannot be read at all are 1-7 per run.

**Repeatability (D2):** DEV run twice on the 1.7B gave **0 different answers** of 1,500. So with
the seed, any difference between two variants is the prompt, not sampling; no noise floor is
needed.

What the baselines show:
- **On DEV the stock 1.7B adds nothing over the algorithm** (41.0% vs 41.3%, p 0.80), with 50x as
  many confident wrong answers (513 vs 10), and its confidence barely separates right from wrong
  (81.5 vs 74.4). The 0.6B is below the algorithm. This matches the fine-tune plan, where stock
  1.7B gained nothing at threshold 100.
- **It mostly gives one option:** top-3 is barely above top-1 (42.4% vs 41.0%), while the
  algorithm's top-3 is 49.0%.
- **No history is where the AI is the only help, and it is weak there.** The 1.7B gets 16.4%
  right, and its confidence says nothing (right 82.5, wrong 83.0); 273 of its 525 answers are
  wrong at ≥ 80. The 0.6B gives no option for 88% and gets 1.1% right. N1-N6 and X3 target this.
- **The AI gives no option often** (1.7B: 389 on DEV, 225 on DEV-NOHIST). The result files do not
  keep the model's raw answer, and the run log keeps only part of the console output (206 of
  2,250 answers, not in case order), so why is not known yet: `"",0`, words not in the verse, or
  unparseable rows. See the note under Step 3.
- The suite's single-request numbers are about as before for these models (user-visible 58% and
  56%, CSV 100%).

