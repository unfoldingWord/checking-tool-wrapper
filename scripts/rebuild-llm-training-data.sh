#!/usr/bin/env bash
#
# Rebuilds every AI training data file already in the training data folder (llmTrainingData by
# default) from the translationCore projects they came from, with
# __tests__/buildLlmTrainingData.test.js. Use it after changing the builder, or after translators
# have aligned more of a project.
#
# Usage:
#   scripts/rebuild-llm-training-data.sh [options]
#
# Examples:
#   scripts/rebuild-llm-training-data.sh -n        # show what would be rebuilt
#   scripts/rebuild-llm-training-data.sh           # rebuild every file
#   scripts/rebuild-llm-training-data.sh -c -a     # rebuild, then refresh the checks and algorithm results
#
# Options:
#   -d DIR    training data folder (default: $LLM_TRAINING_OUT_DIR or llmTrainingData)
#   -t DIR    translationCore folder holding projects/ and resources/
#             (default: $LLM_TRAINING_TC_HOME or ~/translationCore)
#   -c        afterwards, find the unhelpful cases (npm run check:llm-training-data)
#   -a        afterwards, rerun the algorithm on every file (npm run run:llm-training-data), so the
#             *_Algorithm.results.json files match the rebuilt cases
#   -f        also rebuild files whose GL is not the project's current translationWords GL
#             (sets LLM_TRAINING_ALLOW_GL_MISMATCH=1; those files get the wrong checks, see below)
#   -n        dry run: list the builds, change nothing
#   -v        show the full jest output
#   -h        show this help
#
# Each file is named <project>_<glOwner>_<glLang>.json by the builder, e.g.
# vi_glt_luk_book_unfoldingWord_en.json or en_ult_tit_book_es-419_gl_es-419.json. The project is
# the longest folder name in <translationCore>/projects that the file name starts with; the GL
# language is the part after the last underscore, and the GL owner is what is left. Files are
# rebuilt with one builder run per GL owner and language. LLM_TRAINING_MAX_WORDS, if set, is passed
# through to the builder.
#
# A project's translationWords check list (.apps/translationCore/index/translationWords) is written
# by translationCore for the GL last selected there, and each GL lists different checks. So a file
# is only rebuilt when its GL is the project's current translationWords GL (toolsSelectedGLs and
# toolsSelectedOwners in the project's manifest.json), or the manifest names none. Other files are
# skipped and listed; to rebuild one, open the project in translationCore with that GL selected for
# translationWords, then run this again.
#
# The rebuilt files replace the old ones. They are tracked by git, so `git diff --stat
# llmTrainingData` shows what changed and `git checkout llmTrainingData` restores them.
#
# Exit status: 0 when every build succeeds, 1 when any fails, 2 for a usage error.

set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILE="__tests__/buildLlmTrainingData.test.js"
DATA_DIR="${LLM_TRAINING_OUT_DIR:-llmTrainingData}"
TC_HOME="${LLM_TRAINING_TC_HOME:-$HOME/translationCore}"
RUN_CHECK=0
RUN_ALGORITHM=0
FORCE=0
DRY_RUN=0
VERBOSE=0

usage() {
  sed -n '2,/^# Exit status/p' "$0" | sed 's/^# \{0,1\}//'
}

while getopts "d:t:cafnvh" opt; do
  case "$opt" in
    d) DATA_DIR="$OPTARG" ;;
    t) TC_HOME="$OPTARG" ;;
    c) RUN_CHECK=1 ;;
    a) RUN_ALGORITHM=1 ;;
    f) FORCE=1 ;;
    n) DRY_RUN=1 ;;
    v) VERBOSE=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))

if [ $# -gt 0 ]; then
  echo "unexpected arguments: $*" >&2
  exit 2
fi

case "$DATA_DIR" in
  /*) ;;
  *) DATA_DIR="$PWD/$DATA_DIR" ;;
esac
PROJECTS_DIR="$TC_HOME/projects"

if [ ! -d "$DATA_DIR" ]; then
  echo "training data folder not found: $DATA_DIR" >&2
  exit 2
fi

if [ ! -d "$PROJECTS_DIR" ]; then
  echo "translationCore projects folder not found: $PROJECTS_DIR" >&2
  exit 2
fi

# one line per file: "<glOwner> <glLang> <project>"
plan=""
failed_names=""
skipped_names=""

for file in "$DATA_DIR"/*.json; do
  [ -e "$file" ] || continue
  name="$(basename "$file" .json)"
  project=""

  for dir in "$PROJECTS_DIR"/*/; do
    candidate="$(basename "$dir")"

    case "$name" in
      "${candidate}_"*)
        if [ ${#candidate} -gt ${#project} ]; then
          project="$candidate"
        fi
        ;;
    esac
  done

  rest="${name#"${project}_"}"
  gl_lang="${rest##*_}"
  gl_owner="${rest%_*}"

  if [ -z "$project" ] || [ -z "$gl_owner" ] || [ "$gl_owner" = "$rest" ]; then
    echo "skipping $name.json: no project in $PROJECTS_DIR matches it, or it has no <glOwner>_<glLang> part" >&2
    failed_names="$failed_names $name.json"
    continue
  fi
  # the project's current translationWords GL, as "<owner>_<lang>", or "" when the manifest has none
  project_gl="$(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const lang = m.toolsSelectedGLs?.translationWords;
    const owner = m.toolsSelectedOwners?.translationWords;
    console.log(lang && owner ? `${owner}_${lang}` : "");
  ' "$PROJECTS_DIR/$project/manifest.json")"

  if [ -n "$project_gl" ] && [ "$project_gl" != "${gl_owner}_${gl_lang}" ] && [ "$FORCE" != 1 ]; then
    skipped_names="$skipped_names"$'\n'"  $name.json (the project's GL is now ${project_gl})"
    continue
  fi
  plan="$plan$gl_owner $gl_lang $project"$'\n'
done

if [ -n "$skipped_names" ]; then
  echo "skipping files whose GL is not their project's current translationWords GL in translationCore:$skipped_names"
  echo
fi

if [ -z "$plan" ]; then
  echo "no training data files to rebuild in $DATA_DIR" >&2
  exit 2
fi

plan="$(printf '%s' "$plan" | sort -u)"
groups="$(printf '%s\n' "$plan" | awk '{print $1, $2}' | sort -u)"
status=0

echo "training data folder: $DATA_DIR"
echo "translationCore folder: $TC_HOME"

while read -r gl_owner gl_lang; do
  projects="$(printf '%s\n' "$plan" | awk -v o="$gl_owner" -v l="$gl_lang" '$1 == o && $2 == l {print $3}' | tr '\n' ' ')"
  projects="${projects% }"
  echo
  echo "GL $gl_owner/$gl_lang: $projects"

  if [ "$DRY_RUN" = 1 ]; then
    continue
  fi

  log="$(mktemp -t rebuild-llm-training-data)"

  if LLM_TRAINING_BUILD=1 \
    LLM_TRAINING_ALLOW_GL_MISMATCH="$FORCE" \
    LLM_TRAINING_PROJECTS="$projects" \
    LLM_TRAINING_GL_OWNER="$gl_owner" \
    LLM_TRAINING_GL_LANG="$gl_lang" \
    LLM_TRAINING_TC_HOME="$TC_HOME" \
    LLM_TRAINING_OUT_DIR="$DATA_DIR" \
    npx jest "$TEST_FILE" > "$log" 2>&1; then
    echo "  rebuilt"
  else
    echo "  FAILED (jest output follows)"
    VERBOSE=1
    status=1
  fi

  if [ "$VERBOSE" = 1 ]; then
    sed 's/^/  | /' "$log"
  fi
  rm -f "$log"
done <<< "$groups"

if [ -n "$failed_names" ]; then
  echo
  echo "not rebuilt:$failed_names"
  status=1
fi

if [ "$DRY_RUN" = 1 ]; then
  exit "$status"
fi

echo
git status --short -- "$DATA_DIR" | grep -v '/results/' || true

if [ "$RUN_CHECK" = 1 ]; then
  echo
  echo "finding unhelpful cases ..."
  LLM_TRAINING_DATA_DIR="$DATA_DIR" npm run --silent check:llm-training-data 2>&1 \
    | sed -n '/unhelpful training cases, saved/,/^ *total /p' || status=1
fi

if [ "$RUN_ALGORITHM" = 1 ]; then
  echo
  echo "rerunning the algorithm on every file ..."
  LLM_TRAINING_DATA_DIR="$DATA_DIR" npm run --silent run:llm-training-data 2>&1 \
    | sed -n '/training data results/,/^ *total /p' || status=1
fi

exit "$status"
