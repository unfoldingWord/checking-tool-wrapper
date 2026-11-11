#!/usr/bin/env node
/**
 * Compares the models tested in the last scripts/test-llm.sh run, side by side.
 *
 * Usage:
 *   scripts/compare-llm-runs.js                   # last run in llm-eval-results
 *   scripts/compare-llm-runs.js DIR               # last run in DIR, e.g. llm-eval-results/temperatures-.../t0.3
 *   scripts/compare-llm-runs.js DIR STAMP         # a given run, e.g. llm-eval-results 20261109-165617
 *   scripts/compare-llm-runs.js -c ...            # also show how each model did on each case
 *
 * scripts/test-llm.sh names each model's results `<STAMP>-<model>.json`, with the same STAMP
 * (date-time) for every model in one run; the newest STAMP in DIR is the last run.
 *
 * Prints one column per model:
 *   - settings (temperature, runs, grouping)
 *   - single-request accuracy, consistency and speed
 *   - batched accuracy, consistency and speed, and how batching compares
 *   - the bars each model failed (the same limits the tests use)
 * With -c, also one row per case showing how many runs had the expected top answer.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const showCases = args.includes('-c');
const [dir = 'llm-eval-results', stampArg] = args.filter(arg => arg !== '-c');

if (args.includes('-h')) {
  const source = fs.readFileSync(__filename, 'utf8');
  console.log(source.slice(source.indexOf('/**') + 3, source.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}

const STAMPED = /^(\d{8}-\d{6})-.+\.json$/;
let files;

try {
  files = fs.readdirSync(dir).filter(name => STAMPED.test(name));
} catch (error) {
  console.error(`Cannot read ${dir}: ${error.message}`);
  process.exit(2);
}

const stamps = [...new Set(files.map(name => name.match(STAMPED)[1]))].sort();
const stamp = stampArg || stamps[stamps.length - 1];

if (!stamp || !stamps.includes(stamp)) {
  console.error(stampArg ? `No results with stamp ${stampArg} in ${dir}. Stamps found: ${stamps.join(', ') || '(none)'}` :
    `No results found in ${dir}`);
  process.exit(2);
}

const runs = files.filter(name => name.startsWith(`${stamp}-`)).sort()
  .map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
  .filter(run => run.summary);

if (!runs.length) {
  console.error(`The results for ${stamp} in ${dir} have no summary (did the run finish?)`);
  process.exit(2);
}

const has = value => value !== undefined && value !== null;
const percent = share => (has(share) ? `${Math.round(share * 100)}%` : '-');
const points = share => (has(share) ? `${share >= 0 ? '+' : ''}${Math.round(share * 100)}` : '-');
const ms = value => (has(value) ? `${value}` : '-');
const signed = value => (has(value) ? `${value >= 0 ? '+' : ''}${value}` : '-');

/** the limits a run missed; the same checks as the tests */
function failedBars(run) {
  const s = run.summary;
  const t = run.thresholds || {};
  const failed = [
    !(s.top1 >= t.minTop1) && 'top-1',
    !(s.confidentlyWrong <= t.maxConfidentWrong) && 'wrong>=80',
    !(s.format >= t.minFormat) && 'format',
    !(s.medianMs <= t.maxMedianMs) && 'median ms',
    has(s.batchTop1) && !(s.batchTop1 >= s.top1 - t.maxBatchTop1Drop) && 'batch top-1',
  ].filter(Boolean);
  return failed.length ? failed.join(', ') : 'none';
}

// [label, value for a run]; a label alone starts a section
const ROWS = [
  ['settings'],
  ['temperature', run => `${run.temperature}`],
  ['extra params', run => (run.extraParams ? JSON.stringify(run.extraParams) : '-')],
  ['runs x cases', run => `${run.runs} x ${run.summary.answers / run.runs}`],
  ['cases', run => run.caseSet || 'all'],
  ['grouping', run => `${run.grouping}`],
  ['single requests'],
  ['top-1', run => percent(run.summary.top1)],
  ['top-3', run => percent(run.summary.top3)],
  ['top-1 per run', run => (run.summary.top1PerRun || []).join(',') || '-'],
  ['top-1 hand-written', run => percent(run.summary.handTop1)],
  ['top-1 real projects', run => percent(run.summary.realTop1)],
  ['user-visible top-1', run => percent(run.summary.userTop1)],
  ['F1', run => (has(run.summary.f1) ? run.summary.f1.toFixed(2) : '-')],
  ['empty (answers)', run => (has(run.summary.empty) ? `${run.summary.empty}` : '-')],
  ['algorithm-certain, AI skipped', run => (has(run.summary.skipped) ? `${run.summary.skipped}` : '-')],
  ['wrong at >=80', run => percent(run.summary.confidentlyWrong)],
  ['consistency', run => percent(run.summary.consistency)],
  ['errors', run => percent(run.summary.errors)],
  ['CSV format', run => percent(run.summary.format)],
  ['avg ms per suggestion', run => ms(run.summary.avgMsPerAnswer)],
  ['median ms', run => ms(run.summary.medianMs)],
  ['first request ms', run => ms(run.summary.warmUpMs)],
  ['prompt tokens per sugg.', run => ms(run.summary.promptTokensPerAnswer)],
  ['answer tokens per sugg.', run => ms(run.summary.completionTokensPerAnswer)],
  ['batched requests'],
  ['top-1', run => percent(run.summary.batchTop1)],
  ['top-3', run => percent(run.summary.batchTop3)],
  ['top-1 per run', run => (run.summary.batchTop1PerRun || []).join(',') || '-'],
  ['user-visible top-1', run => percent(run.summary.batchUserTop1)],
  ['F1', run => (has(run.summary.batchF1) ? run.summary.batchF1.toFixed(2) : '-')],
  ['empty (answers)', run => (has(run.summary.batchEmpty) ? `${run.summary.batchEmpty}` : '-')],
  ['wrong at >=80', run => percent(run.summary.batchConfidentlyWrong)],
  ['consistency', run => percent(run.summary.batchConsistency)],
  ['errors', run => percent(run.summary.batchErrors)],
  ['avg ms per suggestion', run => ms(run.summary.batchAvgMsPerAnswer)],
  ['median ms per sugg.', run => ms(run.summary.batchMedianMsPerAnswer)],
  ['median ms per query', run => ms(run.summary.batchMedianMsPerQuery)],
  ['prompt tokens per sugg.', run => ms(run.summary.batchPromptTokensPerAnswer)],
  ['batch minus single'],
  ['top-1 (points)', run => points(run.summary.batchVsSingle?.top1)],
  ['wrong at >=80 (points)', run => points(run.summary.batchVsSingle?.confidentlyWrong)],
  ['avg ms per suggestion', run => signed(run.summary.batchVsSingle?.avgMsPerAnswer)],
  ['speed (x as fast)', run => (has(run.summary.batchVsSingle?.speedup) ? run.summary.batchVsSingle.speedup.toFixed(2) : '-')],
  ['algorithm alone'],
  ['top-1', run => percent(run.summary.algorithmTop1)],
  ['result'],
  ['failed bars', failedBars],
];

function printTable(header, rows) {
  const widths = header.map((_, i) => Math.max(...[header, ...rows].map(row => (row[i] || '').length)));
  const line = row => row.map((cell, i) => (i ? (cell || '').padStart(widths[i]) : (cell || '').padEnd(widths[i])))
    .join('  ').trimEnd();

  console.log(line(header));
  console.log(widths.map(width => '-'.repeat(width)).join('  '));
  rows.forEach(row => console.log(line(row)));
}

const models = runs.map(run => run.model);
const urls = [...new Set(runs.map(run => run.url))];

console.log(`Run ${stamp} in ${dir}: ${runs.length} model(s) at ${urls.join(', ')}\n`);
printTable(['', ...models], ROWS.map(([label, getValue]) =>
  (getValue ? [`  ${label}`, ...runs.map(getValue)] : [label, ...runs.map(() => '')])));

// best value per measure, to make the comparison quicker to read
if (runs.length > 1) {
  const best = (label, getValue, higherIsBetter) => {
    const scored = runs.filter(run => has(getValue(run)));

    if (scored.length) {
      const top = scored.reduce((a, b) => ((getValue(b) > getValue(a)) === higherIsBetter ? b : a));
      console.log(`  ${label.padEnd(26)}${top.model}`);
    }
  };

  console.log('\nbest:');
  best('single top-1', run => run.summary.top1, true);
  best('single wrong at >=80', run => run.summary.confidentlyWrong, false);
  best('single avg ms per sugg.', run => run.summary.avgMsPerAnswer, false);
  best('batched top-1', run => run.summary.batchTop1, true);
  best('batched avg ms per sugg.', run => run.summary.batchAvgMsPerAnswer, false);
}

if (showCases) {
  // per case: how many runs had the expected top answer, single / batched
  const ids = [...new Set(runs.flatMap(run => run.single.map(result => result.id)))];

  const tally = (results, id) => {
    const forCase = (results || []).filter(result => result.id === id);
    return forCase.length ? `${forCase.filter(result => result.top1).length}/${forCase.length}` : '-';
  };

  console.log('\ntop-1 per case (single  batched; runs with the expected answer):\n');
  printTable(['case', ...models], ids.map(id => [
    id, ...runs.map(run => `${tally(run.single, id).padStart(3)}  ${tally(run.batch, id).padStart(3)}`),
  ]));
}
