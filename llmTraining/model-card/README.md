---
license: apache-2.0
base_model: Qwen/Qwen3-1.7B
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
DRAFT model card for uw-tw-qwen3-1.7b-d3. Before publishing:
- TODO: set the published repository names (MLX and GGUF) and the download links below.
- TODO: fill in the owners and source links in the attribution tables (see "Training data").
- TODO: give the CC BY-SA version of the training data (e.g. 4.0).
Figures are from plans/fine-tune-qwen3.md (Results) in the checking-tool-wrapper repository.
-->

# uw-tw-qwen3-1.7b (translationWords suggestions)

A small model, fine-tuned from [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B), that helps Bible
translation checkers in [translationCore](https://github.com/unfoldingWord/translationCore). In a
translationWords check, the checker selects the words in their translation (the target language)
that render a key term from the gateway-language (GL) text. This model suggests those words, with a
confidence, so the checker can accept or correct them.

It is meant to run on the checker's own computer, offline, through a local OpenAI-compatible server
(LM Studio on Mac, or a llama.cpp server), as one part of translationCore's suggestions. The final
choice always stays with the checker.

## Builds

| Build | For | Size | Run it with |
|---|---|---|---|
| MLX 5-bit | Mac (Apple silicon) | 1.1 GB | LM Studio (MLX engine) |
| GGUF Q5_K_M | Windows, Linux | 1.2 GB | llama.cpp (`llama-server`) |

Both builds are 5-bit. MLX 5-bit scores the same as MLX 8-bit on every test below, at two-thirds
the size. In llama.cpp, GGUF Q5_K_M scores the same as Q8_0 and as the MLX build; Q4_K_M did too,
but 5 bits keep a margin (the 0.6B model loses accuracy at 4 bits).

**Engine note:** on a Mac, LM Studio's *llama.cpp* engine gave noticeably different and worse
answers than llama.cpp itself (`llama-server`), for this model and for the stock Qwen3-1.7B alike.
Plain llama.cpp matched the reference implementation (transformers) on 538 of 543 test prompts;
LM Studio's llama.cpp engine matched on 428. On a Mac, use the MLX build. LM Studio's Windows and
Linux engines have not been tested yet.

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
  in one call, it drops the `### REQUEST n` markers and most answers come back empty (36% top-1
  with 4 checks per call, against 75% one at a time). In translationCore, keep `llmGrouping` at 1,
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

### Held-out projects (6,076 checks)

A copy of the model was trained with ten projects held out, one or more in each main training
language plus Nepali, which is in no training project, and scored on all of them. The released
model trains on six of those projects too, so this copy is the clean measure for languages the
model knows, on projects it has not seen.

| Held-out project | Checks | Algorithm alone | This model | Qwen3-1.7B | Qwen3-4B-2507 |
|---|---|---|---|---|---|
| Russian, Luke (GL en and ar) | 2,569 | 64.1% | **82.2%** | 58.3% | 67.2% |
| Telugu, Luke | 1,393 | 53.3% | **68.3%** | 54.1% | 59.9% |
| Vietnamese, Hebrews | 727 | 46.8% | **67.3%** | 43.7% | 50.2% |
| Arabic, Hebrews | 349 | 59.9% | **82.2%** | 58.5% | 65.6% |
| Nepali, 2 Corinthians (unseen language) | 323 | 55.1% | **65.0%** | 53.9% | 63.5% |
| English, Titus, under 5 GLs | 291 | 49.5% | **57.4%** | 46.4% | 50.9% |
| Indonesian, 1 Timothy | 112 | 57.1% | **67.9%** | 47.3% | 57.1% |
| Bengali, Ephesians | 98 | 67.3% | **85.7%** | 63.3% | 72.4% |
| Farsi, James | 91 | 28.6% | **52.7%** | 27.5% | 36.3% |
| Spanish (Latin America), Ruth | 84 | 44.0% | **71.4%** | 50.0% | 57.1% |
| Nepali, Titus (unseen language) | 39 | 56.4% | **64.1%** | 51.3% | 61.5% |
| **All** | **6,076** | 57.2% | **74.2%** | 54.1% | 61.7% |
| Wrong at ≥ 80 | | 1,049 | **547** | 1,802 | 1,357 |

The Qwen models are the stock models given the same prompt (Qwen3-1.7B as an MLX 8-bit build). The
model beats the algorithm and both stock models in every project, and gives about half the
confident wrong answers of the algorithm alone.

### The released model (835 checks)

The released model trains on more projects, so it is scored on the four projects held out from it:
Nepali (2 Corinthians, Titus), Bengali (Ephesians), Spanish (Ruth) and English Titus under five
GLs.

| Model | Top-1 | Nepali only (362) | Wrong at ≥ 80 |
|---|---|---|---|
| This model, MLX 5-bit | **68.3%** | 66.6% | **91** |
| This model, MLX 8-bit | 68.1% | 66.9% | 92 |
| This model, GGUF Q5_K_M (llama.cpp) | 68.1% | 66.9% | 94 |
| This model, GGUF Q4_K_M (llama.cpp, not released) | 68.7% | 68.0% | 85 |
| This model, GGUF Q8_0 (llama.cpp) | 68.7% | 66.9% | 91 |
| Qwen3-4B-2507 | 59.3% | | 193 |
| Qwen3-1.7B (MLX 8-bit) | 51.7% | | 257 |
| Algorithm alone | 53.5% | 55.2% | 181 |

Trained on more data, the released model is about 3 points better on these files than the
held-out copy above (68.3% vs 65.4%).

### Suitability suite

translationCore's model suitability suite (55 hand-written and real cases, asked 3 times):

| Build | Top-1 | Wrong at ≥ 80 | Median time per suggestion | Result |
|---|---|---|---|---|
| MLX 5-bit (LM Studio) | 75% | 11% | 126 ms | Pass |
| GGUF Q5_K_M (llama.cpp) | 67% | 11% | 100 ms | Below the 70% top-1 bar |

Times on an M5 Pro Mac. Stock Qwen3-1.7B scored 62% with 24% wrong at ≥ 80, stock Qwen3-4B-2507
68% with 22%. The GGUF build answers 6 of the 55 cases differently from MLX, mostly by giving fewer
words; on the 835 checks above it matches MLX.

## Training

- **Base model:** Qwen/Qwen3-1.7B.
- **Method:** LoRA, rank 16 (scale 1.0, no dropout) on every layer's attention and MLP projections,
  with Apple MLX (`mlx-lm` 0.32.2, `mlx` 0.32.4) on a Mac. Loss on the answer only.
- **Settings:** 2 epochs (2,566 steps), batch 8, learning rate 2e-4 with 100 warmup steps and
  cosine decay, maximum length 2,048 tokens, seed 3407. About 2.8 hours.
- **Then:** the adapter is merged into the base weights and quantized (MLX 5-bit; GGUF with
  llama.cpp, Q5_K_M).
- **Compared and not chosen:** LoRA rank 64 and a full fine-tune scored 2-3 points lower; adding
  the cases where the expected answer only partly matches the history raised that group but made
  the model add extra words elsewhere.

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

| Project | Language | Book | Aligned to (GL) | Owner | Source |
|---|---|---|---|---|---|
| `BSOJ/ar_avd/heb.usfm` | Arabic | Hebrews | English (ULT) | TODO | TODO |
| `BSOJ/ar_avd/tit.usfm` | Arabic | Titus | English (ULT), Spanish (GLT) | TODO | TODO |
| `BSOJ/ar_avt/psa.usfm` | Arabic | Psalms | English (ULT) | TODO | TODO |
| `translationCore-Create-BCS/bn_glt/2co.usfm` | Bengali | 2 Corinthians | English (ULT) | TODO | TODO |
| `translationCore-Create-BCS/bn_glt/tit.usfm` | Bengali | Titus | English (ULT), Spanish (GLT) | TODO | TODO |
| `es-419_gl/es-419_est/jon.usfm` | Spanish (Latin America) | Jonah | English (ULT) | TODO | TODO |
| `es-419_gl/es-419_glt/jon.usfm` | Spanish (Latin America) | Jonah | English (ULT) | TODO | TODO |
| `fa_gl/fa_glt/1ti.usfm` | Farsi | 1 Timothy | English (ULT) | TODO | TODO |
| `fa_gl/fa_glt/jas.usfm` | Farsi | James | English (ULT) | TODO | TODO |
| `fa_gl/fa_glt/mrk.usfm` | Farsi | Mark | English (ULT) | TODO | TODO |
| `id_gl/id_glt/1ti.usfm` | Indonesian | 1 Timothy | English (ULT) | TODO | TODO |
| `id_gl/id_glt/tit.usfm` | Indonesian | Titus | English (ULT), Spanish (GLT) | TODO | TODO |
| `ru_gl/ru_rlob/gen.usfm` | Russian | Genesis | English (ULT) | TODO | TODO |
| `ru_gl/ru_rlob/luk.usfm` | Russian | Luke | English (ULT), Arabic (ARST) | TODO | TODO |
| `ru_gl/ru_rlob/tit.usfm` | Russian | Titus | English (ULT), Spanish (GLT) | TODO | TODO |
| `translationCore-Create-BCS/te_glt/luk.usfm` | Telugu | Luke | English (ULT) | TODO | TODO |
| `translationCore-Create-BCS/te_glt/tit.usfm` | Telugu | Titus | English (ULT), Spanish (GLT) | TODO | TODO |
| `vi_gl/vi_glt/1co.usfm` | Vietnamese | 1 Corinthians | English (ULT) | TODO | TODO |
| `vi_gl/vi_glt/heb.usfm` | Vietnamese | Hebrews | English (ULT) | TODO | TODO |
| `vi_gl/vi_glt/luk.usfm` | Vietnamese | Luke | English (ULT), Arabic (ARST), Russian (RLOB) | TODO | TODO |
| `vi_gl/vi_glt/tit.usfm` | Vietnamese | Titus | English (ULT), Spanish (GLT) | TODO | TODO |

Gateway-language texts the projects are aligned to (versions as in the training data; owners are
their Door43 organizations):

| GL text | Version | Owner | Source |
|---|---|---|---|
| English, unfoldingWord Literal Text (ULT) | v91 | unfoldingWord | TODO |
| Spanish (Latin America), GLT | v42 | es-419_gl | TODO |
| Arabic, ARST | v4.9 | BSOJ | TODO |
| Russian, RLOB | v13.0 | ru_gl | TODO |


## Limitations

- **Tied to translationCore's prompt.** If that prompt changes, the model should be retrained, or at
  least measured again (see checking-tool-wrapper).
- **The answers are alignments, not selections.** The training answers are the words translators
  aligned to a key term, which can include small words a checker would leave out.
- **Confidences are a rule, not a probability.** They follow the labeling rule above and are not
  calibrated. How well they separate right from wrong answers has not been measured.
- **Coverage.** Most training examples use an English GL. Nepali is the only language tested that
  is in no training project, and the model was not tested with GLs beyond those listed.
- **Small model.** When nothing in the history is related to the right answer, it is right about
  half the time (48.9% of 133 such held-out checks), and it is trained to mark those answers with a
  lower confidence (55).

## License

The model weights are released under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), as is the base model, Qwen3-1.7B.

