## Security Warnings
- Never use the timeout command to run anything.
- Do not use pkill with node and this script.

## Logging Best Practices
- Never console.log directly, always use the logger object if one exists.

## Testing Guidelines
- When testing the downloader scripts, use `--output=<SOME TEST FILE> --log`.  The `--log` flag creates a debug log with the same basename but `.log` suffix.

## Testing a release tag via npx

Smoke-test with the URL file and a prefixed output file:

```bash
npx github:richardkmichael/tailwindplus-downloader#<tag> \
  --debug-url-file=test/smoke-test-urls.txt \
  --output=claude_exp-smoke-test.json \
  --log
```

A successful run logs: "10 URLs … 92 individual components".

## Linting
- Run eslint as: `npm run lint:fix` (uses `eslint.config.cjs`; plain `npx eslint` won't pick up the config)
- To lint a specific file: `npx eslint --config eslint.config.cjs --fix <FILE>`

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
