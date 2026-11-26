# Plan: original-language keys for the suggestion history

Started 2026-11-26. Status: Steps 0-2 done (Step 2: a real gain on the tune projects, the same
direction but not significant on the held-out ones, p = 0.08). Step 4 measured 2026-11-26, before
Step 3: OL history from the project's **other books** is a significant gain on the held-out
projects too (B vs C 25 won / 7 lost, p = 0.002), mostly where the GL bible lacks those books. The
Step 3 wired into the app 2026-11-26 (committed, tried in translationCore by the author): the
algorithm now gets OL history from every project the selection history reads, and from the word
alignments when that setting is on. Calibration with it is no worse (fewer wrong answers at 95+).

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

### Step 3: OL history in the app — done 2026-11-26 (after Step 4)

- `fetchPreviousSelectionData` takes an `onBookChecks(checks, bookId, projectsFolder)` hook, called for
  every included project with checks for the group, **whether or not its GL bible book was found**
  (H4). `Container.js` (`loadSelectionHistory`, used by both places that read the history) counts
  the OL tally with it: `countOlSelections` in `originalLanguageUtils.js` looks up each check's quote in
  the newest unfoldingWord `ugnt`/`uhb` of the resources folder (`loadOlBookForSuggestions`, cached per
  book for the session) and counts its rendering under the lemma key and the form key. The hook keeps
  `checkingSuggestionsUtils.js` from importing `originalLanguageUtils.js`, which imports it.
- Each request's `selectionsData.olHistory` is `getOlHistoryForCheck` (the tallies and the check's
  keys); `getBestSelections` passes it to the algorithm as `olHistory`. The AI prompt does not use it.
  `olSelections` is left out of `translation_data.json` (`getSelectionsDataToSave`).
- `updateSelectionsData` updates the OL tally when a selection is saved, with
  `updatedPreviousSelectionsData` on each key.
- No setting: Step 4 showed a held-out gain, and calibration is no worse (below).
- **Alignment history** (`llmUseAlignmentHistory`, off by default; added 2026-11-26 after the author
  tried Step 3 in translationCore): `fetchAlignmentHistoryEntries` takes an `olKeysForCheck` option,
  which `Container.js` passes (`getCheckOlKeys` with the check's OL book). Each entry gets `olKeys`,
  and projects whose GL bible book is missing are read too, keeping the entries that have OL keys
  (with `glPhrase` ''; the GL history skips them). `getSuggestionOlHistory` adds the entries to the
  OL tally for one check, leaving out the same ones `getSuggestionHistory` leaves out (the check's own
  verse, checks whose saved selection is already counted). **Not measured:** the training data has
  no alignment-history cases with OL keys; it uses the same weights as the selection history.
- **Time** (your projects folder, `vi_glt_heb_book` with `vi_glt_1co_book`, 8 groups): the first group
  took ~15 ms more (reading the Greek books), the rest under 1 ms more. Those projects have few saved
  selections (`faith` 5, `god` 0), so this is a lower bound; the per-check cost is a verse lookup.
- **Calibration** with OL history from other books (`LLM_OL_CROSS_ALGO=1 npm run measure:ol-cross-book`;
  the top answer at each confidence, accuracy and wrong count; A, C, B as in Step 4):

  | split | | at 100 | 95-99 | 80-94 |
  |---|---|---|---|---|
  | tune | A | 2,286 at 92.3% (176 wrong) | 1,194 at 84.0% (191) | 243 at 79.8% (49) |
  | tune | B | 2,364 at 92.4% (179) | 945 at 84.3% (148) | 338 at 81.1% (64) |
  | test | A | 613 at 92.7% (45) | 479 at 87.5% (60) | 178 at 84.3% (28) |
  | test | B | 635 at 92.9% (45) | 393 at 87.8% (48) | 188 at 86.7% (25) |

  Wrong answers at 95 or more (which skip the AI): tune 367 → 327, test 105 → 93. More answers reach
  100 (an OL count can lift a rendering's count to `CERTAIN_MIN_HISTORY_COUNT`), and those are right
  as often as before.
- Unit tests: `__tests__/originalLanguageHistory.test.js` (tally, keys, loader, the hook with a
  missing GL book) and a `getBestSelections` test in `checkingSuggestionsUtils.test.js`.

### Step 4: measure history across books and GLs (H4) — measured 2026-11-26, before Step 3

Done first, since Step 3 is the costly step and was only worth doing if this showed a gain.

**H4's premise was partly wrong.** The app does not key another project's selections by the GL
that project was checked with: `fetchPreviousSelectionData` and `fetchAlignmentHistoryEntries`
re-key every project's checks with the **current** GL bible (`loadGlBookForSuggestions` +
`getAlignedTextFromBible` on each check's `contextId`). So a project checked with a Russian GL
already gets English keys when checking with English. History is lost only when the current GL
bible has **no such book** (`if (foundBible)`) or no aligned text for the check's OL words, or when
the GL bible's text is in another language (Arabic `arst` has English text in most books, see
CLAUDE.md). OL keys work in all those cases.

How much is lost, under each case's own GL bible (other books of the same target language and
resource id, same testament, as the selection history; one training file per book as the source of
its checks; `npm run measure:ol-cross-book`, `__tests__/olCrossBook.test.js`):

| measure | cases |
|---|---|
| all cases | 45,097 |
| with history from other books | 18,395 |
| losing some of it / all of it | 2,052 / 1,446 |
| answer only in the lost history (same OL form) | 759 (393) |

The GL bibles in `~/translationCore/resources` that lose it: es-419 `glt` (6 books: 3jn est jon
neh rut tit), id `glt` (10 NT books), fa `glt` (8), ru `rlob` (no heb, gal, ...). en `ult` and ar
`avd` lose almost nothing.

**Algorithm, top-1** on the cases with other-book history, each run with Step 2's `OL_KEY_SCORE`:
- A: the GL history (the case's own, plus the other books' checks the GL bible keys), as the app has;
- C: A + OL history from the same project (Step 2);
- B: C + OL history from every other book, keyed or not.

| split | cases | A | C | B | B vs C (won / lost, p) | B vs A |
|---|---|---|---|---|---|---|
| tune | 14,680 | 54.0% | 54.4% | 54.8% | 103 / 41, 2.4e-7 | 153 / 37, 5.9e-18 |
| tune, with lost history | 3,271 | 56.5% | 56.9% | 58.6% | 68 / 12, 1.2e-10 | 82 / 13 |
| **test** | 3,715 | 60.2% | 60.3% | 60.8% | **25 / 7, 0.002** | 29 / 8, 0.0008 |
| test, with lost history | 227 | 63.0% | 63.0% | 69.2% | 15 / 1, 0.0005 | 15 / 1 |

- **Held-out gain is significant**, and much larger where history was lost (+6.2 points on those
  227 cases). Most wins are in files whose GL bible lacks books (`*_ru_gl_ru`, `*_es-419_gl_es-419`,
  `en_ult_tit_book_bahtraku_id`, `en_ult_tit_book_fa_gl_fa`), as H4 predicts.
- **Losses by language:** no file lost more than it won by over 3 cases; the worst were
  `gu_glt_luk_book_unfoldingWord_en` (0 / 3) and `te_glt_luk_book_unfoldingWord_en` (1 / 2), both
  English-GL files where nothing was lost, so the cross-book OL weight there only re-ranks.
- **Not yet measured:** calibration (wrong answers at 80+, the 95-99 band) with cross-book OL
  history; check it when Step 3 is wired, with `calibrate:algorithm`, before shipping.
- Limits: the other books' checks are the training files' cases, not every check of those projects;
  the case's own history is still only its earlier checks (the app uses every other check of the
  project); and the other books are keyed with the case file's GL bible, while the app uses the first
  GL bible in `bibleIdSort` order.
- **Adoption:** met for going on to Step 3 (significant held-out gain, no language clearly worse).

### Step 5 (later, only if Steps 2-4 help): the AI path

- Try ordering the history lines in `formatPreviousTranslations` by OL-key match as well. Same
  format, so no retraining is needed for that alone, but the fine-tuned models were trained on the
  current order, so measure the shipped models with `scripts/test-llm.sh` and on `promptEval`.
- Showing the OL key in the prompt is a new format: it needs new fine-tuning data and a
  retrain (`plans/fine-tune-qwen3.md`), and is a separate plan.

**Part 1 started 2026-11-26 (variants and first runs).**

- **Variants** (`__tests__/helpers/promptVariants.js`; the app's prompt is unchanged):
  - `O1`: the app's system prompt and line format; after the verse fit the history lines are
    ordered by OL form match, exact GL key, OL lemma match, relatedness, count (Step 2's order).
    `formatPreviousTranslations` takes the experiment-only options `olHistory` and
    `addOlRenderings`; `getBestSelections` puts `selectionsData.olHistory` on the AI request (as it
    does `contextId`), which only an eval override reads.
  - `O2`: O1 plus renderings only the OL history has, shown as chosen for the GL phrase.
- **Data:** `LLM_TRAINING_OL_HISTORY=same` gives each case its same-project OL history (Step 2's
  "C"): `buildRunOlHistories` rebuilds it from the case's `sourceFile` with `buildOlHistories`.
  The `#nohist` cases get none (their history was removed on purpose; given the OL history, the
  algorithm's top-1 on DEV-NOHIST went from 0 to 249), so O1 and O2 send the baseline prompt
  there and those sets need no AI runs. The cross-book history of Step 4 also re-keys the GL
  history, so it would change the baseline itself; it is left for later.
- **Algorithm with OL history** (`_Algorithm_ol-same`, which also decides which cases skip the
  AI): DEV top-1 620 → 626 of 1,500 (none at 95+, by construction); TEST 447 → 446 of 835, at
  95+ 207 → 196, so 639 TEST cases go to the AI instead of 628.
- **How many prompts change** (AI-bound cases): DEV 1,500, of which 1,092 have OL counts, O1
  changes 248 prompts (the first line in 127); TEST 639, 346, 83 (60). O2 adds lines to only
  11 DEV cases and no TEST case: same-project OL history rarely has a rendering the GL history
  lacks, so O2 is not run until the cross-book history is wired in.
- **Runs:** baseline and O1 on DEV and TEST, both with `LLM_TRAINING_OL_HISTORY=same`, on the
  span plan's server (translationCore's bundled `llama-server`, build 12651, router over
  `llmTraining/outputs/eval-models`, port 8080; temperature 0.1, seed 42): the shipped fine-tunes
  `uw-tw-qwen3-1.7b-Q5_K_M` and `uw-tw-qwen3-0.6b-Q6_K` (hard links to `~/translationCore/models`),
  and stock `qwen3-1.7b-stock-Q5_K_M`. Compare with
  `scripts/compare-prompt-variants.js -a <set>_Algorithm_ol-same.results.json`.

## Open questions

- Do older projects record an OL version that matches the resource used for lemma lookup? Not
  checked yet.
- Should the finer key (surface form, Hebrew prefixes) ever outrank a GL exact match, or only
  break ties? Step 2 decides from the data.
