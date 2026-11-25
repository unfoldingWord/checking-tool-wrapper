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
DRAFT model card for uw-tw-qwen3-0.6b, version r0v2 (2026-11-24; the first release was d3), the small
companion of uw-tw-qwen3-1.7b r0v2. Before publishing:
- TODO: set the published repository names (MLX and GGUF) and the download links below.
- TODO: fill in the owners and source links in the attribution tables (see "Training data").
The training data and attribution sections are the same as the 1.7B card (llmTraining/model-card);
keep them in step. Figures are from plans/improve-single-prompt.md (Step 8A) and
plans/fine-tune-qwen3.md ("Qwen3-0.6B as a candidate").
-->

# uw-tw-qwen3-0.6b (translationWords suggestions, small)

A very small model, fine-tuned from [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), that helps
Bible translation checkers in [translationCore](https://github.com/unfoldingWord/translationCore). In a
translationWords check, the checker selects the words in their translation (the target language)
that render a key term from the gateway-language (GL) text. This model suggests those words, with a
confidence, so the checker can accept or correct them.

It is the small companion of **uw-tw-qwen3-1.7b**, trained on the same data in the same way. **Use
the 1.7B model when the computer can run it** (about 1.1 GB): it is about 4.5 points more accurate
with history and 15 with none. This model is for
computers with too little memory for the 1.7B.

It is meant to run on the checker's own computer, offline, through a local OpenAI-compatible server
(LM Studio on Mac, or a llama.cpp server), as one part of translationCore's suggestions. The final
choice always stays with the checker.

## Builds

| Build | For | Size | Run it with |
|---|---|---|---|
| MLX 6-bit | Mac (Apple silicon) | 0.5 GB | LM Studio (MLX engine) |
| GGUF Q6_K | Windows, Linux | 0.5 GB | llama.cpp (`llama-server`) |

Both builds are 6-bit, and they score the same (68.1% and 67.7% top-1 on the held-out checks
below). For the first version, 4-bit rounding cost accuracy at this size (GGUF Q4_K_M 63.0% against
64.7% for Q8_0, p = 0.02), while 5 to 8 bits scored within noise of each other on both engines; 6
bits keep a margin above the 4-bit loss at 0.5 GB.

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
temperature 0.1 (seed 42), one request per call; GGUF builds with llama.cpp (`llama-server`), MLX
builds with `mlx_lm.server`.

### Held-out projects (835 checks)

Scored on the four projects held out from training: Nepali (2 Corinthians, Titus; a language in no
training project), Bengali (Ephesians), Spanish (Ruth) and English Titus under five GLs. "No
history" is the same 835 checks with the checker's earlier selections removed, as for a project's
first checks.

| Model | Size | With history | Nepali only (362) | Wrong at ≥ 80 | No history | Median time |
|---|---|---|---|---|---|---|
| uw-tw-qwen3-1.7b, GGUF Q5_K_M (for comparison) | 1.2 GB | **72.3%** | **69.3%** | 83 | **65.0%** | 80 ms |
| **This model, MLX 6-bit** | 0.5 GB | 68.1% | 63.3% | 90 | 50.4% | 59 ms |
| **This model, GGUF Q6_K** | 0.5 GB | 67.7% | 62.7% | 89 | 49.7% | 48 ms |
| First version (d3), MLX 6-bit | 0.5 GB | 64.3% | 63.8% | 96 | 36.9% | 59 ms |
| First version (d3), GGUF Q6_K | 0.5 GB | 64.0% | 63.0% | 96 | 36.2% | 50 ms |
| Qwen3-4B-2507 (GGUF Q8_0) | 4.3 GB | 58.6% | 64.1% | 227 | 36.0% | 188 ms |
| Qwen3-0.6B (GGUF Q8_0) | 0.8 GB | 54.0% | 55.2% | 178 | 4.0% | 78 ms |
| Algorithm alone | | 53.5% | 55.2% | 17 | 0% | |

The Qwen models are the stock models given the same prompt. Compared with the first version, this
version is 3.7 points better with history (paired: 64 checks right only for this version, 33 only
for the first, p = 0.002) and 13.5 points better with no history (158 against 45, p < 0.001), at
the same speed. With history it now scores what the first 1.7B version did (67.4%). With no
history, translationCore caps the AI's confidence at 70, so no answer there is shown at 80 or more.
The gain is not on Nepali (63.0% → 62.7%); it is mostly on English Titus, whose language pairs
(English target, Arabic or Russian GL) this version trains on in other books.

### Suitability suite

translationCore's model suitability suite (55 hand-written and real cases, asked 3 times):

| Build | Top-1 | Wrong at ≥ 80 | Median time per suggestion | Result |
|---|---|---|---|---|
| This model, GGUF Q6_K (llama.cpp) | 58% | 9% | 44 ms | Below the 70% top-1 bar |
| uw-tw-qwen3-1.7b, GGUF Q5_K_M (llama.cpp) | 64% | 10% | 93 ms | Below the 70% top-1 bar |

Times on an M5 Pro Mac. The suite is small (each 1.8 points is one case), and its real cases come
from projects that are also in the training data (their verses are left out), so the held-out
projects above are the measure to rely on. The first version's GGUF Q6_K scored 60% when it was
released (with an earlier version of translationCore's matching algorithm). The MLX build was not
run through the suite.

## Training

- **Base model:** Qwen/Qwen3-0.6B (same tokenizer and chat template as Qwen3-1.7B).
- **Method:** LoRA, rank 16 (scale 1.0, no dropout) on every layer's attention and MLP projections,
  with Apple MLX (`mlx-lm` 0.32.2, `mlx` 0.32.4) on a Mac. Loss on the answer only.
- **Settings:** 2 epochs (4,345 steps), batch 8, learning rate 2e-4 with 100 warmup steps and
  cosine decay, maximum length 2,048 tokens, seed 3407: the 1.7B model's recipe unchanged. About
  2.4 hours.
- **Then:** the adapter is merged into the base weights and quantized (MLX 6-bit; GGUF with
  llama.cpp, Q6_K).
- **Settings choice:** taken from the 1.7B model, where LoRA rank 64, a full fine-tune and other
  training sets were compared; they were not tuned again for 0.6B.

Scripts, configurations and the full results are in `llmTraining/` (`lora-r16-r0v2-0.6b.yaml`),
`plans/fine-tune-qwen3.md` and `plans/improve-single-prompt.md` of the checking-tool-wrapper
repository.

## Training data

17,380 training and 1,077 validation examples, built from translationWords checks in aligned
translationCore projects. Each example is the prompt translationCore sends and, as the answer, the
words the translator aligned to the key term.

- **Target languages:** Russian, Vietnamese, English, Arabic, Telugu, Farsi, Bengali, Spanish
  (Latin America) and Indonesian.
- **Gateway languages:** English (53% of training examples), Russian (34%), Arabic (12%) and
  Spanish (1%).
- **Confidence labels** follow a fixed rule, not a measurement: 95 when the answer is an earlier
  rendering found word for word in the verse, 75 when it is related to one, 55 when the history
  has nothing related. 461 examples (3%) pair a check with another verse that contains none of
  its words, answered with nothing at confidence 0, so the model learns to give no answer.
- **No-history examples:** 1,538 examples (9%) repeat a training check with the history removed,
  labelled 55, so the model learns the request translationCore sends for a project's first checks.
- **Left out:** checks the algorithm already gets right with certainty (most of them), checks the
  algorithm is certain about but wrong, answers that could not be found in the verse, and checks
  from the held-out projects and the suitability suite.

**Changes from the first version:** four new projects (English Galatians, Joshua and Luke; Spanish
Esther), Russian or Arabic GLs added to five others, the no-history examples, and Arabic GL
phrases from AVD: the first version's Arabic-GL examples took their GL phrases from ARST v4.9,
which has English text in most books, so they were English.

The training data is licensed under various open licenses. It comes
from the work of the translation teams below, and of the gateway-language teams whose texts they
aligned to.  See the LICENSE.md file of each project for details.

Target-language projects in the training and validation data (25):

Training data is on https://git.door43.org/

| Project | Language | Book | Aligned to (GL) |
|---|---|---|---|
| `BSOJ/ar_avd/heb.usfm` | Arabic | Hebrews | English (ULT) |
| `BSOJ/ar_avd/tit.usfm` | Arabic | Titus | English (ULT), Spanish (GLT) |
| `BSOJ/ar_avt/psa.usfm` | Arabic | Psalms | English (ULT) |
| `translationCore-Create-BCS/bn_glt/2co.usfm` | Bengali | 2 Corinthians | English (ULT), Arabic (AVD) |
| `translationCore-Create-BCS/bn_glt/tit.usfm` | Bengali | Titus | English (ULT), Spanish (GLT) |
| `unfoldingWord/en_ult/gal.usfm` | English | Galatians | Arabic (AVD) |
| `unfoldingWord/en_ult/jos.usfm` | English | Joshua | Russian (RLOB) |
| `unfoldingWord/en_ult/luk.usfm` | English | Luke | Russian (RLOB) |
| `es-419_gl/es-419_est/est.usfm` | Spanish (Latin America) | Esther | English (ULT) |
| `es-419_gl/es-419_est/jon.usfm` | Spanish (Latin America) | Jonah | English (ULT) |
| `es-419_gl/es-419_glt/jon.usfm` | Spanish (Latin America) | Jonah | English (ULT) |
| `fa_gl/fa_glt/1ti.usfm` | Farsi | 1 Timothy | English (ULT), Russian (RLOB) |
| `fa_gl/fa_glt/jas.usfm` | Farsi | James | English (ULT) |
| `fa_gl/fa_glt/mrk.usfm` | Farsi | Mark | English (ULT) |
| `id_gl/id_glt/1ti.usfm` | Indonesian | 1 Timothy | English (ULT) |
| `id_gl/id_glt/tit.usfm` | Indonesian | Titus | English (ULT), Spanish (GLT) |
| `ru_gl/ru_rlob/gen.usfm` | Russian | Genesis | English (ULT) |
| `ru_gl/ru_rlob/luk.usfm` | Russian | Luke | English (ULT), Arabic (AVD) |
| `ru_gl/ru_rlob/tit.usfm` | Russian | Titus | English (ULT), Spanish (GLT) |
| `translationCore-Create-BCS/te_glt/luk.usfm` | Telugu | Luke | English (ULT), Russian (RLOB) |
| `translationCore-Create-BCS/te_glt/tit.usfm` | Telugu | Titus | English (ULT), Spanish (GLT) |
| `vi_gl/vi_glt/1co.usfm` | Vietnamese | 1 Corinthians | English (ULT), Russian (RLOB) |
| `vi_gl/vi_glt/heb.usfm` | Vietnamese | Hebrews | English (ULT) |
| `vi_gl/vi_glt/luk.usfm` | Vietnamese | Luke | English (ULT), Arabic (AVD), Russian (RLOB) |
| `vi_gl/vi_glt/tit.usfm` | Vietnamese | Titus | English (ULT), Spanish (GLT) |

Gateway-language texts the projects are aligned to (versions as in the training data; owners are
their Door43 organizations):

| GL text | Version | Owner |
|---|---|---|
| English, unfoldingWord Literal Text (ULT) | v91 | unfoldingWord |
| Spanish (Latin America), GLT | v42 | es-419_gl |
| Arabic, Van Dyke (AVD) | v6.9 | BSOJ |
| Russian, RLOB | v13.0 | ru_gl |


## Limitations

- **Tied to translationCore's prompt.** If that prompt changes, the model should be retrained, or at
  least measured again (see checking-tool-wrapper).
- **The answers are alignments, not selections.** The training answers are the words translators
  aligned to a key term, which can include small words a checker would leave out.
- **Confidences are a rule, not a probability.** They follow the labeling rule above and are not
  calibrated. How well they separate right from wrong answers has not been measured.
- **Coverage.** About half the training examples use an English GL. Nepali is the only language
  tested that is in no training project, and the model was not tested with GLs beyond those listed.
- **Very small model.** With no earlier selections it is right about half the time on the held-out
  projects (49.7%, against 65.0% for the 1.7B model), and it is trained to mark those answers with a
  lower confidence (55).

## License

The model weights are released under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), as is the base model, Qwen3-0.6B.

