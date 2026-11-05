# Plan: better partial GL matching in `getBestTWordSelectionWithConfidenceAlgorithm()`

**File:** `src/utils/autoCheckingUtils.js`
**Tests:** `__tests__/autoCheckingUtils.test.js`
**Written against commit:** `2e69910c4e4a0476d4370c01fb290378bb810b06` (branch `feature-mcleanb-add-suggestions-support`).
The working tree at that time also had an uncommitted version bump in `package.json` / `package-lock.json`; that does not move any line cited below. If `git diff 2e69910 -- src/utils/autoCheckingUtils.js` is not empty when you start, re-check every line number in this plan before editing.

**Baseline recorded on 2026-11-05:** `npm test` → eslint clean, `Test Suites: 14 passed, 14 total`, `Tests: 89 passed, 89 total`, `Snapshots: 7 passed`.

This plan is self-contained. Every design decision is settled in section 3 and 4; only the items in section 8 need the author. Expected numbers quoted as "prototype value" come from a throwaway re-implementation of the proposed scoring that was run on the test inputs in section 5; use them to sanity-check your implementation, but the assertions in the tests are ranges, and the ranges are what must hold.

---

## 1. Diagnosis (current code, with line numbers)

The function is `getBestTWordSelectionWithConfidenceAlgorithm` at lines 1339–1535. Its helpers sit at 843–1337.

### 1.1 Observations from the prompt, checked

| Claim | Verdict | Evidence |
|---|---|---|
| `getPreviousTranslationPartialMatchCounts` returns the **first** key sharing **any one** word | **Confirmed** | Lines 940–951: `glPhrases.find(...)` with `translatedWords.includes(normalizedGlWords[i])`. `Object.keys` order is insertion order, which is the order projects were scanned in `fetchPreviousSelectionData` (line 3146), i.e. arbitrary. Probe: history `{ 'the law': {'la ley':3}, 'faith': {'fe':5} }`, GL phrase `'the faith'`, verse `Por la fe Abraham obedeció y la ley fue dada` → top `la ley` at **100**. Swap the two keys → top `fe` at 100. |
| That word can be a function word | **Confirmed** | Same probe: the shared word was `the`. |
| Only one key is used, keys are not ranked by overlap | **Confirmed** | Lines 953–955 return `data[matchedGL]` for the single hit. With the full Vietnamese fixture (`__tests__/__fixtures__/tWords/vi_translationData.json`, 7 keys), GL phrase `holy places` on Heb 9:12 picks key `holy` → `thánh khiết`, which is not in the verse, and the result is `thánh kiếm` at 77 (fuzzy), although `các nơi thánh` (rendering of key `of the holy places`) is in the verse verbatim. The existing test for this verse passes only because its 3-key history happens to list `Holy` first. |
| Partial-GL renderings are scored like exact ones and can reach 100 | **Confirmed** | `glMatchInfo.isFuzzyGlMatch` (line 1350) is set only on the Levenshtein step (line 960), not on the shared-word step. The cap `maxConfidence` (line 1357) is therefore 100 for shared-word partial matches. Probe above shows 100. |
| Fuzzy fallback picks the best verse position per word independently, no order/adjacency check | **Confirmed** | Lines 1463–1480: one `bestPos` per rendering word; positions are then only deduplicated and sorted (line 1484). Probe (existing test "Heb 12:10", history `{Holy, the Holy, sanctification}`, GL `holiness`): `nơi` fuzzy-matches `với` (NFKD similarity 0.6 > 0.5) and the result is `với thánh` at 72. The test asserts this value with a `TODO` admitting it is wrong (test file line 67). **Side effect to preserve:** because it ignores order, this pass is also what currently handles a swapped rendering (`святой дух` found as `дух святой`, probe gives 90). An order-aware replacement must keep that case working (3.4.6, test R5). |
| Fuzzy fallback only runs when no candidate is above 80 | **Confirmed** | Lines 1446–1450. |

### 1.2 Other weaknesses found

1. **Fuzzy GL threshold is effectively 0.2, not 0.6.** `findClosestFuzzyGlPhrase` is called with an explicit `0.2` (line 957), so `GL_PHRASE_FUZZY_MATCH_THRESHOLD = 0.6` (line 968) is dead. With the full fixture, GL `holiness` fuzzy-picks `of Holies` (score 0.594; `holy` scores 0.375) and ignores `holy` → `thánh khiết`, which is in the Heb 12:10 verse verbatim; result is `thánh` at 50.
2. **The "use all data" branch returns nothing.** Line 964: `return { }; // if no GL matches, use all data for groupId`. The comment describes the author's intent; the code returns an empty map and the function yields `[]`.
3. **The confidence cap is applied after sorting.** Line 1524 applies `Math.min(confidence, maxConfidence)` after `.sort().slice(0, 3)` (lines 1514–1523), so capped candidates are ordered by their uncapped score. Harmless today (one cap for all), wrong once caps differ per rendering.
4. **A one-word fragment gets the adjacency bonus.** `isContiguous = span === positions.length - 1` (line 1388) is `true` for a single position, so a lone word from a two-word rendering scores 30 + 15 + usage ≈ 50 (`scoreAlgorithmicMatch`, line 1223). Probe: verse `la casa de la madre y la hija`, GL `church`, history `{ church: {'la iglesia': 5} }` → `la` at **50**.
5. **Sub-phrase search only tries contiguous slices of the rendering** (`findBestAvailableOrderedMatchPositions`, lines 1157–1191). A rendering whose middle word is missing (`sự nên thánh` vs verse `sự thánh khiết`) loses an outer word; today the fuzzy fallback happens to rescue this case.
6. **Ordered search is exponential.** `findBestOrderedMatchPositions` (lines 1101–1155) enumerates every increasing placement with no pruning. Measured on current code with rendering `a b a b a b a b c` (so the contiguous step fails and the 8-word slice is searched): 16-word verse 2 ms, 24 words 5 ms, 28 words 13 ms, 36 words 67 ms, 44 words 264 ms, doubling every 4 words. A 72-word verse would take about half a minute. Real verses rarely repeat a rendering word that often, but long verses with a repeated function word inside a 4–6 word rendering are plausible. The same function is used by the LLM path (`resolveLlmPhraseInVerse`, line 1825).
7. **Levenshtein works on UTF-16 code units** (`levenshteinDistance`, lines 1266–1297, indexes `a[i - 1]`). Fine for BMP scripts; a surrogate pair would count as two characters. Cheap to fix with `Array.from`.
8. **Fuzzy fallback threshold `> 0.5` is too loose for short words** (line 1476). Two edits on a 4–5 code-point word pass (`nơi`/`với` = 0.6 after NFKD).
9. **Normalisation facts you need:** `normalizer` from `string-punctuation-tokenizer` 2.2.0 is only `text.normalize('NFKD')` (see `node_modules/string-punctuation-tokenizer/src/normalizers.js` line 47). It does not lowercase or strip punctuation. `normalizeForCompare` (line 557) adds lowercasing. So every "character" count in this plan is in **NFKD code points**: `thánh` is 6, `nơi` is 4, `với` is 5, `reúnen` is 7, `विश्वास` is 7. Outer history keys are produced by `cleanGlQuote` (line 2601: NFKD + punctuation removed); inner keys are raw selection text joined by spaces (line 2679), not normalised. `getWordList` (line 2496) tokenises on `[\pL\pM‍⁠]+`, so scripts without spaces (Thai, Khmer, CJK) yield one token per run; that is outside this function.

### 1.3 Shared helpers (do not break the LLM path)

`findContiguousMatchPositions`, `findBestOrderedMatchPositions`, `fuzzyStringSimilarity` and `buildSelectionsFromPositions` are also called from `resolveLlmPhraseInVerse` (lines 1803, 1824, 1825, 1840). Any change to them must keep the same inputs and return values. `getPreviousTranslationExactMatchCounts`, `getPreviousTranslationPartialMatchCounts`, `findClosestFuzzyGlPhrase`, `getWordCoverageSimilarity` and `getNormalizedGlWords` are only used inside the algorithm path (callers at 1349, 1353, 957, 1035–1036, 1022/1032). None of these helpers is exported, and `__tests__` does not import them.

---

## 2. Key fact driving the design: the history is per translationWord group

`fetchPreviousSelectionData` reads `.apps/translationCore/index/${toolName}/${bookId}/${groupId}.json` (lines 3218–3221) for every project, so `previousTranslationData` only ever contains GL phrases aligned to the **same** translationWords group (e.g. every key in the Vietnamese fixture is a form of "holy"). Every rendering in the history is therefore a rendering of the current concept, whatever its GL wording. That is why pooling renderings across keys is safe for translationWords, and why the decision in 3.2 pools **all** keys.

Consequence for word weighting: within one group the concept word (`holy`) appears in most keys, so an inverse-document-frequency weight computed from the history would make the concept word the *least* important word and the incidental words (`the`, `of`, `place`) the most important. Verified on the fixture: `holy` is in 5 of 7 keys, `the` in 3, `places` in 1. **History-frequency weights are therefore rejected** for the GL side (decision 3.1.3).

---

## 3. Proposed approach and decisions

### 3.1 GL side: rank every history key by weighted word overlap

**3.1.1 Word similarity (shared by GL and target sides).** New helper `wordSimilarity(a, b)` on strings already through `normalizeForCompare`:

```js
const WORD_FUZZY_THRESHOLD = 0.65;   // ~ one edit per three code points
const MIN_FUZZY_WORD_LENGTH = 4;     // shorter words match only exactly
const MIN_AFFIX_LENGTH = 6;          // shorter word must be a whole prefix/suffix of the longer

function wordSimilarity(a, b) {
  if (a === b) { return 1; }
  const aChars = Array.from(a), bChars = Array.from(b);
  if (aChars.length < MIN_FUZZY_WORD_LENGTH || bChars.length < MIN_FUZZY_WORD_LENGTH) { return 0; }
  let similarity = fuzzyStringSimilarity(a, b);           // Levenshtein, see Step 1
  const [shorter, longer] = aChars.length <= bChars.length ? [a, b] : [b, a];
  const shorterLength = Math.min(aChars.length, bChars.length);
  if (shorterLength >= MIN_AFFIX_LENGTH && (longer.startsWith(shorter) || longer.endsWith(shorter))) {
    similarity = Math.max(similarity, 0.5 + 0.5 * shorterLength / Math.max(aChars.length, bChars.length));
  }
  return similarity >= WORD_FUZZY_THRESHOLD ? similarity : 0;
}
```

Prototype values: `place/places` 0.83, `reúnen/reúnan` 0.86, `reunan/reúnan` 0.86 (missing accent = one edit), `believed/believing` 0.67, `holies/holiness` 0.75, `holy/holiness` 0, `nơi/với` 0 (0.6 raw, rejected), `thánh/thành` 0.83 (tone difference; unavoidable at character level, see risks), `kirche/kirchengemeinde` 0.70 (affix rule), `comer/comerciante` 0 (`comer` is 5 code points, under `MIN_AFFIX_LENGTH`), `विश्वास/विश्वासी` 0.94, `πιστοί/πιστούς` 0.71.

*Why these values:* 0.65 keeps every inflection pair above while rejecting two edits on a four-letter word. `MIN_FUZZY_WORD_LENGTH = 4` means two- and three-letter words (most function words in the GLs in scope, and all two-character Chinese words) never fuzzy-match. `MIN_AFFIX_LENGTH = 6` plus the whole-prefix/suffix requirement is the loosest rule that still rejects `comer/comerciante`; arbitrary substring matching is **rejected** because on short words it is almost always a false positive.

*Works for an unrelated target language?* Yes: it is character-level on NFKD, needs no word list, and is script-agnostic. Hangul decomposes to 2–3 jamo per syllable so Korean words clear the length guards; Chinese two-character words fall under them and match exactly only, which is the right behaviour.

**3.1.2 GL word weight.** `glWordWeight(word) = Array.from(word).length < MIN_FUZZY_WORD_LENGTH ? 0.2 : Math.min(1, Array.from(word).length / 5)`. Short GL words (`the`, `of`, `by`, `la`, `de`, `के`, `से`) count for 0.2, four-letter words 0.8, five or more 1.

**3.1.3 Decision: weights come from word length, not from history frequency and not from a per-GL list.** History frequency inverts the ranking inside a per-group history (section 2). A per-GL stop list would need a list per gateway language (English, French, Hindi, Spanish, …) and is never complete. Length is a weak but language-neutral proxy for "function word" in every GL in scope, and it only has to break ties: the verse itself is the main evidence. Alternative recorded in Open question 3.

**3.1.4 Relatedness of a key to the GL phrase.** For each history key:

- exact: `key === glPhrase` or `normalizeForCompare(key).trim() === normalizeForCompare(glPhrase).trim()` → `{ relatedness: 1, isExact: true }` (this is the only way to keep cap 100; word-set equality in a different order is deliberately **not** exact).
- otherwise, with `q` = GL phrase words and `k` = key words (`getNormalizedGlWords`, line 981, kept):
  - `recall = Σ_q glWordWeight(q) · max_k wordSimilarity(q, k) / Σ_q glWordWeight(q)`
  - `precision = Σ_k glWordWeight(k) · max_q wordSimilarity(k, q) / Σ_k glWordWeight(k)`
  - `relatedness = (recall + precision) ? 2·recall·precision / (recall + precision) : 0` (F1).

Prototype ranking for `holy places` on the fixture: `holy place` 0.91, `of the holy places` 0.90, `of the holy place` 0.82, `holy` 0.62, `Holy` 0.62, `the Holy` 0.57, `of Holies` 0. For `holiness`: `of Holies` 0.68, all others 0.

**3.1.5 Flat data.** `previousTranslationData` may be an already-flat `{ rendering: count }` map (the `isPhraseKeyed` test at lines 846–850). Keep that: when the data is flat, treat it as one exact key.

### 3.2 Pool renderings from every key

New helper `poolRenderings(data, rankedKeys)` → `Map<normalizedRendering, { rendering, count, relatedness, isExact }>`:
- map key is `rendering.split(/\s+/).filter(Boolean).map(normalizeForCompare).join(' ')` so `Nơi Thánh` and `nơi thánh` merge;
- `count` sums across keys; `relatedness` is the max; `isExact` is true if any contributing key was exact;
- skip empty renderings and counts ≤ 0 (today's filter at line 1360).

**Decision: pool every key, including keys with relatedness 0.** Reason: section 2. A rendering of the same group found verbatim in the verse is strong evidence even when the GL wording differs (`holiness` vs `holy` → `thánh khiết`). Keys with relatedness 0 get the lowest cap (3.3). Risk and the translationNotes caveat are in section 6 and Open question 1.

### 3.3 Confidence caps (replaces `FUZZY_GL_MATCH_MAX_CONFIDENCE`)

```js
const PARTIAL_GL_MATCH_CAP_MIN = 82;  // key shares nothing with the GL phrase
const PARTIAL_GL_MATCH_CAP_MAX = 95;  // key shares every weighted word but is not the exact key
const FUZZY_TARGET_MAX_CONFIDENCE = 90; // any candidate that needed target-word fuzzy matching

capForRendering = isExact ? 100 : Math.round(PARTIAL_GL_MATCH_CAP_MIN + (PARTIAL_GL_MATCH_CAP_MAX - PARTIAL_GL_MATCH_CAP_MIN) * relatedness)
```

Rules, in words:
1. **100** only for exact GL key **and** full rendering found contiguous and in order (unchanged, `scoreAlgorithmicMatch` line 1217).
2. Partial GL key: candidate confidence = `min(verse score, cap)`, cap in 82..95 by relatedness. A verbatim contiguous match through a partial key therefore lands between 82 and 95, always above the 80 fuzzy gate, so a verbatim target match still suppresses target-side fuzzy matching.
3. Target-side fuzzy match: `min(FUZZY_TARGET_MAX_CONFIDENCE, round(structural score × average similarity))`, then the GL cap of rule 2. So fuzzy ≤ 90 always, and fuzzy-through-partial-key ≤ its cap.
4. Caps are applied **when the candidate is created** (inside `considerCandidate`), not after sorting. Delete the post-sort `Math.min(confidence, maxConfidence)` at line 1524.
5. Ordering among candidates stays: confidence desc, count desc, matched words desc, span asc (lines 1514–1520).

Relative order this produces: exact+contiguous 100 > exact+gapped (max 94) ≈ partial+contiguous (82–95, by relatedness) > fuzzy (≤ 90, usually 70–88) > sub-phrase fragments (< 60).

### 3.4 Verse search changes

1. **Polynomial tightest ordered placement** (replaces the recursive `search` at lines 1124–1150). For each candidate start position of word 0, greedily take the first position of word 1 after it, then of word 2 after that, etc.; keep the placement with the smallest span, earliest start on ties. Greedy "earliest next" is optimal for a fixed start, so the result equals the exhaustive search's result. Complexity O(|positions of word 0| × n × log). If some start cannot complete, no later start can either, so break. Implement it as an inner function taking `positionsPerWord` so Step 4 and Step 5 can reuse it with their own position lists; `findBestOrderedMatchPositions` keeps its signature and builds `positionsPerWord` by exact equality as today.
2. **Present-word subsequence before slices.** In the sub-phrase step, first try the ordered placement of *all rendering words that occur in the verse* (drop absent words wherever they are); only if their order fails, fall back to the current contiguous-slice loop. Scored against the full rendering length as today.
3. **No adjacency bonus for a single matched word**: in `scoreAlgorithmicMatch`, `contiguousBonus = isContiguous && matchedWordCount >= 2 ? 15 : 0`. The early `return 100` for a full contiguous match (line 1217) is untouched, so one-word renderings still reach 100.
4. **Verse-frequency discount for partial-coverage matches only.** When `matchedWordCount < phraseWordCount`, the coverage term uses `Σ 1 / occurrencesInVerse(word)` instead of the matched count. A lone `la` in a verse with three `la`s then covers 1/3 of a word. Full matches are untouched (a one-word rendering `fe` found in a verse with two `fe`s is still 100). Data-driven and language-neutral.
5. **Fuzzy pass rewritten** (replaces the `if (!haveConfidentCandidate)` block, lines 1450–1511; confirm the closing brace before deleting). For each pooled rendering: positions per word = verse positions with `wordSimilarity > 0` (remember the similarity); drop words with no position; place the remaining words with `placeWords` from item 6 (ordered first, then adjacent swap); `averageSimilarity = Σ similarity of placed words / phraseWordCount` (absent words count 0); `structural = scoreAlgorithmicMatch(placed.length, phraseWordCount, isContiguous, span, count, maxCount)` minus `ORDER_PENALTY` when the placement was unordered; confidence per rule 3.3.3. Gate unchanged: this pass runs only when no candidate is above 80 (`minimumConfidenceLevel`, line 1446). Decision recorded: keep the gate, because running the pass always would add low-value fuzzy options to slots 2–3 of every result.
6. **Adjacent-swap fallback (mandatory, not optional).** The current fuzzy pass ignores order, so today a swapped rendering (`святой дух` in a verse reading `дух святой`) is found at 90. An order-aware pass would silently lose that, so both the exact-word pass (Step 4) and the fuzzy pass (Step 5) use one placement helper:

   ```
   placeWords(positionsPerWord) → { positions, inOrder } | null
     1. tightest ordered placement (item 1)            → { positions, inOrder: true }
     2. else tightest unordered window: sort every (position, wordIndex) pair by position and
        slide two pointers to find the smallest window containing every wordIndex at least once
        (O(P log P)); accept only if span - (n - 1) <= MAX_UNORDERED_GAP (= 1)
                                                        → { positions, inOrder: false }
     3. else null
   ```

   An unordered placement is scored `scoreAlgorithmicMatch(n, n, false, span, …) - ORDER_PENALTY` with `ORDER_PENALTY = 10`, so it can never return 100 or take the adjacency bonus; for an adjacent swap of a full two-word rendering through the exact key this gives 60 + 20 + 10 + usage − 10 ≈ 85. The one-gap limit is the deliberate improvement over today: a far-apart wrong pairing (`fe … la` across the verse) no longer outranks the correct fragment `fe`. Covers free-word-order target languages at low risk because fixed-order languages never trigger it for adjacent words that are not a real swap.

*Works for an unrelated target language?* 1, 2, 3, 4 and 6 are position arithmetic only. 5 relies on `wordSimilarity` (3.1.1).

### 3.5 Levenshtein on code points

`levenshteinDistance` and `fuzzyStringSimilarity` switch to `Array.from(a)` / `Array.from(b)` so surrogate pairs count as one character. `fuzzyStringSimilarity` is shared with the LLM path; its contract (number in [0,1]) is unchanged.

### 3.6 What gets deleted

`getPreviousTranslationExactMatchCounts` (doc+body 832–861), `getPreviousTranslationPartialMatchCounts` (863–965), `GL_PHRASE_FUZZY_MATCH_THRESHOLD` and `FUZZY_GL_MATCH_MAX_CONFIDENCE` (967–973), `getWordCoverageSimilarity` (985–1006), `findClosestFuzzyGlPhrase` (1008–1046). Keep `getNormalizedGlWords` (975–983). ESLint `no-unused-vars` is an error, so unused functions must be removed, not left behind.

---

## 4. Confidence rules, summarised for the JSDoc

Replace the bullet list in the function's JSDoc (lines 1297–1337) with:

- found adjacently and in order through the **exact** GL key: **100** (the only way to reach 100)
- found adjacently and in order through a **related** GL key: 82–95, higher the more weighted GL words the key shares with the phrase
- found in order with other verse words in between: below 100, by compactness (and under the key's cap)
- found with its words swapped but within one gap: 10 points below the in-order score, never above 89
- only part of the rendering is in the verse: by coverage, discounted when the matched words are frequent in the verse
- found only by fuzzy word matching (inflection, compound, accent): at most 90, scaled by average word similarity

---

## 5. Test cases to add to `__tests__/autoCheckingUtils.test.js`

Keep the existing helpers (`getResults`, `normalizePreviousTranslationData`) and the four existing tests, with one change noted in 5.2. Import the fixture: `import viTranslationData from './__fixtures__/tWords/vi_translationData.json';` and use `viTranslationData['ἅγια'].selections` where "full vi history" is written below. All verses are built with `getWordList(normalizer(verseText))` as the existing tests do. Confidence ranges are inclusive. "Prototype value" is informational.

Verses used:

- **V1 Heb 9:12 (vi):** `cũng chẳng phải bởi huyết của dê đực và bò con, nhưng bởi huyết của chính mình, Ngài đã vào trong các nơi thánh một lần đủ cả, tự mình kiếm được sự cứu chuộc đời đời.`
- **V2 Heb 12:10 (vi):** `Vì dù cha phần xác sửa dạy chúng ta trong ít ngày theo điều dường như là tốt nhất đối với họ, nhưng Cha phần tâm linh sửa dạy vì cớ đem ích lợi cho chúng ta, để dự phần vào sự thánh khiết của Ngài.`
- **V3 (es):** `Por la fe Abraham obedeció y la ley fue dada`
- **V4 (es, existing):** `Por lo tanto mis hermanos cuando se reúnan para comer esperen el uno por el otro`

### 5.1 New tests — fail on current code

| # | Name (describe → test) | wordList | glPhrase | history | Expected top | Current code gives | Passes after step |
|---|---|---|---|---|---|---|---|
| N1 | `partial GL match` → pools renderings from every related key (vi, Heb 9:12, full history) | V1 | `normalizer('holy places')` | full vi history | text `các nơi thánh`, confidence 85–95 (prototype 94) | `thánh kiếm` 77 | 3 |
| N2 | `partial GL match` → is independent of history key order (es) | V3 | `'the faith'` | `{ 'the law': {'la ley': 3}, 'faith': {'fe': 5} }` **and** the same two keys in the other order (two calls in one test) | text `fe` both times, confidence 85–95 (prototype 94) | `la ley` 100 / `fe` 100 | 3 |
| N3 | `partial GL match` → is independent of history key order (hi, Devanagari; made-up data) | `विश्वास से हम समझते हैं कि व्यवस्था दी गई` | `'the faith'` | `{ 'the law': {'व्यवस्था': 3}, 'faith': {'विश्वास': 5} }` | text `विश्वास`, confidence 85–95 (prototype 94) | `व्यवस्था` 100 | 3 |
| N4 | `partial GL match` → never reports 100 through a partial key (es) | `por la fe Abraham` | `'by faith'` | `{ 'faith': {'la fe': 3} }` | text `la fe`, 82 ≤ confidence ≤ 95 (prototype 94) | `la fe` 100 | 3 |
| N5 | `partial GL match` → uses the most-used group rendering when the GL phrase is only morphologically related (vi, Heb 12:10, full history) | V2 | `'holiness'` | full vi history | text `thánh khiết`, confidence 80–90 (prototype 82) | `thánh` 50 | 3 |
| N6 | `fuzzy target match` → matches a compound target word by shared prefix (de-like, made-up data) | `und die Kirchengemeinde versammelte sich` | `'the church'` | `{ 'church': {'Kirche': 4} }` | text `Kirchengemeinde`, confidence 60–80 (prototype 70) | no results | 5 |
| N7 | `fuzzy target match` → does not fuzzy-match a short target word (vi, Heb 12:10, 3-key history) | V2 | `'holiness'` | `normalizePreviousTranslationData({ 'Holy': {'Nơi Thánh': 1}, 'the Holy': {'Nơi Thánh': 1}, 'sanctification': {'sự nên thánh': 1} })` | text `sự thánh`, confidence 50–79 (prototype 58); **and** no returned option's text contains `với` | `với thánh` 72 | 5 |
| N8 | `scoring` → discounts a fragment made only of repeated verse words (es) | `la casa de la madre y la hija` | `'church'` | `{ 'church': {'la iglesia': 5} }` | text `la`, confidence < 30 (prototype 15) | `la` 50 | 4 |
| N9 | `performance` → handles a verse that repeats a rendering word many times | `getWordList(Array(36).fill('a b').join(' '))` (72 words) | `'x'` | `{ 'x': {'a b a b a b a b c': 1} }` | non-empty result; test declared with a 10 000 ms jest timeout and must finish well inside it (new code: ~1 ms) | roughly 30 s or more → times out | 2 |

### 5.2 Existing test to change

`vi testing → Should find match Heb 12:10` (test file lines 40–69) currently expects `với thánh` with a `TODO`. Change `expectedText` to `normalizer('sự thánh')` and the assertion to `confidence >= 50 && confidence < 80`; remove the TODO comment. It then duplicates N7 except for the `với` check; keep both. It fails after Step 0 and passes after Step 5. (Open question 6 confirms the new expectation.)

### 5.3 Regression tests — must pass before and after every step

| # | Name | wordList | glPhrase | history | Expected | Prototype |
|---|---|---|---|---|---|---|
| R1 | `regression` → exact GL key and verbatim rendering still score 100 (es) | `para la iglesia de Éfeso` | `'church'` | `{ 'church': {'la iglesia': 7, 'congregación': 2} }` | text `la iglesia`, confidence **exactly 100** | 100 |
| R2 | `regression` → inflected target word through the exact key (hi, made-up) | `सब विश्वासी एक साथ थे` | `'faith'` | `{ 'faith': {'विश्वास': 5} }` | text `विश्वासी`, confidence 75–90 | 90 (current 79: code-unit Levenshtein 0.875 × 90) |
| R3 | `regression` → finds the outer words when the middle word is missing (vi) | `để dự phần vào sự thánh khiết của Ngài` | `'sanctification'` | `{ 'sanctification': {'sự nên thánh': 1} }` | text `sự thánh`, confidence 50–79 | 60 (current 60) |
| R4 | `regression` → fuzzy inflection in a non-Latin script (el, made-up) | `ο θεός αγαπά τους πιστούς` | `'the faithful'` | `{ 'faithful': {'πιστοί': 2} }` | text `πιστούς`, confidence 65–80 | 75 (current 68) |
| R5 | `regression` → keeps finding an adjacent swap of a known rendering (ru-like, made-up) | `и дух святой сошёл` | `'holy spirit'` | `{ 'holy spirit': {'святой дух': 3} }` | text `дух святой`, confidence 80–90 | 85 by hand (current 90, via the order-blind fuzzy pass) |
| existing | `Should find match Heb 9:12`, `Should find match - perfect`, `Should find match - impertect` | as is | | | unchanged assertions | 90, 87, 87 (current 100, 84, 84) |

Note for the two `coming together` tests: the verse has `cuando se reúnan`, so the expected `cuando reúnan` is a gapped fuzzy match; 87 is correct, not a bug.

R5 is the guard for 3.4.6: if Step 5 is done without the adjacent-swap fallback, R5 drops to `святой` at about 50 and fails.

---

## 6. Risks

1. **Performance.** After pooling, the fuzzy pass costs (renderings × rendering words × verse words) Levenshtein calls, e.g. 300 × 3 × 80 ≈ 72 000 short-string comparisons ≈ 10 ms per check, and the request queue may run thousands of checks per book. Mitigations: memoise `wordSimilarity` per (rendering word, verse word) in a `Map` local to one call; pooling already dedupes renderings. The exponential ordered search is removed by Step 2. N9 guards this.
2. **False positives from common words.** (a) A key sharing only `the` still gets relatedness ≈ 0.2 → cap 85, so in a history that mixes concepts an unrelated rendering found verbatim can appear as option 2 at ~85 (N2 shows `la ley` at 85 in second place). In a true per-group translationWords history this cannot happen. (b) If the same algorithm ever runs for translationNotes, a group is a note type, not a concept, and pooling unrelated keys would produce confident nonsense (probe: `the hand of God` with key `walk in the light` → `camina en la luz` at 83). See Open question 1. (c) Target-side fragments of common words are pushed down by 3.4.3/3.4.4 but still returned (N8: `la` at 15).
3. **Loose matching on short words.** Guarded by `MIN_FUZZY_WORD_LENGTH = 4` and `MIN_AFFIX_LENGTH = 6` in NFKD code points. Known residual: tonal or diacritic near-duplicates in long words (`thánh`/`thành` 0.83) are indistinguishable at character level; they can surface only in the fuzzy pass (≤ 90) and only when nothing verbatim scores above 80.
4. **Thresholds are in NFKD code points.** Lengths differ by script (Hangul expands, Chinese does not). Document this next to the constants.
5. **Scriptio continua** target languages produce one token per run (`getWordList`), so nothing here helps them; out of scope.
6. **Shared helpers.** `findBestOrderedMatchPositions` and `fuzzyStringSimilarity` are used by the LLM path; Steps 1–2 must keep their contracts. `__tests__/autoCheckingUtils.test.js` does not cover the LLM path, so rely on the full `npm test` and the equivalence argument in 3.4.1.
7. **Timing test (N9)** depends on the machine; it is bounded by a 10 s jest timeout and the new code needs ~1 ms, so the margin is large, but do not add a tight millisecond assertion.
8. **Docs drift.** `CLAUDE.md` line 44 describes the old lookup (`getPreviousTranslationPartialMatchCounts`, `findClosestFuzzyGlPhrase`, `FUZZY_GL_MATCH_MAX_CONFIDENCE`); Step 6 updates it.
9. **Adjacent-swap fallback on three-word renderings.** With `MAX_UNORDERED_GAP = 1` a word may move across two others (`một nơi thánh` accepted as `nơi thánh một`). Observed in the prototype on the existing Heb 9:12 test: the top result is unchanged (`nơi thánh` 90) but a second option `nơi thánh một` appears at 83. Harmless for ranking; if it is unwanted, restrict the fallback to two-word renderings (Open question 5).

---

## 7. Implementation steps

Each step ends with `npx jest __tests__/autoCheckingUtils.test.js` and `npm run lint`. Commit after each step so a step can be reverted alone. Steps 1, 2 and 4 are independently revertible. Step 3 is the core; Steps 4 and 5 depend on it (they edit `considerCandidate` and the pooled entries). Step 5 depends on Steps 1 and 4 (it uses `wordSimilarity` and `placeWords`).

Test counts used below: 4 existing + 9 new (N1–N9) + 5 regression (R1–R5) = **18** tests in the file after Step 0.

Lint notes from `.eslintrc`: blank line required before `function`, `if`, `for`, `while`, `switch`, `try` and after a `const`/`let` block before a block statement (`padding-line-between-statements`); `curly` always; `brace-style` 1tbs with no single-line blocks; `no-nested-ternary`; `object-curly-newline` with `minProperties: 3`; trailing commas on multiline. Run `npm run lint:fix` first, then fix the rest by hand.

### Step 0 — baseline and tests

1. `npm test` → expect eslint clean, `Tests: 89 passed, 89 total`.
2. Add N1–N9, R1–R5 and the change in 5.2 to `__tests__/autoCheckingUtils.test.js`. Put N1–N5 in `describe('partial GL match')`, N6–N7 in `describe('fuzzy target match')`, N8 in `describe('scoring')`, N9 in `describe('performance')`, R1–R5 in `describe('regression')`. Give N9 a 10 000 ms timeout as the third `test()` argument.
3. `npx jest __tests__/autoCheckingUtils.test.js` → **done when** the output shows exactly these failing: N1, N2, N3, N4, N5, N6, N7, N8, N9 (timeout) and the changed Heb 12:10 test (`Tests: 10 failed, 8 passed, 18 total`), with R1–R5 plus the other three existing tests passing. If a test in the "fail" column passes or one in the "pass" column fails, stop and re-check section 1 before continuing; do not edit the expectation to make it fit.

### Step 1 — code-point Levenshtein and `wordSimilarity`

1. `levenshteinDistance` (1266–1297) and `fuzzyStringSimilarity` (1241–1253): operate on `Array.from(a)`, `Array.from(b)`.
2. Add constants `WORD_FUZZY_THRESHOLD`, `MIN_FUZZY_WORD_LENGTH`, `MIN_AFFIX_LENGTH` and `wordSimilarity` (3.1.1) right after `fuzzyStringSimilarity`. Not yet called anywhere except by a unit of the next steps; to satisfy `no-unused-vars` either add it in Step 3 instead or call it from the Step 1 version of the fuzzy pass (`bestSim = wordSimilarity(...)`, keeping `> 0.5` out: `if (bestPos >= 0 && bestSim > 0)`). Recommended: add it here and switch the existing fuzzy pass at line 1468/1476 to it now, which is a tiny behaviour change covered by N7 (still fails for the ordering reason) and R2/R4.
3. **Done when:** the same 10 tests fail as in Step 0 and the same 8 pass; `npm run lint` clean. Revertible alone.

### Step 2 — polynomial ordered placement

1. Rewrite the body of `findBestOrderedMatchPositions` (1101–1155) per 3.4.1. Keep the signature, the `null` return when a word is absent, ascending positions, and tightest-span/earliest-start selection.
2. **Done when:** N9 passes within the timeout; everything else unchanged from Step 1; lint clean. Revertible alone.

### Step 3 — rank keys, pool renderings, per-rendering caps

1. Add `glWordWeight`, `rankGlKeys(previousTranslationData, glPhrase)` (3.1.2–3.1.5), `poolRenderings` (3.2), `capForRendering` (3.3), and constants `PARTIAL_GL_MATCH_CAP_MIN`, `PARTIAL_GL_MATCH_CAP_MAX`, `FUZZY_TARGET_MAX_CONFIDENCE`, placed where the deleted helpers were.
2. In the main function: replace lines 1349–1357 (`counts`, `glMatchInfo`, `maxConfidence`) with `const ranked = rankGlKeys(...)`, `const pool = poolRenderings(...)`, and `countEntries` built from the pool sorted by count desc. Each entry carries `{ rendering, count, relatedness, isExact }`.
3. `considerCandidate(positions, phraseWordCount, entry)`: compute `confidence` as today, then `confidence = Math.min(confidence, capForRendering(entry))` before the dedupe comparison.
4. Old fuzzy pass (still present until Step 5): iterate the pool, and apply `Math.min(fuzzyConfidence, capForRendering(entry))`.
5. Remove the post-sort cap at line 1524 (return `{ selections, confidence }` as is).
6. Delete the helpers listed in 3.6. Update the JSDoc of the main function per section 4.
7. **Done when:** N1, N2, N3, N4, N5 pass; N6, N7, N8 and the changed Heb 12:10 test still fail (`Tests: 4 failed, 14 passed, 18 total`); R1–R5 and the three other existing tests pass; lint clean (no unused functions). Reverting Step 3 requires reverting Steps 4–5 too.

### Step 4 — scoring fixes for fragments and adjacent swaps

1. `scoreAlgorithmicMatch`: adjacency bonus only when `matchedWordCount >= 2` (3.4.3); add a `matchedWeight` parameter (defaults to `matchedWordCount`) used for the coverage term (3.4.4). Callers in `considerCandidate` pass `Σ 1 / occurrences(word)` when `positions.length < phraseWordCount`, using an occurrence `Map` built once from `normalizedWordList`.
2. Add `placeWords` (3.4.6) with `MAX_UNORDERED_GAP = 1` and `ORDER_PENALTY = 10`, built on the Step 2 ordered placement generalised to take a precomputed `positionsPerWord`. Use it in the per-rendering loop: full rendering first (ordered → swap), then the present-word subsequence (3.4.2), then the existing contiguous-slice loop. `considerCandidate` takes an `inOrder` flag and subtracts `ORDER_PENALTY` (floor 1, ceiling 89) when it is false.
3. **Done when:** N8 passes; R1 still exactly 100; R3 still `sự thánh`; R5 still `дух святой` (now about 85 from the exact-word pass, not 90); N6, N7 and the changed Heb 12:10 test still fail (`Tests: 3 failed, 15 passed, 18 total`); lint clean. Revertible alone (R5 then goes back to 90 via the old fuzzy pass).

### Step 5 — fuzzy target pass

1. Replace the `if (!haveConfidentCandidate)` block (lines 1450–1511 at the base commit; it will have moved) with the pass in 3.4.5, using `wordSimilarity`, `placeWords`, and the cap rules in 3.3. Memoise `wordSimilarity` per call (6.1).
2. **Done when:** N6, N7 and the changed Heb 12:10 test pass; the two `coming together` tests pass (expect 87); R5 still passes (85); `npx jest __tests__/autoCheckingUtils.test.js` → `Tests: 18 passed, 18 total`; lint clean.

### Step 6 — docs and full run

1. Update `CLAUDE.md` line 44 to describe the new lookup: every history key ranked by weighted word overlap, renderings pooled across keys, cap 100 only for exact key + verbatim contiguous, partial keys capped 82–95, adjacent swaps allowed with a 10-point penalty, fuzzy target ≤ 90, ordered placement polynomial. Mention that `plans/algorithm-partial-match.md` holds the rationale.
2. `npm test` → **done when** eslint is clean and all suites pass: `Tests: 103 passed, 103 total` (89 baseline + 14 added). Record the final counts at the top of this file under the baseline line.

---

## 8. Open questions for the author (each with the recommended answer)

1. **Pool keys that share no word with the GL phrase?** The plan pools every key because the history is per translationWords group (section 2). If suggestions can also run for translationNotes, groups there are note types and this would be wrong. *Recommended:* keep pooling; if translationNotes suggestions exist or are planned, add a caller-side switch later (the function signature cannot carry the tool name without breaking interchangeability with the LLM path), or set `PARTIAL_GL_MATCH_CAP_MIN` lower for that tool.
2. **Return a minimum confidence?** Fragments such as `la` at 15 or `của` at 23 are still returned in slots 2–3. *Recommended:* no floor in this change; the host decides what to show. Revisit if the UI shows all three options without their confidence.
3. **GL word weights by length rather than a per-GL stop list?** *Recommended:* length (3.1.3). A per-GL list can be layered on later without changing the structure.
4. **Cap values 82 / 95 / 90.** Chosen so partial verbatim matches stay above the 80 fuzzy gate and below exact gapped matches (max 94). *Recommended:* accept; tell the executor if translationCore auto-applies selections above some confidence, because then 82–95 for partial matches may be too high.
5. **Adjacent-swap window size.** `MAX_UNORDERED_GAP = 1` keeps today's swapped-order behaviour (R5) while dropping far-apart wrong pairings that the current order-blind fuzzy pass accepts. It also lets a word of a three-word rendering move across the other two (risk 9). *Recommended:* keep 1 and allow any rendering length; restrict to two-word renderings only if the extra second-slot options bother users.
6. **New expectation for the existing Heb 12:10 test.** `sự thánh` (confidence 58) replaces `với thánh`. The ideal selection is `sự thánh khiết`, which this 3-key history cannot produce; with the full fixture the function now returns `thánh khiết` at 82 (N5). *Recommended:* accept `sự thánh` for the 3-key test.
7. **Should the recorded `TODO` tests for Vietnamese use the full fixture file everywhere?** *Recommended:* no; keep the small hand-written histories so each test isolates one behaviour, and use the fixture only in N1 and N5.
