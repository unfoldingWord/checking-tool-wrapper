# Plan: improve AI suggestions (`getBestTWordSelectionWithConfidenceFromLlm`)

Written 2026-11-09 against commit `7734dae` (`7734daea7cc2d9d435238f53a31c762dfee42a25`) on branch
`feature-mcleanb-add-suggestions-support`. All line numbers are for that commit. Before starting,
run `git log --oneline -1` and `git diff 7734dae --stat -- src __tests__`; if the files below have
changed, find each function by name, not by line number.

**Revised 2026-11-09 (same commit):** the model suitability suite now exists, uncommitted:
`__tests__/llmModelSuitability.test.js`, `__tests__/__fixtures__/llmEval/cases.json` (23 cases) and
the `test:llm` script in `package.json`. Section 3.5 describes it and its results for
`qwen/qwen3-1.7b`, `qwen/qwen3-4b-2507` and `qwen/qwen3-14b`; section 9 holds those results as the
baseline. Steps 1 and 2 were rewritten to extend that suite instead of creating `eval/` files.

Goals, in priority order: **accuracy** (the top suggestion is what a translator would select, and
the confidence reflects that), then **speed**, then **tokens**.

## 1. Summary

The evidence in section 3 changes what is worth doing. The answer format and parsing are not the
problem: in about 360 live request answers from two models there was no parse failure. The losses come from
what the model is shown and from how its answer is mapped back to the verse.

| # | Change | Goal | Setup | Evidence |
|---|---|---|---|---|
| C1 | Choose the history lines sent to the model by how closely their GL key matches the phrase, reusing `rankGlKeys`. Today the right rendering can be filtered out. | Accuracy, tokens | Both | W1 |
| C2 | Map answer words to verse words with `wordSimilarity` instead of a loose Levenshtein match, and cap confidence when the mapping was inexact. | Accuracy (confidence) | Both | W2, W3 |
| C3 | Drop options the model gave with confidence 0. | Accuracy | Both | W5 |
| C4 | Tell the model that batched requests are separate. | Accuracy | Larger models (batched) | W6 |
| C5 | System prompt wording: test variants one at a time, adopt only what the measurements support. | Accuracy | Differs by setup | W4, W5, section 3.4 |
| C6 | Use the check's `occurrence` so a repeated word is suggested at the right place. | Accuracy | Both, and the algorithm path | W8 |
| C7 | Treat a temperature of 0 as a real setting; measure 0.2 against 0.7. | Accuracy (repeatable results) | Both | W7 |
| C8 | Optional, needs the author's yes: skip the model when the algorithm is certain. | Speed, tokens | Both | section 3.2 |

Nothing in this plan changes the return contract, the on-disk formats, the `Api`/`Container`
contract, translationCore or tc-ui-toolkit.

Steps are marked **OFFLINE** (no server needed; verified by `npm test`) or **LIVE** (needs an
OpenAI-compatible server with the models in Open question Q1). If no server is reachable, do the
OFFLINE steps, skip the LIVE ones, and say so in the Results log (section 9).

## 2. Current behavior

All paths are in `src/utils/autoCheckingUtils.js` unless another file is named.

1. `src/Container.js` builds one request per check. Background generation
   (`generateSuggestionsForGroupSub`, line 199) bundles `llmGrouping` requests per query
   (line 200; default `DEFAULT_SUGGESTION_REQUESTS_PER_CALL = 1`, line 95). The interactive path
   is `getSuggestions` (line 709), which sends one request (line 765). Each request carries the
   verse text, `alignedGLText` and `selectionsData.selections`: the whole history for the check's
   translationWords group, shaped `{ glPhrase: { targetRendering: count } }`.
2. `LlmRequestQueue` (`src/utils/LlmRequestQueue.js`) returns a cached result if it has one
   (`makeSuggestionRequest`, line 259), otherwise runs requests one at a time through `doQuery`
   (line 489) → `getBestSelections`. If the AI result has no selection, it reruns that request with
   the algorithm and marks it `algorithmFallback` (lines 397–405).
3. `getBestSelections` (line 3785) sends the jobs to
   `getBestTWordSelectionWithConfidenceFromLlm` (line 2236) when `llmQueryUrl` is set: one job as a
   single request, several as one batch. Temperature is `llmTemperature || 0.7` (line 3865).
4. Single request: `buildTranslationOptionsPrompt` (line 836) returns a fixed system prompt (lines
   845–883: 8 rules, one Spanish example, three wrong answers) and a per-request input: `TARGET
   VERSE (lang): words`, optional `PREVIOUS TRANSLATIONS:` lines, `GATEWAY PHRASE (lang): phrase`,
   `Answer:`.
5. History lines come from `formatPreviousTranslations` (line 693):
   - keeps renderings whose words are all in the verse exactly (lines 699–724); if none are, it
     uses the whole history (lines 726–728);
   - sorts by usage count (line 748);
   - keeps only GL keys whose words are all in the GL phrase, unless that leaves nothing (lines
     750–763);
   - keeps the first `MAX_PROMPT_PREVIOUS_TRANSLATIONS` = 20 (lines 19, 767);
   - writes each as `"rendering" (chosen N times for "key")` (lines 770–774).
6. Batch: `getBestTWordSelectionsBatchFromLlm` (line 2394) prefixes each input with
   `### REQUEST n`, ends with one `Answer:`, appends `LLM_BATCH_SYSTEM_PROMPT` (line 2313) to the
   system prompt (line 2416), allows `max(2048, n × 256)` answer tokens (line 2415), and splits the
   answer with `splitLlmBatchAnswer` (line 2356). The first request's `lmOptions` are used for all.
7. `queryAiAPI` (line 317) prefixes `/no_think` to the system prompt and the query when thinking is
   off (lines 330–331). In Electron it calls `window.AiAPIs.query(query, lmQueryOptions)` (line
   354); translationCore's `electronite/queryAiApisFromMainProcess.js` (line 154) sends its first
   argument as the user message, so there the user message has no `/no_think` and the system prompt
   has it. Outside Electron `streamChatMessage` (line 123) sends both with `/no_think`. Both send
   `chat_template_kwargs: { enable_thinking }` and stream the answer. Neither reads token usage.
8. `parseLlmSelectionOptions` (line 2126) cleans the answer (`cleanLlmAnswer`, line 1825), finds
   rows (`extractLlmRows`, line 1955), and maps each row's words to the verse with
   `resolveLlmPhraseInVerse` (line 2047): exact word, then ignoring accents, then the most similar
   verse word by `fuzzyStringSimilarity` above 0.3 (lines 2069–2080). Words not found are dropped.
   The words are placed as an adjacent run if possible, else in order, else first unused positions
   (lines 2094–2108). Up to 3 options are returned, highest confidence first.

`translatePhraseWithConfidence` (line 2659), `buildVerseMatchPrompt` (line 501) and
`parseResponseRow` (line 2499) are the older single-phrase path. Nothing in `src/` calls
`translatePhraseWithConfidence`. **This plan does not touch them.**

## 3. Evidence

### 3.1 How it was gathered

On 2026-11-09 the code at `7734dae` was run unchanged through temporary jest files (deleted
afterwards; nothing was committed). Live runs used LM Studio at `http://localhost:1234` on the
author's Mac with `qwen/qwen3-4b-2507` and `qwen/qwen3-14b` (both 4-bit, already loaded). The
default `AI_API_URL` (`http://192.168.142.70:1234`) did not answer from that machine. Requests went
through a stand-in for `window.AiAPIs.query` that sends what translationCore's main process sends,
but not streamed, so the server reports token usage.

These are small samples (12 and 15 cases, mostly taken from the algorithm path's own tests, several
with made-up data). They show where the problems are. They are not the baseline; Step 2 records
that.

### 3.2 Measurements

**Run 1: 12 cases, current code.** Top-1 means the top option is exactly the expected words.

| Path | Top-1 | Time for 12 | Prompt tokens for 12 |
|---|---|---|---|
| Algorithm only | 10/12 | ~0 ms | 0 |
| 4b, single, temp 0.7 (2 runs) | 10/12, 9/12 | 2.1 s | 5,695 |
| 4b, single, temp 0.1 | 10/12 | 2.1 s | 5,695 |
| 4b, 4 per query | 10/12 | 2.2 s | 2,242 |
| 4b, 12 per query | 9/12 | 2.3 s | 1,291 |
| 14b, single (3 runs) | 7/12 each | 8.0–9.1 s | 5,695 |
| 14b, 4 per query | 8/12 | 7.4 s | 2,242 |
| 14b, 12 per query | 8/12 | 6.6 s | 1,291 |

- The smallest possible request (one-letter verse and phrase, no history) is 431 prompt tokens; a
  typical one is 442–504. So the fixed system prompt is 85–95% of every single request.
- A single request took 110–220 ms on 4b and 420–930 ms on 14b (up to 1,980 ms for one long answer), so the server is reusing the
  cached system prompt. Answers were 6–24 tokens (one of 58).
- Batching cut prompt tokens by 61% (4 per query) and 77% (12 per query). It saved no time on 4b
  and 7–28% on 14b.
- Thinking was off in both models: 0 and 1 reasoning tokens.
- The algorithm alone matched or beat both models on these cases. Its two misses were the case with
  no history (it returns nothing) and the case where nothing fits (it returns `la` at 15). The
  cases favour it, since most come from its tests.

**Run 2: 15 cases, 2 runs each.** The two Spanish cases no longer use the system prompt's own
example verse, and three made-up-language cases were added, where history is the only evidence.
"Planned history" means the history lines were hand-written to what C1 would produce (they differ
for 2 of the 15 cases, and the order of the Vietnamese lines is not exactly what Step 3 will
produce: see the note in Step 3). "Candidate prompt" is the text in section 3.4.

| Variant | 4b top-1 | 4b wrong at confidence ≥ 80 | 14b top-1 | 14b wrong at confidence ≥ 80 |
|---|---|---|---|---|
| A: current prompt, current history | 12, 13 | 2, 1 | 9, 8 | 4, 4 |
| B: candidate prompt, current history | 11, 12 | 4, 2 | 10, 10 | 1, 1 |
| C: candidate prompt, planned history | 13, 13 | 1, 1 | 11, 11 | 1, 1 |
| D: current prompt, planned history | 14, 14 | 0, 0 | 10, 10 | 3, 4 |

- The history change helped both models (A → D, and B → C).
- The candidate prompt helped 14b and hurt 4b. Prompt wording is model-dependent, so C5 is a
  measured experiment, not a rewrite.
- The candidate prompt cost 113 more prompt tokens per request.

### 3.3 Weaknesses

**W1. The right history line can be filtered out** (`formatPreviousTranslations`, lines 750–763).
Vietnamese, Hebrews 9:12, GL phrase `holy places`, history from
`__tests__/__fixtures__/tWords/vi_translationData.json`. The history has
`"of the holy places": {"các nơi thánh": 1}`, the expected answer, and all three words are in the
verse. The prompt contained only:

```
PREVIOUS TRANSLATIONS:
"Nơi Thánh" (chosen 1 time for "Holy")
```

The key `of the holy places` was dropped because `of` and `the` are not in the GL phrase, while the
less related key `Holy` passed. Both models still got this case right because they know
Vietnamese. With made-up words (`mo tala vu kirano sema lopa dun`, history
`of the holy places → kirano sema`, `Holy → Sema`) the prompt showed only `"Sema"`, and both models
missed in all 4 runs (`sema lopa` at 85 on 4b, `sema` at 50 on 14b). With the planned history both
got it right in all runs.

Related faults in the same function:
- When no rendering is in the verse, up to 20 lines are sent, ordered by count only. A test with 40
  unrelated keys produced 20 unrelated lines (1,060 characters).
- Flat history `{ rendering: count }`, which the JSDoc says is supported, produces no history lines
  at all (the loop at lines 701–706 skips number values). `Container.js` always passes nested
  history, so this does not show in the app.
- Renderings are matched to the verse exactly only, so an inflected form counts as not in the verse.
- GL words are lowercased with the target-language code (line 752).

**W2. The parser maps words that are not in the verse onto unrelated verse words, at full
confidence** (lines 2069–2080, threshold 0.3).
- Live, 4b, batched, both batch sizes: the model answered `"Kirche",85` (the history rendering,
  which is not in `und die Kirchengemeinde versammelte sich`). The parser returned `sich` at 85 and
  88, because plain Levenshtein similarity is 0.50 for `kirche`/`sich` and 0.40 for
  `kirche`/`kirchengemeinde`. 14b gave `"Kirche"` as its second option in every single run, and it
  became `sich` at 70–80.
- Offline: `"mesa",90` on `la casa de la madre y la hija` → `casa` at 90.
  `"the church of Ephesus",95` on `Para la iglesia de Éfeso …` → `de Éfeso` at 95.
- Words not found are dropped silently: 4b answered `"la iglesia",0` for a verse without `iglesia`
  and the parser returned `la`.

`wordSimilarity` (line 1468), which the algorithm path uses, gets all of these right: it needs 0.65
similarity, never fuzzy-matches words under 4 code points, and treats a word of 6 or more code
points that is a whole prefix or suffix of another as related (`kirche` → `kirchengemeinde`).

**W3. Models often answer with the history spelling, not the verse word.** Rule 1 says to copy
verse words. Seen in most runs on both models: `"विश्वास"` (verse has `विश्वासी`), `"cuando reúnen"`
(verse has `reúnan`), `"πιστοί"` (verse has `πιστούς`), `"святой дух"` (verse order is `дух
святой`), `"Kirche"`. The parser's fuzzy step is what rescues these, so C2 must keep rescuing
inflected forms while rejecting unrelated words. Confidence is not lowered when a word had to be
mapped: `विश्वास` → `विश्वासी` stayed at 95.

**W4. Span boundaries.** 14b adds function words that the history does not have: `la fe` (history:
`fe` chosen 5 times), `die Kirchengemeinde`, `τους πιστούς`, `cuando se reúnan`. These were 4 of
its 5–6 misses in every single-request run. 4b with history `la iglesia` chosen 7 times for exactly
`church` answered `"iglesia",98` then `"la iglesia",70`. Rule 2 (line 854, "fewest words") and rule
3 (line 855, follow previous translations) pull in different directions, and the example answer
(lines 876–877) ranks the bare word first.

**W5. Confidence is not calibrated.**
- 14b answered `"ο θεός αγαπά τους πιστούς",100`, the whole verse, for `the faithful` (5 of 7 single
  runs with the current prompt).
- For a verse where nothing fits, the models answered `"la casa"` at 30, 40, 50 or 60, and
  sometimes `"la casa",0` or `"la iglesia",0`. A row with confidence 0 is returned as an option.
- tc-ui-toolkit auto-applies the top suggestion at any confidence above 0
  (`../tc-ui-toolkit/src/VerseCheck/CheckArea/index.js`, line 423), so `la casa` at 30 is selected
  for the user. That file is outside this plan; see Open question Q5.

**W6. Batching.**
- Requests leak into each other on the small model: 4b answered the no-history request with
  `"la iglesia",98`, copied from the history of the request before it, in both batch sizes. Alone
  it answered `"iglesia",98`.
- At 12 per query each model lost the Vietnamese case it got right alone (4b: `nơi Thánh`; 14b:
  `"",0`).
- Batched answers have one option per request in nearly every case. `LLM_BATCH_SYSTEM_PROMPT`'s
  example (lines 2313–2322) shows one row per request.
- Speed and token effects are in section 3.2.

**W7. Temperature.** The default is 0.7 (line 3865; tc-ui-toolkit's setting also starts at 0.7).
On 4b at 0.7 the same request gave `fe` in one run and `la fe` in another, and confidence 85 or 95
for the same answer. Results are cached per check, so which one the user sees is chance.
`llmTemperature || 0.7` also turns a setting of 0 into 0.7.

**W8. A repeated word is always suggested at its first occurrence.** The model answers with words
only, and `resolveLlmPhraseInVerse` takes the first adjacent run (line 2094): `"iglesia",98` on a
verse with `iglesia` twice gives occurrence 1. The check's `contextId.occurrence` (which occurrence
of the original-language quote this check is for) is never used; the interactive request does not
even carry `contextId` (`Container.js` line 765). Two checks for the same word in one verse get the
same suggestion. The algorithm path has the same limit.

**W9. A stale, skipped test.** `__tests__/autoCheckingUtilsLlm.test.js` line 73 is
`describe.skip`. Its expectation at line 91 looks for `"rendering":"iglesia"` in the query, the old
JSON history format. The single-request path has no running test.

**W10. The system prompt example leaks into answers.** With the candidate prompt, whose Example 1
answers `"la iglesia",98`, both models answered a no-history Spanish request with `"la iglesia",98`
(4 of 4 runs on 4b and on 14b). With the current prompt, whose example answers `"iglesia",98` then
`"la iglesia",70`, 4b gave exactly those two rows for the case that reuses the example's verse.
Consequence for the evaluation set: no case may reuse the example's verse. Shared words are
allowed, and `es-no-history` deliberately keeps `iglesia` so this leak stays visible.

**W11. Small faults, noted for accuracy of the record.** The example line at 871 reads `chosen 31
time`. `formatNumberedVerse`'s JSDoc (lines 777–787) describes an answer format and a
`parseResponseRow` link that no longer apply; the function is only used in two log messages.

### 3.4 The candidate prompt that was tried

Kept here so the executor can reuse parts of it in Step 7. Do not adopt it whole: it lowered 4b's
score (section 3.2).

```
You find the words in a Bible verse that translate a phrase.

You are given:
TARGET VERSE - the words of the verse, in order.
PREVIOUS TRANSLATIONS - how this phrase and related phrases were translated before, best match first (may be missing).
GATEWAY PHRASE - the phrase to find in the verse.

Rules:
1. Answer only with words copied from TARGET VERSE, spelled exactly as written there.
2. If a previous translation is in TARGET VERSE word for word, it is usually the answer. Copy exactly those words: do not add or drop small words.
3. If a previous translation is not in TARGET VERSE word for word, look for a verse word that is another form of it (a different ending, or part of a longer word) and answer with the verse word.
4. With no previous translation to follow, choose the fewest verse words that carry the meaning of GATEWAY PHRASE.
5. Give 1 to 3 options, best first, one per line, written as: "words",confidence
6. confidence is a whole number from 0 to 100: 90 or more only when a previous translation is in the verse word for word, 60 to 89 for another form of a previous translation or a clear meaning match, below 60 for a guess.
7. If no words in TARGET VERSE fit, answer: "",0
8. Answer only with CSV rows: no header, no explanation, no reasoning, no markdown fences.

Example 1:
TARGET VERSE (es-419): para la iglesia de Éfeso

PREVIOUS TRANSLATIONS:
"la iglesia" (chosen 7 times for "church")
"las iglesias" (chosen 3 times for "churches")

GATEWAY PHRASE (en): church

Answer:
"la iglesia",98
"iglesia",60

Example 2:
TARGET VERSE (de): alle Gläubigen waren zusammen

PREVIOUS TRANSLATIONS:
"Glaube" (chosen 5 times for "faith")

GATEWAY PHRASE (en): believers

Answer:
"Gläubigen",75

Wrong answers for Example 1:
"church",98 - gateway words are not in TARGET VERSE
"las iglesias",90 - not in TARGET VERSE word for word
```

### 3.5 Model suitability suite, and whether `qwen/qwen3-1.7b` is usable

**The suite.** `__tests__/llmModelSuitability.test.js` asks a model on a local server every case in
`__tests__/__fixtures__/llmEval/cases.json` through `getBestTWordSelectionWithConfidenceFromLlm`,
first one request per query, then `LLM_EVAL_GROUPING` (default 4) per query, `LLM_EVAL_RUNS`
(default 2) times, and pools the results. Requests go through a stand-in for `window.AiAPIs.query`
that sends what translationCore's main process sends, unstreamed so token usage comes back (D7).
The live tests are skipped unless `LLM_EVAL_MODEL` is set, so `npm test` makes no network call; the
case-file checks always run. Run it with:

```
LLM_EVAL_MODEL=qwen/qwen3-4b-2507 LLM_EVAL_RUNS=3 npm run test:llm
```

A model is suitable when all of these pass (thresholds are environment variables, see the file's
header):

| Test | Default bar |
|---|---|
| model is available on the server | listed by `/v1/models` |
| every request succeeds | no request errors |
| answers in the requested CSV format | 90% of answers contain a `"words",confidence` row |
| keeps thinking off and stops by itself | no answer with over 20 characters of reasoning or cut off at the token limit |
| top suggestion matches the translator's choice often enough | top-1 at least 70% |
| is rarely wrong with high confidence | wrong at confidence ≥ 80 in at most 15% |
| responds quickly enough | median single request at most 3,000 ms |
| batched: answers every request under its marker | every `### REQUEST n` present |
| batched: accuracy holds up | batched top-1 at most 15 points below single |

**Results at commit `7734dae`** (23 cases × 3 runs = 69 answers per model, temperature 0.7, LM
Studio on the author's Mac; 1.7b is 8-bit, the others 4-bit):

| | qwen3-1.7b | qwen3-4b-2507 | qwen3-14b |
|---|---|---|---|
| Single top-1 | 50/69 (72%); runs 16, 17, 17 | 60/69 (87%); runs 21, 20, 19 | 54/69 (78%); runs 18, 18, 18 |
| Top-3 | 50 (it never gives a second option) | 60 | 57 |
| Wrong at confidence ≥ 80 | 16 (23%) **fails** | 4 (6%) | 8 (12%) |
| CSV format | 100% | 100% | 100% |
| Median single request | 131 ms | 150 ms | 517 ms |
| First request (load + cache) | 467 ms | 513 ms | 1,167 ms |
| Tokens per request (prompt + answer) | 467 + 12 | 467 + 9 | 467 + 15 |
| Batched (4 per query) top-1 | 39/69 (57%); runs 13, 13, 13 | 60/69 (87%) | 57/69 (83%) |
| Batched total time vs single | 10.6 s vs 9.7 s | 11.8 s vs 11.0 s | 37.8 s vs 41.3 s |
| Batched prompt tokens per request | 185 | 185 | 185 |
| Suite verdict | **fails 1–2 tests** (wrong ≥ 80 always; batched accuracy in 2 of 3 rounds) | passes all | passes; wrong ≥ 80 near the bar (16% in an earlier round) |

Earlier rounds on a slightly different case list gave the same picture: 1.7b top-1 65–72%, wrong
≥ 80 23–30%; 4b 78–87%; 14b 74–78%.

**`qwen/qwen3-1.7b` findings** (raw answers from run 1):
- **Format and speed are fine.** Every answer was a clean CSV row, thinking stayed off, and it
  answered in 131 ms median. It is not meaningfully faster than 4b (150 ms), because the server's
  prompt cache makes both fast; its advantage is memory, not speed.
- **It never says nothing fits.** `es-nothing-fits` → `"la casa",90` and
  `es-nothing-fits-no-history` → `"pescaba",90`, in all 3 runs. 6 of its 16 confident errors.
- **It answers with the history spelling** (W3) and the parser maps it to an unrelated word (W2):
  `de-compound` → `"Kirche",98` → `sich` at 98, all 3 runs.
- **It is hurt by the history filter** (W1): `vi-holy-places` → `"nơi thánh",95`;
  `xx-related-key` → the whole verse at confidence 0 (which C3 would drop).
- **It drops words the history keeps:** `xx-article-kept` (history `e miruna` chosen 6 times) →
  `"miruna",95`.
- **Batching breaks it.** In a 4-request batch it answers later requests with the whole verse
  (`"Dieu a envoyé son Fils dans le monde",98`) or the GL phrase itself, and in one earlier round it
  numbered a 3-request batch's only answer `### REQUEST 3`.

**Verdict:** usable mechanically, not suitable today. Use it only for single requests (`llmGrouping`
1), never batched. 9 of its 19 single misses are on the three cases Steps 3 and 4 target
(`vi-holy-places`, `xx-related-key`, `de-compound`), and its confidence-0 whole-verse answers are
what C3 drops, so re-run the suite after Step 4. The nothing-fits over-confidence (6 misses) is a
calibration problem; Step 7's P4 and Open question Q5 address it. If 1.7b still fails "rarely wrong
with high confidence" after Step 7, it should not be offered as a setting.

**W12. A GL word that is also a target word is copied.** In an earlier round the case
`fr-no-history` asked for `Son` in `Dieu a envoyé son Fils dans le monde`. Every model answered
`son` (French "his") in every run, since rule 1 only asks for words copied from the verse. The case
was changed to `the world` because it did not tell models apart; the weakness is real for GLs and
target languages that share spellings, and no step addresses it.

## 4. Decisions

Each is settled. Do not reopen them unless a step's "done when" check cannot be met.

- **D1. Keep the CSV answer format and the tolerant parser.** No JSON mode, schema or grammar.
  There were no parse failures in about 360 live request answers, and structured output would need changes
  to translationCore's request code.
- **D2. Keep thinking off and leave `/no_think` handling as it is.** Reasoning tokens were 0 and 1.
  The evaluation reports reasoning tokens so a model that ignores the switch is noticed.
- **D3. Keep `LLM_DEFAULT_MAX_TOKENS` at 2048.** No runaway answer was seen. A small cap would cut
  off models that cannot turn thinking off before they reach their answer.
- **D4. Keep the default of 1 request per query.** On the small model batching saved no time and
  leaked between requests. Batching stays the user's choice through `llmGrouping`, for larger
  models. Do not clamp `llmGrouping`.
- **D5. Reuse the algorithm path's helpers** (`rankGlKeys`, `wordSimilarity`,
  `FUZZY_TARGET_MAX_CONFIDENCE`) instead of writing new similarity or ranking code. They are
  language-neutral, need no word lists, and are already tested with non-Latin scripts.
- **D6. Live evaluation is the jest suite `__tests__/llmModelSuitability.test.js`.** Its live
  tests are skipped unless `LLM_EVAL_MODEL` is set, so `npm test` makes no network call; run them
  with `LLM_EVAL_MODEL=<model> npm run test:llm`. jest is the only babel runner in the repo. (This
  replaces the earlier `eval/*.live.js` idea: the author asked for the evaluation as tests.)
- **D7. The evaluation script supplies its own `window.AiAPIs.query`.** In jest there is no
  `fetch`, so `streamChatMessage` cannot run; the script uses Node's `http`/`https`. It sends what
  translationCore's main process sends, but with `stream: false`, so `usage` comes back. It uses
  Node's `fs` to write results, because `fs-extra` is mocked globally.
- **D8. Evaluation cases are JSON**, at `__tests__/__fixtures__/llmEval/cases.json` (23 cases
  now). A `.js` file under `__tests__/__fixtures__/` would be collected by jest as a test.
- **D9. The system prompt stays one constant string per path** (single, and single + batch
  addendum), so the server's prompt cache keeps working. It may grow only if a measured variant
  earns it (Step 7), and never past 550 prompt tokens for the smallest request (431 today).
- **D10. One system prompt for both setups unless the measurements force a split.** If a variant
  helps one setup and hurts the other by more than the noise rule in section 7.4, keep the current
  prompt for single requests and use the other variant only in the batch path, where the system
  prompt already differs. Batching is the only existing signal that the user has a larger model.
- **D11. `translatePhraseWithConfidence`, `buildVerseMatchPrompt` and `parseResponseRow` are not
  touched.**
- **D12. No changes in translationCore or tc-ui-toolkit.** Anything that would need one is in Open
  questions.
- **D13. Do not commit unless the author asks.** Each step is sized to be one commit.
- **D14. The suite's default bars stay as set** (top-1 ≥ 70%, wrong at ≥ 80 ≤ 15%, CSV ≥ 90%,
  median ≤ 3,000 ms, batched top-1 at most 15 points below single). With them 4b passes, 14b
  passes close to the line, and 1.7b fails on confidence, which matches what the raw answers show.
  Do not loosen them to make a model pass; raise them once the steps improve the baseline.

## 5. Where the two setups differ

| | Small local model (e.g. Qwen3 4B; Qwen3 1.7B see section 3.5) | Larger model |
|---|---|---|
| Requests per query | 1 (default). 1.7B must never be batched (section 3.5). | 4–8, set by the user with `llmGrouping`. Step 2 measures 1, 4, 8 and 12. |
| System prompt | The single-request prompt. Must stay short and literal. | Single-request prompt plus `LLM_BATCH_SYSTEM_PROMPT`. |
| Speed lever | The server's prompt cache; nothing to gain from batching. | Batching: 7–28% less time, 61–77% fewer prompt tokens in section 3.2. |
| Main accuracy risk | History selection (W1), leakage between batched requests (W6), prompt examples (W10). | Extra function words (W4), over-confidence (W5). |
| Prompt wording | The current wording did best. | The candidate wording did better. See D10 and Step 7. |

C1, C2, C3, C6 and C7 apply to both.

## 6. Steps

After every step: `npm test` passes (lint and jest), and
`npx eslint --no-ignore __tests__/llmModelSuitability.test.js` reports no errors (`npm test` only
lints `src`). Add JSDoc for every new or changed function. "Run the suite" below means, for each
reference model (Q1), `LLM_EVAL_MODEL=<model> LLM_EVAL_RUNS=3 LLM_EVAL_OUT=<file> npm run test:llm`.

### Step 0. Check the starting point (OFFLINE)

Run `git log --oneline -1`, `git status --short` and `npm test`.

**Done when:** `npm test` prints `Test Suites: 17 passed` (11 tests skipped: 9 live suitability
tests and the 2 existing ones) and you have noted any drift from `7734dae`.

### Step 1. Finish the evaluation cases and offline checks (OFFLINE)

Already done: `__tests__/__fixtures__/llmEval/cases.json` (23 cases), and the always-running
`llmEval cases` tests in `__tests__/llmModelSuitability.test.js` (required fields, unique ids,
expected words are verse words, the prompt's example verse is not reused).

1. Add cases to reach at least 30, as section 7.3 describes. Still missing: `repeated-word` (2),
   a second `rtl-script` (Hebrew), `long-history` with 15 or more renderings, and a third
   `unknown-language` case with a compound word. After adding, check that the `llmEval cases` tests
   pass.
2. Add `occurrence` support to the suite: pass `contextId: { occurrence }` in the request (ignored
   until Step 5) and compare `word:2` answers (already handled by `optionText`).
3. Add an always-running algorithm row: run `getBestTWordSelectionWithConfidenceAlgorithm` on every
   case and assert the number of top-1 matches equals the number measured when the test is written
   (write it in a comment). This guards the shared helpers that Steps 3–5 touch.
4. Fix the stale test (W9): in `__tests__/autoCheckingUtilsLlm.test.js` change `describe.skip`
   (line 73) to `describe`, and replace the expectation at line 91 with
   ``expect(query.mock.calls[0][0]).toContain('"iglesia" (chosen 3 times for "church")');``.
   Checked on 2026-11-09: with that change all 26 tests in the file pass.

**Done when:** `npx jest __tests__/llmModelSuitability.test.js __tests__/autoCheckingUtilsLlm.test.js`
passes with only the 9 live tests skipped, and `cases.json` has at least 30 cases.

### Step 2. Complete the suite's metrics and record the baseline (LIVE)

The suite reports top-1, top-3, wrong at ≥ 80, CSV format, timing and tokens. Add the rest of
section 7.4 to its `summarize` and `formatReport`, without new pass/fail tests:
- **F1**, **Empty**, top-1 **per run** (min–max);
- **User-visible top-1**: when the AI result has no option, score the algorithm's result instead
  (what `LlmRequestQueue.processNextRequest` does at lines 397–405);
- the **algorithm-only** top-1;
- `LLM_EVAL_GROUPING` accepting a comma list (`1,4,8`) and reporting each size.

Then run the suite on every reference model (Q1) with `LLM_EVAL_GROUPING=4,8` for the larger model.

**Done when:** each run's report is copied into section 9 as `baseline` rows, replacing the
`baseline (partial)` rows, and `npm test` still makes no network call.

### Step 3. History selection, C1 (OFFLINE, then LIVE check)

Replace the body of `formatPreviousTranslations` (line 693). New signature:
`formatPreviousTranslations(previousTranslationData, glPhrase, glLangCode, verseContent, targetLangCode)`.
Update its one caller (line 885). Remove the `filter` parameter.

1. Add `key` to each object `rankGlKeys` (line 986) returns (the history key; `glPhrase` for flat
   history). This is additive; `poolRenderings` ignores it.
2. Call `rankGlKeys(previousTranslationData, glPhrase, glLangCode)`. For every key and every
   rendering with a count above 0, make an entry `{ rendering, phrase: key, count, relatedness,
   isExact }`.
3. Merge entries whose renderings are equal after `normalizeForCompare(word, targetLangCode)` on
   each word: add the counts, keep the first spelling seen, and keep `phrase`, `relatedness` and
   `isExact` from the entry with the better match (`isExact` first, then higher `relatedness`).
4. Give each entry a verse fit: 2 if every word is a verse word exactly (normalized), 1 if every
   word is a verse word exactly or has `wordSimilarity` above 0 with some verse word, else 0.
5. Sort by verse fit, then `isExact`, then `relatedness`, then `count`, all descending. The sort
   must be stable.
6. Keep the entries with verse fit above 0, at most `MAX_PROMPT_PREVIOUS_TRANSLATIONS`, changed
   from 20 to 10. If there are none, keep the first 5 of the rest (new constant
   `MAX_PROMPT_UNMATCHED_TRANSLATIONS = 5`).
7. Keep the line format exactly: `"rendering" (chosen N time(s) for "phrase")`.

Reasons for the choices: the history holds one translationWords group, so every key is the same
concept (see `poolRenderings`' JSDoc) and ordering is safer than filtering. Verbatim presence in
the verse ranks first because it is the strongest evidence, as in the algorithm's scoring. 10 and 5
are enough for the groups seen (the fixture's group has 7 renderings) and halve the worst case.
Do not change the system prompt in this step.

Add tests to `__tests__/autoCheckingUtilsLlm.test.js`, through
`buildTranslationOptionsPrompt(...).input`:
- Vietnamese Hebrews 9:12 (`VERSE_HEB_9_12` in `__tests__/autoCheckingUtils.test.js` line 8), GL
  `holy places`, history `viTranslationData['ἅγια'].selections`: the input contains the line
  `"các nơi thánh" (chosen 1 time for "of the holy places")`. Do not assert it comes first:
  `rankGlKeys` scores `holy place` (0.907) just above `of the holy places` (0.900), so the
  `một nơi thánh` line is listed before it. The trial in section 3.2 put `các nơi thánh` first by
  hand, so check this case in the Step 3 live run. If it now misses, record that in section 9.
- Flat history `{ 'iglesia': 7, 'la iglesia': 3 }` with verse `Pablo saludó a la iglesia`: both
  renderings are listed.
- 40 unrelated keys, none in the verse: exactly 5 history lines.
- Hindi verse `सब विश्वासी एक साथ थे`, GL `faith`, history `{ faith: { 'विश्वास': 5 } }`: the line
  is present (verse fit 1).
- History `{ 'the law': { 'la ley': 9 }, 'faith': { 'fe': 2 } }`, GL `the faith`, verse
  `Por la fe Abraham obedeció y la ley fue dada`: the `fe` line comes before the `la ley` line.

**Done when:** those tests pass, `npm test` passes, and (LIVE) the suite (run as in section 6)
meets the regression rule in section 7.4 on both setups. Add the rows to
section 9.

### Step 4. Answer-to-verse mapping and confidence, C2 and C3 (OFFLINE, then LIVE check)

In `resolveLlmPhraseInVerse` (line 2047):
1. Replace the fuzzy fallback (lines 2069–2080) with: the verse word with the highest
   `wordSimilarity(word, normalizedWord)` above 0; the first one on a tie.
2. Count the phrase words found. With `strict`, any word not found still returns `null`. Without
   `strict`, return `null` unless more than half of the phrase words were found.
3. Return `{ selections, inexact }` instead of the selections, where `inexact` is true when any
   word was matched by `wordSimilarity` or dropped. A match that only ignores accents is not
   inexact. `parseLlmSelectionOptions` is the only caller.

In `parseLlmSelectionOptions` (line 2126):
4. Skip rows whose confidence is 0 (C3).
5. When `inexact`, use `Math.min(confidence, FUZZY_TARGET_MAX_CONFIDENCE)` (90, line 910), the
   same cap the algorithm path applies to fuzzy matches.

Add tests to `__tests__/autoCheckingUtilsLlm.test.js` for `parseLlmSelectionOptions`:

| Answer | Verse words | Expected |
|---|---|---|
| `"Kirche",85` | `und die Kirchengemeinde versammelte sich` | `Kirchengemeinde` at 85 |
| `"Kirche",98` | same | `Kirchengemeinde` at 90 |
| `"mesa",90` | `la casa de la madre y la hija` | `[]` |
| `"the church of Ephesus",95` | the file's `wordList` | `[]` |
| `"la iglesia",40` | `la casa de la madre y la hija` | `[]` (1 of 2 words found) |
| `"la casa",0` | same | `[]` |
| `"विश्वास",95` | `सब विश्वासी एक साथ थे` | `विश्वासी` at 90 |
| `"cuando se reúnen",85` | `cuando se reúnan para comer` | `cuando se reúnan` at 85 |

Every existing test in that file must pass unchanged.

**Done when:** those tests pass, `npm test` passes, and (LIVE) the suite meets the
regression rule and "wrong at confidence ≥ 80" is not higher than at Step 3 on either setup. Add
the rows to section 9.

### Step 5. Repeated words, C6 (OFFLINE)

1. Add an exported helper `moveSelectionsToOccurrence(selections, wordList, occurrence)`:
   - return `selections` unchanged unless `occurrence` is above 1 and the selections are an
     adjacent run of verse words;
   - find every non-overlapping adjacent run of the same words (compared with
     `normalizeForCompare`) in `wordList`, left to right;
   - if the selections are the first run and there are at least `occurrence` runs, return the
     selections for run number `occurrence`, built with `buildSelectionsFromPositions` (line 1084);
     otherwise return `selections` unchanged.
2. In `getBestSelections` (line 3785), after either path returns, apply it to every option of each
   job using `job.contextId?.occurrence`.
3. In `src/Container.js`, add `contextId` to the object passed to
   `makeLlmRequestAndWaitForResponse` (line 765). The background request already has it (line 323).

This changes algorithm-path results too, only for checks with `occurrence` above 1. It is a
heuristic: it assumes the nth occurrence of the original word is rendered by the nth occurrence of
the suggested words. When the verse has fewer runs than `occurrence`, nothing changes.

Tests (in `__tests__/autoCheckingUtils.test.js`): the helper with occurrence 1, 2, more than the
runs available, and non-adjacent selections; and `getBestSelections` without `llmQueryUrl` for
verse `Dios amó al mundo y Dios envió a su Hijo`, GL `God`, history `{ God: { Dios: 9 } }`,
`contextId: { occurrence: 2 }` → top option `[{ text: 'Dios', occurrence: 2 }]`.

**Done when:** those tests pass, `npm test` passes, and the two `repeated-word` evaluation cases
are top-1 for the algorithm row in `__tests__/llmModelSuitability.test.js` (update its expected count and
comment).

### Step 6. Batched requests, C4 (LIVE)

In `LLM_BATCH_SYSTEM_PROMPT` (line 2313) add one line after the first:
`Each request is separate: use only its own TARGET VERSE and PREVIOUS TRANSLATIONS.`
Change nothing else in it.

**Done when:** with the larger model at `LLM_EVAL_GROUPING=4,8` and the small model at `4`,
the suite meets the adoption rule in section 7.4 against Step 4's batched rows. If it
does not, revert the line and record that in section 9. `npm test` passes either way (the batch
tests do not assert the addendum text).

### Step 7. System prompt variants, C5 (LIVE)

Test these one at a time, each on both setups (small model at grouping 1; larger model at grouping
1 and 4), 3 runs each. Start each from the last adopted variant.

- **P1.** Line 871: `chosen 31 time` → `chosen 31 times`.
- **P2.** Line 849: `most used first` → `best match first` (true since Step 3).
- **P3.** Replace rules 2 and 3 (lines 854–855) with rules 2, 3 and 4 of section 3.4, and renumber.
  Targets W3 and W4.
- **P4.** Replace rule 5 (line 857) with rule 6 of section 3.4. Targets W5.
- **P5.** Add Example 2 of section 3.4. Targets W3.
- **P6.** Rewrite the example or examples of the best variant so far with made-up words in place of
  Spanish or German (for instance verse `mo tala kirano dova`, rendering `kirano`), keeping the
  layout. Targets W10.

Apply D9 (size limit) and D10 (when to split by path). A variant is adopted only by the adoption
rule in section 7.4. Record every variant's rows in section 9, including the rejected ones. Update
any test that asserts prompt text.

**Done when:** every variant has a row in section 9 marked adopted or rejected, the code holds only
adopted variants, the smallest-request prompt size is at or under 550 tokens, and `npm test`
passes.

### Step 8. Temperature, C7 (OFFLINE fix, LIVE measurement)

1. Line 3865: `temperature: (llmTemperature || 0.7)` → `temperature: (llmTemperature ?? 0.7)`, so
   a setting of 0 is used. Add a test that a job with `llmTemperature: 0` reaches
   `window.AiAPIs.query` with `temperature` 0.
2. (LIVE) Run the evaluation on both setups with `LLM_EVAL_TEMPERATURE=0.2` and compare with the
   0.7 rows: top-1 mean, and the spread between runs (min to max).

Do not change the default. tc-ui-toolkit owns it; see Open question Q6.

**Done when:** the test passes, `npm test` passes, and the 0.2 rows are in section 9 with a
one-line recommendation.

### Step 9. Documentation (OFFLINE)

1. `CLAUDE.md`, section "Auto-select suggestions": describe the history selection (C1), the answer
   mapping and confidence cap (C2, C3), `moveSelectionsToOccurrence` (C6), and where the
   evaluation lives and how to run it.
2. Fix `formatNumberedVerse`'s JSDoc (W11): say it is used for log messages only.
3. Fill in section 9 and write a short "Outcome" paragraph at the top of this file: what was
   adopted, what was rejected, baseline against final numbers for both setups.

**Done when:** `npm test` passes and section 9 has a baseline row and a final row for each setup.

### Step 10. Optional: skip the model when the algorithm is certain, C8

**Do this only if the author answers yes to Q3.** In `getBestSelections`' AI branch, run
`getBestTWordSelectionWithConfidenceAlgorithm` for each job first. A job whose top option has
confidence 100 (exact GL key and the rendering found word for word; see `capForRendering`, line
1068) is answered with that result (`model: 'APP'`, `elapsedStr: '0'`, `algorithmFirst: true`) and
is not sent to the model. The rest go to the model as now, keeping their order.

**Done when:** a test shows a confidence-100 job makes no `window.AiAPIs.query` call while a
second job in the same call does; `npm test` passes; and the evaluation reports how many cases were
skipped and that top-1 for the user-visible result did not drop on either setup.

## 7. Evaluation

### 7.1 Case format

```json
{
  "id": "vi-holy-places-related-key",
  "targetLang": "vi",
  "glLang": "en",
  "verse": "…",
  "glPhrase": "holy places",
  "occurrence": 1,
  "history": { "of the holy places": { "các nơi thánh": 1 } },
  "expected": ["các nơi thánh"],
  "tags": ["related-key", "real-data"],
  "madeUp": false
}
```

`expected` lists every acceptable answer, preferred first. Each is the selected words separated by
spaces, with `word:2` for a second occurrence. `[]` means nothing in the verse fits. `occurrence`
is optional and defaults to 1.

### 7.2 Starter cases (these ran in section 3.2, run 2; all are in `cases.json`)

`cases.json` also has 8 more: `xx-word-order`, `fr-no-history` (GL `the world`), `pt-no-history`,
`es-nothing-fits-no-history`, `fr-gl-es` (GL in Spanish), `es-gl-hi` (GL in Hindi), `ar-rtl` and
`es-long-history`. `es-exact-key` and `es-no-history` use the verse below, not the prompt's example
verse, and `es-no-history` and `es-gap` accept the variants listed in the file.

Verse constants are in `__tests__/autoCheckingUtils.test.js` lines 8–11. "vi fixture" is
`viTranslationData['ἅγια'].selections` from `__tests__/__fixtures__/tWords/vi_translationData.json`;
copy it into the JSON.

| id | Lang | Verse | GL phrase | History | Expected |
|---|---|---|---|---|---|
| es-exact-key | es-419 | `Pablo saludó a la iglesia en Corinto` | church | `church: {la iglesia: 7, congregación: 2}` | `la iglesia` |
| es-no-history | es-419 | same | church | none | `iglesia` |
| vi-holy-places | vi | `VERSE_HEB_9_12` | holy places | vi fixture | `các nơi thánh` |
| vi-holiness | vi | `VERSE_HEB_12_10` | holiness | vi fixture | `thánh khiết` |
| es-the-faith | es-419 | `VERSE_ES_FAITH` | the faith | `faith: {fe: 5}`, `by faith: {por la fe: 2}` | `fe` |
| hi-the-faith | hi | `विश्वास से हम समझते हैं कि व्यवस्था दी गई` | the faith | `faith: {विश्वास: 5}` | `विश्वास` |
| de-compound | de | `und die Kirchengemeinde versammelte sich` | the church | `church: {Kirche: 4}` | `Kirchengemeinde` |
| el-inflected | el | `ο θεός αγαπά τους πιστούς` | the faithful | `faithful: {πιστοί: 2}` | `πιστούς` |
| ru-word-order | ru | `и дух святой сошёл` | holy spirit | `holy spirit: {святой дух: 3}` | `дух святой` |
| es-gap | es-419 | `VERSE_ES_COMING_TOGETHER` | coming together | `you come together: {cuando reúnen: 1}`, `in coming together: {cuando reúnen: 1}` | `cuando reúnan` |
| es-nothing-fits | es-419 | `la casa de la madre y la hija` | church | `church: {la iglesia: 5}` | none |
| hi-inflected | hi | `सब विश्वासी एक साथ थे` | faith | `faith: {विश्वास: 5}` | `विश्वासी` |
| xx-related-key | xx | `mo tala vu kirano sema lopa dun` | holy places | `of the holy places: {kirano sema: 1}`, `Holy: {Sema: 1}`, `the Holy: {Sema: 1}` | `kirano sema` |
| xx-inflected | xx | `ren talo mirunak peso dova` | faith | `faith: {miruna: 6}`, `by faith: {se miruna: 2}` | `mirunak` |
| xx-article-kept | xx | `ren talo e miruna peso dova` | faith | `faith: {e miruna: 6, miruna: 1}` | `e miruna` |

All but the two Vietnamese cases use made-up history; the `xx` cases use made-up words. Mark them
`madeUp: true`.

### 7.3 Cases to add (to reach at least 30)

Write at least this many more, following the rules below:

| Tag | At least | What it checks |
|---|---|---|
| `repeated-word` | 2 | The phrase's rendering occurs twice; `occurrence: 2`; expected uses `word:2`. |
| `non-english-gl` | 3 | `glLang` of `es-419`, `fr` or `hi`, with GL keys in that language. |
| `unknown-language` | 3 | Made-up target words, where history is the only evidence: one verbatim, one inflected, one with different word order. |
| `no-history` | 2 | A language the models know (e.g. `fr`, `pt-br`), no history. |
| `nothing-fits` | 2 | Expected `[]`, one with history and one without. |
| `rtl-script` | 1 | Arabic or Hebrew script target. |
| `long-history` | 2 | 15 or more renderings across 8 or more GL keys, the right one not the most used. |

Rules: no case may reuse the system prompt's example verse (W10).
Keep the made-up share visible with `madeUp`. Prefer real data: the remaining rows of the algorithm
tests (`__tests__/autoCheckingUtils.test.js` lines 47–200) are already checked. See Q4 for real
project data.

### 7.4 Metrics and rules

Per model and grouping, over all runs:
- **Top-1:** the top option's `text:occurrence` set equals an acceptable answer's (for `[]`: no
  option returned). Report the mean, the minimum and the maximum over runs.
- **Top-3:** any returned option equals an acceptable answer.
- **F1:** the best word-position F1 between the top option and any acceptable answer, averaged.
- **Wrong at confidence ≥ 80:** top-1 wrong and its confidence 80 or more. Mean per run.
- **Empty:** cases with an expected answer where the model's result had no option.
- **User-visible top-1:** top-1 after replacing an empty AI result with the algorithm's.
- **Time:** total and median ms per case. **Tokens:** mean prompt and completion tokens per case,
  total reasoning tokens, and the smallest-request prompt size.
- An **algorithm-only** row for comparison.

Runs differ by about one case at temperature 0.7, so:
- **Regression rule** (Steps 3, 4): mean top-1 is not more than 1 case lower than the previous
  step's on either setup.
- **Adoption rule** (Steps 6, 7): mean top-1 is at least 1 case higher on one setup, or "wrong at
  confidence ≥ 80" is at least 1 lower, and neither measure is more than 1 case worse on the other
  setup. Otherwise the change is rejected and reverted.

## 8. Risks and what is left out

Risks:
- **The evaluation set is small and partly made-up.** Differences of one case are noise; that is
  why the rules use three runs and a one-case margin. Real project data (Q4) would make it stronger.
- **Results depend on the model and server.** Section 3 used two 4-bit Qwen3 models on one machine.
  A prompt that helps one model hurt another, which is why Step 7 measures each variant on both.
- **Step 4 rejects answers the old mapping accepted.** Some were right by luck. More requests will
  fall back to the algorithm; "Empty" and "User-visible top-1" show the effect.
- **Step 5 is a heuristic** and changes algorithm-path results for checks with `occurrence` above 1.
- **Prompt caching is assumed.** The timings show LM Studio reuses the system prompt. A hosted
  server that does not will pay about 430 prompt tokens per single request; batching is the
  answer there.
- **Step 3 sends fewer history lines** (10, or 5 when none fit the verse). If the evaluation's
  `long-history` cases lose, raise `MAX_PROMPT_PREVIOUS_TRANSLATIONS` back toward 20 and note it.

Left out, with reasons:
- **Structured output (JSON schema, grammar):** no parse failures were seen (D1).
- **Request timeout or cancel:** a hung server blocks the queue, but in Electron the request is
  made in translationCore (D12).
- **Sending more context** (the GL verse, the original-language quote, the translationWords
  article): each costs tokens on every request and no measured case needed it.
- **Clamping `llmGrouping`** or choosing it from the model name: the model's ability cannot be
  known from its name (D4).
- **Changing when a suggestion is auto-applied:** that is in tc-ui-toolkit (Q5).
- **The older path** `translatePhraseWithConfidence` (D11).
- **Per-request timing for batches:** every request in a batch reports the whole batch's
  `elapsedStr`. Not a suggestion-quality problem.

## 9. Results log

Preliminary numbers from section 3.2 (different, smaller case sets; not the baseline):

| Label | Model | Grouping | Cases | Top-1 (runs) | Wrong ≥ 80 | Time | Prompt tokens / case |
|---|---|---|---|---|---|---|---|
| prelim, current code | algorithm | – | 12 | 10 | – | ~0 | 0 |
| prelim, current code | qwen3-4b-2507 | 1 | 15 | 12, 13 | 2, 1 | 2.5–3.1 s | 473 |
| prelim, current code | qwen3-14b | 1 | 15 | 9, 8 | 4, 4 | 10.7–11.9 s | 473 |
| prelim, planned history | qwen3-4b-2507 | 1 | 15 | 14, 14 | 0, 0 | 2.5–2.7 s | 477 |
| prelim, planned history | qwen3-14b | 1 | 15 | 10, 10 | 3, 4 | 10.4–10.9 s | 477 |

The executor adds rows below for `baseline`, `step3`, `step4`, `step6`, each `P` variant of Step 7
(adopted or rejected), the temperature 0.2 runs, and `final`. The `baseline (partial)` rows were
recorded with the suite on 2026-11-09 at `7734dae` (23 cases × 3 runs, temperature 0.7); F1, Empty
and user-visible top-1 were not measured yet (Step 2). Top-1 is shown per run.

| Label | Model | Grouping | Top-1 mean (min–max) | Top-3 | F1 | Wrong ≥ 80 | Empty | User-visible top-1 | Median ms | Prompt / completion tokens | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline (partial) | qwen3-1.7b (8-bit) | 1 | 16.7/23 (16–17) | 50/69 | – | 16/69 | 0 | – | 131 | 467 / 12 | fails suite |
| baseline (partial) | qwen3-1.7b (8-bit) | 4 | 13/23 (13–13) | – | – | – | – | – | – | 185 / – | |
| baseline (partial) | qwen3-4b-2507 | 1 | 20/23 (19–21) | 60/69 | – | 4/69 | 0 | – | 150 | 467 / 9 | passes |
| baseline (partial) | qwen3-4b-2507 | 4 | 20/23 (20–20) | – | – | – | – | – | – | 185 / – | |
| baseline (partial) | qwen3-14b | 1 | 18/23 (18–18) | 57/69 | – | 8/69 | 0 | – | 517 | 467 / 15 | passes |
| baseline (partial) | qwen3-14b | 4 | 19/23 (18–20) | – | – | – | – | – | – | 185 / – | |

## 10. Open questions for the author

- **Q1. Which server and models are the two reference setups?** Section 3 used LM Studio at
  `http://localhost:1234` with `qwen/qwen3-4b-2507` (small) and `qwen/qwen3-14b` (larger);
  section 3.5 adds `qwen/qwen3-1.7b`, which fails the suite today. Should 1.7b stay a reference
  model (re-tested after Step 4 and Step 7), or be dropped? `prism-ml/bonsai-27b` was also loaded
  and not tested. The default `AI_API_URL`
  (`192.168.142.70:1234`) was not reachable. Is the larger setup a local model like these, or a
  hosted API (which needs `LLM_EVAL_API_TOKEN` and has no free prompt cache)?
- **Q2. Will the executor's session be able to reach that server?** If not, the executor does the
  OFFLINE steps (0, 1, 3, 4, 5, 8.1, 9) and the author runs the LIVE commands.
- **Q3. Step 10: should the model be skipped when the algorithm reports confidence 100?** It saves
  a request and, in section 3.2, the algorithm was right where 4b preferred a different span. But
  the user turned AI suggestions on, and those results would show `model: 'APP'`.
- **Q4. May real project data be used for evaluation?** `~/translationCore/projects` on the
  author's machine has 28 projects (Arabic, Bengali, Spanish and others). Every finished check is a
  real case: verse, GL phrase, the translator's selection. A script could build cases from one
  project, with history taken from the others. Should such cases be committed as fixtures, or kept
  in an untracked `eval/local/` folder? Which projects?
- **Q5. Should there be a minimum confidence for auto-applying a suggestion?** Today anything above
  0 is applied (tc-ui-toolkit, `CheckArea/index.js` line 423), including `la casa` at 30 and the
  algorithm fallback's `la` at 15. This plan does not change it.
- **Q6. Should the default temperature drop from 0.7?** Step 8 measures 0.2. The default is set in
  tc-ui-toolkit (`CheckArea/index.js` line 109).
- **Q7. Is Step 5 wanted for the algorithm path too?** As planned it applies to both paths so they
  stay interchangeable. Say so if it should be AI-only or dropped.
- **Q8. Should the suite's full JSON results (`LLM_EVAL_OUT`) be committed** somewhere, or only
  the summary rows in section 9?
- **Q10. Should the GL-word-equals-target-word trap (W12) be addressed?** One option is a prompt
  rule ("a verse word spelled like a GATEWAY PHRASE word is not the answer unless a previous
  translation uses it"), tested like the Step 7 variants.
- **Q9. Is the expected answer for a phrase with an article the history's span?** The starter cases
  expect `fe` for `the faith` when history has `fe`, and `la iglesia` for `church` when history has
  `la iglesia`. If translators are expected to follow the GL article instead, cases `es-the-faith`
  and `es-exact-key` and prompt variant P3 need to change.
