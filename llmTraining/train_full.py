"""Runs `mlx_lm.lora` with the model cast to float32 (plans/fine-tune-qwen3.md, Step 4A, run C).

`mlx_lm.lora` trains the weights in the dtype they load in (bfloat16 for Qwen3-1.7B). That is fine
for LoRA, whose small adapter matrices start at zero, but a full fine-tune at learning rate 1e-5
adds steps of about 1e-5 to weights whose bfloat16 spacing is about 1e-4 (near 0.02), so most
updates would round away. Casting to float32 keeps them; it doubles the memory for weights,
gradients and Adam state (~25 GB for 1.7B) and is slower.

Usage (from the repo folder; same arguments as mlx_lm.lora):
  llmTraining/.venv/bin/python llmTraining/train_full.py --config llmTraining/full.yaml
"""
import mlx.core as mx
import mlx_lm.lora as lora

_load = lora.load


def load_float32(*args, **kwargs):
    model, tokenizer = _load(*args, **kwargs)
    model.set_dtype(mx.float32)
    return model, tokenizer


lora.load = load_float32

if __name__ == "__main__":
    lora.main()
