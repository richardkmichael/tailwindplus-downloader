# TailwindPlus Downloader

A downloader for TailwindPlus components in HTML, React, and Vue formats across Tailwind CSS v3 and
v4, with diff tools to compare components between downloads.

TailwindPlus component HTML is downloaded into a structured JSON file, preserving the component
organization.  The JSON output allows the use of `jq` for programmatic access.  For example, using
an LLM coding assistant such as Claude Code; see below for details.

The diff tools are helpful because TailwindPlus undergoes small fixes for which there is no changelog.

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

  * use `jq` to query the full file for a _specific_ component's HTML
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

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create credentials file:
   ```bash
   echo '{"email": "your-email@example.com", "password": "your-password"}' > credentials.json
   ```

3. Download components:
   ```bash
   node tailwindplus-download.js
   ```

## Usage

### Download Script

```bash
# Basic download
node tailwindplus-download.js

# Custom output location
node tailwindplus-download.js --output ./my-components.json

# Custom credentials file
node tailwindplus-download.js --credentials ./my-credentials.json

# Adjust number of parallel workers
node tailwindplus-download.js --workers 3

# Debug mode (show browser window)
node tailwindplus-download.js --debug-headed

# Enable detailed logging
node tailwindplus-download.js --debug-log

# Short test (only first 2 sections)
node tailwindplus-download.js --debug-short-test

# Slow down browser actions (useful for debugging)
node tailwindplus-download.js --slow-mo 1000

# Help
node tailwindplus-download.js --help
```

### Diff Script

```bash
# Compare two most recent downloads automatically
./tailwindplus-diff.sh

# Compare specific files
./tailwindplus-diff.sh --old old-file.json --new new-file.json

# Help
./tailwindplus-diff.sh --help
```

## Dependencies

- **Node.js and npm** - For running the download script
- **jq** - Required for JSON processing in diff script
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
6. Failed downloads are automatically retried with exponential backoff


## Code Quality

This project uses ESLint v9 for code quality control.

```bash
# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```
