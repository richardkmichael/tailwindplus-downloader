#!/usr/bin/env bash
#
# Smoke tests for tailwindplus-downloader option combinations.
#
# Requires an authenticated session or credentials file.  Run from the repo
# root or from within test/.
#
# Usage: bash test/smoke-test.sh [--trace] [filter]
#
# With no arguments, all tests run.  With a filter, only tests whose names
# contain the filter substring are run (case-sensitive).
# Example: bash test/smoke-test.sh "auth"
#
# --trace  Pass --debug-trace to every downloader invocation.  Requires a
#          filter — tracing a full run is not allowed.  Intended for
#          diagnosing a specific failing test:
#            bash test/smoke-test.sh --trace "dir: output with --log"
#          WARNING: trace files record all browser activity, including login
#          credentials and session tokens in plaintext.  Do not share them.

set -o nounset
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

cd "$ROOT_DIR"

FILTER=""
TRACE=false
for arg in "$@"; do
  if [[ "$arg" == "--trace" ]]; then
    TRACE=true
  elif [[ "$arg" == --* ]]; then
    echo "Unknown option: $arg" >&2
    exit 1
  else
    FILTER="$arg"
  fi
done

if $TRACE && [[ -z "$FILTER" ]]; then
  echo "--trace requires a filter to avoid generating traces for every test." >&2
  echo "Example: bash test/smoke-test.sh --trace \"dir: output with --log\"" >&2
  exit 1
fi

# Wrapper that appends --debug-trace when --trace is active.
TRACE_ARGS=()
$TRACE && TRACE_ARGS=("--debug-trace")
downloader() {
  node "$ROOT_DIR/tailwindplus-downloader.js" "$@" "${TRACE_ARGS[@]+"${TRACE_ARGS[@]}"}"
}

# ── Helpers ───────────────────────────────────────────────────────────────────

# Colors (only when stdout is a terminal)
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; NC=''
fi

PASS=0
FAIL=0
SKIP=0
TOTAL=0

pass() { echo -e "${GREEN}[PASS]${NC} $1"; (( PASS += 1 )); (( TOTAL += 1 )); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; (( FAIL += 1 )); (( TOTAL += 1 )); }
skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; (( SKIP += 1 )); }

header() { echo -e "\n${YELLOW}--- $1 ---${NC}"; }

# Run a command, check its exit code, log pass/fail.
# Uses the global $_NAME set by the test runner loop.
run_cmd() {
  local expected_exit="$1"
  local notty="$2"
  shift 2

  # Restore errexit to whatever it was, rather than switching it on: the tests
  # expect non-zero exits, and each test function ends in a conditional whose
  # false branch would otherwise abort the whole run.
  local errexit_was_set=false
  [[ $- == *e* ]] && errexit_was_set=true

  set +o errexit
  if [[ "$notty" = "notty" ]]; then
    "$@" < /dev/null 2>&1
  else
    "$@" 2>&1
  fi
  local actual_exit=$?
  if $errexit_was_set; then set -o errexit; fi
  if [[ "$actual_exit" -eq "$expected_exit" ]]; then
    pass "$_NAME"
  else
    fail "$_NAME  (expected exit $expected_exit, got $actual_exit)"
  fi
}

check_file_exists() {
  local label="$1"
  local path="$2"
  if [[ -e "$path" ]]; then
    pass "$label"
  else
    fail "$label  (not found: $path)"
  fi
}

# ── Setup ────────────────────────────────────────────────────────────────────

ONE_URL_FILE="test/one-test-url.txt"
MANY_URL_FILE="test/many-test-urls.txt"

DEFAULT_SESSION=".tailwindplus-downloader-session.json"
DEFAULT_CREDS=".tailwindplus-downloader-credentials.json"

RUN_DIR="test/smoke-test-runs/run.$$"

if [[ ! -f "$DEFAULT_SESSION" && ! -f "$DEFAULT_CREDS" ]]; then
  echo "Smoke tests require a valid session or credentials file. Neither found:"
  echo "  $DEFAULT_SESSION"
  echo "  $DEFAULT_CREDS"
  exit 1
fi

HAS_CREDS=false
[[ -f "$DEFAULT_CREDS" ]] && HAS_CREDS=true

# ── Test functions ───────────────────────────────────────────────────────────
#
# Each function is a self-contained test: set up preconditions, run the
# downloader once, check postconditions, clean up on success.

test_json_basic() {
  local dir="$RUN_DIR/01-json-basic"
  mkdir -p "$dir"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$MANY_URL_FILE" --output="$dir/output.json" --log --debug
  check_file_exists "output file created" "$dir/output.json"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_json_exists_aborts() {
  local dir="$RUN_DIR/02-json-exists-aborts"
  mkdir -p "$dir"
  touch "$dir/output.json"
  local fail_before=$FAIL

  run_cmd 1 "notty" downloader --debug-url-file="$ONE_URL_FILE" --output="$dir/output.json"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_json_overwrite() {
  local dir="$RUN_DIR/03-json-overwrite"
  mkdir -p "$dir"
  touch "$dir/output.json"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$ONE_URL_FILE" --output="$dir/output.json" --overwrite --log --debug

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_dir_basic() {
  local dir="$RUN_DIR/04-dir-basic"
  mkdir -p "$dir"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$MANY_URL_FILE" --output-format=dir --output="$dir/output" --log --debug
  check_file_exists "output directory created" "$dir/output"
  check_file_exists "metadata.json written" "$dir/output/metadata.json"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_dir_exists_aborts() {
  local dir="$RUN_DIR/05-dir-exists-aborts"
  mkdir -p "$dir/output"
  touch "$dir/output/placeholder"
  local fail_before=$FAIL

  run_cmd 1 "notty" downloader --debug-url-file="$ONE_URL_FILE" --output-format=dir --output="$dir/output"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_dir_overwrite() {
  local dir="$RUN_DIR/06-dir-overwrite"
  mkdir -p "$dir/output"
  touch "$dir/output/placeholder"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$ONE_URL_FILE" --output-format=dir --output="$dir/output" --overwrite --log --debug
  check_file_exists "metadata.json recreated" "$dir/output/metadata.json"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_dir_with_log() {
  local dir="$RUN_DIR/07-dir-with-log"
  mkdir -p "$dir"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$ONE_URL_FILE" --output-format=dir --output="$dir/output" --log --debug
  check_file_exists ".log file created" "$dir/output.log"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_dir_default_path() {
  local dir="$RUN_DIR/08-dir-default-path"
  mkdir -p "$dir"
  local fail_before=$FAIL

  # Run from inside the subdir so the auto-generated timestamped output lands there.
  # Auth file paths must be absolute since the CWD changes.
  local auth_args=()
  [[ -f "$DEFAULT_SESSION" ]] && auth_args+=(--session="$ROOT_DIR/$DEFAULT_SESSION")
  [[ -f "$DEFAULT_CREDS" ]]   && auth_args+=(--credentials="$ROOT_DIR/$DEFAULT_CREDS")

  # shellcheck disable=SC2016 # $1/$@ expand inside the bash -c subshell, not here.
  run_cmd 0 "" \
    bash -c 'cd "$1" && shift && node "$@"' _ "$dir" \
      "$ROOT_DIR/tailwindplus-downloader.js" \
      --debug-url-file="$ROOT_DIR/$ONE_URL_FILE" \
      --output-format=dir \
      "${auth_args[@]+"${auth_args[@]}"}" \
      "${TRACE_ARGS[@]+"${TRACE_ARGS[@]}"}"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_auth_fresh_login() {
  if ! $HAS_CREDS; then skip "$_NAME  (no credentials file)"; return; fi
  local dir="$RUN_DIR/09-auth-fresh-login"
  mkdir -p "$dir"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$ONE_URL_FILE" --output="$dir/output.json" --session="$dir/session.json" --credentials="$DEFAULT_CREDS" --log --debug
  check_file_exists "session file created" "$dir/session.json"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_auth_no_creds() {
  local dir="$RUN_DIR/10-auth-no-creds"
  mkdir -p "$dir"
  local fail_before=$FAIL

  run_cmd 1 "notty" downloader --debug-url-file="$ONE_URL_FILE" --output="$dir/output.json" --session="$dir/session.json" --credentials="$dir/credentials.json"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_auth_relogin() {
  if ! $HAS_CREDS; then skip "$_NAME  (no credentials file)"; return; fi
  local dir="$RUN_DIR/11-auth-relogin"
  mkdir -p "$dir"
  printf '{"cookies":[],"origins":[]}' > "$dir/session.json"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$ONE_URL_FILE" --output="$dir/output.json" --session="$dir/session.json" --credentials="$DEFAULT_CREDS" --log --debug

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

# ── Test registry and runner ─────────────────────────────────────────────────

TESTS=(
  "JSON: basic output to fixed path|test_json_basic"
  "JSON: existing output, non-TTY aborts|test_json_exists_aborts"
  "JSON: existing output, --overwrite proceeds|test_json_overwrite"
  "dir: basic output to fixed path|test_dir_basic"
  "dir: existing output, non-TTY aborts|test_dir_exists_aborts"
  "dir: existing output, --overwrite proceeds|test_dir_overwrite"
  "dir: output with --log|test_dir_with_log"
  "dir: default timestamped output path|test_dir_default_path"
  "auth: credentials present, no session|test_auth_fresh_login"
  "auth: no credentials, no session, non-TTY aborts|test_auth_no_creds"
  "auth: invalid session, re-login succeeds|test_auth_relogin"
)

echo -e "${BOLD}=== TailwindPlus Downloader Smoke Tests ===${NC}"
echo "URL file: $MANY_URL_FILE"
echo "Output:   $RUN_DIR"
[[ -n "$FILTER" ]] && echo "Filter:   $FILTER"

mkdir -p "$RUN_DIR"

for entry in "${TESTS[@]}"; do
  _NAME="${entry%%|*}"
  _FUNC="${entry##*|}"
  if [[ -z "$FILTER" || "$_NAME" == *"$FILTER"* ]]; then
    header "$_NAME"
    "$_FUNC"
  else
    skip "$_NAME"
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
if [[ "$SKIP" -gt 0 ]]; then
  echo -e "${BOLD}=== Results: $PASS/$TOTAL passed, $SKIP skipped ===${NC}"
else
  echo -e "${BOLD}=== Results: $PASS/$TOTAL passed ===${NC}"
fi

# Remove the run directory if empty (all tests passed and cleaned up).
rmdir "$RUN_DIR" 2>/dev/null || true

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "${RED}$FAIL test(s) failed.${NC}"
  exit 1
fi
