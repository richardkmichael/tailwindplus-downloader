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
