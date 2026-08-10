## Security Warnings
- Never use the timeout command to run anything.
- Do not use pkill with node and this script.

## Logging Best Practices
- Never console.log directly, always use the logger object if one exists.

## Testing Guidelines
- When testing the downloader scripts, use `--output=<SOME TEST FILE> --log`.  The `--log` flag creates a debug log with the same basename but `.log` suffix.

## Unit Tests

Cover the pure logic — entity decoding, page-data parsing, format selection, sorting, and the diff
tool's comparison logic.  No network, and they finish in under a second, so reach for these first:

```bash
npm run test:unit    # unit tests only
npm test             # unit tests, then the smoke suite
```

## Smoke Tests

Run the full suite from the repo root:

```bash
bash test/smoke-test.sh
```

Each run writes to a fresh `test/smoke-test-runs/run.PID/` directory so runs never overwrite each other and concurrent runs are safe.

Run only tests whose names contain a filter string (case-sensitive):

```bash
bash test/smoke-test.sh "auth"                     # all auth tests
bash test/smoke-test.sh "auth: credentials"        # one specific test
bash test/smoke-test.sh "JSON"                     # all JSON output tests
bash test/smoke-test.sh "non-TTY"                  # just the non-TTY abort tests
```

To generate a Playwright trace for a specific failing test, combine `--trace` with a filter (a filter is required — tracing a full run is not allowed):

```bash
bash test/smoke-test.sh --trace "dir: output with --log"
```

Trace files land in `<output-basename>.traces/` in the repo root (e.g. `dir.traces/`).  WARNING: traces contain login credentials and session tokens in plaintext — never commit or share them.

A trace covers the login flow only.  A browser is launched just for the login form; the downloads
run over Playwright's `APIRequestContext`, which tracing does not capture.  Trace a login or
session failure — for a failed download, read the `--log` file instead.

In the trace viewer, turn on absolute timestamps for both actions and network requests so they can
be lined up against a `--log` file.

Each test is self-contained in its own numbered subdirectory under `run.PID/` (e.g. `01-json-basic/`, `05-dir-exists-aborts/`).  Each test sets up its own preconditions and writes output to `output.json` or `output/` within its subdir.  Passing tests are cleaned up automatically; only failing test subdirs remain for inspection.  Check the relevant `output.log` file when a test fails.

## Testing a release tag via npx

Smoke-test with the URL file and a prefixed output file.  The `claude_exp__` prefix (two
underscores) is what the global gitignore matches, so the output and its `.log` stay untracked:

```bash
npx github:richardkmichael/tailwindplus-downloader#<tag> \
  --debug-url-file=test/many-test-urls.txt \
  --output=claude_exp__smoke-test.json \
  --log
```

A successful run logs: "10 URLs … 92 individual components".

## Linting
- Run eslint as: `npm run lint:fix` (uses `eslint.config.cjs`; plain `npx eslint` won't pick up the config)
- To lint a specific file: `npx eslint --config eslint.config.cjs --fix <FILE>`
- Run shellcheck on shell scripts: `shellcheck test/smoke-test.sh`

## Commit Message Format

Use conventional commits:
- `feat:` — new user-visible feature
- `fix:` — bug fix
- `perf:` — performance improvement
- `refactor:` — code restructuring, no behavior change
- `chore:` — maintenance, deps, tooling
- `docs:` — documentation only
- `test:` — tests only
- Add `BREAKING CHANGE: <description>` in the commit body for breaking changes

Multi-part changes: use bullet points in the body as before.
