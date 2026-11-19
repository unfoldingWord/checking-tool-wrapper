#!/bin/bash
# Assembles the release folders of the chosen model (plans/fine-tune-qwen3.md: D3) and its small
# companion (D3's recipe on Qwen3-0.6B) from the builds in llmTraining/outputs, each with its model
# card (llmTraining/model-card*/README.md) and the Apache 2.0 LICENSE (its base model's copy):
#   llmTraining/outputs/release/uw-tw-qwen3-1.7b-mlx-5bit/  MLX 5-bit, for Mac
#   llmTraining/outputs/release/uw-tw-qwen3-1.7b-GGUF/      GGUF Q5_K_M, for Windows and Linux
#   llmTraining/outputs/release/uw-tw-qwen3-0.6b-mlx-6bit/  MLX 6-bit, for Mac
#   llmTraining/outputs/release/uw-tw-qwen3-0.6b-GGUF/      GGUF Q6_K, for Windows and Linux (0.6B: Q4_K_M loses accuracy)
# Run from the repo folder after building the 5-bit and GGUF builds (llmTraining/README.md). Rerun it
# after changing the card; it replaces the release folders.
#
# It also writes llmTraining/outputs/github-release/, flat files for a GitHub release (release assets
# cannot be folders): each MLX build zipped (it unpacks to the model folder LM Studio expects), each
# GGUF file as is, the cards as <name>-README.md, the LICENSE and SHA256SUMS. GitHub allows up to
# 2 GiB per file; the largest here is ~1.2 GiB. Use a draft release while the cards have TODOs:
#   gh release create models-test-YYYY-MM-DD llmTraining/outputs/github-release/* --draft \
#     --title "translationWords suggestion models (test)" --notes "..."
#
# Upload (after the card's TODOs are done; REPO is the Hugging Face repository, e.g. org/name):
#   llmTraining/.venv/bin/hf auth login
#   llmTraining/.venv/bin/hf upload REPO-MLX-5bit llmTraining/outputs/release/uw-tw-qwen3-1.7b-mlx-5bit .
#   llmTraining/.venv/bin/hf upload REPO-GGUF llmTraining/outputs/release/uw-tw-qwen3-1.7b-GGUF .
#   (and the same for the two uw-tw-qwen3-0.6b folders)
set -euo pipefail

OUT=llmTraining/outputs
REL=$OUT/release

# release NAME MLX_DIR MLX_TAG GGUF_FILE GGUF_TAG CARD BASE_REPO_DIR
release() {
  local name=$1 mlx=$2 mlxTag=$3 gguf=$4 ggufTag=$5 card=$6 baseDir=$7
  local base license
  base=$(ls -d ~/.cache/huggingface/hub/"$baseDir"/snapshots/*/ | head -1)
  license=${base}LICENSE
  for f in "$card" "$mlx/model.safetensors" "$gguf" "$license"; do
    [ -e "$f" ] || { echo "missing: $f" >&2; exit 1; }
  done
  grep -q "Apache License" "$license" || { echo "not the Apache license: $license" >&2; exit 1; }

  # MLX: the model folder, with the card in place of the README mlx_lm.convert writes
  mkdir -p "$REL/$name-mlx-$mlxTag" "$REL/$name-GGUF"
  cp "$mlx"/* "$REL/$name-mlx-$mlxTag/"
  cp "$card" "$REL/$name-mlx-$mlxTag/README.md"
  cp "$license" "$REL/$name-mlx-$mlxTag/LICENSE"

  # GGUF: one file, renamed for release; the card without the MLX library tag
  cp "$gguf" "$REL/$name-GGUF/$name-$ggufTag.gguf"
  sed '/^library_name: mlx$/d' "$card" > "$REL/$name-GGUF/README.md"
  cp "$license" "$REL/$name-GGUF/LICENSE"

  if grep -q "TODO" "$card"; then
    echo "note: $card still has TODOs ($(grep -c TODO "$card") lines); finish them before uploading"
  fi
}

rm -rf "${REL:?}"
release uw-tw-qwen3-1.7b "$OUT/uw-tw-qwen3-1.7b-d3-5bit" 5bit \
  "$OUT/uw-tw-qwen3-1.7b-d3-GGUF/uw-tw-qwen3-1.7b-d3-Q5_K_M.gguf" Q5_K_M \
  llmTraining/model-card/README.md models--Qwen--Qwen3-1.7B
release uw-tw-qwen3-0.6b "$OUT/uw-tw-qwen3-0.6b-d3-6bit" 6bit \
  "$OUT/uw-tw-qwen3-0.6b-d3-GGUF/uw-tw-qwen3-0.6b-d3-Q6_K.gguf" Q6_K \
  llmTraining/model-card-0.6b/README.md models--Qwen--Qwen3-0.6B
du -sh "$REL"/*

# flat files for a GitHub release
GH=$OUT/github-release
rm -rf "${GH:?}"
mkdir -p "$GH"
for dir in "$REL"/*-mlx-*; do
  (cd "$REL" && zip -q -r -X "../github-release/$(basename "$dir").zip" "$(basename "$dir")" -x '*.DS_Store')
done
for dir in "$REL"/*-GGUF; do
  name=$(basename "$dir" -GGUF)
  cp "$dir"/*.gguf "$GH/"
  cp "$dir/README.md" "$GH/$name-README.md"
done
cp "$REL/uw-tw-qwen3-1.7b-GGUF/LICENSE" "$GH/LICENSE"
(cd "$GH" && shasum -a 256 -- * > SHA256SUMS)
ls -l "$GH" | awk 'NR > 1 {printf "%8.1f MB  %s\n", $5 / 1048576, $9}'
