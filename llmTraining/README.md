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
llmTraining/.venv/bin/mlx_lm.lora --config llmTraining/lora-r64.yaml     # run B
llmTraining/.venv/bin/python llmTraining/train_full.py --config llmTraining/full.yaml  # run C, full, float32
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

For run C, pass `--adapter-path llmTraining/outputs/full`; `mlx_lm.fuse` loads the full weights
from it the same way.

Then copy the model folder into LM Studio's models folder and evaluate with Step 6 of the plan.

## GGUF for Windows and Linux (llama.cpp)

translationCore users on Windows and Linux need GGUF. Tested with llama.cpp 1.0.0 (Homebrew,
commit `b1b770d90`, 2026-11-18):

```sh
brew install llama.cpp                                   # llama-quantize
git clone --filter=blob:none --no-checkout https://github.com/ggml-org/llama.cpp llmTraining/.llama.cpp
git -C llmTraining/.llama.cpp checkout b1b770d90         # the converter matching the installed build
/opt/homebrew/bin/python3.12 -m venv llmTraining/.venv-gguf
llmTraining/.venv-gguf/bin/pip install -r llmTraining/.llama.cpp/requirements/requirements-convert_hf_to_gguf.txt
llmTraining/.venv-gguf/bin/pip install -e llmTraining/.llama.cpp/gguf-py
```

`mlx_lm.fuse` re-saves the tokenizer with transformers 5, which the converter's transformers 4.57
cannot read, and its re-saved `tokenizer.json` differs from Qwen's in some byte-level flags. The
fine-tune does not change the tokenizer, so convert from a folder with the fused weights and the
base model's original tokenizer files:

```sh
BASE=$(ls -d ~/.cache/huggingface/hub/models--Qwen--Qwen3-1.7B/snapshots/*/)
F=$PWD/llmTraining/outputs/fused-d3; ST=llmTraining/outputs/gguf-stage-d3; mkdir -p $ST
for f in config.json generation_config.json model.safetensors model.safetensors.index.json; do ln -sf $F/$f $ST/$f; done
for f in tokenizer.json tokenizer_config.json vocab.json merges.txt; do ln -sf $(readlink -f $BASE$f) $ST/$f; done
G=llmTraining/outputs/uw-tw-qwen3-1.7b-d3-GGUF; mkdir -p $G
llmTraining/.venv-gguf/bin/python llmTraining/.llama.cpp/convert_hf_to_gguf.py $ST --outtype bf16 \
    --outfile $G/uw-tw-qwen3-1.7b-d3-bf16.gguf
llama-quantize $G/uw-tw-qwen3-1.7b-d3-bf16.gguf $G/uw-tw-qwen3-1.7b-d3-Q8_0.gguf Q8_0
llama-quantize $G/uw-tw-qwen3-1.7b-d3-bf16.gguf $G/uw-tw-qwen3-1.7b-d3-Q4_K_M.gguf Q4_K_M
```

Copy the `.gguf` files into a folder under LM Studio's models folder; it lists them as
`uw-tw-qwen3-1.7b-d3@q8_0` / `@q4_k_m` and runs them with its llama.cpp engine. Score them with
Step 6 of the plan before publishing.
