## Security Warnings
- Never use the timeout command to run anything.
- Do not use pkill with node and this script.

## Logging Best Practices
- Never console.log directly, always use the logger object if one exists.  The one exception is the
  top-level fatal handler, which runs after teardown has closed the logger and so has no other
  channel.

## The TailwindPlus Site

How the site itself behaves — where the page data lives, how a format change is made, why no browser
is needed to read, session cookies, URL structure — is written up in
[docs/TAILWINDPLUS_ARCHITECTURE.md](docs/TAILWINDPLUS_ARCHITECTURE.md).  Read it before changing how
the downloader reads the site, and when a download breaks in a way the logs do not explain.

It describes the site, not the downloader, so it stays accurate as the downloader changes.

## Testing Guidelines
- Run with `--log`.  It writes a debug log beside the output, same basename with a `.log` suffix.
- Leave `--output` at its default.  It is timestamped and `.gitignore` matches it, so runs cannot
  clobber each other and downloaded components stay out of tracked paths.

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

Every test that downloads needs a session or credentials file and skips without one, so a
credential-free run covers argument handling, the abort paths and the diff tool.  CI runs in that
configuration; a real download is exercised by the weekly site-monitor workflow instead.

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

Trace files land in `<output-basename>.traces/` in the repo root.  Every smoke test writes to `output.json` or `output/`, so a traced run puts them in `output.traces/`.  WARNING: traces contain login credentials and session tokens in plaintext — never commit or share them.

A trace covers the login flow only.  A browser is launched just for the login form; the downloads
run over Playwright's `APIRequestContext`, which tracing does not capture.  Trace a login or
session failure — for a failed download, read the `--log` file instead.

In the trace viewer, turn on absolute timestamps for both actions and network requests so they can
be lined up against a `--log` file.

Each test is self-contained in its own numbered subdirectory under `run.PID/` (e.g. `01-json-basic/`, `05-dir-exists-aborts/`).  Each test sets up its own preconditions and writes output to `output.json` or `output/` within its subdir.  Passing tests are cleaned up automatically; only failing test subdirs remain for inspection.  Check the relevant `output.log` file when a test fails.

## Testing a release tag via npx

Smoke-test with the URL file, leaving the output at its default.  That names the download and its
log `tailwindplus-components-<timestamp>`, which the repository ignores and which no earlier run
can clobber:

```bash
npx github:richardkmichael/tailwindplus-downloader#<tag> \
  --debug-url-file=test/many-test-urls.txt \
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

Multi-part changes: use bullet points in the body.
