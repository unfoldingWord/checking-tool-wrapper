#!/usr/bin/env node
/**
 * Compares two AI runs on the same cases, case by case, for the prompt experiments of
 * plans/improve-single-prompt.md (two prompt variants, or two models).
 *
 * Usage:
 *   scripts/compare-prompt-variants.js CASES.json A.results.json B.results.json
 * e.g.
 *   scripts/compare-prompt-variants.js llmTrainingData/promptEval/dev.json \
 *     llmTrainingData/promptEval/results/dev_qwen3-1.7b_prompt-baseline.results.json \
 *     llmTrainingData/promptEval/results/dev_qwen3-1.7b_prompt-X1.results.json
 *
 * The result files are what `npm run run:llm-training-data` saves (`[{id, result, elapsedMs}]`).
 * Answers are scored as the app shows them: when the AI gave no option, the algorithm's answer is
 * used, from `<folder of CASES>/results/<CASES name>_Algorithm.results.json` (run the algorithm on
 * the case file first). Answers are compared as `summarizeTestResults` compares them
 * (`normalizer`, lowercase, an `:n` suffix for an occurrence above 1).
 *
 * Prints, for A and B: cases, top-1, top-3, wrong at confidence >= 80, AI answers with no option,
 * mean confidence of right and of wrong top answers, median time; then the paired counts (right
 * only in A, right only in B) with an exact two-sided McNemar p.
 *
 * Then the span breakdown of plans/prompt-span-experiments.md (Step 1): each wrong top answer is
 * too short (its words are some of the expected words), too long (it has every expected word and
 * more), the right words at the wrong occurrence, a partial overlap, other words, or no answer
 * (the AI gave no option). Words are compared after `normalizePhrase`, without `:n` suffixes,
 * counting repeated words. Last, top-1 split by the GL phrase's word count (one word, more than
 * one), with the paired counts and McNemar p for each group.
 */
const fs = require('fs');
const path = require('path');
const { normalizer } = require('string-punctuation-tokenizer');

/** an answer at this confidence or more counts as confident (as in the suitability suite) */
const CONFIDENT = 80;

/**
 * @param {string} file
 * @returns {*} parsed JSON
 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * @param {string} [phrase]
 * @returns {string} normalized for comparing answers
 */
function normalizePhrase(phrase) {
  return normalizer(phrase || '').toLowerCase().trim();
}

/**
 * @param {object} option - `{selections: [{text, occurrence}], confidence}`
 * @returns {string} the words, with `:n` after a word whose occurrence is above 1
 */
function optionText(option) {
  return (option?.selections || [])
    .map(({ text, occurrence }) => (occurrence > 1 ? `${text}:${occurrence}` : text))
    .join(' ');
}

/** the kinds of wrong top answer, in the order they are printed */
const SPAN_CATEGORIES = ['tooShort', 'tooLong', 'wrongOccurrence', 'partial', 'other', 'noAnswer'];

const SPAN_LABELS = {
  tooShort: 'too short',
  tooLong: 'too long',
  wrongOccurrence: 'wrong occurrence',
  partial: 'partial overlap',
  other: 'other words',
  noAnswer: 'no answer',
};

/**
 * @param {string} [phrase] - may have `:n` occurrence suffixes
 * @returns {Array<string>} its normalized words, without the suffixes
 */
function phraseWords(phrase) {
  return normalizePhrase((phrase || '').replace(/:\d+(?=\s|$)/g, '')).split(/\s+/).filter(Boolean);
}

/**
 * @param {Array<string>} part
 * @param {Array<string>} whole
 * @returns {number} how many words of `part` are in `whole`, each word of `whole` used once
 */
function sharedWordCount(part, whole) {
  const left = new Map();

  whole.forEach(word => left.set(word, (left.get(word) || 0) + 1));
  return part.filter(word => {
    if (!left.get(word)) {
      return false;
    }
    left.set(word, left.get(word) - 1);
    return true;
  }).length;
}

/**
 * Sorts a wrong top answer by how it differs from the expected answer. Each expected answer is
 * tried, and the closest kind wins (in the order of {@link SPAN_CATEGORIES}).
 * @param {object|undefined} option - the top answer shown, `{selections, confidence}`
 * @param {Array<string>} expected - the case's expected answers
 * @param {boolean} aiEmpty - the AI gave no option
 * @returns {string} one of {@link SPAN_CATEGORIES}
 */
function classifySpan(option, expected, aiEmpty) {
  if (aiEmpty || !option) {
    return 'noAnswer';
  }

  const answer = (option.selections || []).flatMap(({ text }) => phraseWords(text));
  const kinds = (expected || []).map(phrase => {
    const want = phraseWords(phrase);
    const shared = sharedWordCount(answer, want);

    if (answer.join(' ') === want.join(' ')) {
      return 'wrongOccurrence';
    }

    if (shared === want.length && answer.length > want.length) {
      return 'tooLong';
    }

    if (shared === answer.length && want.length > answer.length) {
      return 'tooShort';
    }
    return shared ? 'partial' : 'other';
  });
  const best = ['wrongOccurrence', 'tooShort', 'tooLong', 'partial']
    .find(kind => kinds.includes(kind));

  return best || 'other';
}

/**
 * Scores every case of a run as the app shows it.
 * @param {Array<object>} cases - the case file
 * @param {Array<object>} results - the run
 * @param {Map<string, object>} algorithmById - algorithm results by case id
 * @returns {Array<{id: string, right: boolean, top3: boolean, confidence: number|null,
 *   aiEmpty: boolean, ms: number, span: string|null, glWords: number}|null>} - one per case, null
 *   when the run has no result for it; `span` is the kind of wrong answer ({@link classifySpan}),
 *   null when right, and `glWords` the GL phrase's word count
 */
function scoreRun(cases, results, algorithmById) {
  const resultById = new Map(results.map(item => [item.id, item]));

  return cases.map(testCase => {
    const item = resultById.get(testCase.id);

    if (!item) {
      return null;
    }

    const expected = (testCase.expected || []).map(normalizePhrase);
    const isRight = option => !!option && expected.includes(normalizePhrase(optionText(option)));
    let options = item.result?.bestSelections || [];
    const aiEmpty = !item.result?.algorithmFirst && !options.length;

    if (aiEmpty) { // the app falls back to the algorithm (`algorithmFallback`)
      options = algorithmById.get(testCase.id)?.bestSelections || [];
    }

    const right = isRight(options[0]);

    return {
      id: testCase.id,
      right,
      top3: options.slice(0, 3).some(isRight),
      confidence: options[0] ? options[0].confidence : null,
      aiEmpty,
      ms: item.elapsedMs || 0,
      span: right ? null : classifySpan(options[0], testCase.expected, aiEmpty),
      glWords: phraseWords(testCase.glPhrase).length,
    };
  });
}

/**
 * @param {Array<number>} values
 * @returns {number} the median, 0 for none
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (!sorted.length) {
    return 0;
  }
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * @param {Array<number>} values
 * @returns {string} the mean with one decimal, '-' for none
 */
function meanText(values) {
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '-';
}

/**
 * Exact two-sided McNemar test (binomial on the discordant pairs).
 * @param {number} onlyA - cases right only in A
 * @param {number} onlyB - cases right only in B
 * @returns {number} p
 */
function mcnemarP(onlyA, onlyB) {
  const n = onlyA + onlyB;
  const k = Math.min(onlyA, onlyB);
  // each term C(n, i) / 2^n in log space: 2^n and C(n, i) overflow a double above n = 1023
  let logTerm = -n * Math.LN2;
  let tail = 0;

  for (let i = 0; i <= k; i++) {
    tail += Math.exp(logTerm);
    logTerm += Math.log(n - i) - Math.log(i + 1);
  }
  return Math.min(1, 2 * tail);
}

/**
 * @param {Array<object>} scores - from {@link scoreRun}, without nulls
 * @returns {object} the metrics printed for one run
 */
function summarize(scores) {
  const count = predicate => scores.filter(predicate).length;
  const confidences = right => scores.filter(s => s.right === right && s.confidence !== null).map(s => s.confidence);

  return {
    cases: scores.length,
    top1: count(s => s.right),
    top3: count(s => s.top3),
    confidentWrong: count(s => !s.right && s.confidence !== null && s.confidence >= CONFIDENT),
    aiEmpty: count(s => s.aiEmpty),
    meanConfidenceRight: meanText(confidences(true)),
    meanConfidenceWrong: meanText(confidences(false)),
    medianMs: Math.round(median(scores.map(s => s.ms))),
  };
}

/**
 * @param {Array<object>} scores - from {@link scoreRun}, without nulls
 * @returns {object} how many wrong top answers of each kind, by {@link SPAN_CATEGORIES}
 */
function spanBreakdown(scores) {
  const counts = Object.fromEntries(SPAN_CATEGORIES.map(kind => [kind, 0]));

  scores.forEach(({ span }) => {
    if (span) {
      counts[span]++;
    }
  });
  return counts;
}

/**
 * @param {Array<Array<object>>} rows - table rows, `[name, ...cells]`
 * @returns {string} the rows, names left-aligned and cells right-aligned
 */
function formatTable(rows) {
  const width = Math.max(...rows.map(([name]) => String(name).length));
  const column = Math.max(12, ...rows.flatMap(([, ...cells]) => cells.map(cell => String(cell).length)));

  return rows.map(([name, ...cells]) =>
    [String(name).padEnd(width), ...cells.map(cell => String(cell).padStart(column))].join('  ')).join('\n');
}

/**
 * @param {Array<Array<object>>} paired - `[score A, score B]` per case
 * @returns {{onlyA: number, onlyB: number, p: number}} the paired counts and McNemar p
 */
function pairedCounts(paired) {
  const onlyA = paired.filter(([x, y]) => x.right && !y.right).length;
  const onlyB = paired.filter(([x, y]) => !x.right && y.right).length;

  return {
    onlyA, onlyB, p: mcnemarP(onlyA, onlyB),
  };
}

function main() {
  const [casesFile, fileA, fileB] = process.argv.slice(2);

  if (!casesFile || !fileA || !fileB || process.argv.includes('-h')) {
    console.log('usage: scripts/compare-prompt-variants.js CASES.json A.results.json B.results.json');
    process.exit(casesFile ? 0 : 2);
  }

  const cases = readJson(casesFile);
  const algorithmFile = path.join(path.dirname(casesFile), 'results',
    `${path.basename(casesFile, '.json')}_Algorithm.results.json`);

  if (!fs.existsSync(algorithmFile)) {
    console.error(`algorithm results not found: ${algorithmFile}\nrun the algorithm on ${casesFile} first`);
    process.exit(2);
  }

  const algorithmById = new Map(readJson(algorithmFile).map(item => [item.id, item.result]));
  const scoresA = scoreRun(cases, readJson(fileA), algorithmById);
  const scoresB = scoreRun(cases, readJson(fileB), algorithmById);
  // only cases both runs answered are compared
  const paired = scoresA.map((a, i) => [a, scoresB[i]]).filter(([a, b]) => a && b);
  const missing = cases.length - paired.length;
  const a = summarize(paired.map(([x]) => x));
  const b = summarize(paired.map(([, y]) => y));
  const {
    onlyA, onlyB, p,
  } = pairedCounts(paired);
  const pct = (value, total) => (total ? `${((100 * value) / total).toFixed(1)}%` : '-');
  const rows = [
    ['cases', a.cases, b.cases],
    ['top-1', `${a.top1} (${pct(a.top1, a.cases)})`, `${b.top1} (${pct(b.top1, b.cases)})`],
    ['top-3', `${a.top3} (${pct(a.top3, a.cases)})`, `${b.top3} (${pct(b.top3, b.cases)})`],
    [`wrong at >= ${CONFIDENT}`, a.confidentWrong, b.confidentWrong],
    ['AI gave no option', a.aiEmpty, b.aiEmpty],
    ['mean confidence, right', a.meanConfidenceRight, b.meanConfidenceRight],
    ['mean confidence, wrong', a.meanConfidenceWrong, b.meanConfidenceWrong],
    ['median ms', a.medianMs, b.medianMs],
  ];
  const spanA = spanBreakdown(paired.map(([x]) => x));
  const spanB = spanBreakdown(paired.map(([, y]) => y));
  const groups = [['GL phrase of 1 word', 1], ['GL phrase of 2+ words', 2]].map(([name, size]) => {
    const inGroup = paired.filter(([x]) => (size === 1 ? x.glWords <= 1 : x.glWords > 1));
    const right = side => inGroup.filter(pair => pair[side].right).length;

    return {
      name, total: inGroup.length, rightA: right(0), rightB: right(1), ...pairedCounts(inGroup),
    };
  });

  console.log(`A: ${fileA}\nB: ${fileB}`);

  if (missing) {
    console.log(`${missing} case(s) missing from A or B are left out`);
  }
  console.log(formatTable([['', 'A', 'B'], ...rows]));
  console.log(`paired: right only in A ${onlyA}, right only in B ${onlyB}, McNemar p ${p.toPrecision(2)}`);
  console.log('\nwrong top answers by kind');
  console.log(formatTable([['', 'A', 'B'],
    ...SPAN_CATEGORIES.map(kind => [SPAN_LABELS[kind], spanA[kind], spanB[kind]])]));
  console.log('\ntop-1 by GL phrase length');
  console.log(formatTable([['', 'cases', 'A', 'B', 'only A', 'only B', 'McNemar p'],
    ...groups.map(group => [group.name, group.total,
      `${group.rightA} (${pct(group.rightA, group.total)})`, `${group.rightB} (${pct(group.rightB, group.total)})`,
      group.onlyA, group.onlyB, group.p.toPrecision(2)])]));
}

if (require.main === module) {
  main();
}

module.exports = {
  classifySpan, mcnemarP, normalizePhrase, optionText, pairedCounts, phraseWords, scoreRun,
  SPAN_CATEGORIES, spanBreakdown, summarize,
};
