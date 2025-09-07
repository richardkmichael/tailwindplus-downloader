# TailwindPlus Downloader

A downloader for TailwindPlus components in HTML, React, and Vue formats across Tailwind CSS v3 and
v4 in system, light, and dark modes; and a diff tool to compare components between downloads.

TailwindPlus component code is downloaded into a structured JSON file, preserving the component
organization.

The JSON output allows the use of `jq` for programmatic access.  For example, using an LLM coding
assistant such as Claude Code or the [TailwindPlus MCP
server](https://github.com/richardkmichael/mcp-tailwindplus). See below for more.

The diff tool is helpful because TailwindPlus undergoes small fixes for which there is no changelog.

## Quick start

See below for additional usage and authentication details.

1. Run the downloader, it will take ~3-4 minutes.  You will be prompted for TailwindPlus
   credentials.  The authenticated session will be automatically saved for re-use.

```bash
  npx github:richardkmichael/tailwindplus-downloader#latest
```

2. Review the downloaded components file:
   ```bash
   ls -l tailwindplus-components-*.json
   ```

## Authentication

Eventually the saved session will expire, and you will be prompted for credentials again.
You may optionally save credentials as a JSON file and it will automatically be used when needed,
instead of prompting.

Either choose to save credentials during a script run, or create the file:

```bash
echo '{"email": "your-email@example.com", "password": "your-password"}' > .tailwindplus-downloader-credentials.json
```

## Features

- Downloads all UI components in HTML, React, and Vue frameworks for both Tailwind CSS v3 and v4 in
  system, light, and dark modes into a JSON file, preserving the hierarchical organization
    - Note: eCommerce components do not have mode variations
- Defaults to a 15 worker pool with retries for fast, reliable downloads, adjust with `--workers N`
- Timestamped output files allow comparing component versions between downloads
- Handles authentication via stored credentials or interactive prompts with session persistence

### Using TailwindPlus with an agent

A small "skeleton" file with component names, but without full code, can be useful for an LLM coding
assistant (Claude Desktop / Code, etc.), since the complete component file is too large (~6 MB) for
context and often unnecessary.

The skeleton file provides the LLM with the structure of the JSON file, allowing it to:

  * use `jq` to query the full JSON file for the code for a _specific_ component
  * _search_ component _names_ to make component suggestions

Generate the skeleton file with `jq`:

```bash
jq '
def walk:
  . as $in |
    if type == "object" then
      reduce keys[] as $key ({}; . + {($key): ($in[$key] | walk)})
    elif type == "array" then
      map(walk)
    elif type == "string" then
      if length > 100 then "<CONTENT>" else . end
    else .
    end;

# Keep metadata, replace large string content in .tailwindplus
. + {"tailwindplus": (.tailwindplus | walk)}
' tailwindplus-components-*.json > tailwindplus-skeleton.json
```

Add only the skeleton file as context to a coding session or project. Then provide the LLM access to
the full file with `jq` using a command execution MCP server and prompt instructions to use a tool
in conjunction with the skeleton file.  An MCP `jq` tool call will be similar to:

`jq '.tailwindplus.Marketing."Page Sections"."Hero Sections"."Simple centered".snippets[] | select(.name == "html" and .version == 4) | .code' --raw-output path/to/tailwindplus-components.json`

## Additional usage

Within the repo, or with a global npm install, the commands below are available as:
  - `npx twp-downloader [...]`
  - `npx twp-diff [...]`

```bash
# Basic download
npx github:richardkmichael/tailwindplus-downloader#latest

# Custom output file
npx github:richardkmichael/tailwindplus-downloader#latest --output ./my-components.json

# Custom credentials file
npx github:richardkmichael/tailwindplus-downloader#latest --credentials ./my-credentials.json

# Custom session file
npx github:richardkmichael/tailwindplus-downloader#latest --session ./my-session.json

# Help, there are additional debug options
npx github:richardkmichael/tailwindplus-downloader#latest --help

# Adjust number of workers, default 15
npx github:richardkmichael/tailwindplus-downloader#latest --workers 10

# Debug mode (show browser window)
npx github:richardkmichael/tailwindplus-downloader#latest --debug-headed

# Enable logging to file, default name is the components output name, but `.log` (not `.json`):
npx github:richardkmichael/tailwindplus-downloader#latest --log

# Enable debug output (can be combined with `--log`)
npx github:richardkmichael/tailwindplus-downloader#latest --debug

# Short test (only first 2 URLs)
npx github:richardkmichael/tailwindplus-downloader#latest --debug-short-test
```

### Diff Script

The diff script has a variety of options to compare between different versions, or a framework only;
see help.

```bash
# Compare two most recent downloads automatically, assumes default downloader JSON filename.
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff

# Compare specific files
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff --old-file old-file.json --new-file new-file.json

# Show only component names that differ (no content comparison)
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff --names-only

# Help
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff --help
```

## Dependencies

- **Node.js and npm** - For running the download script
- **git** - Optional, provides better diffs (recommended)

## Data Structure

The downloader produces a JSON file with this structure:

```json
{
  "version": "2025-07-14-235056",
  "downloaded_at": "2025-07-14T23:50:56Z",
  "component_count": 33,
  "download_duration": "27.2s",
  "downloader_version": "2.0.0",
  "tailwindplus": {
    "Marketing": {
      "Page Sections": {
        "Hero Sections": {
          "Simple centered": {
            "name": "Simple centered",
            "snippets": [
              {
                "code": "<div class=\"...\">...</div>",
                "language": "html",
                "mode": "light",
                "name": "html",
                "preview": "...",
                "supportsDarkMode": true,
                "version": 4
              },
              {
                "code": "<div class=\"dark:bg-gray-900...\">...</div>",
                "language": "html",
                "mode": "dark",
                "name": "html",
                "preview": "...",
                "supportsDarkMode": true,
                "version": 4
              },
              {
                "code": "<div className=\"...\">...</div>",
                "language": "jsx",
                "mode": "light",
                "name": "react",
                "preview": "...",
                "supportsDarkMode": true,
                "version": 4
              },
              {
                "code": "<div className=\"dark:bg-gray-900...\">...</div>",
                "language": "jsx",
                "mode": "dark",
                "name": "react",
                "preview": "...",
                "supportsDarkMode": true,
                "version": 4
              }
            ]
          }
        }
      }
    }
  }
}
```

## How It Works

The script uses Playwright automation with workers (browserContexts) to handle the React/InertiaJS
site.  It includes robust authentication handling and precision data waiting to ensure reliable data
extraction.

1. Prompts for credentials, if not provided, and logs in to establish a session
2. Saves the session information automatically, to use it on the next run -- no need to store credentials
3. Discovers the complete TailwindPlus component hierarchy as a collection of pages
4. Uses on-page controls to iterate through the "format": framework, TailwindCSS version, and mode
5. Creates workers to process multiple component pages simultaneously
6. All component data is organized into a hierarchical JSON structure matching the site organization


## Code Quality

This project uses ESLint v9 for code quality control.

```bash
# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```
