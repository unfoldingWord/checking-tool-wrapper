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

**Balance the train set:**
- Keep every case whose algorithm confidence is below 100 (the cases the AI actually gets).
- Keep a random 20% of the confidence-100 cases, so the model still learns the plain
  "copy the previous translation" case without it dominating.
- Cap each target project at ~2,000 examples and each (project, group) at ~40, so
  `ru_rlob_gen`, `ar_avt_psa`, `vi_glt_luk` and groups like `god`/`jesus` do not dominate.
  Rough estimate before the round-trip drops: 10-13k training examples.
- Optional, ~3%: negative examples answered `"",0`, made by pairing a case's GL phrase and history
  with another verse of the same project that contains neither the answer nor any history word.
  The builder drops unaligned checks, so without this the model never sees rule 6.

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
  scale: 20.0                       # mlx-lm uses a scale, not lora_alpha
  dropout: 0.0
  keys: ["self_attn.q_proj", "self_attn.k_proj", "self_attn.v_proj", "self_attn.o_proj",
         "mlp.gate_proj", "mlp.up_proj", "mlp.down_proj"]
mask_prompt: true                   # loss on the assistant answer only
max_seq_length: 2048
batch_size: 8
iters: 3000                         # about 2 epochs of ~12k examples at batch 8
learning_rate: 2e-4
lr_schedule: { name: cosine_decay, warmup: 150, arguments: [2e-4, 3000, 0] }
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
| C | Full fine-tune | `fine_tune_type: full`, no `lora_parameters`, `learning_rate: 1e-5` (try 2e-5), `adapter_path: outputs/full` |

Notes:
- C trains every weight, so it needs a far smaller learning rate than LoRA. A LoRA rate (2e-4) would
  wreck the model. If C's validation loss rises after the first epoch, halve `iters`.
- Memory, estimated and not measured: C needs about 16 bytes per parameter for weights, gradients
  and Adam state (~27 GB for 1.7B) plus activations. With 48 GB of unified memory, gradient
  checkpointing and `batch_size` 2-4, it should fit, but close the other large apps (LM Studio
  included) while it trains. If it does not fit or is too slow, run C on an NVIDIA GPU with
  Unsloth (Appendix A) on the same data.
- C saves full weights (~3.4 GB in bf16) rather than an adapter.

**Choosing:** use the Step 6 (b) held-out top-1 and the rate of confident wrong answers, reported
**separately for the `ne_*` files** (a target language not in training) and for the rest. Pick C
only if it beats the best LoRA run overall **and** is not worse on `ne_*`. A full fine-tune that
gains on seen languages but loses on unseen ones would be a bad trade, because target languages can
be anything. If A and B score within ~1 point of each other, keep A (smaller, faster). Record all
three runs in the results section.

After choosing, other things to try if needed: 1 vs 3 epochs, and `learning_rate` 1e-4 for LoRA.
Pick by the test-set top-1 from Step 6, not by validation loss alone.

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
4. **Only for distribution** (Windows/Linux translationCore users need GGUF): convert the fused bf16
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
   algorithm-first + AI result a translator sees.
c. Optionally, `llmGrouping` 4 on (a) if batched examples were trained.

Metrics: top-1, top-3, wrong answers at confidence ≥ 80, no-suggestion rate, median time.
**Success** (proposed, Q4): on (b), fine-tuned 1.7b top-1 beats stock 1.7b by at least 5 points and
is not below stock 4b; on both (a) and (b), confident wrong answers are no higher than stock 1.7b;
4-bit within 2 points of 8-bit. Record the results in a results section at the end of this plan.

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
- **Q2. Test split.** Is holding out `ne_*`, `bn_glt_eph`, `es-419_est_rut` and `en_ult_tit_*` right,
  or should other projects be held out?
- **Q3. Batched examples.** The app default is one request per call. Train single only, or add
  ~15% batched examples so `llmGrouping` > 1 also improves?
- **Q4. Success bar.** Are the thresholds in Step 6 the right bar to switch the default model?
- **Q5. Distribution.** Will the fine-tuned model be published (e.g. Hugging Face) for
  translationCore users, or kept internal? This affects licensing and where the GGUF lives.

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
