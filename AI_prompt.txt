Write a plan for improving `getBestTWordSelectionWithConfidenceAlgorithm()` in
`src/utils/autoCheckingUtils.js`. Deliver the plan only. Do not change any code yet.

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

Publish the plan as Markdown at
`plans/algorithm-partial-match.md` so the executor can read it from the repo.

## Background

This function suggests which word(s) in a target-language verse translate a
gateway-language (GL) phrase for a translationWords check. It does not call a model.
Its only evidence is how translators rendered GL phrases in earlier checks.

## Languages involved

- The gateway language is a widely used language, such as English, French, Hindi or
  Latin American Spanish. GL-specific knowledge (like a list of common words) is
  possible, but the code must not assume English.
- The target language can be any language a community speaks, including ones with
  little or no published linguistic data. Plan for this:
  - No built-in word lists, stemmers or dictionaries for the target language. Anything
    "common word" or morphology-related has to come from the data itself, such as how
    often a word shows up across all history renderings.
  - Words may be compound or heavily inflected. One GL word may match part of a target
    word, and one target word may cover several GL words. A history rendering may show up
    in the verse with a different prefix or suffix.
  - Word order can differ from the GL and can vary between verses, so ordered matching
    may be wrong.
  - Scripts vary (non-Latin, combining marks). Character-level similarity such as
    Levenshtein should work on normalized Unicode, and the thresholds should hold up
    for short words.

Inputs:
- `wordList`: the target-language verse split into words (from `getWordList(verseText)`).
- `glPhrase`: the `alignedGLText` for the current check, in the gateway language (e.g. 'by faith').
- `previousTranslationData`: comes from `fetchPreviousSelectionData()`, shaped
  `{ normalizedGlPhrase: { targetLanguageSelection: count } }`,
  e.g. `{ 'faith': { 'fe': 12, 'la fe': 3 }, 'by faith': { 'por la fe': 4 } }`.
  Outer keys are GL text. Inner keys are target-language text.

How it works now:
1. It looks up an exact GL key with `getPreviousTranslationExactMatchCounts`. If none is
   found, it uses `getPreviousTranslationPartialMatchCounts`.
2. For each previous rendering, it searches the verse for: a contiguous match (confidence 100),
   then an ordered match with gaps, then the best ordered sub-phrase.
3. If no candidate scores above 80, it falls back to Levenshtein fuzzy matching
   word by word.
4. It returns up to 3 `{ selections: [{text, occurrence}], confidence }`, sorted best first.

## The problem

When `glPhrase` has no exact key in the history but related history exists, the
function does a poor job of finding the best partial match, even though the correct
target words are probably in the verse. Improve this case.

Things I have noticed. Check each one against the code before relying on it:
- `getPreviousTranslationPartialMatchCounts` returns the *first* key that shares *any one*
  word with `glPhrase`. That word can be a function word such as 'the' or 'of'. It uses only
  that one key, and it does not rank keys by how much they overlap.
- Renderings found through a partial GL match are scored the same way as exact GL matches.
  This means they can reach confidence 100.
- The fuzzy fallback picks the best verse position for each word on its own, with no
  ordering or adjacency check. It also runs only when no candidate is above 80.

## What the plan should cover

1. Diagnosis: confirm or correct the observations above, and list any other weaknesses
   in the partial-match and fuzzy paths. Cite line numbers.
2. Proposed approach for partial GL matching. For example:
   - rank GL keys by word overlap, down-weighting common GL words (decide whether the
     weights come from history frequency or from a per-GL list)
   - pool renderings from several related keys
   - check which rendering words actually appear in the verse
   - lower the confidence of anything reached through a partial GL match
   - match target words by shared prefix/suffix or substring so compound and
     inflected forms still match
   Explain the trade-offs and recommend one approach. For each idea, say whether it
   still works for a target language unlike the GL (see "Languages involved").
3. Confidence rules: keep 100 for "exact GL key and verbatim contiguous match in the verse".
   State how partial and fuzzy matches are capped and ordered relative to each other.
4. Test cases to add to `__tests__/autoCheckingUtils.test.js`. Give concrete
   `wordList` / `glPhrase` / history inputs and the expected top result. Include:
   - cases where the current code picks the wrong match
   - regression cases that must not change
   - at least one target language that is not Latin-script and one with compound or
     inflected words (made-up data is fine if you label it)
5. Risks: performance on long verses and large histories (the current ordered search is
   exponential in the worst case), false positives from common words, and false
   positives from loose substring matching on short words.
6. Implementation steps, in order:
   - Step 0: run `npm test` and record the baseline. Add the new test cases first and
     confirm which ones fail on the current code.
   - Then one step per change, each ending with `npx jest __tests__/autoCheckingUtils.test.js`
     passing and `npm run lint` clean.
   - Last step: full `npm test`.
   Note which steps could be reverted on their own if a later step fails.
7. Open questions for the author, each with your recommended answer.

## Constraints

- Keep the signature and return shape. The function must stay interchangeable with
  `getBestTWordSelectionWithConfidenceFromLlm`.
- No network calls and no new dependencies.
- Keep the change inside `autoCheckingUtils.js`. `npm test` (eslint + jest) must pass.

## References

./CLAUDE.md
