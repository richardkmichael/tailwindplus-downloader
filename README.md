> [!WARNING]
> Thise was a "quick" yak shave, with a low bar and no tests.  It works.
>
> Improvements are welcome, but don't sweat it. :sunglasses:

# TailwindPlus Downloader

A downloader for TailwindPlus component HTML, and a diff-tool to compare HTML between downloads.

TailwindPlus component HTML is downloaded into a structured JSON file, preserving the component
organization.  The JSON output allows the use of `jq` for programmatic access.  For example, using
an LLM coding assistant such as Claude Code; see below for details.

The diff-tool is helpful because TailwindPlus undergoes small fixes for which there is no changelog.

## Features

- Downloads all UI components HTML into a JSON file, preserving the hierarchical organization
- Timestamped output files allow comparing component versions between downloads
- Handles authentication via cookies

### Using TailwindPlus with an agent

A small "skeleton" file with component names, but without full HTML, can be useful for an LLM coding
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
    if   type == "object" then reduce keys[] as $key ({}; . + {($key): ($in[$key] | walk)})
    elif type == "array"  then map(walk)
    elif type == "string" then "<HTML>"
    else .
    end;

walk
' tailwindplus-components-*.json > tailwindplus-skeleton.json
```

Add only the skeleton file as context to a coding session or project. Then provide the LLM access to
the full file with `jq` using a command execution MCP server and prompt instructions to use a tool
in conjunction with the skeleton file.  An MCP `jq` tool call will be similar to:

`jq '."Application UI".Elements.Buttons."Primary buttons"' --raw-output path/to/tailwindplus-components.json`

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Authenticate and download components:
   ```bash
   node tailwindplus-download.js --auth
   ```

3. Run subsequent downloads (uses saved cookies):
   ```bash
   node tailwindplus-download.js
   ```

## Usage

### Download Script

```bash
# Authenticate and download (first time)
node tailwindplus-download.js --auth

# Download with existing cookies
node tailwindplus-download.js

# Custom output location
node tailwindplus-download.js --output-path=./my-components.json

# Custom cookie location
node tailwindplus-download.js --cookies-path=./my-cookies.json

# Debug mode (show browser)
node tailwindplus-download.js --debug

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
  "Marketing": {
    "Page Sections": {
      "Hero Sections": {
        "Split with screenshot on dark": "<div class=\"...\">...</div>",
        "Split with screenshot": "<div class=\"...\">...</div>"
      }
    }
  },
  "Application UI": {
    ...
  }
}
```

## How It Works

The script uses Playwright automation to handle the dynamic JavaScript site, executing DOM queries
in the browser context.  The `--auth` flag displays the Playwright browser for manual login and
saves the cookies for future use.

1. Authenticates using browser cookies
2. Navigates the TailwindPlus site structure, extracting component HTML by clicking "View Code" buttons
4. Organizes everything into a nested JSON structure matching the site
5. Compares versions using diffs to spot Tailwind HTML and CSS changes


## Code Quality

This project uses ESLint v9 for code quality control.

```bash
# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```
