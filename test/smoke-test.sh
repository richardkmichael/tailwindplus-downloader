#!/usr/bin/env bash
#
# Smoke tests for tailwindplus-downloader option combinations.
#
# Run from the repo root or from within test/.
#
# The unauthenticated tests need no login and always run.  The rest need a
# session or credentials file and skip when neither is present, so this suite
# is usable in CI without exposing an account.
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

# Start the downloader in the background, wait until it logs `marker` so the signal lands while a
# job is in flight, then interrupt it and check its exit code.
#
# `node` is backgrounded directly rather than through the `downloader` helper: backgrounding a
# shell function gives the subshell's PID, and the signal would never reach node.  Every wait is
# bounded, because a shutdown that hangs is exactly what this guards against.
run_and_interrupt() {
  local expected_exit="$1"
  local marker="$2"
  local logfile="$3"
  shift 3

  node "$ROOT_DIR/tailwindplus-downloader.js" "$@" "${TRACE_ARGS[@]+"${TRACE_ARGS[@]}"}" > /dev/null 2>&1 &
  local pid=$!

  local waited=0
  while ! grep -q "$marker" "$logfile" 2>/dev/null; do
    if ! kill -0 "$pid" 2>/dev/null; then
      fail "$_NAME  (exited before logging: $marker)"
      return
    fi
    sleep 0.2
    waited=$(( waited + 1 ))
    if [[ "$waited" -gt 300 ]]; then
      kill -INT "$pid" 2>/dev/null
      fail "$_NAME  (marker never logged: $marker)"
      return
    fi
  done

  kill -INT "$pid"

  waited=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.2
    waited=$(( waited + 1 ))
    if [[ "$waited" -gt 150 ]]; then
      kill -KILL "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      fail "$_NAME  (still running 30s after the interrupt)"
      return
    fi
  done

  wait "$pid"
  local actual_exit=$?
  if [[ "$actual_exit" -eq "$expected_exit" ]]; then
    pass "$_NAME"
  else
    fail "$_NAME  (expected exit $expected_exit, got $actual_exit)"
  fi
}

check_log_contains() {
  local label="$1"
  local path="$2"
  local pattern="$3"

  if [[ ! -f "$path" ]]; then
    fail "$label  (no log file: $path)"
    return
  fi

  if grep -q "$pattern" "$path"; then
    pass "$label"
  else
    fail "$label  (not found in $path: $pattern)"
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

check_file_absent() {
  local label="$1"
  local path="$2"
  if [[ ! -e "$path" ]]; then
    pass "$label"
  else
    fail "$label  (unexpectedly present: $path)"
  fi
}

# Compare the output's component_count against an expected value.
# mode is "exact" or "min".
check_component_count() {
  local label="$1"
  local path="$2"
  local mode="$3"
  local expected="$4"

  if [[ ! -f "$path" ]]; then
    fail "$label  (no output file: $path)"
    return
  fi

  local actual
  # readFileSync, not require: require() reads a bare relative path as a module name.
  actual=$(node -e 'const fs = require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).component_count)' "$path" 2>&1)
  if [[ ! "$actual" =~ ^[0-9]+$ ]]; then
    fail "$label  (could not read component_count: $actual)"
    return
  fi

  local ok=false
  case "$mode" in
    exact) [[ "$actual" -eq "$expected" ]] && ok=true ;;
    min)   [[ "$actual" -ge "$expected" ]] && ok=true ;;
    *)     fail "$label  (unknown mode: $mode)"; return ;;
  esac

  if $ok; then
    pass "$label  (component_count=$actual)"
  else
    fail "$label  (component_count=$actual, expected $mode $expected)"
  fi
}

# Assert the output carries both description maps and that neither is empty.
check_descriptions() {
  local label="$1"
  local path="$2"

  if [[ ! -f "$path" ]]; then
    fail "$label  (no output file: $path)"
    return
  fi

  local counts
  counts=$(node -e '
    const fs = require("fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).descriptions || {};
    console.log(Object.keys(d.products || {}).length, Object.keys(d.subcategories || {}).length);
  ' "$path" 2>&1)

  if [[ ! "$counts" =~ ^[0-9]+\ [0-9]+$ ]]; then
    fail "$label  (could not read descriptions: $counts)"
    return
  fi

  local products="${counts% *}"
  local subcategories="${counts#* }"
  if [[ "$products" -gt 0 && "$subcategories" -gt 0 ]]; then
    pass "$label  (products=$products, subcategories=$subcategories)"
  else
    fail "$label  (products=$products, subcategories=$subcategories, expected both non-zero)"
  fi
}

# Assert every captured component carries the full format set exactly once, with content.
#
# `expected` is the downloader's own cross-product from CONFIG.download -- 3 frameworks x 2
# versions x 3 modes, or 6 where mode does not vary -- not a claim about what TailwindPlus
# publishes.  Components may be added or removed upstream freely; what must hold is that whatever
# was captured carries every format asked for, once each, with code.
#
# Distinctness is the part that matters: a stale read, a format change that did not apply, or a
# skipped axis all leave the snippet count intact while duplicating a format.
check_snippet_formats() {
  local label="$1"
  local path="$2"
  local expected="$3"

  if [[ ! -f "$path" ]]; then
    fail "$label  (no output file: $path)"
    return
  fi

  local result
  # shellcheck disable=SC2016 # ${...} below are JS template literals, not shell expansions.
  result=$(node -e '
    const fs = require("fs");
    const expected = Number(process.argv[2]);
    const tree = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).tailwindplus || {};
    const problems = [];
    let checked = 0;

    const walk = (node, path) => {
      if (!node || typeof node !== "object") { return; }
      if (Array.isArray(node.snippets)) {
        checked++;
        const formats = node.snippets.map(s => `${s.name}-v${s.version}-${s.mode}`);
        const distinct = new Set(formats);
        if (formats.length !== expected) {
          problems.push(`${path}: ${formats.length} snippets, expected ${expected}`);
        } else if (distinct.size !== expected) {
          problems.push(`${path}: only ${distinct.size} distinct formats in ${formats.length} snippets`);
        }
        const empty = node.snippets.filter(s => !s.code).length;
        if (empty > 0) { problems.push(`${path}: ${empty} snippet(s) with no code`); }
        return;
      }
      for (const key of Object.keys(node)) { walk(node[key], path ? `${path}.${key}` : key); }
    };

    walk(tree, "");
    if (checked === 0) { problems.push("no components found"); }
    console.log(problems.length > 0 ? problems.join("; ") : `OK ${checked}`);
  ' "$path" "$expected" 2>&1)

  if [[ "$result" == "OK "* ]]; then
    pass "$label  (${result#OK } component(s) x $expected formats)"
  else
    fail "$label  ($result)"
  fi
}

# Assert each component directory in dir output holds one file per format.  The directory layout
# carries no snippet metadata, so the count is what can be checked there.
check_snippet_file_count() {
  local label="$1"
  local dir="$2"
  local expected="$3"

  local problems=""
  local checked=0

  while IFS= read -r componentDir; do
    [[ -z "$componentDir" ]] && continue
    checked=$(( checked + 1 ))
    local count
    count=$(find "$componentDir" -type f | wc -l | tr -d ' ')
    if [[ "$count" -ne "$expected" ]]; then
      problems="$problems ${componentDir##*/}=$count"
    fi
  done < <(find "$dir" -type d -name 'v*' -exec dirname {} \; 2>/dev/null | sort -u)

  if [[ "$checked" -eq 0 ]]; then
    fail "$label  (no component directories under $dir)"
  elif [[ -n "$problems" ]]; then
    fail "$label  (expected $expected files each, got:$problems)"
  else
    pass "$label  ($checked component(s) x $expected files)"
  fi
}

# Assert the directory output contains snippet filenames with no `-<mode>` suffix.  Only
# components with a null mode produce these, so it confirms the mode-less path ran end to end.
check_modeless_filenames() {
  local label="$1"
  local dir="$2"

  local count
  count=$(find "$dir" -type f \( -name 'html.html' -o -name 'react.jsx' -o -name 'vue.vue' \) 2>/dev/null | wc -l | tr -d ' ')

  if [[ "$count" -gt 0 ]]; then
    pass "$label  ($count files)"
  else
    fail "$label  (no suffix-free snippet filenames under $dir)"
  fi
}

# Guard for tests that need a login.  Use as: require_auth || return
require_auth() {
  if ! $HAS_AUTH; then
    skip "$_NAME  (no session or credentials)"
    return 1
  fi
  return 0
}

# ── Setup ────────────────────────────────────────────────────────────────────

ONE_URL_FILE="test/one-test-url.txt"
MANY_URL_FILE="test/many-test-urls.txt"
NO_FREE_URL_FILE="test/no-free-components-url.txt"
ECOMMERCE_URL_FILE="test/ecommerce-test-url.txt"

DEFAULT_SESSION=".tailwindplus-downloader-session.json"
DEFAULT_CREDS=".tailwindplus-downloader-credentials.json"

RUN_DIR="test/smoke-test-runs/run.$$"

HAS_CREDS=false
[[ -f "$DEFAULT_CREDS" ]] && HAS_CREDS=true

# The unauthenticated tests need no login, so a run with no session or credentials
# is valid — the authenticated tests skip instead of aborting the run.
HAS_AUTH=false
[[ -f "$DEFAULT_SESSION" || -f "$DEFAULT_CREDS" ]] && HAS_AUTH=true

if ! $HAS_AUTH; then
  echo "No session or credentials found; running unauthenticated tests only."
  echo "  $DEFAULT_SESSION"
  echo "  $DEFAULT_CREDS"
fi

# ── Test functions ───────────────────────────────────────────────────────────
#
# Each function is a self-contained test: set up preconditions, run the
# downloader once, check postconditions, clean up on success.

test_json_basic() {
  require_auth || return
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
  require_auth || return
  local dir="$RUN_DIR/03-json-overwrite"
  mkdir -p "$dir"
  touch "$dir/output.json"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$ONE_URL_FILE" --output="$dir/output.json" --overwrite --log --debug

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_dir_basic() {
  require_auth || return
  local dir="$RUN_DIR/04-dir-basic"
  mkdir -p "$dir"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$MANY_URL_FILE" --output-format=dir --output="$dir/output" --log --debug
  check_file_exists "output directory created" "$dir/output"
  check_file_exists "metadata.json written" "$dir/output/metadata.json"
  check_file_exists "descriptions.json written" "$dir/output/descriptions.json"

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
  require_auth || return
  local dir="$RUN_DIR/06-dir-overwrite"
  mkdir -p "$dir/output"
  touch "$dir/output/placeholder"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$ONE_URL_FILE" --output-format=dir --output="$dir/output" --overwrite --log --debug
  check_file_exists "metadata.json recreated" "$dir/output/metadata.json"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_dir_with_log() {
  require_auth || return
  local dir="$RUN_DIR/07-dir-with-log"
  mkdir -p "$dir"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --debug-url-file="$ONE_URL_FILE" --output-format=dir --output="$dir/output" --log --debug
  check_file_exists ".log file created" "$dir/output.log"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_dir_default_path() {
  require_auth || return
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

# Unauthenticated mode captures only the free sample components, so these tests
# need no session or credentials and are the subset CI can run.

test_unauth_no_credentials() {
  local dir="$RUN_DIR/12-unauth-no-credentials"
  mkdir -p "$dir"
  local fail_before=$FAIL

  # Run from inside the subdir, passing no auth arguments, so the default session
  # and credentials paths resolve to a directory that has neither.  This is what
  # proves the mode needs no account.
  # shellcheck disable=SC2016 # $1/$@ expand inside the bash -c subshell, not here.
  run_cmd 0 "" \
    bash -c 'cd "$1" && shift && node "$@"' _ "$dir" \
      "$ROOT_DIR/tailwindplus-downloader.js" \
      --unauthenticated \
      --debug-url-file="$ROOT_DIR/$ONE_URL_FILE" \
      --output=output.json \
      "${TRACE_ARGS[@]+"${TRACE_ARGS[@]}"}"

  check_file_exists "output file created" "$dir/output.json"
  check_file_absent "no session file written" "$dir/$DEFAULT_SESSION"
  check_component_count "free components captured" "$dir/output.json" min 1
  check_descriptions "descriptions captured" "$dir/output.json"
  # A moded page: 3 frameworks x 2 versions x 3 modes.
  check_snippet_formats "every format captured once" "$dir/output.json" 18

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_unauth_no_free_components() {
  local dir="$RUN_DIR/13-unauth-no-free-components"
  mkdir -p "$dir"
  local fail_before=$FAIL

  run_cmd 0 "" downloader --unauthenticated --debug-url-file="$NO_FREE_URL_FILE" --output="$dir/output.json" --log --debug
  check_component_count "completes with nothing captured" "$dir/output.json" exact 0

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_unauth_dir_output() {
  local dir="$RUN_DIR/14-unauth-dir-output"
  mkdir -p "$dir"
  local fail_before=$FAIL

  # An eCommerce page, so this covers the mode-less extraction path and the suffix-free filenames
  # it produces, neither of which the moded page used elsewhere reaches.  It has more than one free
  # component, so the per-component loop iterates.
  run_cmd 0 "" downloader --unauthenticated --debug-url-file="$ECOMMERCE_URL_FILE" --output-format=dir --output="$dir/output" --log --debug
  check_file_exists "output directory created" "$dir/output"
  check_file_exists "metadata.json written" "$dir/output/metadata.json"
  check_file_exists "descriptions.json written" "$dir/output/descriptions.json"
  check_component_count "multiple free components captured" "$dir/output/metadata.json" min 2
  check_modeless_filenames "mode-less snippet filenames" "$dir/output"
  # A mode-less page: 3 frameworks x 2 versions, with no mode to vary.
  check_snippet_file_count "every format written once" "$dir/output" 6

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_url_file_empty() {
  local dir="$RUN_DIR/15-url-file-empty"
  mkdir -p "$dir"
  printf '# a comment, and no URLs\n\n' > "$dir/urls.txt"
  local fail_before=$FAIL

  # An unfiltered run would download every component, so this must abort rather than proceed.
  run_cmd 1 "notty" downloader --unauthenticated --debug-url-file="$dir/urls.txt" --output="$dir/output.json"
  check_file_absent "no output written" "$dir/output.json"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_interrupt_shuts_down() {
  local dir="$RUN_DIR/16-interrupt"
  mkdir -p "$dir"
  local fail_before=$FAIL

  # Many URLs so the run cannot finish before the interrupt arrives.
  run_and_interrupt 130 'Started job:' "$dir/output.log" \
    --unauthenticated --debug-url-file="$MANY_URL_FILE" --output="$dir/output.json" --log --debug

  check_log_contains "interrupt reported" "$dir/output.log" 'Received SIGINT'
  check_log_contains "teardown reached" "$dir/output.log" 'Shutting down'
  check_file_absent "no partial output written" "$dir/output.json"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

# The diff tool reads component trees out of JSON, so it is exercised against files written here
# rather than downloads: no network, and the counts are known rather than whatever the site holds.
test_diff_component_counts() {
  local dir="$RUN_DIR/17-diff-counts"
  mkdir -p "$dir"
  local fail_before=$FAIL

  local snippet='{"name":"html","language":"html","version":4,"mode":"light","code":"<div></div>"}'
  printf '{"component_count":1,"tailwindplus":{"Marketing":{"Sections":{"Heroes":{"One":{"name":"One","snippets":[%s]}}}}}}\n' \
    "$snippet" > "$dir/old.json"
  printf '{"component_count":2,"tailwindplus":{"Marketing":{"Sections":{"Heroes":{"One":{"name":"One","snippets":[%s]},"Two":{"name":"Two","snippets":[%s]}}}}}}\n' \
    "$snippet" "$snippet" > "$dir/new.json"

  # Run from the test directory: the tool writes a `diffs/` directory beside its working
  # directory, which should not land in the repo root.
  # shellcheck disable=SC2016 # $1..$4 expand inside the bash -c subshell, not here.
  run_cmd 0 "" bash -c 'cd "$1" && node "$2" --old-file=old.json --new-file=new.json > "$3" 2>&1' \
    _ "$dir" "$ROOT_DIR/tailwindplus-diff.js" "output.txt"

  check_log_contains "old count reported" "$dir/output.txt" '(1 components)'
  check_log_contains "new count reported" "$dir/output.txt" '(2 components)'
  check_log_contains "delta reported" "$dir/output.txt" '+1'

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

# Comparing two formats out of one file is the case with no second download to fall back on, so it
# is driven end to end here: one file, one marketing component whose light and dark snippets
# differ, and one eCommerce component with no modes at all.
test_diff_formats_within_one_file() {
  local dir="$RUN_DIR/19-diff-formats"
  mkdir -p "$dir"
  local fail_before=$FAIL

  local light='{"name":"html","language":"html","version":4,"mode":"light","code":"<div class=\"bg-white\"></div>"}'
  local dark='{"name":"html","language":"html","version":4,"mode":"dark","code":"<div class=\"bg-black\"></div>"}'
  local modeless='{"name":"html","language":"html","version":4,"mode":null,"code":"<div></div>"}'
  printf '{"component_count":2,"tailwindplus":{"Marketing":{"Sections":{"Heroes":{"One":{"name":"One","snippets":[%s,%s]}}}},"Ecommerce":{"Components":{"Product lists":{"Priced":{"name":"Priced","snippets":[%s]}}}}}}\n' \
    "$light" "$dark" "$modeless" > "$dir/components.json"

  # Run from the test directory: the tool writes a `diffs/` directory beside its working
  # directory, which should not land in the repo root.
  # shellcheck disable=SC2016 # $1..$3 expand inside the bash -c subshell, not here.
  run_cmd 0 "" bash -c 'cd "$1" && node "$2" --file=components.json --from=html-v4-light --to=html-v4-dark --verbose > "$3" 2>&1' \
    _ "$dir" "$ROOT_DIR/tailwindplus-diff.js" "output.txt"

  check_file_exists "diff named by both formats" \
    "$dir/diffs/Marketing_Sections_Heroes_One_html-v4-light_to_html-v4-dark.diff"
  check_log_contains "mode-less component reported as skipped" "$dir/output.txt" 'no mode variants'
  check_log_contains "skipped component named" "$dir/output.txt" 'Product lists > Priced'

  # A mode asked of a file holding only mode-less components reaches nothing, which must be said
  # rather than reported as the two sides being identical.
  printf '{"component_count":1,"tailwindplus":{"Ecommerce":{"Components":{"Product lists":{"Priced":{"name":"Priced","snippets":[%s]}}}}}}\n' \
    "$modeless" > "$dir/ecommerce.json"

  # shellcheck disable=SC2016 # $1..$3 expand inside the bash -c subshell, not here.
  run_cmd 0 "" bash -c 'cd "$1" && node "$2" --file=ecommerce.json --from=html-v4-light --to=html-v4-dark > "$3" 2>&1' \
    _ "$dir" "$ROOT_DIR/tailwindplus-diff.js" "ecommerce.txt"

  check_log_contains "empty comparison reported" "$dir/ecommerce.txt" 'Nothing was compared'

  # An unreadable format is refused before any file is opened.
  # shellcheck disable=SC2016 # $1..$3 expand inside the bash -c subshell, not here.
  run_cmd 1 "" bash -c 'cd "$1" && node "$2" --file=components.json --from=html-v5 --to=html-v4-dark > "$3" 2>&1' \
    _ "$dir" "$ROOT_DIR/tailwindplus-diff.js" "invalid.txt"

  check_log_contains "invalid format explained" "$dir/invalid.txt" "Invalid format 'html-v5'"

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

# An option accepted on the command line but not carried through to the run is invisible: reading
# an absent property is not an error, so the value simply behaves as though it were never passed.
# --show-config is where that becomes observable, so it is asserted here.
test_options_reach_the_run() {
  local dir="$RUN_DIR/18-options-carried"
  mkdir -p "$dir"
  local fail_before=$FAIL

  # shellcheck disable=SC2016 # $1/$2 expand inside the bash -c subshell, not here.
  run_cmd 0 "" bash -c 'node "$1" --show-config --unauthenticated --retries=7 --workers=3 > "$2" 2>&1' \
    _ "$ROOT_DIR/tailwindplus-downloader.js" "$dir/config.json"

  check_log_contains "retries carried through" "$dir/config.json" '"retries": 7'
  check_log_contains "workers carried through" "$dir/config.json" '"workers": 3'
  check_log_contains "unauthenticated carried through" "$dir/config.json" '"unauthenticated": true'
  check_log_contains "unset options listed" "$dir/config.json" '"debugTrace": null'

  [[ "$FAIL" -eq "$fail_before" ]] && rm -rf "$dir"
}

test_diff_file_needs_formats() {
  local dir="$RUN_DIR/19-diff-file-formats"
  mkdir -p "$dir"
  local fail_before=$FAIL

  printf '{"tailwindplus":{"P":{"C":{"S":{"One":{"name":"One","snippets":[]}}}}}}\n' > "$dir/c.json"

  # Without a format pair the default sweep compares the file against itself and reports that it
  # is identical, which reads as a successful comparison.
  # shellcheck disable=SC2016 # $1..$3 expand inside the bash -c subshell, not here.
  run_cmd 1 "notty" bash -c 'cd "$1" && node "$2" --file=c.json > "$3" 2>&1' \
    _ "$dir" "$ROOT_DIR/tailwindplus-diff.js" "output.txt"

  check_log_contains "says what is missing" "$dir/output.txt" '\-\-from and \-\-to are required'

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
  "unauthenticated: no credentials needed|test_unauth_no_credentials"
  "unauthenticated: page with no free components|test_unauth_no_free_components"
  "unauthenticated: dir output format|test_unauth_dir_output"
  "URL file with no URLs aborts|test_url_file_empty"
  "interrupt shuts down cleanly|test_interrupt_shuts_down"
  "diff: component counts reported|test_diff_component_counts"
  "diff: formats within one file|test_diff_formats_within_one_file"
  "options reach the run|test_options_reach_the_run"
  "diff: --file needs a format pair|test_diff_file_needs_formats"
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
