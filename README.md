# TailwindPlus Downloader

A downloader for TailwindPlus components in HTML, React, and Vue formats across Tailwind CSS v3 and
v4, with diff tools to compare components between downloads.

TailwindPlus component HTML is downloaded into a structured JSON file, preserving the component
organization.

The JSON output allows the use of `jq` for programmatic access.  For example, using
an LLM coding assistant such as Claude Code or an MCP server, see below for details.

The diff tools are helpful because TailwindPlus undergoes small fixes for which there is no changelog.

## Usage

See below for additional usage.

1. Create credentials file:
   ```bash
   echo '{"email": "your-email@example.com", "password": "your-password"}' > credentials.json
   ```

2. Download components, will take around 5 minutes running with 5 parallel workers:
   ```bash
   npx github:richardkmichael/tailwindplus-downloader#latest
   ```

3. Downloaded components file:
   ```bash
   ls -l tailwindplus-components-*.json
   ```

## Features

- Downloads all UI components in HTML, React, and Vue formats for both Tailwind CSS v3 and v4 into a
  JSON file, preserving the hierarchical organization
- Parallel worker pool with retries for fast, reliable downloads
- Timestamped output files allow comparing component versions between downloads
- Handles authentication via stored credentials
- Configurable slowMo timing to work around React hydration issues

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

```bash
# Basic download
npx github:richardkmichael/tailwindplus-downloader#latest

# Custom output location
npx github:richardkmichael/tailwindplus-downloader#latest --output ./my-components.json

# Custom credentials file
npx github:richardkmichael/tailwindplus-downloader#latest --credentials ./my-credentials.json

# Help, there are additional debug options
npx github:richardkmichael/tailwindplus-downloader#latest --help

# Adjust number of parallel workers, default 5
npx github:richardkmichael/tailwindplus-downloader#latest --workers 3

# Debug mode (show browser window)
npx github:richardkmichael/tailwindplus-downloader#latest --debug-headed

# Enable detailed logging
npx github:richardkmichael/tailwindplus-downloader#latest --debug-log

# Short test (only first 2 sections)
npx github:richardkmichael/tailwindplus-downloader#latest --debug-short-test

# Slow down browser actions (useful for debugging)
npx github:richardkmichael/tailwindplus-downloader#latest --slow-mo 1000
```

### Diff Script

The diff script has a variety of options to compare between different versions, or a framework only;
see help.

```bash
# Compare two most recent downloads automatically, assumes default downloader JSON filename.
./tailwindplus-diff.js

# Compare specific files
./tailwindplus-diff.js --old-file old-file.json --new-file new-file.json

# Help
./tailwindplus-diff.js --help
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
                "supportsDarkMode": false,
                "version": 4
              },
              {
                "code": "<div className=\"...\">...</div>",
                "language": "jsx",
                "mode": "light",
                "name": "react",
                "preview": "...",
                "supportsDarkMode": false,
                "version": 4
              },
              {
                "code": "<div class=\"...\">...</div>",
                "language": "vue",
                "mode": "light",
                "name": "vue",
                "preview": "...",
                "supportsDarkMode": false,
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

The script uses Playwright automation with a parallel worker pool architecture to handle the dynamic JavaScript site. It includes configurable slowMo timing to work around React hydration issues and ensure reliable data extraction.

1. Discovers the complete TailwindPlus component hierarchy from the discovery page
2. Creates a parallel worker pool to process multiple component pages simultaneously
3. Each worker authenticates using stored credentials and navigates to component pages
4. Workers extract component data by configuring framework/version selectors and waiting for API responses
5. All component data is organized into a hierarchical JSON structure matching the site organization
6. Failed downloads are automatically retried


## Code Quality

This project uses ESLint v9 for code quality control.

```bash
# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```
