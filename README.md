# TailwindPlus Downloader

> [!NOTE]
> A TailwindPlus license is needed to get the most out of this downloader.

A downloader for TailwindPlus components in HTML, React, and Vue formats across Tailwind CSS v3 and
v4 in system, light, and dark modes; and a diff tool to compare components between downloads.

TailwindPlus components are downloaded into a structured JSON file or a directory tree of individual
files, preserving the component organization.

The JSON file can be used with the [TailwindPlus MCP
server](https://github.com/richardkmichael/mcp-tailwindplus), or directly with `jq`. The directory
output allows an agent to naturally discover and read components using regular CLI tooling. See below
for more.

The diff tool is helpful because TailwindPlus undergoes small fixes, for which there is no changelog.

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

## Credentials

Eventually the saved session will expire, and you will be prompted for credentials again.
You may optionally save credentials as a JSON file and it will automatically be used when needed,
instead of prompting.

Either choose to save credentials during a script run, or create the file:

```bash
echo '{"email": "your-email@example.com", "password": "your-password"}' > .tailwindplus-downloader-credentials.json
```

## Features

- Downloads all UI components in HTML, React, and Vue frameworks for both Tailwind CSS v3 and v4 in
  system, light, and dark modes, preserving the hierarchical organization
    - Note: eCommerce components do not have modes
- Two output formats: a single JSON file (`--output-format=json`, default) or a directory tree of
  individual component files (`--output-format=dir`)
- Defaults to a 15 worker pool with retries for fast, reliable downloads, adjust with `--workers N`
- Timestamped output names allow comparing component versions between downloads
- Handles authentication via stored credentials or interactive prompts with session persistence
- Prompts before overwriting existing output; use `--overwrite` to skip the prompt in scripts

## Using TailwindPlus with an agent

### MCP Server

> [!TIP]
> Use the [TailwindPlus MCP server](https://github.com/richardkmichael/mcp-tailwindplus).  It uses the JSON file from the downloader.

Then ask for a component:

```
> I need a simple one-line search input to put in the app header.

 mcp-tailwindplus - Get Component by Full Name (MCP)(full_name: "Application UI.Forms.Input Groups.Input with leading icon", framework: "react", tailwind_version: "4")
  ⎿  {
       "version": "2025-07-14-204017",
       "full_name": "Application UI.Forms.Input Groups.Input with leading icon",
     … +15 lines (ctrl+r to expand)

 mcp-tailwindplus - Get Component by Full Name (MCP)(full_name: "Application UI.Forms.Input Groups.Input with keyboard shortcut", framework: "react", tailwind_version: "4")
  ⎿  {
       "version": "2025-07-14-204017",
       "full_name": "Application UI.Forms.Input Groups.Input with keyboard shortcut",
     … +16 lines (ctrl+r to expand)


 Perfect! Here are two ideal options for a header search input:

  1. Input with Leading Icon

  Application UI.Forms.Input Groups.Input with leading icon
  - Simple search input with magnifying glass icon
  - Just swap the EnvelopeIcon for MagnifyingGlassIcon
  - Clean, compact design perfect for headers

  2. Input with Keyboard Shortcut

  Application UI.Forms.Input Groups.Input with keyboard shortcut
  - Shows "⌘K" shortcut hint
  - Modern search UX that users expect
  - Great for power users

  For a header, I'd recommend the first one with a search icon - it's the most recognizable and space-efficient.
```

### Directory output

Use `--output-format=dir` to write each component snippet as an individual file in a directory tree.
An agent can then discover and selectively read components using regular CLI tooling (`ls`, `cat`,
etc.) without loading the entire ~6 MB JSON file into context.

```bash
npx github:richardkmichael/tailwindplus-downloader#latest --output-format=dir
```

The directory structure mirrors the component hierarchy:

```
tailwindplus-components-[TIMESTAMP]/
├── metadata.json
└── Marketing/
    └── Page Sections/
        └── Hero Sections/
            └── Simple centered/
                ├── v3/
                │   ├── html-light.html
                │   ├── html-dark.html
                │   ├── html-system.html
                │   ├── react-light.jsx
                │   └── ...
                └── v4/
                    ├── html-light.html
                    └── ...
```

### Directly use the JSON data file

A small "skeleton" file with component names, but without full code, can be useful for an LLM coding
assistant (Claude Desktop / Code, etc.), since the complete component file is too large (~6 MB) for
context and often unnecessary.

The skeleton file provides the LLM with the structure of the JSON file, allowing it to:

  * use `jq` to query the full JSON file for the code for a _specific_ component
  * _search_ component _names_ to make component suggestions

Create the skeleton file:

```bash
npm run create-skeleton
npm run create-skeleton -- myfile.json   # pass a specific file (note: -- is required by npm)
# or directly: scripts/create-skeleton.sh [--help] [FILE]
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

# Directory output (default name: tailwindplus-components-[TIMESTAMP]/)
npx github:richardkmichael/tailwindplus-downloader#latest --output-format=dir

# Directory output to a specific path
npx github:richardkmichael/tailwindplus-downloader#latest --output-format=dir --output=./components

# Overwrite existing output without prompting (useful in scripts with a fixed --output path)
npx github:richardkmichael/tailwindplus-downloader#latest --output=./components --output-format=dir --overwrite

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

### Unauthenticated usage

The downloader can run unauthenticated, which will download only the freely available TailwindPlus
components.  This can be helpful for testing, or examining the JSON file structure.

However, there are very few free TailwindPlus components -- they are intended as demo only.

TailwindPlus must be purchased for this downloader to be useful.

```bash
npx github:richardkmichael/tailwindplus-downloader#latest --unauthenticated [options]
```


## Diff Script

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
