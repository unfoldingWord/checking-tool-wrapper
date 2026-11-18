# Plan: fine-tune `qwen3-1.7b` for translationWords suggestions (MLX on a Mac, Unsloth as alternative)

Written 2026-11-15 against commit `042a838` ("Add training data runner for JSON folders") on
branch `feature-mcleanb-add-suggestions-support`. **Line numbers are for `042a838`.** If
`src/utils/checkingSuggestionsUtils.js` has changed, find each function by name.

**Main route: Apple MLX (`mlx-lm`) on the development Mac** (Apple M5 Pro, 48 GB unified memory,
LM Studio installed; `mlx-lm` not installed yet). The `mlx-lm` commands and config keys below are
from my knowledge of the library, not yet run here: check them against `mlx_lm.lora --help` for the
installed version.

Unsloth on a Mac (checked in Unsloth's docs on 2026-11-15): the **Unsloth Studio / Desktop app**
trains on macOS with an MLX backend, with LoRA exports to PEFT or GGUF. The docs show no Mac route
for the **Unsloth Core Python library** (`FastLanguageModel` / `SFTTrainer` scripts), and do not say
whether full fine-tuning works on Mac. This plan needs scripted, repeatable runs and control over
the chat template and loss masking, so `mlx-lm` (the same MLX engine, used directly) stays the main
route. Unsloth Studio on the Mac is Appendix B, an optional cross-check; Unsloth Core on an NVIDIA GPU
is Appendix A, for a full fine-tune that is too slow or too large for the Mac.

Goal: a fine-tune of Qwen3-1.7B that gives better AI suggestions than the stock
`qwen/qwen3-1.7b` (and ideally `qwen/qwen3-4b-2507`) when translationCore sends it the **same
prompt it sends today**, so the app needs no code change to use it: only a different model name in
the settings.

## 1. What we have (measured at `042a838`)

**Training cases.** `llmTrainingData/*.json`: 39 files, **26,369 cases**, 579 tW groups, built by
`__tests__/buildLlmTrainingData.test.js` from translators' word-aligned projects. Each case has
`verse`, `targetLang`, `glPhrase`, `glLang`, `history` (correct answers of earlier checks in the
same group), `expected` (e.g. `"Chúa:3 Cứu:2 Thế"`), `selections` and `contextId`.
- 12,976 cases (49%) have a multi-word answer; 475 are for an occurrence above 1.
- In 14,088 cases (53%) the answer is literally one of the history renderings.
- The same target verses appear in several files: e.g. `vi_glt_luk` with GL `en`, `ru` and `ar`;
  every `*_tit_book` project with GL `en` and `es-419`; `en_ult_tit` with five GLs.
- Sizes are very uneven: `ru_rlob_gen` 4,900, `ar_avt_psa` 4,046, the three `vi_glt_luk` files
  8,372 together; several Titus files have under 50.

**Algorithm baseline** (`llmTrainingData/results/*_Algorithm.summary.json`, from
`npm run run:llm-training-data`): top-1 **55.7%** (14,684), top-3 61.6%, no suggestion 2,258.

Split by algorithm confidence (my own quick count, comparing option text to `expected` after
lowercasing only, without `normalizer`, so approximate):

| Algorithm top confidence | Cases | Top-1 right |
|---|---|---|
| 100 (app answers without the AI, `algorithmFirst`) | 11,276 | ~81% |
| below 100 (app sends these to the AI) | 15,093 | ~37% |

So the AI only ever sees the ~15k harder cases. That is where the fine-tune has to win.

**What the app sends** (single request, the default: `DEFAULT_SUGGESTION_REQUESTS_PER_CALL = 1`,
`src/Container.js:95`):
1. `getBestSelections` (`checkingSuggestionsUtils.js:3962`) builds `wordList = getWordList(verseText)`.
2. `getBestTWordSelectionWithConfidenceFromLlm` (`:2337`) calls
   `buildTranslationOptionsPrompt(wordList.join(' '), targetLangCode, glPhrase, glLangCode, history)`
   (`:898`) → `{ systemPrompt: LLM_SINGLE_SYSTEM_PROMPT, input }`.
3. `queryAiAPI` (`:345`) prefixes **both** with `/no_think\n` (thinking off, `:359-360`).
4. `streamChatMessage` (`:134`) sends `messages: [{system}, {user}]`, temperature 0.1,
   `chat_template_kwargs: { enable_thinking: false }`.

Batched (`llmGrouping` > 1): `getBestTWordSelectionsBatchFromLlm` (`:2512`) builds each request
with `forBatch = true`, joins them as `### REQUEST n` blocks ending in `Answer:`, and uses
`LLM_BATCH_BASE_SYSTEM_PROMPT + LLM_BATCH_SYSTEM_PROMPT`.

Expected answer format (system prompt rules 4-6): CSV rows `"words",confidence`, 1-3 rows, best
first; `"",0` when nothing fits. Parsed by `parseLlmSelectionOptions` (`:2224`).

### Stock models against the algorithm (measured 2026-11-17)

`npm run run:llm-training-data` with an AI model, on 9 training files (5,349 cases: `vi_glt_heb`,
`fa_glt_mrk`, `ru_rlob_luk`, `te_glt_luk`, `ar_avd_heb`, `ne_glt_2co`, `bn_glt_2co`, `id_glt_1ti`,
`es-419_est_rut`, GL `unfoldingWord/en`), one run each, temperature 0.1, LM Studio on the Mac.
Bands are the algorithm's top confidence; the AI is scored as the app shows it, falling back to the
algorithm when the AI gives no option. Pooled results are in
`llmTrainingData/results/<model>.byAlgorithmConfidence.json`.

| Algorithm confidence | Cases | Algorithm | `qwen3-1.7b-mlx` | `qwen/qwen3-4b-2507` |
|---|---|---|---|---|
| 100 (algorithm answers, `algorithmFirst`) | 1,958 | 83.9% | 83.9% | 83.9% |
| 90-94 | 947 | 57.4% | 52.6% (-4.9) | 58.4% (+1.0) |
| 85-89 | 285 | 53.3% | 50.2% (-3.2) | 56.8% (+3.5) |
| 80-84 | 435 | 53.6% | 49.9% (-3.7) | 57.9% (+4.4) |
| 60-79 | 408 | 59.1% | 53.9% (-5.1) | 61.8% (+2.7) |
| 1-59 | 584 | 18.3% | 19.0% (+0.7) | 31.2% (+12.8) |
| no algorithm answer | 727 | 0% | 12.7% | 25.2% |

Top-1 at each `ALGORITHM_CERTAIN_CONFIDENCE` (the algorithm answers at or above it):

| Threshold | 100 | 90 | 80 | 60 | 1 |
|---|---|---|---|---|---|
| `qwen3-1.7b-mlx` | 54.7% | 55.6% | 56.1% | **56.5%** | 56.4% |
| `qwen/qwen3-4b-2507` | **60.4%** | 60.2% | 59.7% | 59.5% | 58.1% |

The algorithm alone scores 54.7%. So the app with stock 1.7b at today's threshold of 100 adds
nothing over the algorithm, and its best threshold is 60; 4b beats the algorithm in every band and
is best at 100. **This is the bar for the fine-tune:** the stock 1.7b is 3-5 points below the
algorithm at 60-94, where 4b is 1-4 points above it. Time for the ~2,900 AI requests: 1.7b 11 min,
4b 18 min (about 225 and 370 ms each). The 1.7b here is LM Studio's MLX build, not the
`qwen/qwen3-1.7b` that `plans/improve-llm-suggestions.md` measured.

AI runs of `run:llm-training-data` before 2026-11-17 are not valid: jest has no `fetch`, so every
AI request failed and those cases got no suggestion. The runner now sends them through
`installNodeAiApis` (`__tests__/helpers/suggestionsHelpers.js`).

## 2. Approach

1. A JS exporter turns each training case into the exact `messages` the app would send, using
   `buildTranslationOptionsPrompt`, plus an assistant answer built from `expected`. It writes
   JSONL in the conversational `messages` format, which both `mlx-lm` and Unsloth / TRL read.
2. `mlx_lm.lora` trains on `Qwen/Qwen3-1.7B` (bf16) with Qwen3's own chat template, thinking off,
   loss on the assistant answer only: LoRA first, then the comparison with a full fine-tune.
3. Fuse the adapter, load the MLX model in LM Studio, and measure with the suites the repo already
   has. Convert to GGUF only for distribution to Windows/Linux users.

Why the exporter is JS and reuses the app code: the fine-tuned model will be tightly bound to the
prompt text. If the training prompt drifts from what `queryAiAPI` sends by even the `/no_think`
placement, accuracy drops (the improve plan, section 3.6, measured exactly this on batch markers).

## 3. Steps

### Step 1. Export the prompt builders the exporter needs (OFFLINE, small `src` change)

In `src/utils/checkingSuggestionsUtils.js`, without changing behavior:
- Extract the `/no_think` prefixing in `queryAiAPI` into an exported
  `applyThinkingDirective({ systemPrompt, query }, enableThinking)` and call it from `queryAiAPI`.
- Extract the batch assembly in `getBestTWordSelectionsBatchFromLlm` (the `inputs` map, the join,
  and `systemPrompt + LLM_BATCH_SYSTEM_PROMPT`) into an exported
  `buildBatchTranslationOptionsPrompt(requests)` returning `{ systemPrompt, input }`, and call it there.
- Not added to `src/index.js`; only the exporter and tests import them.

Gate: `npm test` passes unchanged (the existing LLM tests mock the network and check prompts).

### Step 2. Write the exporter (OFFLINE)

New `__tests__/buildFineTuneData.test.js` (jest, like the other builders, because it is the
repo's only babel runner; Node `fs` because `fs-extra` is mocked), skipped unless
`LLM_FINETUNE_BUILD=1`, with `npm run build:finetune-data`. Output to `llmTrainingData/finetune/`
(git-ignored) as `train.jsonl`, `valid.jsonl` and `test.jsonl`, the file names `mlx_lm.lora`
expects in its `--data` folder. For each case:

1. `options = testCaseToSelectionOptions(testCase)` (`__tests__/helpers/suggestionsHelpers.js`),
   so the verse is cleaned exactly as the runners clean it; `wordList = getWordList(options.verseText)`.
2. `{ systemPrompt, input } = buildTranslationOptionsPrompt(wordList.join(' '), targetLang, glPhrase, glLang, history)`,
   then `applyThinkingDirective(..., false)`.
3. **Assistant answer**: `expected[0]` with `:n` occurrence suffixes removed, as one CSV row
   `"words",confidence`. The app places the answer at its first match, and `getBestSelections`
   then moves it to `contextId.occurrence` with `moveSelectionsToOccurrence`, so the model should
   answer plain words, not occurrence markers.
4. **Confidence label**, following system prompt rule 5 so the labels teach what the prompt says:
   - 95 when the answer equals a history rendering that is in the verse word for word;
   - 75 when a history rendering is in the verse as another form (by `wordSimilarity`), or covers
     some of the answer words;
   - 55 otherwise (no usable history).
5. **Round-trip check**: run the assistant answer through `parseLlmSelectionOptions(answer, wordList)`
   and `moveSelectionsToOccurrence(...)`, and drop the case unless the result equals `expected[0]`
   (scored as `summarizeTestResults` scores it). This guarantees every example teaches an answer the
   app can actually decode to the right words. Report how many are dropped and why.
6. Write one JSONL line:
   ```json
   {"messages":[{"role":"system","content":"/no_think\nYou find the words..."},
                {"role":"user","content":"/no_think\n\nTARGET VERSE (vi): ...\n\nAnswer:"},
                {"role":"assistant","content":"\"Chúa Cứu Thế\",95"}],
    "meta":{"id":"train-vi-tit-2-13-christ","file":"vi_glt_tit_book_unfoldingWord_en",
            "project":"vi_glt_tit_book","split":"train","kind":"single","algorithmConfidence":88}}
   ```
   `meta` is for filtering and reporting. `mlx-lm` may reject or ignore extra keys, so the exporter
   also writes `meta` to a parallel `*.meta.jsonl` and leaves it out of the files `mlx-lm` reads
   (one line per example, same order).

**Batched examples** (only if Q3 says yes): group 2-4 consecutive cases of the same project and
group (as the app batches a group's checks), build with `buildBatchTranslationOptionsPrompt`, and
answer with `### REQUEST n` lines followed by each request's row, matching `LLM_BATCH_SYSTEM_PROMPT`'s
example output.

**Parity test** (always runs in `npm test`, a few cases): send the same cases through
`getBestSelections` with `fetch` mocked to record the request body, and assert the recorded
`messages[0..1]` equal the exporter's system/user messages. This fails if the app's prompt ever
changes without regenerating the training data.

### Step 3. Choose and split the data (OFFLINE, in the exporter)

**Split by target project, never by file**, so the same verse under different GLs cannot be in
both train and test.
- **Test** (never trained on; proposed, see Q2): every `ne_glt_*` (a target language with no other
  training data), `bn_glt_eph`, `es-419_est_rut`, and every `en_ult_tit_*` (English target, five
  GLs). About 835 cases.
- **Exclude** from train the verses (book, chapter, verse, group) of the 25
  `__fixtures__/llmEval/realCases.json` cases: they come from `vi_glt_heb`, `vi_glt_1co`,
  `id_glt_1ti` and `fa_glt_mrk`, which are in the training files. Otherwise the suitability suite
  stops being a fair measure.
- **Validation**: 5% of the remaining (project, group) pairs, for eval loss and early stopping.

**Filter the train set** (measured 2026-11-17 on the 26,369 cases; see "Evidence" below). The
question for each case is whether the AI ever sees it in the app, not whether its answer is in the
history. `findUnhelpfulTrainingCases` (`__tests__/helpers/suggestionsHelpers.js`, run with
`npm run check:llm-training-data`) gives each case its history reason; the exporter reads the
algorithm results (`*_Algorithm.results.json`, from `npm run run:llm-training-data`) for the
algorithm's top option and confidence, matched to cases by `id`.

1. **Drop:**
   - Algorithm-certain cases (top confidence 100), except a random ~20% of the certain-and-right
     ones (~1,800), kept so the model still learns to copy a previous translation. The app answers
     certain cases without the AI (`algorithmFirst`), so more of them teaches a skill it never uses.
     Drop all certain-but-wrong ones (~2,100): the app never sends them, and the disagreement
     suggests a doubtful answer.
   - Unusually long answers, judged per language: drop an answer only when it is longer than its
     target language's 99th percentile answer length (computed from the training data) **and** more
     than 2 words longer than the longest rendering in its history. A fixed word cap would not work:
     languages space words differently (Vietnamese writes each syllable as a word, e.g. `Áp ra ham`;
     its median answer is 2 words and its 98th percentile 5, while most languages have a median of 1).
     Measured 2026-11-17, counting each check once: a fixed cap of 4 words would drop 382 checks,
     348 of them Vietnamese; this rule drops 17 (11 Vietnamese). Some are clearly too wide (Telugu
     `ఆదాము దేవుని యొక్క కుమారుడుగా ఉన్నాడు`, roughly "Adam ... was son of God", for "of God"); some are
     fine (Vietnamese `anh chị em đã được kêu gọi` for "you were called"). At 17 cases, no length
     filter at all would also be reasonable. `npm run check:llm-training-data` now reports these as
     `unusuallyLongAnswer` (with `longAnswer: {words, languageLimit, longestHistoryRendering}`). On
     review, about half of the 17 look right, mostly where the GL phrase itself is long (e.g.
     `Giu đa kẻ được gọi là Ích ca ri ốt` for "Иуду прозванного Искариотом"), so treat the list as
     cases to check by hand, not to drop automatically. Do not use the builder's `LLM_TRAINING_MAX_WORDS`
     for this: it is one number for every language.
   - Cases that fail the round-trip check (Step 2) and exact repeats (`duplicate`, 1 case).
2. **Keep all:**
   - Cases the app sends to the AI that pass every check (~5,050).
   - `onlyOtherFormsInHistory` cases sent to the AI (~2,700): the answer is another form of a
     history word. Label them 60-89 (rule 5).
3. **Decide by experiment (Step 4B):**
   - `someExpectedWordsNotInHistory` (~3,970 sent to the AI; the algorithm gets 3% right): mostly
     the history rendering plus or minus small words (`của Áp ra ham` vs history `Áp ra ham`), about
     2,800 of them Vietnamese. This is a label question: alignments include small words a checker may
     not select. Hand-check ~50 first. Where a history rendering is in the verse word for word but the
     expected answer differs, the case contradicts rule 3 ("copy exactly those words"); if those are
     frequent, drop or relabel them.
   - `noRelatedWordInHistory` (~3,380 sent to the AI; the algorithm gets 1% right): only knowledge of
     the target language can solve these, which a 1.7B model may not learn. If kept, label them 55 or
     lower (rule 5) so at worst the model learns to say it is unsure.

Size: the base set (1 and 2) is about 9,500 cases before the holdout and caps; about 16,800 with
both experimental groups.

**Balance the train set:**
- Cap each target project at ~2,000 examples and each (project, group) at ~40, so
  `ru_rlob_gen`, `ar_avt_psa`, `vi_glt_luk` and groups like `god`/`jesus` do not dominate.
- Optional, ~3%: negative examples answered `"",0`, made by pairing a case's GL phrase and history
  with another verse of the same project that contains neither the answer nor any history word.
  The builder drops unaligned checks, so without this the model never sees rule 6.

**Evidence** (algorithm results joined to `findUnhelpfulTrainingCases` reasons; about 6% of rows
may be misattributed because case ids were not unique when this was measured, since fixed):

| Group | Cases | Algorithm certain | Sent to the AI | Algorithm right, of those sent |
|---|---|---|---|---|
| Passes every check | 15,408 | 10,361 | 5,047 | 3,594 (71%) |
| `onlyOtherFormsInHistory` | 2,850 | 152 | 2,698 | 1,795 (67%) |
| `someExpectedWordsNotInHistory` | 4,652 | 681 | 3,971 | 116 (3%) |
| `noRelatedWordInHistory` | 3,458 | 81 | 3,377 | 36 (1%) |

Answer lengths (all cases): 1 word 13,393; 2 words 7,376; 3 words 3,597; 4 words 1,343; 5+ words
660. Per target language, counting each check once (median / 98th percentile / longest, in words):
ru 1/3/5, vi 2/5/10, ar 1/2/4, te 1/3/5, fa 1/4/5, bn 1/4/6, ne 1/3/5, es-419 2/4/4, id 1/5/6,
en 1/4/5.
`wordSimilarity` misses some forms a person would call the same word (Arabic `عَلِيٌّ` vs history
`ٱلْعَلِيِّ`), so `noRelatedWordInHistory` slightly overstates "nothing related".

**Data upkeep:**
- Case ids are unique within a file since 2026-11-17:
  `train-<targetLang>-<book>-<chapter>-<verse>-<groupId>-<checkId>[-<occurrence>]`. Before that,
  3,050 cases shared an id with another check of the same verse and group.
- `scripts/rebuild-llm-training-data.sh` rebuilds every file in `llmTrainingData` from the
  translationCore projects (`-c` and `-a` refresh the check and algorithm results). A project's
  translationWords check list is written by translationCore for the GL last selected there, and
  each GL lists different checks, so the script only rebuilds files whose GL is the project's
  current GL. On 2026-11-17, 11 of 39 files did not match their project's GL; rebuilding them anyway
  gave 7 of them the wrong checks. To rebuild one of those, open the project in translationCore
  with that GL selected, then run the script again.

Write the split and the per-project counts to `llmTrainingData/finetune/manifest.json`.

### Step 4. Train with MLX on the Mac

New folder `llmTraining/` with a README, `requirements.txt` (`mlx-lm`, `transformers`), the
configs below and `check_data.py`; outputs in `llmTraining/outputs/` (git-ignored). Use a Python
virtual environment (`python3 -m venv llmTraining/.venv`), not the system Python.

Base model: `Qwen/Qwen3-1.7B` from Hugging Face, in bf16 (`mlx-lm` converts it when loading). Do
not train on a quantized copy: 1.7B in bf16 is small enough, and LM Studio's `qwen/qwen3-1.7b` is
the same base model, so the comparison in Step 6 is fair.

`llmTraining/lora-r16.yaml` (run A):

```yaml
model: Qwen/Qwen3-1.7B
train: true
data: ../llmTrainingData/finetune   # train.jsonl, valid.jsonl, test.jsonl
fine_tune_type: lora
num_layers: -1                      # LoRA on every layer
lora_parameters:
  rank: 16
  scale: 1.0                        # = lora_alpha / rank; see "Results" (20 broke the model)
  dropout: 0.0
  keys: ["self_attn.q_proj", "self_attn.k_proj", "self_attn.v_proj", "self_attn.o_proj",
         "mlp.gate_proj", "mlp.up_proj", "mlp.down_proj"]
mask_prompt: true                   # loss on the assistant answer only
max_seq_length: 2048
batch_size: 8
iters: 2000                         # 2 epochs of the 7,892 train examples at batch 8
learning_rate: 2e-4
lr_schedule: { name: cosine_decay, warmup: 100, arguments: [2e-4, 1900, 0] }
grad_checkpoint: true
steps_per_report: 20
steps_per_eval: 200
val_batches: 50
save_every: 200
adapter_path: outputs/lora-r16
seed: 3407
```

Run: `mlx_lm.lora --config llmTraining/lora-r16.yaml`. Set `iters` from the real train-set size
once Step 3 has run (examples × epochs ÷ batch size).

Checks before the full run (`llmTraining/check_data.py`):
- **Template and masking check.** This is the main risk of the MLX route. `mlx-lm` applies the
  model's chat template itself, and I am not sure it passes `enable_thinking=False` or how it
  splits prompt from answer for `mask_prompt`. For one example, compare:
  1. the reference: `tokenizer.apply_chat_template(messages, tokenize=False, enable_thinking=False)`
     with the `transformers` tokenizer, whose assistant turn should end as
     `<|im_start|>assistant\n<think>\n\n</think>\n\n"…",95<|im_end|>` (my reading of the Qwen3
     template, not yet checked);
  2. what `mlx-lm` trains on: build its dataset the way `mlx_lm.lora` does (its `load_dataset` for
     the installed version), decode the full token sequence, and decode the part after the mask
     offset.

  Pass when (2)'s full text equals (1), and the unmasked part is only the answer and `<|im_end|>`,
  or the empty think block plus those (harmless, because the app's generation prompt ends with that
  block). **If it fails**, have `check_data.py` write pre-rendered files instead: `prompt` = the
  reference text up to and including `<|im_start|>assistant\n<think>\n\n</think>\n\n`, and
  `completion` = the answer plus `<|im_end|>`. Then use the `mlx-lm` data format that takes text
  as given, without applying a template again, and repeat this check on that format.
- **Length check**: longest tokenized example under `max_seq_length` (the single-request system
  prompt is the bulk; batches of 4 are longer).
- **Smoke run**: `iters: 200` on a 1,000-example copy of the data, fuse it (Step 5), and run Step 6
  (b) on one test file. Watch memory in Activity Monitor; lower `batch_size` to 4 if it swaps.

### Step 4A. Compare LoRA ranks with a full fine-tune

LoRA is the starting choice, not a measured one. It needs much less memory, iterates fast, and
keeps the base weights frozen, which should limit forgetting on target languages that are not in
the training data. A full fine-tune can learn more from the same data. Train these three on the
**same** train/validation files, seed and number of epochs, and score each with Step 6:

| Run | Setup | Config changes from `lora-r16.yaml` |
|---|---|---|
| A | LoRA r=16 | as written |
| B | LoRA r=64 | `rank: 64`, `adapter_path: outputs/lora-r64` |
| C | Full fine-tune | `llmTraining/full.yaml`: `fine_tune_type: full`, no `lora_parameters`, `learning_rate: 1e-5` (try 2e-5), `save_every: 1000`, `adapter_path: outputs/full`; run through `llmTraining/train_full.py` (float32) |

Notes:
- C trains every weight, so it needs a far smaller learning rate than LoRA. A LoRA rate (2e-4) would
  wreck the model. If C's validation loss rises after the first epoch, halve `iters`.
- Memory, estimated and not measured: C needs about 16 bytes per parameter for weights, gradients
  and Adam state (~27 GB for 1.7B) plus activations. With 48 GB of unified memory, gradient
  checkpointing and `batch_size` 2-4, it should fit, but close the other large apps (LM Studio
  included) while it trains. If it does not fit or is too slow, run C on an NVIDIA GPU with
  Unsloth (Appendix A) on the same data.
- C saves full weights rather than an adapter: ~5.6 GB per checkpoint in float32 (the 28 layers;
  the tied embeddings stay frozen), so `save_every` is 1000 to spare the disk.
- **Train C in float32** (found 2026-11-17). `mlx_lm.lora` trains the weights in the dtype they
  load in, bfloat16 for Qwen3-1.7B. An Adam step at lr 1e-5 is about 1e-5, but bfloat16 values
  near a typical weight (0.02) are 1.2e-4 apart, so most updates would round away and C would
  hardly train. `llmTraining/train_full.py` runs `mlx_lm.lora` with the model cast to float32.
  Measured on 20 steps: ~5 s per step at `batch_size` 8 (~3 hours for 2,000 steps with
  evaluations), validation loss 3.15 → 0.154, no memory swapping on 48 GB.
- **Memory, measured:** the first full run (`batch_size` 8, float32) ran out of GPU memory at
  step ~1,140 (`kIOGPUCommandBufferCallbackErrorOutOfMemory`), after the step-1,000 checkpoint
  (validation loss 0.036). It was resumed from that checkpoint with `llmTraining/full-resume.yaml`:
  `batch_size` 4 x `grad_accumulation_steps` 2 (same effective batch), the lr continuing the
  original cosine from 5.41e-6 to 0, a new seed for the second epoch's order, and fresh Adam
  moments (not saved by the first attempt). First validation after loading: 0.038. Start a new
  full run with `batch_size` 4 x `grad_accumulation_steps` 2 (`iters` doubles, since it counts
  micro-batches).

**Choosing:** use the Step 6 (b) held-out top-1 and the rate of confident wrong answers, reported
**separately for the `ne_*` files** (a target language not in training) and for the rest. Pick C
only if it beats the best LoRA run overall **and** is not worse on `ne_*`. A full fine-tune that
gains on seen languages but loses on unseen ones would be a bad trade, because target languages can
be anything. If A and B score within ~1 point of each other, keep A (smaller, faster). Record all
three runs in the results section.

After choosing, other things to try if needed: 1 vs 3 epochs, and `learning_rate` 1e-4 for LoRA.
Pick by the test-set top-1 from Step 6, not by validation loss alone.

### Step 4B. Which doubtful groups to train on

With the configuration chosen in Step 4A (LoRA r=16 if A and B are close), train three runs on the
same split, seed and epochs:

| Run | Train set |
|---|---|
| D1 | base set (Step 3, items 1 and 2) |
| D2 | base + `someExpectedWordsNotInHistory` (after the hand-check) |
| D3 | base + `noRelatedWordInHistory`, labelled 55 or lower |

Score each with Step 6 (b), broken down by the same groups on the held-out files. Keep a group only
if adding it raises top-1 on its own held-out group without lowering the others, and without more
confident wrong answers. If both help, train once more with both.

### Step 5. Fuse and load in LM Studio

1. Fuse the adapter into the base weights (runs A and B; C is already full weights):
   `mlx_lm.fuse --model Qwen/Qwen3-1.7B --adapter-path outputs/lora-r16 --save-path outputs/fused-r16`
2. Quantize for LM Studio, matching the stock model's quantization when comparing:
   `mlx_lm.convert --hf-path outputs/fused-r16 --mlx-path outputs/uw-tw-qwen3-1.7b-8bit -q --q-bits 8`
   (and `--q-bits 4` for the 4-bit check).
3. Copy each model folder into LM Studio's models folder, e.g.
   `~/.lmstudio/models/unfoldingWord/uw-tw-qwen3-1.7b-8bit/` (check the folder in LM Studio's
   settings), confirm it shows Qwen3's chat template, and find its name with
   `scripts/test-llm.sh -l`.
4. **Only for distribution** (Windows/Linux translationCore users need GGUF; done for D3 on
   2026-11-18, see the results and `llmTraining/README.md`, which also covers converting with the
   base model's tokenizer files): convert the fused bf16
   model with llama.cpp, `python convert_hf_to_gguf.py outputs/fused-r16 --outtype q8_0`, and
   `llama-quantize` for `Q4_K_M`. Check that the fused folder loads in llama.cpp (tensor names and
   `config.json`) and that the GGUF scores the same as the MLX model on Step 6 (b).

### Step 6. Evaluate (LIVE, LM Studio)

Run each candidate (stock `qwen/qwen3-1.7b`, stock `qwen/qwen3-4b-2507`, fine-tuned runs A, B and
C from Step 4A at 8-bit, and the chosen run at 4-bit) the same way in LM Studio, temperature 0.1.
Use the same format and quantization for the stock 1.7b as for the fine-tuned models (e.g. the MLX
8-bit build of `qwen/qwen3-1.7b`), so the comparison measures the fine-tune, not the quantization.
Unload models between runs; LM Studio and a training run should not share the 48 GB at once.

a. **Suitability suite** (55 cases, none trained on after Step 3's exclusion):
   `scripts/test-llm.sh -r 3 qwen/qwen3-1.7b qwen/qwen3-4b-2507 uw-tw-qwen3-1.7b-8bit`, then
   `scripts/compare-llm-runs.js -c`.
b. **Held-out training files**: `LLM_TRAINING_URL=http://localhost:1234 LLM_TRAINING_MODEL=<model>
   LLM_TRAINING_FILES="<test files>" npm run run:llm-training-data`, and the algorithm alone for
   reference. This is through `getBestSelections`, so the scores are the combined
   algorithm-first + AI result a translator sees. Run the algorithm on the same files first: the
   runner then prints the per-band comparison and the top-1 at each `ALGORITHM_CERTAIN_CONFIDENCE`
   (section 1, "Stock models against the algorithm"), with the app's fallback to the algorithm.
   Measure stock 1.7b and stock 4b on the held-out files too; the section 1 figures come from files
   the fine-tune trains on, so they are not the comparison.
c. Optionally, `llmGrouping` 4 on (a) if batched examples were trained.

Metrics: top-1, top-3, wrong answers at confidence ≥ 80, no-suggestion rate, median time.
**Success** (proposed, Q4), on (b) at threshold 100, scored as the app shows it:
- fine-tuned 1.7b top-1 beats stock 1.7b by at least 5 points and is not below stock 4b (on the 9
  files of section 1 that gap was 54.7% to 60.4%);
- in each band from 60 to 94, fine-tuned 1.7b is at or above the algorithm, as stock 4b is. If it
  is not, the fine-tune is only worth using with a lower threshold for it (see Q6);
- on both (a) and (b), confident wrong answers are no higher than stock 1.7b;
- 4-bit within 2 points of 8-bit.

Record the results, including each model's best threshold, in a results section at the end of this
plan.

### Step 7. Document (OFFLINE)

Add the exporter, `npm run build:finetune-data` and `llmTraining/` to `CLAUDE.md` (Commands), add
`llmTrainingData/finetune/`, `llmTraining/outputs/` and `llmTraining/.venv/` to `.gitignore`, and note in `checkingSuggestionsUtils.js` next to the system prompts that changing them
means regenerating the data and retraining, or the fine-tuned model loses accuracy.

## 4. Risks

- **Alignment is not selection.** `expected` is the words the translator *aligned* to the quote,
  not what a checker selected (the builder ignores saved selections). Alignments can include small
  words a checker would leave out, so the model learns alignment habits. Worth checking a sample of
  answers by hand before training.
- **Prompt lock-in.** The fine-tune is tied to today's prompt text. Later prompt changes need
  retraining, or at least re-running Step 6. The parity test in Step 2 catches drift.
- **GL coverage.** Most cases use GL `en`; `ru`, `ar`, `es-419`, `fa` and `id` are few. Report Step 6
  results per GL.
- **Overfitting to seen languages.** The `ne` test files are the check on unseen target languages,
  which matters because target languages can be anything.
- **Labeled confidences are a rule, not a measurement.** If the fine-tuned model's confidences do
  not separate right from wrong (mean confidence right vs wrong in the summaries), revise the rule.
- **Permission.** The data comes from translators' projects; check before distributing model
  weights trained on it (Q5).

## 5. Open questions for the author

- **Q1. Fallback hardware.** Training runs on this Mac with MLX. If the full fine-tune (run C) does
  not fit in 48 GB or is too slow, is there an NVIDIA machine or Colab account for Appendix A?
  - Answer: no NVIDIA machine or Colab, but do have a mac Mini M4Pro with 64GB if that would help.

- **Q2. Test split.** Is holding out `ne_*`, `bn_glt_eph`, `es-419_est_rut` and `en_ult_tit_*` right,
  or should other projects be held out?
  - Answer: no

- **Q3. Batched examples.** The app default is one request per call. Train single only, or add
  ~15% batched examples so `llmGrouping` > 1 also improves?
  **Decided 2026-11-17: single requests only.** Batching is not helpful with small models, so it
  is not trained or tested; a fine-tuned model must be used with one request per query.
- **Q4. Success bar.** Are the thresholds in Step 6 the right bar to switch the default model?
  **Recommendation after testing (2026-11-18):** the bars are the right kind of test, and D3
  (`uw-tw-qwen3-1.7b-d3`, 8-bit) meets all four on the held-out files:
  - top-1 68.1% vs stock 1.7b 51.7% (+16.4) and stock 4b 59.3% (+8.8);
  - at or above the algorithm in every band from 60 to 94 (90-94: 65.9 vs 58.0; 85-89: 67.3 vs
    50.9; 80-84: 62.2 vs 56.1; 60-79: 67.7 vs 41.9);
  - wrong at confidence ≥ 80: 92 vs 255 for stock 1.7b on (b), 11% vs 24% on the suite (a);
  - 4-bit 66.1%, within 2 points (-2.0), exactly at the limit.
  It is also not much worse on unseen target languages (`ne_*` 66.9% vs 69.1% on the rest) and is
  the first model to pass the whole suitability suite. Make it the default for quality, using the
  **8-bit** build, with 4-bit only as a fallback for computers with little memory. Before switching,
  four conditions the bars do not cover:
  1. **GGUF parity (Step 5.4).** Windows and Linux need GGUF; everything was measured on the MLX
     build. Convert it and check it scores the same on Step 6 (b).
     **Measured 2026-11-18: not met** (results, "GGUF builds of D3"). In LM Studio's llama.cpp
     engine, Q8_0 scores 65.7% and Q4_K_M 66.8% on (b), against 68.1% for MLX 8-bit (Q8_0 vs MLX
     p = 0.02), and both fail the suite's top-1 bar; they still beat stock 1.7b (51.7%) and stock
     4b (59.3%) clearly, with fewer confident wrong answers (78 / 75 vs 92). The gap comes from
     the engine, not the conversion: the stock model diverges between the engines too.
     **Then found to be LM Studio's llama.cpp engine, not the GGUF:** the bf16 GGUF in plain
     llama.cpp (`llama-server` 1.0.0) matches transformers on 538 of 543 answers (LM Studio's
     engine: 428). Recommendation: release **both** builds (MLX 8-bit for Mac; GGUF for Windows
     and Linux), and before choosing Q8_0 or Q4_K_M and calling the condition met, score the GGUF
     with Step 6 (b) through plain `llama-server` and on the engine translationCore users will
     run on Windows and Linux (LM Studio's Windows/Linux engines or another llama.cpp server).
  2. **One request per query.** The fine-tune breaks with `llmGrouping` > 1 (Q3); make sure that
     setting cannot quietly be used with it, or warn when it is.
  3. **A broader test (Q2).** The held-out set is 9 files, five of them the same Titus verses
     under different GLs. The margins are large, so this is unlikely to change the conclusion, but
     it should be confirmed on more projects.
  4. **Permission to distribute (Q5, Risks).** The model is trained on translators' projects, so
     confirm it may be published before shipping it as the default.
- **Q5. Distribution.** Will the fine-tuned model be published (e.g. Hugging Face) for
translationCore users, or kept internal? This affects licensing and where the GGUF lives.    - Answer: yes it will likely be published and needs to support windows and linux as well as mac.

- **Q6. `ALGORITHM_CERTAIN_CONFIDENCE` per model.** It is a constant (100), which is best for stock
  4b, but stock 1.7b is best at 60 (section 1). If both models stay supported (1.7b for smaller
  computers), should it become a checking setting, e.g. `llmAlgorithmFirstConfidence` like
  `llmExtraParams`, defaulting to 100? Decide after Step 6 shows where the fine-tuned model lands.
  Done as the optional `llmAlgorithmCertainConfidence` checking setting (no UI; default 100); what
  remains is the default per model.
  Measured on the held-out files (2026-11-18): the fine-tunes are best at 100 (D3 68.1% at 100,
  66.5 at 90, 64.8 at 80, 63.8 at 60), stock 4b is flat (59.3 at 100, 59.4 at 80), stock 1.7b is
  best at 80 or 60 (54.6 vs 51.7 at 100). So the default of 100 is right for the fine-tuned model
  and stock 4b; only the stock 1.7b would gain (about 3 points) from 80, and it is the model the
  fine-tune replaces.

## Appendix A. Alternative: Unsloth Core on an NVIDIA GPU

Use this when a run is too slow or too large for the Mac (most likely the full fine-tune, run C).
The Unsloth Core Python library documents Linux and Windows with an NVIDIA, AMD or Intel GPU
(Linux, WSL or Colab); its docs show no Mac route for these scripts. It reads the same
`train.jsonl` / `valid.jsonl` from Step 2, so results stay comparable. LoRA runs fit on a 16 GB
GPU; a full fine-tune needs roughly 24-40 GB (estimated).

```python
from unsloth import FastLanguageModel
from unsloth.chat_templates import train_on_responses_only
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

model, tokenizer = FastLanguageModel.from_pretrained(
    "unsloth/Qwen3-1.7B", max_seq_length=2048, load_in_4bit=False)  # 1.7B fits in 16-bit LoRA
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=16, lora_dropout=0, bias="none",
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    use_gradient_checkpointing="unsloth", random_state=3407)

def to_text(ex):
    return {"text": tokenizer.apply_chat_template(
        ex["messages"], tokenize=False, enable_thinking=False)}

ds = load_dataset("json", data_files={"train": "train.jsonl", "validation": "valid.jsonl"})
ds = ds.map(to_text, remove_columns=["messages"])  # meta is in the separate *.meta.jsonl

trainer = SFTTrainer(model=model, tokenizer=tokenizer,
    train_dataset=ds["train"], eval_dataset=ds["validation"],
    args=SFTConfig(dataset_text_field="text", per_device_train_batch_size=8,
        gradient_accumulation_steps=2, num_train_epochs=2, learning_rate=2e-4,
        lr_scheduler_type="cosine", warmup_ratio=0.05, eval_strategy="steps",
        eval_steps=200, save_steps=200, logging_steps=20, seed=3407, output_dir="outputs"))
trainer = train_on_responses_only(trainer,
    instruction_part="<|im_start|>user\n", response_part="<|im_start|>assistant\n")
trainer.train()
```

Differences from the MLX route:
- Run B: `r=64, lora_alpha=64`. Run C: `from_pretrained(..., full_finetuning=True)`, no
  `get_peft_model`, `learning_rate=1e-5` to `2e-5`, `optim="adamw_8bit"`. Check that
  `full_finetuning=True` exists in the installed Unsloth version; if not, use plain TRL
  `SFTTrainer` with the same data and template.
- The template check is the same idea: print `to_text` for one example and compare it with the
  reference rendering in Step 4. Masking check: decode the label tokens of one batch; only the
  answer and `<|im_end|>` should be unmasked.
- Export:
  ```python
  model.save_pretrained_merged("outputs/merged", tokenizer, save_method="merged_16bit")
  model.save_pretrained_gguf("outputs/gguf", tokenizer, quantization_method=["q8_0", "q4_k_m"])
  ```
  Then load the GGUF in LM Studio and evaluate with Step 6 as for the MLX models.

## Appendix B. Optional cross-check: Unsloth Studio on the Mac

Unsloth's Studio / Desktop app trains on macOS with MLX (docs checked 2026-11-15:
[macOS install](https://unsloth.ai/docs/get-started/install/mac.md),
[requirements](https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements.md),
[changelog](https://unsloth.ai/docs/new/changelog.md): "Updated MLX support and Mac LoRA exports to
PEFT or GGUF"). Install with `brew install --cask unsloth` or the Desktop `.dmg`.

It is not the main route because it is driven from a UI, and the plan depends on things a UI may not
expose: the exact chat template with thinking off, loss on the answer only, and runs that can be
repeated with the same settings. Use it, if at all, to train run A once from the same `train.jsonl`
and compare its Step 6 scores with the `mlx-lm` run A. Before relying on it, check that it:
- accepts the `messages` JSONL from Step 2 (or the pre-rendered fallback from Step 4);
- trains on the assistant answer only, and renders Qwen3's template with thinking off (repeat the
  Step 4 template check on whatever it exports);
- can save its training settings, so the run can be repeated;
- exports a model LM Studio loads (MLX or GGUF).

Not confirmed in its docs: full fine-tuning on Mac, and whether Qwen3-1.7B is a supported Mac
training model.

## Results

### 2026-11-17: Steps 1-3 done, smoke runs

- Steps 1-3 are implemented: `applyThinkingDirective` and `buildBatchTranslationOptionsPrompt` in
  `checkingSuggestionsUtils.js`, the exporter `npm run build:finetune-data`
  (`__tests__/buildFineTuneData.test.js`, `__tests__/helpers/fineTuneHelpers.js`, with a parity
  test in `npm test`), and `llmTraining/` (`check_data.py`, `lora-r16.yaml`, `lora-smoke.yaml`,
  README). Batched examples (Q3) are not built.
- First build: train 7,892 (incl. 1,385 algorithm-certain-and-right and 230 negatives), valid 449,
  test 543. 274 cases fail the round trip because `expected` is a later occurrence (`:2`) than the
  check's original-language occurrence, which the app's `moveSelectionsToOccurrence` cannot reach.
  710 kept cases have a history rendering in the verse word for word but a different answer
  (`contradictsRule3` in the manifest): worth a hand-check. The base set has no examples labelled
  55, and its GLs are only en, ar, ru and es-419.
- `check_data.py` passes on `mlx-lm` 0.32.2: its tokens equal the Qwen3 template with thinking off,
  start with the app's generation prompt, and the loss covers only `<think>\n\n</think>\n\n`, the
  answer and `<|im_end|>`. Compare tokens, not decoded text: the tokenizer normalizes to NFC, so
  decoded Arabic can differ from the input. Longest example 1,096 tokens.
- **`scale: 20` broke the model.** `mlx-lm` adds `scale * (x A) B`, so `scale` is PEFT's
  `lora_alpha / rank`; 20 is `mlx-lm`'s default for its 1e-5 learning rate. With 2e-4 the smoke run
  answered Spanish verses with Arabic fragments and mixed-script words (`"Boоз"`): 0 of 30 Ruth
  test cases right, unquantized and unfused alike. `scale: 1.0` (alpha 16 at rank 16, as in
  Appendix A): validation loss 0.040 after 200 iterations (0.355 with 20), 14 of 30 right.
- Speed: ~3.8 s per iteration at batch 8 on the M5 Pro, so run A (2,000 iterations) is ~2.3 hours.
- The section 1 baseline `qwen3-1.7b-mlx` is LM Studio's `Qwen3-1.7B-MLX-4bit`. For Step 6 use
  `qwen3-1.7b-stock`, the stock model converted to 8-bit with `mlx_lm.convert` like the fine-tunes.
- The fine-tune always answers one row (every training answer is one row), so top-3 = top-1.

Held-out `es-419_est_rut` (84 cases, one run, app scoring with algorithm-first at 100), smoke model
(200 iterations on 1,000 examples, `scale: 1.0`, 8-bit):

| Model | Top-1 | Wrong | No suggestion | Mean confidence right / wrong |
|---|---|---|---|---|
| Algorithm | 37 | 44 | 3 | 100 / 69 |
| `uw-tw-qwen3-1.7b-smoke-s1` | **56** | 28 | 0 | 91 / 88 |
| `qwen3-1.7b-stock` (8-bit) | 42 | 36 | 6 | 98 / 91 |
| `qwen3-1.7b-mlx` (4-bit) | 41 | 40 | 3 | 99 / 89 |
| `qwen/qwen3-4b-2507` | 47 | 35 | 2 | 97 / 87 |

One small file, so only a sign that the setup works, not a Step 6 result. Its confidences barely
separate right from wrong (91 vs 88).

### 2026-11-17: run A (LoRA r16, `scale: 1.0`, 2,000 iterations)

Validation loss 3.15 → 0.047 (iteration 400) → 0.033 (1,200) → 0.035 (2,000); ~2.2 hours.
Fused, converted with `mlx_lm.convert` to 8-bit (`uw-tw-qwen3-1.7b-r16`) and 4-bit, loaded in
LM Studio. LM Studio lists the two as variants `uw-tw-qwen3-1.7b-r16@8bit` / `@4bit`; load them
with `lms load <name>@8bit --identifier <id>`, or the plain name is not found.

**Step 6 (b), held-out files** (the 9 test files, 835 cases, one run each, temperature 0.1, app
scoring: algorithm answers at confidence 100, falls back to the algorithm when the AI gives
nothing). Run in `llmTrainingData/finetune/heldout/` (copies of the test files and their algorithm
results), so the pooled `results/<model>.byAlgorithmConfidence.json` of section 1 are not
overwritten.

| Algorithm confidence | Cases | Algorithm | Run A 8-bit | Run A 4-bit | Stock 1.7b 8-bit | Stock 4b |
|---|---|---|---|---|---|---|
| 100 | 281 | 84.3% | 84.3% | 84.3% | 84.3% | 84.3% |
| 90-94 | 176 | 58.0% | **66.5%** | 63.6% | 52.8% | 61.9% |
| 85-89 | 55 | 50.9% | **56.4%** | 50.9% | 41.8% | 47.3% |
| 80-84 | 82 | 56.1% | **63.4%** | 59.8% | 45.1% | 48.8% |
| 60-79 | 31 | 41.9% | 61.3% | 58.1% | 45.2% | **64.5%** |
| 1-59 | 129 | 16.3% | **50.4%** | 45.0% | 19.4% | 29.5% |
| no algorithm answer | 81 | 0% | **33.3%** | 32.1% | 6.2% | 32.1% |
| **All, threshold 100** | 835 | 53.5% | **65.6%** | 63.2% | 52.0% | 59.4% |
| `ne_*` only (362, unseen target language) | | 55.2% | 63.3% | 61.9% | 53.9% | 63.3% |
| Wrong at confidence ≥ 80 | | 181 | **94** | 102 | 255 | 189 |

Top-1 at each threshold on these files (run 2; 100 / 90 / 80 / 60 / 1): run A 65.9 / 64.1 / 63.0 /
62.3 / 57.0; stock 4b 59.3 / 58.4 / 59.4 / 58.7 / 56.6; stock 1.7b 51.7 / 52.8 / **54.6** / **54.6** /
54.1. The fine-tune is best at 100 by 1.8 points or more, stock 4b is flat (100 and 80 within 1
case), and stock 1.7b is best at 80 or 60, as in section 1. (Corrected 2026-11-18: this note first
said every model is best at 100.)

**Step 6 (a), suitability suite** (`scripts/test-llm.sh -r 3`, 55 cases):

| | Run A 8-bit | Run A 4-bit | Stock 1.7b 8-bit | Stock 4b |
|---|---|---|---|---|
| Single: top-1 | 69% | 71% | 62% | 68% |
| Single: top-1 real projects | 47% | 56% | 36% | 47% |
| Single: wrong at ≥ 80 | **13%** | **13%** | 24% | 22% |
| Batched (4 per query): top-1 | **36%** | **36%** | 55% | 65% |
| Batched: empty answers | 87 | 87 | 24 | 15 |

All four fail the suite's top-1 bar on single requests (run A 8-bit included), and both stock
models fail its "rarely wrong with high confidence" bar, which run A passes.

**Against the success bar (Step 6):**
- Top-1 at threshold 100 beats stock 1.7b by ≥ 5 points and is not below stock 4b: **met**
  (65.6% vs 52.0% and 59.4%).
- At or above the algorithm in every band from 60 to 94: **met** (+5.5 to +19.4 points).
- Confident wrong answers no higher than stock 1.7b on (a) and (b): **met** (13% vs 24%; 94 vs 255).
- Not worse on `ne_*` than the rest: **met** (63.3%, equal to stock 4b).
- 4-bit within 2 points of 8-bit: **missed narrowly** (63.2% vs 65.6%, -2.4), though still above
  stock 4b.
- **Batched requests break.** Trained on single requests only (Q3), the fine-tune does not write
  the `### REQUEST n` markers, so with `llmGrouping` > 1 most answers are empty. Use it only with
  one request per query (the app default), or add batched examples and retrain.

**Second run of Step 6 (b)** (same settings; results in `heldout/results-run1` and `results-run2`):

| Model | Run 1 top-1 | Run 2 top-1 | Wrong at ≥ 80, run 1 / 2 | Answers that changed |
|---|---|---|---|---|
| Run A 8-bit | 548 (65.6%) | 550 (65.9%) | 94 / 96 | 15 |
| Run A 4-bit | 528 (63.2%) | 528 (63.2%) | 102 / 103 | 10 |
| Stock 1.7b 8-bit | 434 (52.0%) | 432 (51.7%) | 255 / 257 | 9 |
| Stock 4b | 496 (59.4%) | 495 (59.3%) | 189 / 193 | 5 |

At temperature 0.1, runs differ by at most 2 cases, so one run per model is enough on these files.
Paired on the same cases (run 2, exact McNemar test), run A is right where the other is wrong /
the other right where run A is wrong: vs stock 1.7b 138 / 20 (p = 7e-23), vs stock 4b 89 / 34
(p = 7e-7), vs its own 4-bit build 35 / 13 (p = 0.002). So the gains are not chance on these cases,
and the 4-bit loss (-2.4 points) is real: the 8-bit build is the one to use. The test still covers
only 9 files, five of them the same Titus verses under different GLs.

### 2026-11-17: run B (LoRA r64, otherwise as run A)

`llmTraining/lora-r64.yaml`: run A's config with `rank: 64` (`scale: 1.0`, lr 2e-4, 2,000
iterations, seed 3407, same data). Validation loss 3.15 → 0.052 (iteration 400) → 0.032 (1,000)
→ 0.033 (2,000), the same curve as run A; ~2.1 hours. Fused and converted to 8-bit
(`uw-tw-qwen3-1.7b-r64`) and scored with Step 6 (b) on the same 835 held-out cases.

| Algorithm confidence | Cases | Algorithm | Run A 8-bit (run 2) | Run B 8-bit |
|---|---|---|---|---|
| 100 | 281 | 84.3% | 84.3% | 84.3% |
| 90-94 | 176 | 58.0% | **66.5%** | 64.2% |
| 85-89 | 55 | 50.9% | **56.4%** | 52.7% |
| 80-84 | 82 | 56.1% | **63.4%** | 62.2% |
| 60-79 | 31 | 41.9% | 61.3% | **64.5%** |
| 1-59 | 129 | 16.3% | **50.4%** | 40.3% |
| no algorithm answer | 81 | 0% | **35.8%** | 32.1% |
| **All, threshold 100** | 835 | 53.5% | **65.9%** (550) | 63.2% (528) |
| `ne_*` only (362) | | 55.2% | **63.5%** | 61.3% |
| Other held-out files (473) | | 52.2% | **67.7%** | 64.7% |
| Wrong at confidence ≥ 80 | | 181 | 96 | 93 |

Paired (exact McNemar): run A right where B is wrong 40 times, B right where A is wrong 18
(p = 0.005; against run A's first run 38 / 18, p = 0.01). Run B ties run A's 4-bit build (528,
29 / 29) and beats stock 4b (73 / 40, p = 0.002).

**Choice: keep run A.** Rank 64 is 2.7 points worse overall and on `ne_*`, mostly on cases the
algorithm is unsure of (1-59: -10 points), with about the same number of confident wrong answers.
The extra capacity did not help with this data; it may fit the training projects more closely.
One seed each, so the gap could shrink with other seeds, but it is not in B's favour.

### 2026-11-17: run C (full fine-tune, float32, lr 1e-5)

`llmTraining/full.yaml` through `llmTraining/train_full.py`, resumed at update 1,000 with
`full-resume.yaml` after running out of memory (Step 4A notes). Validation loss 3.15 → 0.036
(update 1,000); after the resume 0.038 → 0.062 (400 micro-batches) → 0.044 (end). The rise right
after the resume is probably Adam restarting without its moments; the end (0.044) is above runs A
and B (0.033). ~3.2 hours of training in all (1.8 + 1.5). Fused, converted to 8-bit (`uw-tw-qwen3-1.7b-full`)
and scored with Step 6 (b).

| Algorithm confidence | Cases | Algorithm | Run A (run 2) | Run B | Run C |
|---|---|---|---|---|---|
| 100 | 281 | 84.3% | 84.3% | 84.3% | 84.3% |
| 90-94 | 176 | 58.0% | **66.5%** | 64.2% | 64.8% |
| 85-89 | 55 | 50.9% | **56.4%** | 52.7% | 54.5% |
| 80-84 | 82 | 56.1% | **63.4%** | 62.2% | 62.2% |
| 60-79 | 31 | 41.9% | 61.3% | **64.5%** | 58.1% |
| 1-59 | 129 | 16.3% | **50.4%** | 40.3% | 41.9% |
| no algorithm answer | 81 | 0% | **35.8%** | 32.1% | **35.8%** |
| **All, threshold 100** | 835 | 53.5% | **65.9%** (550) | 63.2% (528) | 63.8% (533) |
| `ne_*` only (362) | | 55.2% | **63.5%** | 61.3% | **63.5%** |
| Other held-out files (473) | | 52.2% | **67.7%** | 64.7% | 64.1% |
| Wrong at confidence ≥ 80 | | 181 | 96 | 93 | 106 |

Paired (exact McNemar): run A vs C 46 / 29 (p = 0.06); B vs C 31 / 36 (p = 0.6); C beats stock 4b
80 / 42 (p = 0.0007).

**Choice: keep run A.** C does not beat A overall (-2.0 points, not significant on its own but in
the same direction as B), ties it on `ne_*`, is 3.6 points lower on the other files and gives
more confident wrong answers. Training every weight did not help with ~7,900 examples, and C costs
~1.5x the training time, 11 GB per checkpoint pair and a 5.8 GB fused model (float32) before
quantizing. Caveat: C's second half
restarted Adam, so this is not a clean single run; a clean run (`batch_size` 4 x
`grad_accumulation_steps` 2 from the start) could close some of the gap, but not likely all.

**Step 4A result:** LoRA r16 (run A) is the configuration to use. Next per the plan: Step 4B.

### 2026-11-17: Step 4B, run D3 (base + `noRelatedWordInHistory`, labelled 55)

D1 is run A (base set). D3: `LLM_FINETUNE_INCLUDE=noRelatedWordInHistory
LLM_FINETUNE_OUT_DIR=llmTrainingData/finetune-d3 npm run build:finetune-data`, 10,265 train
examples (2,738 `noRelatedWordInHistory` at label 55; the project and group caps now drop ~500 base
examples, so D3 is not exactly A + extras), `llmTraining/lora-r16-d3.yaml` (run A's config,
2,566 iterations = 2 epochs). `check_data.py` PASS. Validation loss 3.14 → 0.065-0.075 from
iteration 1,200 (not comparable with A: the validation set now has the 55-labelled cases too);
~2.8 hours. Fused, 8-bit (`uw-tw-qwen3-1.7b-d3`), Step 6 (b):

| Algorithm confidence | Cases | Algorithm | Run A (D1) | D3 |
|---|---|---|---|---|
| 100 | 281 | 84.3% | 84.3% | 84.3% |
| 90-94 | 176 | 58.0% | **66.5%** | 65.9% |
| 85-89 | 55 | 50.9% | 56.4% | **67.3%** |
| 80-84 | 82 | 56.1% | **63.4%** | 62.2% |
| 60-79 | 31 | 41.9% | 61.3% | **67.7%** |
| 1-59 | 129 | 16.3% | 50.4% | **52.7%** |
| no algorithm answer | 81 | 0% | 35.8% | **48.1%** |
| **All, threshold 100** | 835 | 53.5% | 65.9% (550) | **68.1%** (569) |
| `ne_*` only (362) | | 55.2% | 63.5% | **66.9%** |
| Other held-out files (473) | | 52.2% | 67.7% | **69.1%** |
| Wrong at confidence ≥ 80 | | 181 | 96 | **92** |
| No suggestion at all | | 81 | 25 | **2** |

By the case groups of Step 3 (held-out cases matched to `test.meta.jsonl` by id; top-1, wrong at
≥ 80 in brackets; paired McNemar A-only / D3-only right):

| Group | Cases | Algorithm | Run A | D3 | A / D3 only | p |
|---|---|---|---|---|---|---|
| passes | 233 | 83.3% (32) | **86.7%** (12) | 85.4% (15) | 8 / 5 | 0.58 |
| onlyOtherFormsInHistory | 118 | 57.6% (23) | 72.0% (5) | **74.6%** (5) | 7 / 10 | 0.63 |
| someExpectedWordsNotInHistory | 115 | 0.9% (68) | 24.3% (31) | **28.7%** (25) | 6 / 11 | 0.33 |
| noRelatedWordInHistory | 133 | 0% (7) | 38.3% (3) | **48.9%** (2) | 6 / 20 | 0.009 |
| not exported (algorithm-certain etc.) | 236 | 78.0% (51) | 78.0% (45) | 78.0% (45) | | |

Overall, paired: A-only 27, D3-only 46 (p = 0.03). Best threshold still 100 (569; 533 at 60).

**Choice: keep the `noRelatedWordInHistory` group (D3).** It raises its own group by 10.6 points
(significant), the other groups move by ±3 cases (not significant; run A's two runs differed by 0
on `passes`), confident wrong answers fall overall (96 → 92, though `passes` has 3 more), and the
`ne_*` files gain 3.4 points. The model now nearly always suggests something (2 cases with no
suggestion, from 25). D3 replaces run A as the candidate.

**D3, rest of Step 6** (4-bit built from the fused model with `--q-bits 4`; in LM Studio
`uw-tw-qwen3-1.7b-d3@8bit` / `@4bit`; suite with `scripts/test-llm.sh -r 3 -g 1`, single requests
only, results in `llm-eval-results/finetune-d3/`):

| | D3 8-bit | D3 4-bit | Run A 8-bit | Run A 4-bit | Stock 1.7b 8-bit | Stock 4b |
|---|---|---|---|---|---|---|
| (b) held-out top-1 | **68.1%** | 66.1% | 65.9% | 63.2% | 52.0% | 59.4% |
| (b) `ne_*` | **66.9%** | 64.4% | 63.5% | 61.9% | 53.9% | 63.3% |
| (b) wrong at ≥ 80 | **92** | 97 | 96 | 102 | 255 | 189 |
| (a) top-1 | **75%** | 73% | 69% | 71% | 62% | 68% |
| (a) top-1 real projects | **56%** | 51% | 47% | 56% | 36% | 47% |
| (a) wrong at ≥ 80 | **11%** | **11%** | 13% | 13% | 24% | 22% |
| (a) suite result | **PASS** | **PASS** | fail (top-1) | fail (top-1) | fail | fail |
| (a) median ms | 148 | 114 | | | | |

The 4-bit build loses 2.0 points on (b) (569 → 552; paired 31 / 14, p = 0.02), just at the 2-point
bar, and 2 points on (a). The 8-bit build is the one to use; the 4-bit one is a fallback for
computers with little memory, still above stock 4b.

**Against the success bar with D3 (8-bit):** beats stock 1.7b by 16.1 points and stock 4b by 8.7
on (b); at or above the algorithm in every band from 60 to 94; confident wrong answers well below
stock 1.7b on (a) and (b); `ne_*` 66.9% (not worse than the rest, 69.1%, by more than 2.2
points); 4-bit within 2 points: **met, at the limit** (-2.0). It is also the first model to pass
the whole suitability suite on single requests.

**Hand-check of `someExpectedWordsNotInHistory` (2026-11-18).** `python3 llmTraining/handcheck.py`
sampled 50 of the 2,487 such cases in the D2 train and validation sets, spread over target
languages (vi 26, ru 11, fa 3, te/bn/id/es-419/ar 2 each; 30 contradict rule 3), and wrote a local
page (`llmTrainingData/finetune-d2/handcheck-someExpectedWordsNotInHistory.html`) showing the
verse with the expected answer and the history renderings marked. The author judged **all 50
expected answers right** (what a checker should select), including the 30 that contradict rule 3.
So the extra or missing words are not an alignment habit to correct: the cases are kept as they
are, at label 75, with no relabelling. It also suggests rule 3 ("copy exactly those words" when a
history rendering is in the verse) is too strict for these cases; that is a prompt question for
later, measured with the suite, not part of this fine-tune.

D2: `LLM_FINETUNE_INCLUDE=someExpectedWordsNotInHistory LLM_FINETUNE_OUT_DIR=llmTrainingData/finetune-d2
npm run build:finetune-data`, 9,332 train examples (the project cap drops 2,243, mostly Vietnamese),
`llmTraining/lora-r16-d2.yaml` (2,333 iterations = 2 epochs), `check_data.py` PASS. Validation loss
3.23 → 0.065 (1,000) → 0.060 (end); ~2.5 hours. Fused, 8-bit (`uw-tw-qwen3-1.7b-d2`), Step 6 (b):

| | Run A (D1) | D3 | D2 |
|---|---|---|---|
| **All, threshold 100** | 65.9% (550) | **68.1%** (569) | 67.1% (560) |
| `ne_*` only (362) | 63.5% | **66.9%** | 64.6% |
| Other held-out files (473) | 67.7% | **69.1%** | 68.9% |
| Wrong at confidence ≥ 80 | 96 | 92 | **79** |
| passes (233) | **86.7%** | 85.4% | 80.7% |
| onlyOtherFormsInHistory (118) | 72.0% | 74.6% | **76.3%** |
| someExpectedWordsNotInHistory (115) | 24.3% | 28.7% | **36.5%** |
| noRelatedWordInHistory (133) | 38.3% | **48.9%** | 42.1% |

Paired with run A (A-only / D2-only right): overall 41 / 51 (p = 0.35); its own group 7 / 21
(p = 0.01); **`passes` 17 / 3 (p = 0.003)**; the others not significant. D3 vs D2 overall 55 / 46
(p = 0.43).

All 17 `passes` cases D2 lost where run A was right are the same error: D2 answered the right
words **plus more** ("the blessed hope" for `hope`, "good faith" for `good`, "ঈশ্বর পিতা" for
`পিতা`, "rebuke them" for `rebuke`). Answers that differ from the history by extra words teach the
model to widen answers in general, not only where the history differs.

**Choice: do not keep the `someExpectedWordsNotInHistory` group.** It raises its own group
(+12.2 points) and lowers confident wrong answers (96 → 79), but it significantly lowers `passes`,
the most common case, which Step 4B's rule does not allow; overall it is below D3. So there is no
run with both groups. **D3 stays the chosen model** (`uw-tw-qwen3-1.7b-d3`, 8-bit). The hand-check
said these answers are right, so the group may still help with a way to keep the model from
widening (e.g. a smaller share of these cases, or only those without `historyInVerseButDiffers`);
that is a later experiment, not part of this plan.

### 2026-11-18: GGUF builds of D3 (Step 5.4)

Built with llama.cpp 1.0.0 (Homebrew, commit `b1b770d90`) as in `llmTraining/README.md`: bf16
GGUF from the fused weights with the base model's original tokenizer files (the tokenizer that
`mlx_lm.fuse` re-saves cannot be read by the converter's transformers 4.57, and differs in some
byte-level flags), then `llama-quantize` to Q8_0 (1.8 GB) and Q4_K_M (1.1 GB). Run in LM Studio's
llama.cpp engine (`llama.cpp-mac-arm64-apple-metal-advsimd@2.73.0`).

| | MLX 8-bit | GGUF Q8_0 | MLX 4-bit | GGUF Q4_K_M |
|---|---|---|---|---|
| (b) held-out top-1 | **68.1%** (569) | 65.7% (549) | 66.1% (552) | 66.8% (558) |
| (b) `ne_*` | **66.9%** | 64.1% | 64.4% | 65.2% |
| (b) wrong at ≥ 80 | 92 | **78** | 97 | **75** |
| (a) suite top-1 | **75%** | 67% | 73% | 65% |
| (a) wrong at ≥ 80 | 11% | 11% | 11% | 11% |
| (a) suite result | PASS | fail (top-1) | PASS | fail (top-1) |

Paired on (b): MLX 8-bit vs Q8_0 46 / 26 (p = 0.02); MLX 4-bit vs Q4_K_M 44 / 50 (p = 0.6).

**Why the GGUF builds score lower**, measured on the 543 exported held-out prompts at temperature
0, scoring the first answer row against the label:
- **Not quantization.** The unquantized bf16 GGUF scores like Q8_0 (309 / 310 right), while MLX
  bf16 and MLX 8-bit agree on 534 of 543 answers (332 / 331 right).
- **Not the chat template or `enable_thinking`.** Sending the exact training prompt (raw
  `/v1/completions`) gives the same scores as the app's chat request on both engines.
- **Tokenization explains little.** llama.cpp tokenizes 55 of the 543 user messages differently
  from the Hugging Face tokenizer (mostly Arabic, Farsi and Russian GL text on the Titus files,
  around combining marks), but on the 488 that tokenize identically MLX and GGUF bf16 still give
  different answers 101 times (306 vs 280 right).
- **It is the engine, not our conversion.** Same weights at bf16: MLX and LM Studio's llama.cpp
  agree on 436 of 543 answers. The **stock** Qwen3-1.7B, converted the same way from the Hugging
  Face cache, diverges even more between the engines (335 of the first 483 answers the same;
  LM Studio's MLX engine crashed with a segmentation fault on prompt 484 of the stock model).

So the GGUF numbers are what Windows and Linux users would get through LM Studio's llama.cpp. The
fine-tune still beats stock 1.7b (51.7%) and stock 4b (59.3%) clearly on GGUF, with fewer
confident wrong answers than the MLX builds, but it loses ~2.4 points at Q8_0 and fails the
suite's top-1 bar. Q4_K_M is as good as Q8_0 on GGUF (558 vs 549, p = 0.14), so it is the smaller
choice there.

**Which engine is right (2026-11-18).** The same 543 prompts (exact training prompt, temperature
0), D3 at full precision in each engine, against transformers (PyTorch, float32) as the reference:

| Engine | Right | Same answer as reference |
|---|---|---|
| transformers float32 (reference) | 337 | 543 |
| GGUF bf16, plain llama.cpp (`llama-server` 1.0.0, Homebrew) | **338** | **538** |
| MLX bf16, LM Studio | 332 | 529 |
| GGUF bf16, LM Studio llama.cpp engine (2.73.0) | 309 | 428 |

**The GGUF file is correct**: plain llama.cpp runs it almost exactly like the reference. Only
LM Studio's bundled llama.cpp engine diverges (and it does for the stock model too), from a load
setting or its own build; its logs show 4 parallel slots with a unified KV cache but not the cache
type. So the lower GGUF scores above are an LM Studio llama.cpp problem on the Mac, not a
property of the model. Not yet measured: LM Studio's Windows and Linux llama.cpp engines (CUDA,
Vulkan, CPU builds), Ollama, and the app's full scoring (Step 6 (b)) through plain
`llama-server`.
