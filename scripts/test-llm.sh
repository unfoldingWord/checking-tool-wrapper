#!/usr/bin/env bash
#
# Runs the model suitability tests in __tests__/llmModelSuitability.test.js against a local
# OpenAI-compatible server (e.g. LM Studio), for one or more models, and prints a summary.
#
# Usage:
#   scripts/test-llm.sh [options] [model ...]
#
# Examples:
#   scripts/test-llm.sh -l                                   # list the server's models
#   scripts/test-llm.sh qwen/qwen3-4b-2507                   # test one model
#   scripts/test-llm.sh -r 3 qwen/qwen3-1.7b qwen/qwen3-4b-2507
#   LLM_EVAL_MIN_TOP1=0.8 scripts/test-llm.sh qwen/qwen3-14b # stricter bar
#
# Options:
#   -u URL    server base URL (default: $LLM_EVAL_URL or http://localhost:1234)
#   -r RUNS   times every case is asked; results are pooled (default: $LLM_EVAL_RUNS or 2)
#   -g N      requests per query for the batched tests; 1 skips them (default: $LLM_EVAL_GROUPING or 4)
#   -t TEMP   sampling temperature (default: $LLM_EVAL_TEMPERATURE or 0.7)
#   -k TOKEN  bearer token, for hosted servers (default: $LLM_EVAL_API_TOKEN)
#   -o DIR    where logs and JSON results go (default: llm-eval-results)
#   -l        list the models the server offers, then exit
#   -v        show the full jest output instead of just the report
#   -h        show this help
#
# With no models given, $LLM_EVAL_MODELS (space-separated) is used. Any other LLM_EVAL_*
# variable already set, such as the thresholds (LLM_EVAL_MIN_TOP1, LLM_EVAL_MAX_CONFIDENT_WRONG,
# LLM_EVAL_MIN_FORMAT, LLM_EVAL_MAX_MEDIAN_MS, LLM_EVAL_MAX_BATCH_TOP1_DROP, LLM_EVAL_TIMEOUT_MS),
# is passed through to the tests. See the header of the test file for what each one means.
#
# Exit status: 0 when every model passes, 1 when any fails, 2 for a usage or server error.

set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILE="__tests__/llmModelSuitability.test.js"
URL="${LLM_EVAL_URL:-http://localhost:1234}"
RUNS="${LLM_EVAL_RUNS:-2}"
GROUPING="${LLM_EVAL_GROUPING:-4}"
TEMPERATURE="${LLM_EVAL_TEMPERATURE:-0.7}"
API_TOKEN="${LLM_EVAL_API_TOKEN:-}"
OUT_DIR="llm-eval-results"
LIST_ONLY=0
VERBOSE=0

usage() {
  sed -n '3,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

while getopts "u:r:g:t:k:o:lvh" opt; do
  case "$opt" in
    u) URL="$OPTARG" ;;
    r) RUNS="$OPTARG" ;;
    g) GROUPING="$OPTARG" ;;
    t) TEMPERATURE="$OPTARG" ;;
    k) API_TOKEN="$OPTARG" ;;
    o) OUT_DIR="$OPTARG" ;;
    l) LIST_ONLY=1 ;;
    v) VERBOSE=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
URL="${URL%/}"

# prints the model ids the server lists, one per line
list_models() {
  local auth=()

  if [ -n "$API_TOKEN" ]; then
    auth=(-H "Authorization: Bearer $API_TOKEN")
  fi

  curl -sS -m 10 "${auth[@]+"${auth[@]}"}" "$URL/v1/models" |
    node -e '
      let text = "";
      process.stdin.on("data", chunk => { text += chunk; });
      process.stdin.on("end", () => {
        try {
          (JSON.parse(text).data || []).forEach(model => model.id && console.log(model.id));
        } catch (error) {
          if (text) {
            console.error(`Unexpected reply from the server: ${text.slice(0, 200)}`);
          }
          process.exit(1);
        }
      });'
}

if ! AVAILABLE="$(list_models)"; then
  echo "Cannot get the model list from $URL/v1/models. Is the server running?" >&2
  exit 2
fi

if [ "$LIST_ONLY" = 1 ]; then
  echo "Models at $URL:"
  echo "$AVAILABLE" | sed 's/^/  /'
  exit 0
fi

if [ "$#" -eq 0 ]; then
  if [ -n "${LLM_EVAL_MODELS:-}" ]; then
    # shellcheck disable=SC2086
    set -- $LLM_EVAL_MODELS
  else
    echo "No model given. Models at $URL:" >&2
    echo "$AVAILABLE" | sed 's/^/  /' >&2
    echo >&2
    usage >&2
    exit 2
  fi
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
SUMMARY=()
FAILED=0

for MODEL in "$@"; do
  NAME="${MODEL//\//-}"
  LOG="$OUT_DIR/$STAMP-$NAME.log"
  JSON="$OUT_DIR/$STAMP-$NAME.json"

  echo
  echo "=== $MODEL (url $URL, runs $RUNS, grouping $GROUPING, temperature $TEMPERATURE)"

  if ! grep -qxF "$MODEL" <<< "$AVAILABLE"; then
    echo "Not listed by $URL/v1/models - skipped."
    SUMMARY+=("NOT FOUND  $MODEL")
    FAILED=1
    continue
  fi

  set +e
  LLM_EVAL_MODEL="$MODEL" \
  LLM_EVAL_URL="$URL" \
  LLM_EVAL_RUNS="$RUNS" \
  LLM_EVAL_GROUPING="$GROUPING" \
  LLM_EVAL_TEMPERATURE="$TEMPERATURE" \
  LLM_EVAL_API_TOKEN="$API_TOKEN" \
  LLM_EVAL_OUT="$JSON" \
    npx jest "$TEST_FILE" > "$LOG" 2>&1
  STATUS=$?
  set -e

  if [ "$VERBOSE" = 1 ]; then
    cat "$LOG"
  else
    # the report printed by the tests, then each test's result and jest's totals
    awk '/LLM suitability:/ { show = 1 } show && /^[[:space:]]*$/ { show = 0 } show' "$LOG" | sed 's/^    //'
    grep -E "✓|✕|Tests:" "$LOG" | grep -v "expected answers are verse words" || true
  fi

  if [ "$STATUS" = 0 ]; then
    SUMMARY+=("PASS       $MODEL")
  else
    SUMMARY+=("FAIL       $MODEL  (details: $LOG)")
    FAILED=1
  fi
done

echo
echo "=== Summary"
printf '%s\n' "${SUMMARY[@]}"
echo "Logs and JSON results: $OUT_DIR/$STAMP-*"

exit "$FAILED"
