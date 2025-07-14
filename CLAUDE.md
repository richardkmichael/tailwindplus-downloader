## Security Warnings
- Never use the timeout command to run anything.
- Do not use pkill with node and this script.

## Logging Best Practices
- Never console.log directly, always use the logger object if one exists.

## Testing Guidelines
- When testing the downloader scripts, use `--output=<SOME TEST FILE>`.  This will also create a *debug* with the same basename, but .log suffix.  Review the script options for more information.

## Linting
- Run eslint as: `npx eslint --fix [OPTIONAL FILE]`
