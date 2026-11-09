#!/usr/bin/env bash
#
# Runs scripts/test-llm.sh once per temperature, from 0.1 to 0.8 in steps of 0.1, and prints a
# table comparing the temperatures for each model.
#
# Usage:
#   scripts/test-llm-temperatures.sh [test-llm.sh options] model [model ...]
#
# Examples:
#   scripts/test-llm-temperatures.sh qwen/qwen3-4b-2507
#   scripts/test-llm-temperatures.sh -r 3 -g 1 qwen/qwen3-1.7b qwen/qwen3-4b-2507
#   LLM_EVAL_TEMPERATURES="0 0.2 0.7" scripts/test-llm-temperatures.sh qwen/qwen3-14b
#
# Every argument is passed to scripts/test-llm.sh (see its header for the options), except -t and
# -o, which this script sets itself.
#
# Environment variables:
#   LLM_EVAL_TEMPERATURES  space-separated temperatures to try (default 0.1 0.2 ... 0.8)
#   LLM_SWEEP_OUT          where results go (default llm-eval-results/temperatures-<time>);
#                          each temperature gets its own folder, e.g. .../t0.3
#
# Exit status: 0 when the sweep finished (whether or not models passed), 2 for a usage or
# server error.

set -euo pipefail

cd "$(dirname "$0")/.."

TEMPERATURES="${LLM_EVAL_TEMPERATURES:-0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8}"
OUT_BASE="${LLM_SWEEP_OUT:-llm-eval-results/temperatures-$(date +%Y%m%d-%H%M%S)}"

for arg in "$@"; do
  case "$arg" in
    -h)
      sed -n '3,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -t* | -o*)
      echo "Do not pass $arg: this script sets the temperature and the results folder." >&2
      echo "Use LLM_EVAL_TEMPERATURES and LLM_SWEEP_OUT instead." >&2
      exit 2
      ;;
  esac
done

if [ "$#" -eq 0 ] && [ -z "${LLM_EVAL_MODELS:-}" ]; then
  echo "No model given. Usage: $0 [test-llm.sh options] model [model ...]" >&2
  exit 2
fi

mkdir -p "$OUT_BASE"

for TEMPERATURE in $TEMPERATURES; do
  echo
  echo "################ temperature $TEMPERATURE ################"
  set +e
  scripts/test-llm.sh -t "$TEMPERATURE" -o "$OUT_BASE/t$TEMPERATURE" "$@"
  STATUS=$?
  set -e

  if [ "$STATUS" -ge 2 ]; then
    echo "scripts/test-llm.sh stopped with a usage or server error - sweep stopped." >&2
    exit "$STATUS"
  fi
done

echo
echo "################ comparison ################"
# one row per model and temperature, from the JSON results the tests wrote
node - "$OUT_BASE" <<'EOF'
const fs = require('fs');
const path = require('path');

const base = process.argv[2];
const percent = share => (share === undefined ? '-' : `${Math.round(share * 100)}%`);
const rows = [];

for (const folder of fs.readdirSync(base).filter(name => name.startsWith('t')).sort()) {
  for (const file of fs.readdirSync(path.join(base, folder)).filter(name => name.endsWith('.json'))) {
    const run = JSON.parse(fs.readFileSync(path.join(base, folder, file), 'utf8'));
    const s = run.summary || {};
    const t = run.thresholds || {};
    const passes = s.top1 >= t.minTop1 && s.confidentlyWrong <= t.maxConfidentWrong &&
      s.format >= t.minFormat && s.medianMs <= t.maxMedianMs &&
      (s.batchTop1 === undefined || s.batchTop1 >= s.top1 - t.maxBatchTop1Drop);
    rows.push([run.model, run.temperature, percent(s.top1), percent(s.top3), percent(s.confidentlyWrong),
      percent(s.batchTop1), `${s.medianMs}`, `${s.answers}`, passes ? 'yes' : 'no']);
  }
}

if (!rows.length) {
  console.log(`No results found in ${base}`);
  process.exit(0);
}

rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
const header = ['model', 'temp', 'top-1', 'top-3', 'wrong>=80', 'batch top-1', 'median ms', 'answers', 'meets bars'];
const table = [header, ...rows.map(row => row.map(String))];
const widths = header.map((_, i) => Math.max(...table.map(row => row[i].length)));
table.forEach((row, i) => {
  console.log(row.map((cell, j) => cell.padEnd(widths[j])).join('  '));
  if (i === 0) {
    console.log(widths.map(width => '-'.repeat(width)).join('  '));
  }
});
console.log('\n"meets bars" is worked out from the thresholds saved with each result; the');
console.log('"every request succeeds" and "keeps thinking off" tests are in the logs.');
EOF
echo "Results: $OUT_BASE"
