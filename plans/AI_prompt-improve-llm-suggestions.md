Write a plan for improving the AI suggestion path, `getBestTWordSelectionWithConfidenceFromLlm()`
in `src/utils/checkingSuggestionsUtils.js`, so it gives more accurate suggestions, faster, with fewer
tokens. Deliver the plan only. Do not change any code, and do not commit.

## Who will read the plan

Claude Opus 5.5 will carry out the plan in a later session, with no access to this
conversation. It will have this repo and `CLAUDE.md`. So the plan has to stand on its own:
- Name exact functions, files and line numbers (as of the current commit), and include the
  commit hash so drift can be spotted.
- Make each step small enough to finish and verify on its own, and give a concrete "done
  when" check for it (a test that passes, a command and its expected output).
- Write down every decision you made and why, so the executor doesn't re-open it.
  List anything that needs the author's input under "Open questions" instead of guessing.

## Where to save it

Save the plan as Markdown at `plans/improve-llm-suggestions.md` so the executor can read it
from the repo.

## Background

This path suggests which word(s) in a target-language verse translate a gateway-language (GL)
phrase for a translationWords check, by asking a model on an OpenAI-compatible
chat-completions server (LM Studio or similar; default `AI_API_URL`). Its evidence is the verse,
the GL phrase, and how translators rendered GL phrases in earlier checks.

Read the code before planning. The parts that matter:
- `buildTranslationOptionsPrompt()`: builds the system prompt (fixed text, so the server can
  reuse its cached prompt prefix) and the per-request input.
- `formatPreviousTranslations()`: picks and orders the history sent to the model, capped by
  `MAX_PROMPT_PREVIOUS_TRANSLATIONS`.
- `getBestTWordSelectionsBatchFromLlm()`, `LLM_BATCH_SYSTEM_PROMPT`, `LLM_BATCH_MARKER`,
  `splitLlmBatchAnswer()`: several requests sent in one query and split back out. How many
  requests go in a query comes from the `llmGrouping` setting (default
  `DEFAULT_SUGGESTION_REQUESTS_PER_CALL` in `src/Container.js`).
- `parseLlmSelectionOptions()`, `extractLlmRows()`: defensive parsing of the answer (reasoning
  tags, CSV or JSON rows, missing formatting) and matching the words back to the verse.
- `queryAiAPI()`: the request itself; it adds `/no_think` when thinking is off.
- `LlmRequestQueue` in `src/utils/LlmRequestQueue.js`: queues and caches requests, and falls
  back to the algorithm (`getBestTWordSelectionWithConfidenceAlgorithm()`) when the AI gives no
  suggestion.
- `getBestSelections()`: chooses the AI path or the algorithm path.
- Tests: `__tests__/checkingSuggestionsUtilsLlm.test.js` (parsing and batching, with the network
  mocked). The algorithm path's tests and history fixtures are in
  `__tests__/checkingSuggestionsUtils.test.js` and `__tests__/__fixtures__/tWords/`.
- `translatePhraseWithConfidence()` is an older single-phrase path. Say whether the plan
  touches it.

## Goals, in priority order

1. **Accuracy:** the top suggestion is the words a translator would select, and the
   confidence reflects how likely that is.
2. **Speed:** short time per suggestion, including when requests are batched.
3. **Tokens:** a smaller prompt per suggestion, mainly by keeping the shared system prompt
   fixed and the per-request input compact.

Two model setups must both work, and the plan should say where they need different handling:
- **Small local models**, such as the Qwen3 family, with thinking off. The system prompt must
  be short and literal, with instructions a small model follows reliably, and the input must be
  laid out so it is easy to read.
- **Larger models** that handle several requests batched in one query, which saves time and
  repeated system-prompt tokens.

Thinking stays off by default: it is slow and tends to over-think this task. The model should
just follow the instructions.

## How to measure improvement

The plan must say how each change is shown to help, not just argued:
- Define a small evaluation set of real cases (verse, GL phrase, history, the expected
  selection), built from existing fixtures where possible, covering the language cases below.
- Unit tests must not call a live server; keep the network mocked as the existing tests do.
- If live-model runs are needed to compare prompt versions, plan a separate script outside
  `npm test`, say what it measures (top-1 match, response time, prompt and answer tokens,
  parse failures), and list the server and models to use as an open question.
- Record a baseline for the current code before changing it.

## Constraints

- Keep the return contract: up to 3 `{ selections: [{text, occurrence}], confidence }`, best
  first, interchangeable with the algorithm path (see `CLAUDE.md`).
- Keep parsing at least as tolerant as it is now; the existing tests in
  `__tests__/checkingSuggestionsUtilsLlm.test.js` must keep passing, or the plan says why one changes.
- Keep the system prompt identical across calls, so the server's prompt cache keeps working.
- Don't change the on-disk formats or the `Api`/`Container` contract that translationCore
  uses.
- `npm test` (lint and jest) must pass after every step.

## Languages involved

- The gateway language is a widely used language, such as English, French, Hindi or
  Latin American Spanish. GL-specific knowledge (like a list of common words) is
  possible, but the code and prompt must not assume English.
- The target language can be any language a community speaks, including ones with
  little or no published linguistic data, so the model may know nothing about it. Plan for
  this:
  - No built-in word lists, stemmers or dictionaries for the target language. Anything
    "common word" or morphology-related has to come from the data itself, such as how
    often a word shows up across all history renderings.
  - Words may be compound or heavily inflected. One GL word may match part of a target
    word, and one target word may cover several GL words. A history rendering may show up
    in the verse with a different prefix or suffix.
  - Word order can differ from the GL and can vary between verses, so ordered matching
    may be wrong.
  - Scripts vary (non-Latin, combining marks). Any character-level similarity should work on
    normalized Unicode, and its thresholds should hold up for short words.

## What the plan should contain

1. **Current behavior:** how the AI path works today, with line numbers, and its weaknesses,
   each backed by evidence (code, a test, or an example prompt and answer), not guesses.
2. **Changes:** each with its reason, which goal it serves, and which model setup it is for.
3. **Steps:** in order, each with a "done when" check.
4. **Evaluation:** the evaluation set, the baseline, and how results are compared.
5. **Risks**, and what is deliberately left out.
6. **Open questions** for the author.
