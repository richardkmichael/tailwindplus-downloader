#!/usr/bin/env bash
#
# Smoke tests for tailwindplus-downloader option combinations.
#
# Requires an authenticated session or credentials file.  Run from the repo
# root or from within test/.
#
# Usage: bash test/smoke-test.sh

set -o nounset
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

cd "$ROOT_DIR"

URL_FILE="test/smoke-test-urls.txt"
RUN_DIR="test/smoke-test-run"
JSON_OUT="$RUN_DIR/output.json"
DIR_OUT="$RUN_DIR/output"
DIR_LOG_OUT="$RUN_DIR/output-log"

# Colors (only when stdout is a terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; NC=''
fi

PASS=0
FAIL=0
TOTAL=0

pass() { echo -e "${GREEN}[PASS]${NC} $1"; (( PASS += 1 )); (( TOTAL += 1 )); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; (( FAIL += 1 )); (( TOTAL += 1 )); }

header() { echo -e "\n${YELLOW}--- $1 ---${NC}"; }

# Run a command, check its exit code, log pass/fail.
# Usage: run_test "name" <expected-exit> [< /dev/null] -- cmd args...
run_test() {
  local name="$1"
  local expected_exit="$2"
  local notty="${3:-}"   # pass "notty" to redirect stdin from /dev/null
  shift 3
  header "$name"
  set +o errexit
  if [ "$notty" = "notty" ]; then
    "$@" < /dev/null 2>&1
  else
    "$@" 2>&1
  fi
  local actual_exit=$?
  set -o errexit
  if [ "$actual_exit" -eq "$expected_exit" ]; then
    pass "$name"
  else
    fail "$name  (expected exit $expected_exit, got $actual_exit)"
  fi
}

check_file_exists() {
  local name="$1"
  local path="$2"
  if [ -e "$path" ]; then
    pass "$name"
  else
    fail "$name  (not found: $path)"
  fi
}

# ── Setup ────────────────────────────────────────────────────────────────────

echo -e "${BOLD}=== TailwindPlus Downloader Smoke Tests ===${NC}"
echo "URL file: $URL_FILE"
echo "Output:   $RUN_DIR"

rm -rf "$RUN_DIR"
mkdir -p "$RUN_DIR"

# ── JSON output ──────────────────────────────────────────────────────────────

run_test "JSON: basic output to fixed path" 0 "" \
  node tailwindplus-downloader.js \
    --debug-url-file="$URL_FILE" \
    --output="$JSON_OUT"

check_file_exists "JSON: output file created" "$JSON_OUT"

run_test "JSON: existing output, non-TTY aborts" 1 "notty" \
  node tailwindplus-downloader.js \
    --debug-url-file="$URL_FILE" \
    --output="$JSON_OUT"

run_test "JSON: existing output, --overwrite proceeds" 0 "" \
  node tailwindplus-downloader.js \
    --debug-url-file="$URL_FILE" \
    --output="$JSON_OUT" \
    --overwrite

# ── dir output ───────────────────────────────────────────────────────────────

run_test "dir: basic output to fixed path" 0 "" \
  node tailwindplus-downloader.js \
    --debug-url-file="$URL_FILE" \
    --output-format=dir \
    --output="$DIR_OUT"

check_file_exists "dir: output directory created" "$DIR_OUT"
check_file_exists "dir: metadata.json written" "$DIR_OUT/metadata.json"

run_test "dir: existing output, non-TTY aborts" 1 "notty" \
  node tailwindplus-downloader.js \
    --debug-url-file="$URL_FILE" \
    --output-format=dir \
    --output="$DIR_OUT"

run_test "dir: existing output, --overwrite proceeds" 0 "" \
  node tailwindplus-downloader.js \
    --debug-url-file="$URL_FILE" \
    --output-format=dir \
    --output="$DIR_OUT" \
    --overwrite

check_file_exists "dir: output recreated after --overwrite" "$DIR_OUT/metadata.json"

# ── dir + --log ───────────────────────────────────────────────────────────────

run_test "dir: output with --log" 0 "" \
  node tailwindplus-downloader.js \
    --debug-url-file="$URL_FILE" \
    --output-format=dir \
    --output="$DIR_LOG_OUT" \
    --log

check_file_exists "dir: --log creates correctly named .log file" "${DIR_LOG_OUT}.log"

# ── dir: default timestamped path ────────────────────────────────────────────

header "dir: default timestamped output path (no --output)"
set +o errexit
TS_OUTPUT=$(node tailwindplus-downloader.js \
  --debug-url-file="$URL_FILE" \
  --output-format=dir \
  2>&1)
TS_EXIT=$?
set -o errexit
echo "$TS_OUTPUT"

if [ "$TS_EXIT" -eq 0 ]; then
  pass "dir: default timestamped output path"
  # Extract dir name from completion message and clean up
  TS_DIR=$(echo "$TS_OUTPUT" | grep "Components saved to directory" | awk '{print $NF}')
  [ -n "$TS_DIR" ] && rm -rf "$TS_DIR"
else
  fail "dir: default timestamped output path"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Results: $PASS/$TOTAL passed ===${NC}"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}$FAIL test(s) failed.${NC}"
  exit 1
fi
