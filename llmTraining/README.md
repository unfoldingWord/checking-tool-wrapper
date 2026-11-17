# llmTraining

Fine-tunes `Qwen/Qwen3-1.7B` for translationWords AI suggestions with Apple MLX (`mlx-lm`), as
planned in `plans/fine-tune-qwen3.md` (Steps 4-5). Run every command from the repo folder.
`outputs/` and `.venv/` are git-ignored.

## Setup (once)

```sh
/opt/homebrew/bin/python3.12 -m venv llmTraining/.venv
llmTraining/.venv/bin/pip install -r llmTraining/requirements.txt
llmTraining/.venv/bin/hf download Qwen/Qwen3-1.7B     # ~3.4 GB, into ~/.cache/huggingface
```

Tested with `mlx-lm` 0.32.2, `mlx` 0.32.4, `transformers` 5.23.0 (2026-11-17).

## Data

```sh
npm run run:llm-training-data          # algorithm results, if the training data changed
npm run build:finetune-data            # writes llmTrainingData/finetune/
llmTraining/.venv/bin/python llmTraining/check_data.py --data llmTrainingData/finetune \
    --smoke-dir llmTrainingData/finetune-smoke
```

`check_data.py` must print `PASS`. It checks that `mlx-lm` renders each example exactly like the
reference Qwen3 template with thinking off, that the trained text starts with the prompt the app's
request becomes on the server, that the loss covers only the answer (after the empty think block)
and `<|im_end|>`, and that no example is longer than `max_seq_length`.

Note: `mlx-lm` 0.32's `ChatDataset` calls `apply_chat_template` without `enable_thinking`. For
Qwen3 that still gives the empty `<think>\n\n</think>\n\n` block before the last assistant answer,
the same text the app's generation prompt ends with; `check_data.py` verifies this, so rerun it
after upgrading `mlx-lm` or changing the model.

## Train

```sh
llmTraining/.venv/bin/mlx_lm.lora --config llmTraining/lora-smoke.yaml   # 200 iterations, 1,000 examples
llmTraining/.venv/bin/mlx_lm.lora --config llmTraining/lora-r16.yaml     # run A
```

Set `iters` in `lora-r16.yaml` from the train count in `llmTrainingData/finetune/manifest.json`
(examples x epochs / batch size). Close LM Studio while training; lower `batch_size` to 4 if
memory swaps.

## Fuse and load in LM Studio

```sh
llmTraining/.venv/bin/mlx_lm.fuse --model Qwen/Qwen3-1.7B --adapter-path llmTraining/outputs/lora-r16 \
    --save-path llmTraining/outputs/fused-r16
llmTraining/.venv/bin/mlx_lm.convert --hf-path llmTraining/outputs/fused-r16 \
    --mlx-path llmTraining/outputs/uw-tw-qwen3-1.7b-8bit -q --q-bits 8
```

Then copy the model folder into LM Studio's models folder and evaluate with Step 6 of the plan.
