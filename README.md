# TailwindPlus Downloader

> [!NOTE]
> A TailwindPlus license is needed to get the most out of this downloader.

A downloader for TailwindPlus components (HTML, React, Vue) across Tailwind CSS v3 and v4 in
system, light, and dark modes. Includes a diff tool to compare component versions between downloads.

Download to a single JSON file (default) or directory tree of components, for multiple use-cases.

## Quick start

```bash
npx github:richardkmichael/tailwindplus-downloader#latest
```

Takes ~3-4 minutes. You will be prompted for TailwindPlus credentials; the session is saved
automatically for re-use.

Output is written to `tailwindplus-components-[TIMESTAMP].json` in the current directory.

## Setup

`npx` requires no installation.  Playwright Chromium requires system dependencies to be installed.

To use the agent skill, clone the repo and symlink, or copy the
[`contrib/tailwind-plus/`](contrib/tailwind-plus/) directory from GitHub:

```bash
git clone https://github.com/richardkmichael/tailwindplus-downloader
```

With a clone, in-repo commands are also available:
- `npx twp-downloader`
- `npx twp-diff`
- `npx twp-create-skeleton`

## Output

Both JSON and directory output formats default to a timestamped destination.

### JSON (default)

Downloads all components to a single JSON file. See [Data Format](#data-format).

Use with the [TailwindPlus MCP server](https://github.com/richardkmichael/mcp-tailwindplus), use the
agent skill, or query directly with `jq`.

```bash
# → tailwindplus-components-[TIMESTAMP].json
npx github:richardkmichael/tailwindplus-downloader#latest

npx github:richardkmichael/tailwindplus-downloader#latest --output ./twp.json
```

### Directory

Downloads each component snippet as an individual file in a directory tree. See [Data Format](#data-format).

Agents can discover and read components using CLI tools (`ls`, `cat`, etc.) without loading the full
JSON into context.

```bash
# → tailwindplus-components-[TIMESTAMP]/
npx github:richardkmichael/tailwindplus-downloader#latest --output-format=dir

npx github:richardkmichael/tailwindplus-downloader#latest --output-format=dir --output=./twp
```

## Credentials

Eventually the saved session will expire and you will be prompted for credentials again.  To avoid
prompting, save credentials as a JSON file:

```bash
echo '{"email": "your-email@example.com", "password": "your-password"}' > .tailwindplus-downloader-credentials.json
```

## Using with an agent

### MCP Server

> [!TIP]
> Use the [TailwindPlus MCP server](https://github.com/richardkmichael/mcp-tailwindplus).  It uses the JSON file from the downloader.

Ask for a component:

```
> I need a simple one-line search input to put in the app header.

 mcp-tailwindplus - Get Component by Full Name (MCP)(full_name: "Application UI.Forms.Input Groups.Input with leading icon", framework: "react", tailwind_version: "4")
  ⎿  {
       "version": "2025-07-14-204017",
       "full_name": "Application UI.Forms.Input Groups.Input with leading icon",
     … +15 lines (ctrl+r to expand)

 mcp-tailwindplus - Get Component by Full Name (MCP)(full_name: "Application UI.Forms.Input Groups.Input with keyboard shortcut", framework: "react", tailwind_version: "4")
  ⎿  {
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

### Agent skill

A skill in [`contrib/tailwind-plus/`](contrib/tailwind-plus/) allows the agent to automatically
browse and read components from the directory output when asked to build UI. See [Setup](#setup) for
installation options.

Install by symlinking into a skills directory:

```bash
# Global
ln -s /path/to/tailwindplus-downloader/contrib/tailwind-plus ~/.claude/skills/tailwind-plus

# Project
ln -s /path/to/tailwindplus-downloader/contrib/tailwind-plus .claude/skills/tailwind-plus
```

### Skeleton file

The full JSON file is too large for LLM context. A skeleton file contains component names without
code, allowing the LLM to search names and use `jq` to fetch specific component code on demand via a
command execution MCP server.

```bash
# Within the repo:
npm run create-skeleton
npm run create-skeleton -- twp.json   # specific file (note: -- is required by npm)

# Via npx:
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-create-skeleton
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-create-skeleton twp.json
```

Add the skeleton file as context to a coding session. Example `jq` query:

```
jq '.tailwindplus.Marketing."Page Sections"."Hero Sections"."Simple centered".snippets[] | select(.name == "html" and .version == 4) | .code' --raw-output path/to/twp.json
```

## Additional usage

```bash
# Help (includes all options and debug flags)
npx github:richardkmichael/tailwindplus-downloader#latest --help

# Adjust workers (default 15)
npx github:richardkmichael/tailwindplus-downloader#latest --workers 10

# Overwrite existing output without prompting (useful in scripts)
npx github:richardkmichael/tailwindplus-downloader#latest --output=./twp --overwrite

# Custom credentials or session file
npx github:richardkmichael/tailwindplus-downloader#latest --credentials ./my-credentials.json
npx github:richardkmichael/tailwindplus-downloader#latest --session ./my-session.json

# Unauthenticated (downloads free/demo components only)
npx github:richardkmichael/tailwindplus-downloader#latest --unauthenticated
```

Within the repo, or with a global install, short-form aliases are available:
`npx twp-downloader`, `npx twp-diff`, `npx twp-create-skeleton`.

## Diff

Works with the JSON single file output to compare component versions between downloads. The diff
tool is helpful because TailwindPlus undergoes small fixes for which there is no changelog.

```bash
# Compare two most recent downloads automatically (assumes default filename)
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff

# Compare specific files
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff --old-file old.json --new-file new.json

# Show only component names that differ
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff --names-only

# Help
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff --help
```

## Dependencies

- Playwright Chromium system dependencies
- Node.js and npm
- git — optional, provides better diffs (recommended)

## Data Format

### JSON output

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

### Directory output

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
                │   ├── react-dark.jsx
                │   ├── react-system.jsx
                │   ├── vue-light.vue
                │   └── ...
                └── v4/
                    ├── html-light.html
                    └── ...
```

## How It Works

The script uses Playwright automation with workers to handle the React/InertiaJS site.  It includes
robust authentication handling and waiting to ensure reliable data extraction.

1. Prompts for credentials, if not provided, and logs in to establish a session
2. Saves the session information automatically, to use it on the next run -- no need to store credentials
3. Discovers the complete TailwindPlus component hierarchy as a collection of pages
4. Uses on-page controls to iterate through the "format": framework, TailwindCSS version, and mode
5. Creates workers to process multiple component pages simultaneously
6. Component data is organized into a hierarchy (JSON file or directory) matching the site organization

## Development

### Code Quality

This project uses ESLint v9 for code quality control.

```bash
# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```

### Testing

The smoke test covers permutations of output options (JSON and directory formats, `--overwrite`,
`--log`, default timestamped paths) using actual downloads.  Takes ~7 minutes.  Requires an
authenticated session or credentials file.

```bash
npm run smoke-test
```
