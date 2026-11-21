/* eslint-env jest */
/**
 * Measures AI suggestion confidences against the history-based score (plans/algorithm-confidence.md,
 * Step 5b). Reads saved AI results (`results/<file>_<model>.results.json`, from
 * `npm run run:llm-training-data` with a model) and rescores every AI option with
 * `scoreSelectionsFromHistory`, then compares, per split: AUC, ECE and Brier score of the AI's own
 * confidence and of the history-based one, and top-1 when the AI's options are re-ordered by it.
 * Options that match no history rendering get no history-based score; how to score them is measured too.
 * Cases answered by the algorithm (`algorithmFirst`) or with no AI option are left out.
 *
 * Skipped unless `LLM_ALGO_AI_MODEL` is set; run with
 *   LLM_ALGO_AI_MODEL=uw-tw-qwen3-1.7b-d3-broad LLM_ALGO_DATA_DIR=llmTrainingData/finetune-d3-broad/heldout \
 *     npx jest __tests__/calibrateAiConfidence.test.js
 *
 * Environment variables:
 *   LLM_ALGO_AI_MODEL         model name in the results file names (required to run)
 *   LLM_ALGO_DATA_DIR         folder with the case files and their `results/` (default llmTrainingData)
 *   LLM_ALGO_FIT_PROJECTS     projects whose cases choose the weights, space-separated, `*` allowed; the
 *                             rest check them (default: the broader test's six added projects)
 */
import fs from 'fs';
import path from 'path';
import {
  getBestSelections, getWordList, scoreSelectionsFromHistory,
} from '../src/utils/checkingSuggestionsUtils';
import { mergeBestSelections } from '../src/utils/LlmRequestQueue';
import {
  normalizePhrase, optionText, testCaseToSelectionOptions,
} from './helpers/suggestionsHelpers';
import {
  areaUnderCurve, brierScore, expectedCalibrationError, matchesProject, projectOfFile,
} from './helpers/algorithmCalibrationHelpers';

const env = process.env;
const MODEL = env.LLM_ALGO_AI_MODEL;
const DATA_DIR = path.resolve(__dirname, '..', env.LLM_ALGO_DATA_DIR || 'llmTrainingData');
const FIT_PROJECTS = (env.LLM_ALGO_FIT_PROJECTS || 'vi_glt_heb ru_rlob_luk te_glt_luk ar_avd_heb fa_glt_jas id_glt_1ti')
  .split(/\s+/).filter(Boolean);
const EXTRA_WORD_FACTORS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
/** how an option with no history match is scored: keep the AI's confidence, or a fixed value */
const NO_MATCH = ['ai', 1, 20, 35, 50, 'cap35', 'cap50', 'cap60'];

(MODEL ? describe : describe.skip)('AI confidences against the history-based score', () => {
  test('rescores the saved AI options', async () => {
    const files = fs.readdirSync(DATA_DIR).filter(name => name.endsWith('.json')).sort();
    const options = []; // one per AI option: { split, caseKey, rank, ai, scores: {extraWordFactor: confidence|null}, right }
    const algorithmByCase = new Map(); // the algorithm's options for each case, as the app merges them in

    for (const file of files) {
      const base = file.replace(/\.json$/, '');
      const resultsPath = path.join(DATA_DIR, 'results', `${base}_${MODEL.replace(/\//g, '-')}.results.json`);

      if (!fs.existsSync(resultsPath)) {
        continue;
      }

      const split = matchesProject(projectOfFile(base), FIT_PROJECTS) ? 'fit' : 'check';
      const cases = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

      for (const [i, testCase] of cases.entries()) {
        const result = results[i]?.result;

        if (!testCase.expected?.length || !result || result.algorithmFirst || !result.bestSelections?.length) {
          continue;
        }

        const wordList = getWordList(testCase.verse);
        const expected = testCase.expected.map(normalizePhrase);
        // eslint-disable-next-line no-await-in-loop
        const [algorithm] = await getBestSelections(testCaseToSelectionOptions(testCase));

        algorithmByCase.set(`${base}|${i}`, {
          split, expected, options: algorithm?.bestSelections || [],
        });

        result.bestSelections.forEach((option, rank) => {
          const scores = {};

          for (const extraWordFactor of EXTRA_WORD_FACTORS) {
            scores[extraWordFactor] = scoreSelectionsFromHistory(wordList, option.selections, testCase.glPhrase,
              testCase.glLang, testCase.history || {}, { extraWordFactor })?.confidence ?? null;
          }
          options.push({
            split, caseKey: `${base}|${i}`, rank, ai: option.confidence, scores, selections: option.selections,
            right: expected.includes(normalizePhrase(optionText(option))),
          });
        });
      }
    }

    const lines = [`model ${MODEL}, ${options.length} AI options; fit projects: ${FIT_PROJECTS.join(' ')}`];

    const describeRows = (rows, conf) => {
      const scored = rows.map(row => ({ confidence: conf(row), right: row.right }));
      const byCase = new Map();

      for (const row of rows) {
        byCase.set(row.caseKey, [...(byCase.get(row.caseKey) || []), row]);
      }

      // top-1 when the case's AI options are ordered by this confidence (ties keep the AI's order)
      let top1 = 0;

      for (const list of byCase.values()) {
        top1 += [...list].sort((a, b) => conf(b) - conf(a) || a.rank - b.rank)[0].right ? 1 : 0;
      }
      return `AUC ${areaUnderCurve(scored).toFixed(3)}  ECE ${expectedCalibrationError(scored).toFixed(1).padStart(5)}`
        + `  Brier ${brierScore(scored).toFixed(3)}  top-1 ${top1} of ${byCase.size}`;
    };

    for (const split of ['fit', 'check']) {
      const rows = options.filter(row => row.split === split);
      const noMatch = rows.filter(row => row.scores[1] === null);

      lines.push('', `== ${split}: ${rows.length} options, ${noMatch.length} with no history match `
        + `(right ${(100 * noMatch.filter(row => row.right).length / (noMatch.length || 1)).toFixed(1)}%)`);
      lines.push(`AI confidence                       ${describeRows(rows, row => row.ai)}`);

      for (const extraWordFactor of EXTRA_WORD_FACTORS) {
        for (const noMatchScore of NO_MATCH) {
          const noMatchConf = row => {
            if (noMatchScore === 'ai') {
              return row.ai;
            }
            return String(noMatchScore).startsWith('cap') ? Math.min(row.ai, Number(noMatchScore.slice(3))) : noMatchScore;
          };

          const conf = row => row.scores[extraWordFactor] ?? noMatchConf(row);
          lines.push(`extra ${String(extraWordFactor).padEnd(3)} no match ${String(noMatchScore).padEnd(3)}           ${describeRows(rows, conf)}`);
        }
      }
    }

    // what the app shows first in AI mode: the AI's and the algorithm's options merged by confidence
    const variants = {
      'AI confidence': row => row.ai,
      'history 0.7, no match = AI': row => row.scores[0.7] ?? row.ai,
      'history 0.7, no match = AI capped 50': row => row.scores[0.7] ?? Math.min(row.ai, 50),
      'history 0.7, no match = 35': row => row.scores[0.7] ?? 35,
    };
    lines.push('', 'Merged with the algorithm (mergeBestSelections): first suggestion right, and how often it is the AI\'s');

    const rightByVariant = {}; // `${split}|${name}` -> Map(caseKey -> right), for the paired test

    for (const split of ['fit', 'check']) {
      for (const [name, conf] of Object.entries(variants)) {
        const perCase = new Map();
        rightByVariant[`${split}|${name}`] = perCase;
        let right = 0;
        let fromAi = 0;
        let cases = 0;

        for (const [caseKey, algorithm] of algorithmByCase) {
          if (algorithm.split !== split) {
            continue;
          }

          const aiOptions = options.filter(row => row.caseKey === caseKey)
            .map(row => ({ selections: row.selections, confidence: conf(row) }));
          const [first] = mergeBestSelections(aiOptions, algorithm.options.map(option => ({ ...option, isAlgorithmSuggestion: true })));
          cases++;
          const isRight = !!first && algorithm.expected.includes(normalizePhrase(optionText(first)));
          perCase.set(caseKey, isRight);
          right += isRight ? 1 : 0;
          fromAi += first && !first.isAlgorithmSuggestion ? 1 : 0;
        }
        lines.push(`${split.padEnd(6)} ${name.padEnd(40)} right ${right} of ${cases} (${(100 * right / cases).toFixed(1)}%), AI's first ${fromAi}`);
      }
    }

    // paired exact McNemar test of each history variant against the AI's own confidence
    lines.push('', 'Paired against "AI confidence" (cases right only with the AI\'s / only with the variant, two-sided exact p)');

    for (const split of ['fit', 'check']) {
      const base = rightByVariant[`${split}|AI confidence`];

      for (const name of Object.keys(variants).slice(1)) {
        const other = rightByVariant[`${split}|${name}`];
        let onlyAi = 0;
        let onlyOther = 0;

        for (const [caseKey, isRight] of base) {
          onlyAi += isRight && !other.get(caseKey) ? 1 : 0;
          onlyOther += !isRight && other.get(caseKey) ? 1 : 0;
        }

        const n = onlyAi + onlyOther;
        const k = Math.min(onlyAi, onlyOther);
        let tail = 0;
        let term = 0.5 ** n; // C(n, 0) / 2^n

        for (let i = 0; i <= k; i++) {
          tail += term;
          term = term * (n - i) / (i + 1);
        }
        lines.push(`${split.padEnd(6)} ${name.padEnd(40)} ${onlyAi} / ${onlyOther}  p ${Math.min(1, 2 * tail).toExponential(1)}`);
      }
    }

    console.log(lines.join('\n'));
    expect(options.length).toBeGreaterThan(0);
  });
});
