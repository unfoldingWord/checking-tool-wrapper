"""Checks the fine-tuning data before training (plans/fine-tune-qwen3.md, Step 4).

1. Template and masking check: for a sample of examples, compares the tokens `mlx_lm.lora` trains on
   (its own ChatDataset, built as `mlx_lm.lora` builds it, with mask_prompt) with
   - the reference rendering, `apply_chat_template(messages, enable_thinking=False)`, and
   - the prompt the app's request becomes on the server (system + user, generation prompt,
     thinking off): the trained text must start with it, so training matches inference.
   The trained (unmasked) part must be the answer and `<|im_end|>`, optionally after the empty
   think block that the app's generation prompt already ends with.
2. Length check: every example's token count against --max-seq-length.

Optionally writes a small copy of the data for the smoke run (--smoke-dir).

Usage:
  llmTraining/.venv/bin/python llmTraining/check_data.py \
      --data llmTrainingData/finetune [--model Qwen/Qwen3-1.7B] [--sample 300] \
      [--smoke-dir llmTrainingData/finetune-smoke --smoke-train 1000]

Exits 1 when a check fails.
"""
import argparse
import json
import random
import sys
import types
import unicodedata
from pathlib import Path

from mlx_lm.tuner.datasets import load_local_dataset
from mlx_lm.utils import load_tokenizer, hf_repo_to_path

EMPTY_THINK = "<think>\n\n</think>\n\n"


def nfc(text):
    return unicodedata.normalize("NFC", text)


def read_jsonl(path):
    with open(path, encoding="utf-8") as fid:
        return [json.loads(line) for line in fid if line.strip()]


def check_template(tokenizer, dataset, sample_indexes):
    """Returns (failures, unmasked kinds, first report) for the sampled examples."""
    failures = []
    kinds = {}
    first = None

    for i in sample_indexes:
        messages = dataset[i]["messages"]
        answer = nfc(messages[-1]["content"])
        tokens, offset = dataset.process(dataset[i])
        tokens = list(tokens)
        # compared as tokens: the Qwen tokenizer normalizes text to NFC, so decoded text can differ
        # from the input in the order of combining marks (e.g. Arabic vowel signs)
        reference = tokenizer.apply_chat_template(messages, enable_thinking=False, return_dict=False)
        app_prompt = tokenizer.apply_chat_template(
            messages[:-1], add_generation_prompt=True, enable_thinking=False, return_dict=False)
        unmasked = nfc(tokenizer.decode(tokens[offset:]))
        problems = []

        if tokens != list(reference):
            problems.append("trained tokens differ from the reference rendering")
        if tokens[:len(app_prompt)] != list(app_prompt):
            problems.append("trained tokens do not start with the app's prompt (thinking off)")
        elif nfc(tokenizer.decode(tokens[len(app_prompt):])).rstrip("\n") != answer + "<|im_end|>":
            problems.append("text after the app's prompt is not just the answer and <|im_end|>")

        if unmasked.rstrip("\n") == answer + "<|im_end|>":
            kind = "answer"
        elif unmasked.rstrip("\n") == EMPTY_THINK + answer + "<|im_end|>":
            kind = "empty think block + answer"
        else:
            kind = "other"
            problems.append(f"unmasked part is {unmasked!r}")

        # the mask offset is computed from a separate rendering of the prompt; its tokens must be
        # the same as the start of the full sequence, or the mask is shifted
        prompt_tokens = tokenizer.apply_chat_template(
            messages[:-1], add_generation_prompt=True, return_dict=False)
        if tokens[:offset] != list(prompt_tokens):
            problems.append("prompt tokens differ from the start of the full token sequence")

        kinds[kind] = kinds.get(kind, 0) + 1
        if first is None:
            first = {"trained_tail": tokenizer.decode(tokens)[-300:], "unmasked": unmasked}
        if problems:
            failures.append((i, problems))

    return failures, kinds, first


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="Qwen/Qwen3-1.7B")
    parser.add_argument("--data", default="llmTrainingData/finetune")
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--sample", type=int, default=300, help="examples per split for the template check")
    parser.add_argument("--seed", type=int, default=3407)
    parser.add_argument("--smoke-dir", help="write a small copy of the data here")
    parser.add_argument("--smoke-train", type=int, default=1000)
    parser.add_argument("--smoke-valid", type=int, default=200)
    args = parser.parse_args()

    tokenizer = load_tokenizer(hf_repo_to_path(args.model))
    data = Path(args.data)
    config = types.SimpleNamespace(mask_prompt=True)
    splits = dict(zip(("train", "valid", "test"), load_local_dataset(data, tokenizer, config)))
    rng = random.Random(args.seed)
    ok = True

    for name, dataset in splits.items():
        if not len(dataset):
            print(f"{name}: no examples")
            continue

        sample = rng.sample(range(len(dataset)), min(args.sample, len(dataset)))
        failures, kinds, first = check_template(tokenizer, dataset, sample)
        lengths = [len(dataset.process(dataset[i])[0]) for i in range(len(dataset))]
        too_long = sum(1 for n in lengths if n > args.max_seq_length)
        lengths.sort()

        print(f"{name}: {len(dataset)} examples")
        print(f"  template check on {len(sample)}: {len(failures)} failed; unmasked part: {kinds}")
        print(f"  tokens: median {lengths[len(lengths) // 2]}, max {lengths[-1]}, "
              f"over {args.max_seq_length}: {too_long}")
        if name == "train":
            print("  first example, end of trained text:\n    " + repr(first["trained_tail"]))
            print("  trained (unmasked) part:\n    " + repr(first["unmasked"]))
        for i, problems in failures[:5]:
            print(f"  FAILED example {i}: {'; '.join(problems)}")
        ok = ok and not failures and not too_long

    if args.smoke_dir:
        out = Path(args.smoke_dir)
        out.mkdir(parents=True, exist_ok=True)
        for name, count in (("train", args.smoke_train), ("valid", args.smoke_valid), ("test", args.smoke_valid)):
            rows = read_jsonl(data / f"{name}.jsonl")[:count]
            with open(out / f"{name}.jsonl", "w", encoding="utf-8") as fid:
                fid.writelines(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        print(f"smoke data written to {out}")

    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
