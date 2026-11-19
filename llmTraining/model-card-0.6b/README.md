---
license: apache-2.0
base_model: Qwen/Qwen3-0.6B
pipeline_tag: text-generation
library_name: mlx
tags:
  - bible-translation
  - translationcore
  - translationwords
  - qwen3
  - lora
  - mlx
  - gguf
language:
  - multilingual
  - en
  - ar
  - ru
  - es
  - vi
  - te
  - fa
  - id
  - bn
  - ne
---

<!--
DRAFT model card for uw-tw-qwen3-0.6b-d3 (the small companion of uw-tw-qwen3-1.7b-d3). Before publishing:
- TODO: set the published repository names (MLX and GGUF) and the download links below.
- TODO: fill in the owners and source links in the attribution tables (see "Training data").
The training data and attribution sections are the same as the 1.7B card (llmTraining/model-card);
keep them in step. Figures are from plans/fine-tune-qwen3.md ("Qwen3-0.6B as a candidate").
-->

# uw-tw-qwen3-0.6b (translationWords suggestions, small)

A very small model, fine-tuned from [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), that helps
Bible translation checkers in [translationCore](https://github.com/unfoldingWord/translationCore). In a
translationWords check, the checker selects the words in their translation (the target language)
that render a key term from the gateway-language (GL) text. This model suggests those words, with a
confidence, so the checker can accept or correct them.

It is the small companion of **uw-tw-qwen3-1.7b**, trained on the same data in the same way. **Use
the 1.7B model when the computer can run it** (about 1.1 GB): it is about 3.5 points more accurate
and passes translationCore's suitability suite, which this one does not. This model is for
computers with too little memory for the 1.7B.

It is meant to run on the checker's own computer, offline, through a local OpenAI-compatible server
(LM Studio on Mac, or a llama.cpp server), as one part of translationCore's suggestions. The final
choice always stays with the checker.

## Builds

| Build | For | Size | Run it with |
|---|---|---|---|
| MLX 6-bit | Mac (Apple silicon) | 0.5 GB | LM Studio (MLX engine) |
| GGUF Q6_K | Windows, Linux | 0.5 GB | llama.cpp (`llama-server`) |

Both builds are 6-bit. At this size, 4-bit rounding costs accuracy (GGUF Q4_K_M scored 63.0%
against 64.7% for Q8_0, p = 0.02); 5 to 8 bits score within noise of each other on both engines
(GGUF Q6_K 64.8%, MLX 6-bit 64.1%, against 64.7% and 64.8% for the 8-bit builds), and 6 bits keep a
margin above the 4-bit loss at 0.5 GB.

**Engine note:** on a Mac, LM Studio's *llama.cpp* engine gave noticeably different and worse
answers than llama.cpp itself (`llama-server`) for Qwen3 models (measured with the 1.7B). On a Mac,
use the MLX build. LM Studio's Windows and Linux engines have not been tested yet.

## How to use it

The model was trained on the exact request translationCore's checking tool sends: its system prompt
(`LLM_SINGLE_SYSTEM_PROMPT`) and a user message built by `buildTranslationOptionsPrompt` in
[`checking-tool-wrapper`](https://github.com/unfoldingWord/checking-tool-wrapper)
(`src/utils/checkingSuggestionsUtils.js`), with thinking turned off (`/no_think` and
`chat_template_kwargs: {"enable_thinking": false}`). The user message gives the verse, the GL
phrase, and the checker's earlier selections for that key term ("history"). The model answers with
up to three CSV rows, best first:

```
"selected words",confidence
```

Use it with that prompt. A different prompt may work, but it has not been measured.

- **One request per call.** The model was trained on single requests. With several checks batched
  in one call, the 1.7B version drops the `### REQUEST n` markers and most answers come back empty
  (36% top-1 with 4 checks per call, against 75% one at a time); this model was not tested batched
  and is expected to do the same. In translationCore, keep `llmGrouping` at 1,
  the default. Nothing warns you if it is raised: translationCore falls back to its matching
  algorithm when the model gives no answer, so suggestions quietly get worse instead of failing.
- **Temperature 0.1** (translationCore's default). Answers are short (about 8 tokens).
- **Let the algorithm answer first.** translationCore's matching algorithm answers on its own when
  it is certain (confidence 100) and asks the model otherwise. This model is most accurate with
  that cutoff at 100, the default.

## Results

"Top-1" is how often the first suggestion is exactly the words the translator aligned, scored as
translationCore shows it (the algorithm answers when it is certain, and is the fallback when the
model gives nothing). "Wrong at ≥ 80" counts first suggestions that were wrong but shown with
confidence 80 or more, the ones a checker is most likely to accept by mistake. All runs at
temperature 0.1, one request per call.

### Held-out projects (835 checks)

Scored on the four projects held out from training: Nepali (2 Corinthians, Titus; a language in no
training project), Bengali (Ephesians), Spanish (Ruth) and English Titus under five GLs.

| Model | Size | Top-1 | Nepali only (362) | Wrong at ≥ 80 |
|---|---|---|---|---|
| uw-tw-qwen3-1.7b, MLX 5-bit (for comparison) | 1.1 GB | **68.3%** | **66.6%** | 91 |
| This model, MLX 6-bit | 0.5 GB | 64.1% | 63.0% | 95 |
| This model, GGUF Q6_K (llama.cpp) | 0.5 GB | 64.8% | 63.8% | 92 |
| This model, MLX 8-bit (not released) | 0.6 GB | 64.8% | 63.0% | 91 |
| This model, GGUF Q8_0 (llama.cpp, not released) | 0.6 GB | 64.7% | 63.5% | 92 |
| This model, GGUF Q5_K_M (llama.cpp, not released) | 0.4 GB | 64.3% | 62.7% | 90 |
| This model, MLX 5-bit (not released) | 0.4 GB | 63.6% | 61.0% | 92 |
| This model, GGUF Q4_K_M (llama.cpp, not released) | 0.4 GB | 63.0% | 62.2% | 98 |
| Qwen3-4B-2507 | 2.3 GB | 59.3% | 63.3% | 193 |
| Qwen3-0.6B (MLX 8-bit) | 0.6 GB | 54.4% | 54.7% | 213 |
| Qwen3-1.7B (MLX 8-bit) | 1.7 GB | 51.7% | 53.3% | 257 |
| Algorithm alone | | 53.5% | 55.2% | 181 |

The Qwen models are the stock models given the same prompt. Fine-tuning lifts Qwen3-0.6B by about
10 points, above the stock 4B model (paired, 88 checks right only for this model against 42 only
for the 4B, p < 0.001), with as few confident wrong answers as the 1.7B fine-tune. It stays about
3.5 points below the 1.7B fine-tune (p = 0.001), in every band of the algorithm's confidence
below 100 (at 100 the algorithm answers). The stock 0.6B often
does not stop "thinking" (empty answers, over a second per suggestion); the fine-tune fixes that.

### Suitability suite

translationCore's model suitability suite (55 hand-written and real cases, asked 3 times):

| Build | Top-1 | Wrong at ≥ 80 | Median time per suggestion | Result |
|---|---|---|---|---|
| MLX 6-bit (LM Studio) | 64% | 13% | 75 ms | Below the 70% top-1 bar |
| GGUF Q6_K (llama.cpp) | 60% | 11% | 50 ms | Below the 70% top-1 bar |
| uw-tw-qwen3-1.7b, MLX 5-bit | 75% | 11% | 126 ms | Pass |

Times on an M5 Pro Mac. Stock Qwen3-0.6B scored 58% with 16% wrong at ≥ 80.

## Training

- **Base model:** Qwen/Qwen3-0.6B (same tokenizer and chat template as Qwen3-1.7B).
- **Method:** LoRA, rank 16 (scale 1.0, no dropout) on every layer's attention and MLP projections,
  with Apple MLX (`mlx-lm` 0.32.2, `mlx` 0.32.4) on a Mac. Loss on the answer only.
- **Settings:** 2 epochs (2,566 steps), batch 8, learning rate 2e-4 with 100 warmup steps and
  cosine decay, maximum length 2,048 tokens, seed 3407: the 1.7B model's recipe unchanged. About
  1.4 hours.
- **Then:** the adapter is merged into the base weights and quantized (MLX 6-bit; GGUF with
  llama.cpp, Q6_K).
- **Settings choice:** taken from the 1.7B model, where LoRA rank 64, a full fine-tune and other
  training sets were compared; they were not tuned again for 0.6B.

Scripts, configurations and the full results are in `llmTraining/` and
`plans/fine-tune-qwen3.md` of the checking-tool-wrapper repository.

## Training data

10,265 training and 629 validation examples, built from translationWords checks in aligned
translationCore projects. Each example is the prompt translationCore sends and, as the answer, the
words the translator aligned to the key term.

- **Target languages:** Arabic, Russian, Vietnamese, Telugu, Farsi, Bengali, Indonesian and Spanish
  (Latin America).
- **Gateway languages:** English (most examples), Arabic, Russian and Spanish.
- **Confidence labels** follow a fixed rule, not a measurement: 95 when the answer is an earlier
  rendering found word for word in the verse, 75 when it is related to one, 55 when the history
  has nothing related. 299 examples (3%) pair a check with another verse that contains none of
  its words, answered with nothing at confidence 0, so the model learns to give no answer.
- **Left out:** checks the algorithm already gets right with certainty (most of them), checks the
  algorithm is certain about but wrong, answers that could not be found in the verse, and checks
  from the held-out projects and the suitability suite.

The training data is licensed under various open licenses. It comes
from the work of the translation teams below, and of the gateway-language teams whose texts they
aligned to.  See the LICENSE.md file of each project for details.

Target-language projects in the training and validation data (21):

Training data is on https://git.door43.org/

| Project Source| Language | Book | Aligned to (GL) |
|---|---|---|---|
| `BSOJ/ar_avd/heb.usfm` | Arabic | Hebrews | English (ULT) |
| `BSOJ/ar_avd/tit.usfm` | Arabic | Titus | English (ULT), Spanish (GLT) |
| `BSOJ/ar_avt/psa.usfm` | Arabic | Psalms | English (ULT) |
| `translationCore-Create-BCS/bn_glt/2co.usfm` | Bengali | 2 Corinthians | English (ULT) |
| `translationCore-Create-BCS/bn_glt/tit.usfm` | Bengali | Titus | English (ULT), Spanish (GLT) |
| `es-419_gl/es-419_est/jon.usfm` | Spanish (Latin America) | Jonah | English (ULT) |
| `es-419_gl/es-419_glt/jon.usfm` | Spanish (Latin America) | Jonah | English (ULT) |
| `fa_gl/fa_glt/1ti.usfm` | Farsi | 1 Timothy | English (ULT) |
| `fa_gl/fa_glt/jas.usfm` | Farsi | James | English (ULT) |
| `fa_gl/fa_glt/mrk.usfm` | Farsi | Mark | English (ULT) |
| `id_gl/id_glt/1ti.usfm` | Indonesian | 1 Timothy | English (ULT) |
| `id_gl/id_glt/tit.usfm` | Indonesian | Titus | English (ULT), Spanish (GLT) |
| `ru_gl/ru_rlob/gen.usfm` | Russian | Genesis | English (ULT) |
| `ru_gl/ru_rlob/luk.usfm` | Russian | Luke | English (ULT), Arabic (ARST) |
| `ru_gl/ru_rlob/tit.usfm` | Russian | Titus | English (ULT), Spanish (GLT) |
| `translationCore-Create-BCS/te_glt/luk.usfm` | Telugu | Luke | English (ULT) |
| `translationCore-Create-BCS/te_glt/tit.usfm` | Telugu | Titus | English (ULT), Spanish (GLT) |
| `vi_gl/vi_glt/1co.usfm` | Vietnamese | 1 Corinthians | English (ULT) |
| `vi_gl/vi_glt/heb.usfm` | Vietnamese | Hebrews | English (ULT) |
| `vi_gl/vi_glt/luk.usfm` | Vietnamese | Luke | English (ULT), Arabic (ARST), Russian (RLOB) |
| `vi_gl/vi_glt/tit.usfm` | Vietnamese | Titus | English (ULT), Spanish (GLT) |

Gateway-language texts the projects are aligned to (versions as in the training data; owners are
their Door43 organizations):

| GL text | Version | Owner |
|---|---|---|
| English, unfoldingWord Literal Text (ULT) | v91 | unfoldingWord |
| Spanish (Latin America), GLT | v42 | es-419_gl |
| Arabic, ARST | v4.9 | BSOJ |
| Russian, RLOB | v13.0 | ru_gl |


## Limitations

- **Tied to translationCore's prompt.** If that prompt changes, the model should be retrained, or at
  least measured again (see checking-tool-wrapper).
- **The answers are alignments, not selections.** The training answers are the words translators
  aligned to a key term, which can include small words a checker would leave out.
- **Confidences are a rule, not a probability.** They follow the labeling rule above and are not
  calibrated. How well they separate right from wrong answers has not been measured.
- **Coverage.** Most training examples use an English GL. Nepali is the only language tested that
  is in no training project, and the model was not tested with GLs beyond those listed.
- **Very small model.** When nothing in the history is related to the right answer, it is right
  45% of the time (45.1% of 133 such held-out checks, against 49.6% for the 1.7B model), and it is
  trained to mark those answers with a lower confidence (55). It was not tested on the wider set of
  held-out projects the 1.7B model was.

## License

The model weights are released under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), as is the base model, Qwen3-0.6B.

