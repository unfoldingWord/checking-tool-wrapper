# Plan: original-language keys for the suggestion history

Started 2026-11-26. Status: Steps 0-1 done; Step 2 measured 2026-11-26: a real gain on the tune
projects, the same direction but not significant on the held-out ones (p = 0.08), so the adoption
bar is not met yet. The app does not pass OL history, so nothing changed for users.

## Goal

Make the algorithm's suggestions more accurate by also keying the selection history by the
check's **original-language (OL) quote**, not only by the gateway-language (GL) phrase aligned
to it.

- Today a rendering is remembered as "GL phrase → target text" (`{ 'of aaron': { 'هَارُونَ': 1 } }`).
- The GL phrase is how the GL bible (e.g. ULT) rendered the OL word *in that verse*. The same
  Greek or Hebrew word is rendered with different GL phrases in different verses, and different
  GLs (en, ru, es-419) give different keys for the same word.
- The OL word is what the target translators actually translated from (or what their GL source
  was made from). Its lemma, Strong's number and form are the same in every project, whatever
  GL was used to check it.

The GL phrase stays: it is what checkers who don't read Greek or Hebrew see, and it is still
the key the AI prompt and the fine-tuned models use. The OL key is an extra signal for
matching history to the check.

## What exists now (checked in the code and data, 2026-11-26)

- **The check's quote is OL text.** `contextId.quote` is the OL surface form, a string or
  `[{ word, occurrence }]` (e.g. `"quote": "ἐπιγινωσκέτω"` in
  `vi_glt_1co_book/.apps/translationCore/index/translationWords/1co/acknowledge.json`). The
  contextId has **no lemma, Strong's number or morphology**.
- **An OL-keyed tally already exists but is thrown away.** `getSelectionsForBook`
  (`src/utils/checkingSuggestionsUtils.js`, ~line 3963) fills `selectionsForQuoteString`, keyed
  by the lowercased surface quote (`getQuoteStringKey`). `fetchPreviousSelectionData`
  (~line 4578) builds it but returns only `selectionsForGlQuote`, and nothing else in `src`
  reads it. It is also counted only when the project's GL bible book is found, since the call
  sits inside `if (foundBible)`.
- **Lemma, Strong's and morphology are available from two places:**
  - alignment data, `alignmentData/<book>/<chapter>.json`: each `topWords` entry has `word`,
    `strong`, `lemma`, `morph`, `occurrence` (seen in `ar_avd_heb_book`, Heb 1:1:
    `πολυμερῶς`, `G41810`);
  - the OL bibles in `~/translationCore/resources` (`el-x-koine/bibles/ugnt/v0.34_*`,
    `hbo/bibles/uhb/v3.0.0_*`): each word has `text`, `strong`, `lemma`, `morph`. Hebrew Strong's
    numbers carry prefix morphemes (`b:H3117` for בִּימֵי, `d:H8199`, `c:H1961`); Greek ones don't
    (`G23160`). In the app the current book's OL bible is in the `tc` bibles
    (`originalLanguage`, `ugnt`/`uhb`, see `src/common/constants.js`).
- **The history holds one translationWords group**, and the algorithm pools the renderings of
  every key (`poolRenderings`). So OL keys would mostly change **which renderings rank first
  and their confidence** (the GL-key weight: 1 for the exact key, 0.36-0.6 for related keys in
  `scoreSuggestionFromHistory`), not which renderings are tried. The exception is new history:
  projects checked with a different GL (see Hypothesis H4).
- **Training cases carry the OL quote** (`contextId.quote` in `llmTrainingData/*.json`), but
  their `history` is GL-keyed only. The builder (`__tests__/buildLlmTrainingData.test.js`)
  makes the history from the alignments of earlier checks of the group, which have `topWords`
  with lemmas, so an OL-keyed history can be built from the same entries.

### First look at the training data (45,097 cases in `llmTrainingData/*.json`)

Counted with a throwaway script; the OL form is the quote lowercased without accents. These
are **indications, not results**: no algorithm change was run. The 33% and 44% rows compared the
`expected` text, whose `word:2` marks never match a history rendering; Step 1 counts the
selections as the history does and gets 38.2% and 51.1%.

| measure | value |
|---|---|
| the check's GL phrase is an exact history key | 24,474 (54%) |
| the expected answer is a rendering under that exact key | 14,791 (33%) |
| the expected answer is a rendering under any key | 19,895 (44%) |
| (file, group, OL form) seen with more than one GL phrase | 19% |
| (file, group, GL phrase) seen with more than one OL form | 13% |

So in almost half of the cases the GL phrase is not a key of the history and the algorithm
falls back to related keys at a lower weight. The same OL form gets different GL phrases in about
1 in 5 groups, and the same GL phrase covers different OL forms in about 1 in 8. Grouping by
lemma rather than surface form would merge more (inflected forms of one lemma). Whether this
changes top-1 is what Step 2 measures.

## Hypotheses

- **H1, stable key.** An OL lemma key matches history more often than the GL phrase. More
  renderings get the exact-key weight, so the right rendering ranks first more often and
  more answers reach `ALGORITHM_CERTAIN_CONFIDENCE` (95) and skip the AI.
- **H2, telling words apart.** A group can hold several lemmas (e.g. *faith*: πίστις, πιστεύω,
  πιστός) that a target language renders differently. An OL key keeps the noun's renderings
  apart from the verb's even when the GL phrases overlap (the 13% above).
- **H3, form.** Morphology (Greek case and number, Hebrew prefixes such as `b:`, `d:`) may predict
  the target form (a case ending, a prefixed preposition). An exact surface-form or
  strong-with-prefixes match could get more weight than a lemma-only match. This is the
  riskiest one: target languages differ, and it must not assume any target grammar.
- **H4, history across GLs.** The app's selection history keeps every project of the same
  target language and bible id, but a project checked with a Russian GL has Russian keys that
  an English-GL check matches poorly or not at all. OL keys are the same for both. They also
  work when the GL bible of a book is not aligned, where today's history is empty
  (`if (foundBible)`).

Risks to check:
- **Sparser keys.** One lemma has fewer checks than the group as a whole. The OL key should add
  weight, not replace the GL key or the pooling.
- **Multi-word quotes** (`quote` lists several words, or `"θεοῦ & πατρὸς"`): the key is the list
  of lemmas; a partial overlap needs a weight, as `rankGlKeys` has for GL words.
- **Testaments don't share OL keys** (Greek vs Hebrew), while GL keys do. Only an issue if OL
  keys replaced GL keys, which this plan doesn't do.
- **Wrong lemma lookup.** Finding the quote word in the OL bible by surface form and occurrence can
  fail when the project's OL version differs from the resource (e.g. `ugnt` v0.18 vs v0.34).
  Fall back to the surface-form key.

## Decisions

Taken as recommended (author, 2026-11-26). Step 1's results revise Decision 1 for Step 2.

1. **Which OL key.** Recommend the **lemma list** as the main key, the **lowercased surface
   quote without accents** as a finer key (already computed), and Strong's numbers only to
   break ties between lemmas spelled alike. For Hebrew, compare the prefixes (`b:`, `d:`) as
   part of the finer key, not the main one.
2. **Where the lemma comes from at runtime.** Recommend the OL bible already in the `tc` props
   for the current check, and for history from other projects, that project's `alignmentData`
   `topWords` for the check's verse, then the OL bible in `~/translationCore/resources`, then the
   surface form alone.
3. **Which paths it feeds.** Recommend the **algorithm only** at first. The AI path gains
   indirectly (more answers at 95+ skip the AI; the algorithm's options are merged into AI
   results). Showing OL keys in the prompt changes `formatPreviousTranslations`, which means
   rebuilding the fine-tuning data and retraining (CLAUDE.md), so it is a later, separate step.
4. **Setting.** Recommend no new checkbox if Step 2 shows a clear gain with no loss for any
   language, as with other algorithm changes (`plans/algorithm-confidence.md`). Otherwise
   put it behind an option (`useOlHistory`), off by default, like `llmUseAlignmentHistory`.
5. **The history's shape.** Recommend keeping `{ glKey: { rendering: count } }` unchanged and
   adding a parallel `{ olKey: { rendering: count } }` tally (the shape `selectionsForQuoteString`
   already has), passed to the algorithm with the current check's OL key. Then the AI path, the
   cache and `updatedPreviousSelectionsData` keep working, and the OL tally is updated in the same
   places.

## Steps

### Step 0: confirm the decisions above

Done 2026-11-26: the recommendations were taken.

### Step 1: OL keys in the training data

- Add an `olHistory` field to the cases from `buildLlmTrainingData.test.js`: the same earlier
  checks as `history`, keyed by the OL key of Decision 1, built from the alignment `topWords`
  (lemma, strong, surface form). Same rules as `history`: earlier checks only, the check's own
  verse left out.
- Add the current check's `olKey` (lemmas, surface form, Strong's) to each case.
- Add the same to the `promptEval` sets (`build:prompt-eval-cases`), as an extra field so the
  existing files and results stay comparable.
- Unit tests for the key builder: Greek, Hebrew with prefixes, multi-word quotes, a quote word
  not found (surface-form fallback).
- **Measure before any algorithm change:** how often the check's OL key is an exact `olHistory`
  key, against 54% for the GL key, and how often the expected answer is under it, against 33%.
  If the OL key is not clearly more often exact, stop here and record why.

**Done 2026-11-26.** The design changed in one way: the files keep only each case's `olWords`, and
the OL history is built from them when needed. A second copy of every history in the 73 MB of
tracked training files was not needed.

- **Code:**
  - `src/utils/originalLanguageUtils.js` (new; also for Step 3): `getQuoteOlWords` finds the
    quote's words in the OL verse by occurrence, as written and then loosely (no accents, points or
    word joiners); `getOlKeys` gives the lemma key and the form key; `getBaseStrong` drops Hebrew
    prefixes.
  - `__tests__/helpers/olHistoryHelpers.js`: loads the newest unfoldingWord `ugnt`/`uhb`
    (`makeOlBibleLoader`), adds `olWords` to cases, builds each case's OL histories from the cases
    before it in its group (`buildOlHistories`), and counts the measures (`measureOlHistory`).
  - `__tests__/olHistory.test.js`: unit tests (in `npm test`), and the jobs
    `npm run add:ol-words` and `npm run measure:ol-history`.
  - `buildLlmTrainingData.test.js` writes `olWords` too. On `ar_avd_heb_book` it gives the same
    `olWords` as `add:ol-words` for 337 of the 338 cases both have; the other one's quote changed
    in the project since the file was built (it is now two words). The project also has more
    checks now (461 cases against 349), so the tracked files were not rebuilt.
- **Data:** `olWords` added to every case of the 58 training files and the 16 `promptEval`
  files; nothing else in them changed (checked against `HEAD` for the training files). Every quote
  was found: 45,097 of 45,097 training cases and 12,193 of 12,193 eval cases. Versions used:
  `ugnt` v0.34 and `uhb` v3.0.0. The `promptEval` files are not tracked; a copy from before the change
  was kept in the session's scratch folder only.
- **Like with like.** The OL histories come from the earlier *cases* of the group, but the file's
  `history` also counts the group's first checks, which have no case of their own. So the
  comparisons use `glSame`, a GL history built from the same earlier cases.

**Results** (`llmTrainingData/results/olHistoryMeasure.txt`, all 45,097 cases):

| key | exact for the case | answer under it | answer is its top rendering |
|---|---|---|---|
| GL phrase (`glSame`) | 49.4% | 35.2% | 30.0% |
| OL lemma | **77.4%** | **44.1%** | 31.6% |
| OL form | 53.2% | 37.0% | - |

The answer is under the exact lemma key but not the GL key in 10.0% of cases, and the other way
round in 1.1%. Every target language gains (lemma-only 2.9% for `es-419` to 13.3% for `vi`).

The Step 1 bar is passed: the lemma key is exact far more often. **But it is a broad key.** The
algorithm suggests only renderings it finds in the verse. So a second measure is a rough proxy for
it: take the renderings under a key that are in the verse (lowercased text contains them); is the
most counted one the answer, alone? "Fits" means some rendering under the key is in the verse.

| key | fits | right when it fits |
|---|---|---|
| GL phrase + OL form (`glForm`) | 31.7% | **85.3%** |
| GL phrase (`glSame`) | 37.6% | 81.0% |
| OL form | 39.9% | 80.1% |
| OL lemma | 53.6% | 64.5% |
| any key (the group's pool) | 60.3% | 59.0% |

Trying keys in order (the first key that fits gives the answer); `glSame, pool` is close to what the
algorithm does now:

| order | right |
|---|---|
| glSame, pool | 38.6% |
| lemma, glSame, pool | 36.5% (worse) |
| glSame, lemma, pool | 38.9% |
| glSame, form, pool | 39.2% |
| form, glSame, lemma, pool | 39.4% |
| **glForm, glSame, form, lemma, pool** | **39.8%** (+1.2) |

**What this means for Step 2:**
- **The lemma key must not outrank the GL key.** A lemma covers every form of a word, and target
  languages render forms differently (case endings, prefixed prepositions). Its top rendering is
  right 64.5% of the time, against 81% for the GL phrase.
- **The form key is about as precise as the GL phrase** and fits more cases, and GL phrase + form
  together is the most precise. This supports H3. **Decision 1 is revised:** for weights, the
  form key (and GL + form) comes first, the GL phrase next, the lemma as a fallback above the
  pool. Step 2 fits the weights with `calibrate:algorithm` rather than fixing this order.
- **Expect a small gain.** The proxy gives about +1.2 points of top-1. It ignores the algorithm's
  related keys, gaps and fuzzy matching. It also picks by count, which the algorithm does not do
  (its confidence is closeness x key weight x verse checks; counts only gate 100). In the
  algorithm, an OL key would act through the key weight. So only Step 2 shows the real effect. The larger gains
  would come from history the GL keys can't use (H4, Step 4), which this data can't show.
- Reproduce: `npm run add:ol-words` (already applied), then `npm run measure:ol-history`.

### Step 2: use the OL key in the algorithm

- Add `rankOlKeys(olKey, olHistory)`, the OL counterpart of `rankGlKeys`: 1 for the same lemma
  list, more for the same surface form (H3, measured separately), a partial-overlap weight for
  multi-word quotes.
- Each pooled rendering gets an OL-key weight beside its GL-key weight. In
  `scoreSuggestionFromHistory`, start with the larger of the two, then try fitted combinations in
  `HISTORY_SCORE`. The gate for 100 (`CERTAIN_MIN_HISTORY_COUNT`) can count an exact OL match
  as an exact-key match.
- Add the OL evidence to `explain` features, so `calibrate:algorithm` can fit and report it.
- Keep the return contract (up to 3 options, best first). With no `olHistory` the results must
  be byte for byte the same as today (test).
- **Measure** with `npm run calibrate:algorithm` (tune and held-out projects) and
  `scripts/compare-prompt-variants.js` on `promptEval` DEV/TEST: top-1, calibration error,
  accuracy at 95-100, by language and by GL phrase length; McNemar against today.
- **Adoption:** a significant top-1 gain on TEST with no significant loss for any language,
  and accuracy at 95+ no lower than today's ~95%.

**Done 2026-11-26 (code and measurement); adoption bar not met.**

- **Code** (`src/utils/checkingSuggestionsUtils.js`):
  - `getBestTWordSelectionWithConfidenceAlgorithm` takes `olHistory` (`{ keys, lemma, form }`, the
    shape `buildOlHistories` gives) and `olKeyWeights` (for measuring).
  - `poolRenderings` marks each rendering counted under the check's form key (`olKey: 'form'`) or
    only its lemma key (`'lemma'`). A rendering only the OL history has joins the pool. A rendering
    in both keeps the larger count, not the sum, since both histories count the same checks.
  - `scoreSuggestionFromHistory`: key weight = max(GL-key weight, OL-key weight), times
    `exactWithoutForm` for an exact-GL-key rendering not chosen for the check's form when the check
    has a form history. The weights are `OL_KEY_SCORE`. The certain-100 gate and the match-score
    cap are unchanged.
  - `explain` adds `olKey` and `olFormInHistory` to the features, only when there is an OL
    history. Without one the options and confidences are as before (unit test).
  - `calibrate:algorithm` takes `LLM_ALGO_OL=1` and passes each case's OL history built with
    `buildOlHistories`.
- **Sweep** (`calibrate:algorithm`, tune and held-out test projects as in
  `plans/algorithm-confidence.md`; 16 settings: form 0.6-0.9, lemma 0.4-0.5, exactWithoutForm 1 or
  0.85; also the first guess form 1, lemma 0.6):

  | setting | tune top-1 | test top-1 | 95-99 band, tune / test | wrong at >= 80, tune / test | ECE top, tune / test |
  |---|---|---|---|---|---|
  | baseline (no OL) | 20,241 (55.3%) | 4,713 (55.7%) | 4,866 at 88.2% / 1,555 at 89.8% | 942 / 255 | 5.8 / 10.9 |
  | form 1, lemma 0.6, exact 1 | 20,295 | 4,721 | 6,661 at 84.7% / 2,037 at 86.2% | 1,374 / 375 | 6.9 / 9.8 |
  | form 0.6, lemma 0.5, exact 0.85 | 20,337 | 4,725 | 4,535 at 88.6% / 1,447 at 90.3% | 923 / 243 | 6.1 / 9.4 |
  | **form 0.7, lemma 0.5, exact 0.85** | **20,343** | **4,724** | 4,535 at 88.6% / 1,447 at 90.3% | 923 / 243 | 5.5 / 8.3 |
  | form 0.8, lemma 0.5, exact 0.85 | 20,340 | 4,724 | same | 1,364 / 366 | 5.5 / 8.6 |
  | form 0.9, lemma 0.4, exact 0.85 | 20,360 | 4,720 | same | 1,377 / 368 | 5.9 / 9.9 |

  - Form 0.8 or more puts form-only matches at 80+: wrong answers shown there rise by about half.
  - exactWithoutForm 0.85 beats 1 everywhere (about +35 tune top-1). It takes about 330 tune
    answers out of 95-99, and those left are right more often.
  - Lemma 0.4 or 0.5 makes almost no difference.
  - Chosen, now `OL_KEY_SCORE`: form 0.7, lemma 0.5, exactWithoutForm 0.85. It is 17 below the best
    tune top-1 (form 0.9), but that setting fails the wrong-at-80 check.
- **McNemar, top-1, chosen setting against the baseline** (cases with no suggestion count as wrong):
  - tune: 189 won, 87 lost, p < 0.0001;
  - test: 22 won, 11 lost, p = 0.08.
  - By project, most of the gain is in `en_ult_jos` (+27), `vi_glt_luk` (+22), `ru_rlob_gen` (+17),
    `ar_avt_psa` (+12) and, held out, `te_glt_luk` (+11). `vi_glt_1co` lost 2.
- **Size of the effect:** +0.3 points on tune, +0.1 on test. That matches Step 1's proxy, which
  expected a small gain: on this data the GL phrase already carries most of what the OL key adds.
- **Adoption:** not met. The bar was a significant held-out gain with no loss for any language.
  The direction agrees on both splits, and calibration improves (fewer, more accurate 95-99
  answers), but p = 0.08. Decision needed (author): stop here, or go on to Steps 3-4, whose main
  hope is history across GLs (H4), which this data cannot measure.
- Files: the reports are `llmTrainingData/results/algorithmCalibration.report.txt` (baseline) and
  `algorithmCalibration.ol.options.report.txt` (chosen setting), with their `.jsonl` rows. The sweep's
  reports were kept in the session's scratch folder only.

### Step 3: OL history in the app

- `fetchPreviousSelectionData`: return the OL tally alongside the GL one, and count it even when
  the GL bible book is missing (H4). Look up lemmas as in Decision 2, with a cache per project
  and book, as the GL bibles have (`loadGlBookForSuggestions`).
- `fetchAlignmentHistoryEntries` / `getSuggestionHistory` (`alignmentHistoryUtils.js`): give
  each alignment entry its OL key from its `topWords`, so alignment history feeds both tallies.
- `Container.js`: pass the current check's OL key (from the `tc` OL bible) and the OL tally with
  each request; `updateSelectionsData` updates the OL tally when the user saves a selection, as
  it does the GL one.
- Check the time it adds per group (lemma lookups for every project).

### Step 4: measure history across GLs (H4)

- The training cases' history comes from earlier checks of the same project, so they can't
  show H4. Build a set like the app's history instead: for each check, history from **other**
  projects of the same target language, some checked with another GL (the training data has such
  pairs, e.g. `ar_avd_luk_book_ru_gl_ru` and `ar_avd_luk_book_unfoldingWord_en`, but those are the
  same project and can't be history for each other).
- Compare GL keys only against GL + OL keys, as in Step 2.

### Step 5 (later, only if Steps 2-4 help): the AI path

- Try ordering the history lines in `formatPreviousTranslations` by OL-key match as well. Same
  format, so no retraining is needed for that alone, but the fine-tuned models were trained on the
  current order, so measure the shipped models with `scripts/test-llm.sh` and on `promptEval`.
- Showing the OL key in the prompt is a new format: it needs new fine-tuning data and a
  retrain (`plans/fine-tune-qwen3.md`), and is a separate plan.

## Open questions

- Do older projects record an OL version that matches the resource used for lemma lookup? Not
  checked yet.
- Should the finer key (surface form, Hebrew prefixes) ever outrank a GL exact match, or only
  break ties? Step 2 decides from the data.
