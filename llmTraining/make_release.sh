#!/bin/bash
# Assembles the release folders of the chosen model (plans/fine-tune-qwen3.md: D3) from the builds in
# llmTraining/outputs, each with the model card (llmTraining/model-card/README.md) and the Apache 2.0
# LICENSE (the base model's copy):
#   llmTraining/outputs/release/uw-tw-qwen3-1.7b-mlx-5bit/  MLX 5-bit, for Mac
#   llmTraining/outputs/release/uw-tw-qwen3-1.7b-GGUF/      GGUF Q4_K_M, for Windows and Linux
# Run from the repo folder after building the 5-bit and GGUF builds (llmTraining/README.md). Rerun it
# after changing the card; it replaces the release folders.
#
# Upload (after the card's TODOs are done; REPO is the Hugging Face repository, e.g. org/name):
#   llmTraining/.venv/bin/hf auth login
#   llmTraining/.venv/bin/hf upload REPO-MLX-5bit llmTraining/outputs/release/uw-tw-qwen3-1.7b-mlx-5bit .
#   llmTraining/.venv/bin/hf upload REPO-GGUF llmTraining/outputs/release/uw-tw-qwen3-1.7b-GGUF .
set -euo pipefail

OUT=llmTraining/outputs
REL=$OUT/release
CARD=llmTraining/model-card/README.md
MLX=$OUT/uw-tw-qwen3-1.7b-d3-5bit
GGUF=$OUT/uw-tw-qwen3-1.7b-d3-GGUF/uw-tw-qwen3-1.7b-d3-Q4_K_M.gguf
BASE=$(ls -d ~/.cache/huggingface/hub/models--Qwen--Qwen3-1.7B/snapshots/*/ | head -1)
LICENSE=${BASE}LICENSE

for f in "$CARD" "$MLX/model.safetensors" "$GGUF" "$LICENSE"; do
  [ -e "$f" ] || { echo "missing: $f" >&2; exit 1; }
done
grep -q "Apache License" "$LICENSE" || { echo "not the Apache license: $LICENSE" >&2; exit 1; }

rm -rf "${REL:?}"
mkdir -p "$REL/uw-tw-qwen3-1.7b-mlx-5bit" "$REL/uw-tw-qwen3-1.7b-GGUF"

# MLX: the model folder, with the card in place of the README mlx_lm.convert writes
cp "$MLX"/* "$REL/uw-tw-qwen3-1.7b-mlx-5bit/"
cp "$CARD" "$REL/uw-tw-qwen3-1.7b-mlx-5bit/README.md"
cp "$LICENSE" "$REL/uw-tw-qwen3-1.7b-mlx-5bit/LICENSE"

# GGUF: one file, renamed for release; the card without the MLX library tag
cp "$GGUF" "$REL/uw-tw-qwen3-1.7b-GGUF/uw-tw-qwen3-1.7b-Q4_K_M.gguf"
sed '/^library_name: mlx$/d' "$CARD" > "$REL/uw-tw-qwen3-1.7b-GGUF/README.md"
cp "$LICENSE" "$REL/uw-tw-qwen3-1.7b-GGUF/LICENSE"

if grep -q "TODO" "$CARD"; then
  echo "note: the model card still has TODOs ($(grep -c TODO "$CARD") lines); finish them before uploading"
fi
du -sh "$REL"/*
