# Plan: prompt experiments for answer spans, on the models translationCore ships

Written 2026-11-24 against commit `2e752cb` on branch `feature-mcleanb-add-suggestions-support`
(no `src` change in the working tree; the new training data in section 1 is committed with
this plan). **Line numbers are for `2e752cb`.** If `src/utils/checkingSuggestionsUtils.js` has
changed, find each function by name.

Goal: find prompt changes for **one request per query** (`llmGrouping` 1, the default) that make
the models in `~/translationCore/models` pick the words a translator would select more often.
Measure each change on the evaluation data (section 4). Do not guess.

This plan follows `plans/improve-single-prompt.md` (called **the previous plan** below). Read its
sections 1, 3 and 7 and the decision under each variant. It measured 20 variants (X1-X6, S1-S6,
N1-N6, Q-SAMP, Q-THINK) and retrained three times (R0, R1, R1b). None of its prompt changes was
adopted; its only adopted change was N5 (the no-history confidence cap, in code). **Do not re-run
its variants.** This plan tests a weakness that plan did not target: **answer spans** (section 1).

**Scope (author, 2026-11-24):** prompt changes only, **no retraining**. Comparisons use the
models in `~/translationCore/models` and the equivalent stock models (decision D3). The expected answers
(alignments) are the target (D9).

## 1. What we know, with evidence

### The models (checked 2026-11-24)

`~/translationCore/models` holds three GGUF files. `.model-digests.json` there records their
sha256, and they were checked against the builds in `llmTraining/outputs/`:

| File | What it is | sha256 (first 12) |
|---|---|---|
| `uw-tw-qwen3-1.7b-Q5_K_M.gguf` | the **released D3** fine-tune (= `llmTraining/outputs/release/uw-tw-qwen3-1.7b-GGUF/`) | `c1b04b6b5c5b` |
| `uw-tw-qwen3-0.6b-Q6_K.gguf` | the released D3 0.6B companion | `cc1adc1628ec` |
| `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` | stock 4B, **the publisher's Q4_K_M** (not the Q8_0 the previous plan converted) | `8cdb57cbb880` |

These are **not** R0 (`llmTraining/outputs/uw-tw-qwen3-1.7b-r0-GGUF/...Q5_K_M.gguf` is
`8ee03e6edc08`, the 0.6B R0 is `0ba2d62a0633`). R0 and r0v2 are out of scope (Q1).

### New training data (added 2026-11-24, committed with this plan)

Training data that no earlier plan used, committed with this plan. The prompt-eval
sets (`llmTrainingData/promptEval/`, built 2026-11-22 at `a6f2928`) and D3's and R0's data were
built before it.

| File | Cases | Project seen by D3? | Use here |
|---|---|---|---|
| `en_ult_gal_book_BSOJ_ar` (new) | 298 | no | **NEW-DEV** |
| `en_ult_jos_book_ru_gl_ru` (new) | 2,887 | no | **NEW-DEV** |
| `en_ult_luk_book_ru_gl_ru` (new) | 2,482 | no | **NEW-DEV** |
| `es-419_est_est_book_unfoldingWord_en` (new) | 140 | no | **NEW-DEV** |
| `bn_glt_2co_book_BSOJ_ar` (new) | 286 | yes (with GL en) | not used: same verses and answers as D3 training, another GL |
| `fa_glt_1ti_book_ru_gl_ru` (new) | 179 | yes (GL en) | not used, same reason |
| `te_glt_luk_book_ru_gl_ru` (new) | 1,898 | yes (GL en) | not used, same reason |
| `vi_glt_1co_book_ru_gl_ru` (new) | 1,456 | yes (GL en) | not used, same reason |
| `ru_rlob_luk_book_BSOJ_ar` (modified) | 1,274 → 1,295 | yes | FT-DEV cases come from the current file |
| `vi_glt_luk_book_BSOJ_ar` (modified) | 2,584 → 2,620 | yes | FT-DEV cases come from the current file |

- In both modified files, **every** case's `glPhrase`, `history` and `source` changed (likely a
  newer Arabic GL resource), and 21 and 36 cases were added. Case ids are unchanged, and 85 of
  FT-DEV's 629 cases come from these two files.
- The three `en_ult` files are the first English-target data outside TEST (the only other one is
  `en_ult_tit`, a TEST project). In the previous plan R1 failed on English targets with no
  history, so NEW-DEV also checks that a variant does not do the same.
- **`llmTrainingData/finetune-r0v2/`** (train 17,380 / valid 1,077 / test 601, same 9 test files
  as D3) trains on all eight new files, with `llmTraining/lora-r16-r0v2.yaml` (4,345 iters).
  Its output `llmTraining/outputs/lora-r16-r0v2/` has checkpoints up to iteration 3,000
  (11:06). The data manifest is stamped 12:45, after that. Retrains are out of scope here, so
  r0v2 is not scored. For a later plan: none of FT-DEV's 629 cases is in r0v2's training split,
  but NEW-DEV's files are.
- `llmTrainingData/.en_ult_luk_book_ru_gl_ru.json.UcAt8WI7Cb` (2.1 MB, 12:47) looks like an
  interrupted rewrite of that file. **The data was still changing when this plan was written:**
  Step 2 starts by checking it is settled (Q4).

translationCore now runs its own llama.cpp:
`../translationCore/vendor/llama-server/darwin-arm64/llama-server`, **build 12651** (commit
`f5e6915c2`), in router mode over the models folder
(`../translationCore/electronite/llamaServerManager.js:124`, `buildServerArgs`:
`--models-dir <dir> --models-max 1 --host 127.0.0.1 --port <free> --no-ui`, plus `--ctx-size`
and `--n-gpu-layers` only when the caller passes them). The previous plan's Homebrew
`llama-server` (build 12359) is no longer installed.

### The current single prompt

`buildLlmSystemPrompt` (`checkingSuggestionsUtils.js:1064`) → `LLM_SINGLE_SYSTEM_PROMPT` (`:1112`),
with rule 3 `LLM_PREVIOUS_TRANSLATION_RULE_SINGLE` (`:1031`) and Example 2
`LLM_INFLECTED_FORM_EXAMPLE` (`:1041`). The request text comes from `buildTranslationOptionsPrompt`
(`:1132`), and its history lines from `formatPreviousTranslations` (`:874`, keys ranked by
`rankGlKeys`, `:1244`). Rule 2 reads:

> 2. Choose the fewest words that carry the meaning of GATEWAY PHRASE, kept in verse order.

Eval-side hooks that already exist: `setSinglePromptOverrideForEval` (`:2896`); variants in
`__tests__/helpers/promptVariants.js` (`PROMPT_VARIANTS`, `:815`; `editPrompt`, `:36`;
`buildRequestText`, `:54`; `buildBaseline`, `:70`); the runner `__tests__/runLlmTrainingData.test.js`
(`LLM_PROMPT_VARIANT`, `LLM_TRAINING_*`, header lines 1-50); and `scripts/compare-prompt-variants.js`
(scores the way the app shows answers, with paired counts and an exact McNemar p).

### How the released fine-tunes fail (the new evidence)

Each top-1 answer of the saved `baseline` runs of D3 on TEST (the previous plan's Step 6, seed 42,
`llmTrainingData/promptEval/results/test*_uw-tw-qwen3-*_prompt-baseline.results.json`) was sorted
by how it differs from the expected answer. Scored the way the app shows answers (the algorithm
when the AI gives nothing). Script: section 4, Step 1.

| D3 run | right | **too short** (expected words minus some) | too long (extra words) | right words, wrong occurrence | partial overlap | other words | no answer |
|---|---|---|---|---|---|---|---|
| 1.7B TEST (835) | 563 | **136** | 46 | 23 | 14 | 50 | 3 |
| 1.7B TEST-NOHIST | 453 | **123** | 86 | 19 | 24 | 96 | 34 |
| 0.6B TEST | 534 | **119** | 54 | 23 | 31 | 70 | 4 |
| 0.6B TEST-NOHIST | 302 | 106 | 73 | 13 | 27 | 210 | 104 |

- **Span errors are most of the 1.7B's errors with history:** 182 of 272 wrong answers are too
  short or too long. Of the 136 too-short answers, 103 miss one word.
- **Too-short answers come mostly from multi-word GL phrases:** 87 of 136 (1.7B) and 79 of 119
  (0.6B). Top-1 for the 1.7B is 285/444 (64%) on multi-word phrases against 278/391 (71%) on
  single-word ones. The missing word is typically the one that translates a small GL word in the
  phrase. Examples (bn, GL en): "for Christ" → answered `খ্রীষ্টের`, expected `খ্রীষ্টের জন্য`
  (জন্য = for); "by grace" → `অনুগ্রহ`, expected `অনুগ্রহ দ্বারা`; "even Christ" → `খ্রীষ্টের`,
  expected `এমনকি খ্রীষ্টের`; "may know" → `জানতে`, expected `জানতে পার`.
- **40 of the 136 too-short answers are a history rendering copied whole.** The expected answer
  is a history rendering in only 5 of them. The model copies the rendering of a shorter, related
  GL key (e.g. `"খ্রীষ্টের" (chosen 4 times for "Christ")` for the phrase "for Christ") and does
  not add the word for the rest of the phrase.
- **Too-long answers come mostly from single-word GL phrases** (26 of 46, 1.7B TEST), so a
  change that makes spans longer must be checked for raising this count.
- Rule 2 ("the fewest words") points the model toward the short answer. The fine-tunes learned
  mostly from labels, not rules, so whether rewording rule 2 moves them is unknown. That is what
  Step 3 measures.
- **The fine-tunes always give exactly one option** (0 of 835 results with more than one), so
  top-3 = top-1 for the AI's own answer. Prompt changes cannot raise it (left out, section 6).
- **Words not in the verse are rare for the fine-tunes:** the AI gave no option in 3 of 628
  TEST requests (1.7B). So constrained decoding, and a guard against answers in the gateway
  language (the stock 0.6B's main failure in the previous plan), are left out for them.

**Caution: these numbers come from TEST**, which the previous plan has already used several
times. The hypotheses come from TEST, so they **must be confirmed on FT-DEV and NEW-DEV before
any variant is built** (Step 2), and TEST is used once more at the end (Step 5). Report that with
the results.

## 2. Hypotheses

- **H1. Rule 2 makes spans too short.** Replacing "the fewest words" with "the words that
  translate every word of GATEWAY PHRASE" raises top-1 on multi-word phrases, and raises too-long
  answers on single-word phrases by less than it lowers too-short ones. Targets the 136.
- **H2. A worked example of a multi-word phrase helps more than the rule alone.** Both examples
  today have one-word phrases, so the model has never seen an answer that covers a function word.
- **H3. Showing that a history line is for part of the phrase stops the whole-rendering copy.**
  Today the line shows its key (`for "Christ"`), but nothing says that "Christ" is not the whole
  phrase "for Christ". Targets the 40 copies.
- **H4. The fine-tunes may follow their training more than the rules.** They learned from about
  10,000 labelled examples, so a rewording (C1, C2) may change few of their answers, while the
  stock models of the same size, which read the rules, change more. Comparing each fine-tune with
  its stock equivalent (decision D3) shows which it is. If only the stock models move, the fix for the
  fine-tunes would be a retrain, which is out of scope: record it for a later plan.

## 3. Decisions

- **D1. Server: the app's own llama-server, the app's way.** Run the bundled binary from
  `../translationCore/vendor/llama-server/darwin-arm64/llama-server` (build 12651) in router mode,
  as `buildServerArgs` does, on a fixed port, over an eval folder `llmTraining/outputs/eval-models/`
  (git-ignored, like all of `outputs/`) that holds **hard links** to the three files in
  `~/translationCore/models` and the two stock builds of D3:
  `llama-server --models-dir llmTraining/outputs/eval-models --models-max 1 --host 127.0.0.1 --port 8080 --no-ui`.
  Hard links take no disk space (both folders are on the same volume, checked 2026-11-24), and
  stock models are kept out of `~/translationCore/models`, so the app does not list them. Record
  `--version` and the five sha256 values with every run. Model ids are whatever
  `GET /v1/models` lists (Step 0 writes them down). Quit LM Studio's server during runs. Why: the
  previous plan found that answers depend on the engine build (fine-tune plan, "Which engine is
  right"), so measure on the build users run.
- **D2. Sampling.** Temperature 0.1 (the app's default), `LLM_TRAINING_EXTRA_PARAMS='{"seed":42}'`,
  thinking off. Step 0 confirms that a repeat run gives 0 different answers under router mode. If
  it does not, use the number that differ as the noise floor, and record that.
- **D3. Models and roles** ("D3" elsewhere in this plan is the released fine-tune; this
  decision is "decision D3". Author, 2026-11-24: the models in `~/translationCore/models` and the
  equivalent stock models). Each fine-tune is paired with its base model at the **same
  quantization**, so that only the training differs between the two:

  | Shipped model (gates adoption) | Stock equivalent (comparison) |
  |---|---|
  | D3 1.7B, `uw-tw-qwen3-1.7b-Q5_K_M.gguf` (**primary**) | Qwen3-1.7B Q5_K_M, `qwen3-1.7b-stock-Q5_K_M.gguf` (built in Step 0) |
  | D3 0.6B, `uw-tw-qwen3-0.6b-Q6_K.gguf` | Qwen3-0.6B Q6_K, `qwen3-0.6b-stock-Q6_K.gguf` (built in Step 0) |
  | Qwen3-4B-Instruct-2507 Q4_K_M (already stock) | itself |

  The stock 1.7B and 0.6B are built with `llama-quantize` from the bf16 files already in
  `llmTraining/outputs/qwen3-{1.7b,0.6b}-stock-GGUF/`, which were converted with the
  `llmTraining/.llama.cpp` checkout at `b1b770d90`, the converter of the fine-tune GGUFs (the
  previous plan's section 7). The previous plan's stock runs were Q8_0, so they are not reused.
  The stock 1.7B and 0.6B do not gate adoption (users are not offered them). They show whether a
  change works by being read (H4). **One prompt for every model** (the previous plan's Q2 answer:
  no prompt chosen by model name).
- **D4. Data sets.**
  - **FT-DEV** (new, the screening set): the 629 cases of D3's validation split
    (`llmTrainingData/finetune-d3/valid.meta.jsonl`), keeping only those the app sends to the AI
    (current algorithm top confidence below `ALGORITHM_CERTAIN_CONFIDENCE`, 95), plus
    **FT-DEV-NOHIST** (the same cases with `history` `{}`). Checked 2026-11-24: none of the 629
    is in D3's training split, so it is fair for D3 (stock models never trained on any
    project). It comes from the training
    projects, so its scores run higher than TEST: use it for **paired comparisons only**, not as
    a model's accuracy. Cases are taken from the **current** data files (the app would send the
    current GL text), so the 85 from the two modified files differ from what D3 was validated on.
  - **NEW-DEV** (new, the second screening set): cases the app sends to the AI from the four
    new-project files (`en_ult_gal`, `en_ult_jos`, `en_ult_luk`, `es-419_est_est`), seeded
    (20261124), about 1,000 cases with no file over 40%, plus **NEW-DEV-NOHIST**. No model in
    `~/translationCore/models` has seen these projects, so this is the fairest set for D3 and the
    only one not drawn from training projects. Its weakness: three of the four files are English
    targets, so report `en` and `es-419` targets separately.
  - **DEV / DEV-NOHIST** (existing, `llmTrainingData/promptEval/`): for the three stock models
    only (DEV is training data for the fine-tunes). The largest set, so it is the stock models'
    main screen.
  - **TEST / TEST-NOHIST** (existing): confirmation, once, in Step 5.
- **D5. Metrics** for every run: top-1 (as the app shows it), top-1 on multi-word and on
  single-word GL phrases, the span breakdown of section 1 (too short / too long / wrong
  occurrence / partial / other / no answer), wrong at confidence ≥ 80, median ms. Also the token
  count of the fixed system prompt, from `POST /tokenize` on the loaded model (llama-server
  caches the fixed system prompt, so per-request time is the measure that matters; the previous
  plan found S1's half-length prompt no faster).
- **D6. Adoption rule** (as the previous plan's D5): a variant beats its parent when:
  - on **at least one shipped model** (D3 1.7B, D3 0.6B, 4B), top-1 is higher with McNemar
    p < 0.05 on FT-DEV **or** NEW-DEV (for the 4B also DEV), and not significantly worse
    (p < 0.05) on the others;
  - **no shipped model** is significantly worse on any of FT-DEV, NEW-DEV, their NOHIST sets,
    or (4B) DEV and DEV-NOHIST;
  - for each shipped model, wrong at ≥ 80 is not higher by more than 1% of cases.
  A gain for D3 1.7B, the primary model, counts most: if two variants pass, prefer the one with
  the larger D3 1.7B gain. The stock 1.7B and 0.6B are reported with every variant but do not
  gate. If variants tie, keep the shorter prompt. Every variant gets a results row, adopted or not.
  With 629 cases a gain of about 3 points is detectable, and 1-2 points usually is not. Say so
  when a variant is close.
- **D7. Out of scope and unchanged:** the batched prompt and its constants
  (`LLM_BATCH_BASE_SYSTEM_PROMPT`, `LLM_BATCH_SYSTEM_PROMPT`). The fine-tunes need single requests
  anyway. No retraining (author, 2026-11-24). Thinking stays off (author, 2026-11-23: too slow). The app's prompt changes only in
  Step 6. Until then variants live in `promptVariants.js` and reach the app's code path through
  `setSinglePromptOverrideForEval`.
- **D8. Example language.** A new worked example uses German, which is already in the prompt
  (Example 2) and in no eval set, so copied example words show up as "other words" answers.
  Count raw answers containing the example's words, as the previous plan did for N2 (the
  copying problem it called W10).
- **D9. The expected answers (alignments) are the target** (author, 2026-11-24, Q2). When the
  alignment includes the word for a small GL word (`খ্রীষ্টের জন্য` for "for Christ"), that is the
  right answer. No hand-check against tW selection habits is needed.

## 4. Steps

### Step 0. Starting point (OFFLINE, then LIVE)

1. `git log -1` shows `2e752cb` or later; `npm test` passes; the names in section 1 exist.
2. Build the two stock models of decision D3. Build only the `llama-quantize` target of the
   `llmTraining/.llama.cpp` checkout (`cmake -B build && cmake --build build --target
   llama-quantize`; it is at `b1b770d90`, record it), then:
   `llama-quantize llmTraining/outputs/qwen3-1.7b-stock-GGUF/qwen3-1.7b-stock-bf16.gguf llmTraining/outputs/qwen3-1.7b-stock-GGUF/qwen3-1.7b-stock-Q5_K_M.gguf Q5_K_M`
   and the same for `qwen3-0.6b-stock` with `Q6_K`. About 1.8 GB in all. The disk had 30 GB free
   on 2026-11-24 (97% full), so check `df -h` first.
3. Make `llmTraining/outputs/eval-models/` with hard links (`ln`, not `ln -s`) to the three files
   in `~/translationCore/models` and the two new stock files. Start the server per D1. Record
   `llama-server --version`, `GET /v1/models` (it must list all five; the ids are what to pass as
   `LLM_TRAINING_MODEL`) and the sha256 of the five files. If the router does not list a hard
   link, run a second server over `~/translationCore/models` on port 8081 instead.
4. Rerun `baseline` with D3 1.7B on TEST, `LLM_TRAINING_DATA_DIR=llmTrainingData/promptEval
   LLM_TRAINING_FILES=test`, twice. (TEST is safe to run here: these are the same requests the
   previous plan already scored. Only the engine is new.)

**Done when:** the two runs differ in 0 answers (or the count is recorded as the noise floor),
and the number of answers that differ from the previous plan's Homebrew-build run
(`test_uw-tw-qwen3-1.7b-q5_k_m_prompt-baseline.results.json`) is written in section 8. If many
differ, that is a finding about the bundled engine: report it to the author before going on.

**Done 2026-11-24** at `9247511` (results in section 8, "Step 0").

### Step 1. Span breakdown in the comparison script (OFFLINE)

Add the section 1 breakdown to `scripts/compare-prompt-variants.js` (or a helper it imports):
for each wrong top-1, classify it as too short (answer words ⊂ expected), too long (expected ⊂
answer), right words at the wrong occurrence, partial overlap, other words, or no answer. Compare
words after `normalizer` + lowercase, as `normalizePhrase` does, with the expected text's `:n`
suffixes removed. Also print top-1 split by GL phrase word count (1 vs more than 1). Print it for
both runs, with the paired counts per group.

**Done when:** a unit test in `__tests__/promptVariants.test.js` covers each category on
hand-made cases, `npm test` passes, and running it on the saved D3 1.7B TEST baseline reproduces
section 1's row (563 right, 136 too short, 46 too long, 23 wrong occurrence).

### Step 2. FT-DEV and NEW-DEV sets, baselines, and the hypotheses rechecked (OFFLINE, then LIVE)

0. **Check the data is settled.** No builder or training is running (`ps aux | grep -E
   "jest|mlx_lm"`), no `llmTrainingData/.*.json.*` temp file is left, and `git status
   llmTrainingData` shows no change to the committed data files (`*.json` at the top level). If
   they have changed since this plan's commit, rerun section 1's table and note the differences. Ask the author about a
   leftover temp file; do not delete it. Record the sha256 of every data file the sets are
   built from in `meta/manifest.json`, so a later rebuild can be checked.
1. Extend `npm run build:prompt-eval-cases` (`__tests__/buildPromptEvalCases.test.js`, helpers in
   `__tests__/helpers/promptEvalCases.js`) to also write `ftdev.json` and `ftdev-nohist.json`. Take
   the case ids from `llmTrainingData/finetune-d3/valid.meta.jsonl` (`file` + `id` → case id
   `<file>/<id>`), take each case from `llmTrainingData/<file>.json` with `toEvalCase`, add
   `glVerse` as the other sets do, and drop the cases whose algorithm top confidence is now ≥ 95.
   Also write `newdev.json` and `newdev-nohist.json` per D4 (reuse `selectDevCases` with the
   four new-project files as candidates and the 40% per-file cap). The algorithm runs before
   selection, as for DEV, so cases it is certain about are left out.
   Record the counts in `meta/manifest.json`. **The existing four files must come out
   byte-identical:** they were built from the data files as they were on 2026-11-22, and the two
   modified files have changed since. If the builder rebuilds DEV from the current files, DEV
   changes. So write the new sets without rebuilding the old ones (e.g. a
   `LLM_PROMPT_EVAL_SETS=ftdev,newdev` setting), and check the old four with `cmp` against copies
   taken first (`llmTrainingData/promptEval/` is not committed).
2. Algorithm run: `LLM_TRAINING_DATA_DIR=llmTrainingData/promptEval LLM_TRAINING_FILES="ftdev ftdev-nohist newdev newdev-nohist" npm run run:llm-training-data`.
3. `baseline` on FT-DEV, FT-DEV-NOHIST, NEW-DEV and NEW-DEV-NOHIST for all five models (decision D3), and
   on DEV and DEV-NOHIST for the three stock models (the previous plan's DEV numbers were Q8_0
   builds, so they are not reused).
4. Run Step 1's breakdown on the FT-DEV and NEW-DEV baselines, and count H3's case: wrong
   answers that are a history rendering copied whole whose GL key is not the exact phrase. Put
   each fine-tune next to its stock equivalent: do the stock models make the same span errors?

**Done when:** baseline rows for every model and set are in section 8, with the breakdown.
**Gate:** if on FT-DEV and NEW-DEV together, with D3 1.7B, the too-short answers are fewer than 30, or fewer than
half of them come from multi-word phrases, H1/H2 are not supported. Then stop and report to the
author instead of running Step 3. If the H3 count is under 20, drop C3 and C4.

### Step 3. Span variants (LIVE, FT-DEV and NEW-DEV, each with its NOHIST set)

Each variant goes in `PROMPT_VARIANTS` as an edit of the app's prompt (`editPrompt`), with a unit
test of its text. Run every variant on all five models, on FT-DEV, NEW-DEV and their NOHIST sets.
That is about 3,300 requests per model, a few minutes each at the previous plan's speeds (77-280 ms
median). DEV runs for the stock models are Step 4.

- **C1. Rule 2 covers the whole phrase.** Replace rule 2 with:
  `2. Choose the verse words that translate all of GATEWAY PHRASE, including any small words in it, and no other words. Keep them in verse order.`
  Rule 3 ("do not add or drop small words") stays: it is about copying a history rendering
  exactly, which does not conflict.
- **C2. C1 + a multi-word example.** Add after Example 2:
  ```
  Example 3:
  TARGET VERSE (de): wir beten für die Gemeinde in Rom

  PREVIOUS TRANSLATIONS:
  "Gemeinde" (chosen 6 times for "church")

  GATEWAY PHRASE (en): for the church

  Answer:
  "für die Gemeinde",80
  ```
  Confidence 80 follows rule 5's 60-89 band (the history covers only part of the phrase). Check
  copying per D8 (raw answers containing "Gemeinde" or "für die").
- **C3. History lines for part of the phrase are marked.** In the request text only: a history
  line whose key is not the exact GL phrase (`isExact` false in `rankGlKeys`) ends with
  ` - for part of the phrase` (exact lines unchanged). Add one sentence to the PREVIOUS
  TRANSLATIONS field line in the system prompt: `A line marked "for part of the phrase" may need
  more verse words.` Build it with a `markPartialKey` option on `formatPreviousTranslations`,
  default off, the way the previous plan built X1's `markVerseFit`. The app's output must not
  change: the existing tests and the fine-tune parity test must still pass.
- **C4.** The best of C1/C2 combined with C3, run only if both pass on their own.

Also run the ablation **C0** (rule 2 deleted, the other rules renumbered) to separate "fewest
words removed" from "new wording added". It is diagnostic only and is not adopted on its own.

**Done when:** every C variant has a row with D5's metrics and paired counts against `baseline`
(C4 also against its parts), with each fine-tune beside its stock equivalent. For H4, report
how many FT-DEV answers each variant changes, for each fine-tune and its stock equivalent.

### Step 4. Guard runs (LIVE)

For each variant not ruled out in Step 3 (no shipped model significantly worse): the three stock
models on DEV and DEV-NOHIST, the 4B's being part of D6 and the other two for comparison.

**Done when:** rows are in section 8, and the D6 decision is final for each variant.

### Step 5. Confirm on TEST (LIVE)

For the adopted variant `F`: `baseline` and `F` on TEST and TEST-NOHIST for all five models,
seed 42. Then twice more at the app's settings
with no seed. Then the suite: `scripts/test-llm.sh -r 3 -g 1 -u http://localhost:8080 <model>`.

**Done when:** `F` is not significantly worse than `baseline` on TEST for any shipped model. If
it is, the screening gain was tuning to FT-DEV or NEW-DEV: report that and stop. Rows go in section 8, with the warning
that TEST has now been used many times.

### Step 6. Put the result in the app (OFFLINE)

Only if a variant was adopted.
1. Move it from `promptVariants.js` into `buildLlmSystemPrompt` / `buildTranslationOptionsPrompt`
   (and `formatPreviousTranslations` for C3). Single path only: the batch constants stay
   untouched (D7).
2. Rename `baseline` in `promptVariants.js` to `v1`, so old runs stay reproducible (the previous
   plan's Step 9 asked for this and was never needed).
3. Update the tests that assert prompt text, the fine-tune parity test
   (`__tests__/buildFineTuneData.test.js`), the prompt description in `CLAUDE.md` (under
   "Auto-select suggestions"), and the comment above `LLM_SINGLE_SYSTEM_PROMPT`.
4. The fine-tune training data must match the app's prompt (the parity test checks it), so
   the next retrain, in a later plan, trains on the new prompt. Record that in
   `plans/fine-tune-qwen3.md`.

**Done when:** `npm test` passes, the batch tests are unchanged, and `baseline`/`v1` reproduce
the app's old prompt byte for byte.

## 5. Risks

- **Longer spans on single-word phrases.** C1/C2 may add articles or particles where the
  expected answer is one word. Step 1's "too long" count on single-word phrases is the check.
- **The training data was changing while this plan was written** (section 1). Sets are built
  once, with checksums (Step 2.0). A later change to the data files does not change them.
- **NEW-DEV is mostly English targets.** Report `en` and `es-419` separately. A variant that
  helps only on English targets is not adopted on NEW-DEV alone.
- **FT-DEV is small and comes from the training projects.** Paired tests handle the first. The
  second can inflate absolute scores, which is why only paired differences are used.
- **TEST has been looked at many times**, including to form this plan's hypotheses. Step 2's
  gate and the FT-DEV screening guard against that. Report it with the Step 5 rows.
- **The fine-tunes may not respond to rule changes** (H4). Then nothing passes D6 for them, and
  the result is a finding for a later retrain plan, not a failure of this one.
- **A prompt change reaches every user of every model.** One prompt for all models, so D6
  needs every shipped model to be not significantly worse.
- **The engine changed** (build 12359 → 12651, router mode). Step 0 measures the difference.
  Don't compare new rows with the previous plan's numbers.

## 6. Left out, with reasons

- The previous plan's variants (X1-X6, S1-S6, N1-N6, Q-SAMP, Q-THINK): measured, not adopted.
  The 4B-only no-history gains (X3, X6, N3, N34) are not re-run, because the prompt has to be one
  for all models and none of them helped the primary model.
- More options per answer: the fine-tunes give one option per answer. That comes from training
  labels, not from the prompt.
- Wrong occurrence (23 on TEST): placing the answer is `moveSelectionsToOccurrence`'s job (the
  previous plan's X5).
- Constrained decoding (a grammar limited to verse words) and a gateway-language guard: the
  fine-tunes almost never answer with words that are not in the verse (section 1).
- Retraining, and scoring R0 or r0v2 (author, 2026-11-24). A variant that would need a
  retrain to help the fine-tunes is recorded for a later plan.
- Batched prompt, thinking, `translatePhraseWithConfidence` (the older single-phrase path, not
  touched).

## 7. Open questions for the author

- **Q1. Which models?** Answer (2026-11-24): the models in `~/translationCore/models` and the
  equivalent stock models (decision D3). R0 and r0v2 are not used.
- **Q2. Should a tW selection include the words for GL function words?** For "for Christ", is
  `খ্রীষ্টের জন্য` or only `খ্রীষ্টের` the right selection? Answer (2026-11-24): use the expected
  answers (alignments) (D9).
- **Q3. Retrain budget.** Answer (2026-11-24): retrains are out of scope for this plan.
- **Q4. Is the new data final?** The eight new files and two changed ones are committed with
  this plan (each parses as complete JSON), but
  `llmTrainingData/.en_ult_luk_book_ru_gl_ru.json.UcAt8WI7Cb` (not committed) looks like an
  interrupted rewrite of `en_ult_luk_book_ru_gl_ru.json`. Should NEW-DEV wait for a rebuild of
  that file?

## 8. Results

(One row per run: variant, model, set, cases, top-1, multi-word / single-word top-1, too short,
too long, wrong ≥ 80, no answer, median ms, system prompt tokens, paired vs parent
(only A / only B, p), decision.)

### 2026-11-24: Step 0

- `npm test`: passed (386 tests, 24 skipped; lint clean).
- **`llama-quantize`**: built from `llmTraining/.llama.cpp` at `b1b770d90` in a separate folder,
  `llmTraining/.llama.cpp/build-quantize/`, with Apple clang (`CC=/usr/bin/clang
  CXX=/usr/bin/clang++`) and `-DGGML_NATIVE=OFF`. That clang rejects `-mcpu=native`, so the
  default build fails. The existing `build/` folder was left alone. The checkout shows 4,037
  modified files, but they are file-mode changes only (no content). Check: re-quantizing
  `qwen2.5-0.5b-stock-bf16.gguf` to Q8_0 gave a file **byte-identical** to the earlier
  `qwen2.5-0.5b-stock-Q8_0.gguf`.
- **Stock builds** (logs `quantize-Q5_K_M.log` / `quantize-Q6_K.log` next to them):
  `llmTraining/outputs/qwen3-1.7b-stock-GGUF/qwen3-1.7b-stock-Q5_K_M.gguf` (1.47 GB; larger than
  D3's 1.26 GB because Qwen's stock checkpoint keeps a separate `output.weight`, see the previous
  plan's section 7) and `llmTraining/outputs/qwen3-0.6b-stock-GGUF/qwen3-0.6b-stock-Q6_K.gguf`
  (0.62 GB).
- **Eval folder** `llmTraining/outputs/eval-models/`: hard links (link count 2, same inodes as
  the originals). sha256 in `llmTraining/outputs/eval-models.sha256.txt`:

  | Model id (`GET /v1/models`) | sha256 (first 12) |
  |---|---|
  | `uw-tw-qwen3-1.7b-Q5_K_M` | `c1b04b6b5c5b` |
  | `uw-tw-qwen3-0.6b-Q6_K` | `cc1adc1628ec` |
  | `Qwen3-4B-Instruct-2507-Q4_K_M` | `8cdb57cbb880` |
  | `qwen3-1.7b-stock-Q5_K_M` | `ff813065f7ae` |
  | `qwen3-0.6b-stock-Q6_K` | `0bd6bc62b8ac` |

- **Server**: `../translationCore/vendor/llama-server/darwin-arm64/llama-server`, `version:
  1.0.0-dev (build 12651, commit f5e6915c2)`, started as D1 says on port 8080. The router lists
  all five hard links, so no second server is needed. Logs, the model list and the runs are in
  `llm-eval-results/span-step0-20261124/`. translationCore's own server (router over
  `~/translationCore/models`, with the 4B loaded) was running at the same time.
- **Repeatability and engine** (D3 1.7B, `baseline`, TEST, seed 42):

  | Run | top-1 | differ from run A (answer, confidence or raw text) | median ms |
  |---|---|---|---|
  | A (build 12651, router) | 67.4% | | 226 |
  | B (build 12651, router) | 67.4% | **0 of 835** | 207 |
  | previous plan (Homebrew build 12359, single model) | 67.4% | **0 of 835** | 102 |

  So seeded runs repeat exactly under router mode (no noise floor is needed), and the bundled
  engine gives the same answers as the build the previous plan used. **Time per request about
  doubled.** The likely causes are the router's proxy to a child server and translationCore's
  server running at the same time; this was not measured. Compare times only within this plan's
  runs.
- **File-name clash (for later steps):** the runner names result files after the model id
  (`test_uw-tw-qwen3-1.7b-Q5_K_M_prompt-baseline.results.json`), and macOS file names ignore
  case, so a TEST run of a released model **overwrites** the previous plan's lowercase-named file.
  The previous plan's D3 TEST and TEST-NOHIST files were copied to
  `llmTrainingData/promptEval/results/before-span-plan/` first and restored after the runs. Do
  the same before Step 5's TEST runs. The FT-DEV and NEW-DEV sets are new names, so they cannot
  clash.

