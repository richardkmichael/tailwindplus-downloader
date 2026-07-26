# TailwindPlus Downloader

> [!NOTE]
> A TailwindPlus license is needed to get the most out of this downloader.

A downloader for TailwindPlus components (HTML, React, Vue) across Tailwind CSS v3 and v4 in
system, light, and dark modes. Includes a diff tool to compare any two formats, between downloads or
within one.

Download to a single JSON file (default) or directory tree of components, for multiple use-cases.

## Quick start

```bash
npx github:richardkmichael/tailwindplus-downloader#latest
```

Takes ~3-4 minutes. You will be prompted for TailwindPlus credentials; the session is saved
automatically for re-use.

Output is written to `tailwindplus-components-[TIMESTAMP].json` in the current directory.

## Setup

`npx` requires no installation.  A browser is needed only to log in, so Playwright Chromium and its
system dependencies are required for a first run, and for any run whose saved session has expired.

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

# Times to retry a page that fails to download (default 3)
npx github:richardkmichael/tailwindplus-downloader#latest --retries 5

# Print the resolved configuration and exit
npx github:richardkmichael/tailwindplus-downloader#latest --show-config

# Unauthenticated (downloads free/demo components only)
npx github:richardkmichael/tailwindplus-downloader#latest --unauthenticated
```

Within the repo, or with a global install, short-form aliases are available:
`npx twp-downloader`, `npx twp-diff`, `npx twp-create-skeleton`.

## Limitations

Do not change the format in the TailwindPlus web UI while a download is running. The downloader sets
the account format and verifies that pages come back in it, so a change made underneath the run
fails jobs with a format mismatch.

## Diff

Works with the JSON single file output to compare components between downloads, and to compare one
format against another. The diff tool is helpful because TailwindPlus undergoes small fixes for
which there is no changelog.

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

### Comparing formats

`--from` and `--to` name a format outright, using the same `framework-vN-mode` names the downloader
uses in its output and in directory-tree filenames.  Any format can be compared against any other,
across frameworks, versions and modes, and either side can come from either file.

```bash
# What a mode changes, within a single download
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff \
  --file components.json --from html-v4-light --to html-v4-dark

# How two frameworks differ, within a single download
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff \
  --file components.json --from html-v4-system --to vue-v4-system

# One format, between two downloads
npx --package=github:richardkmichael/tailwindplus-downloader#latest -- twp-diff \
  --old-file old.json --new-file new.json --from react-v4-dark --to react-v4-dark
```

`--file` reads both sides from one download.  `--from` and `--to` replace `--tw`, `--tw-from`,
`--tw-to` and `--framework`, which continue to work on their own.

A format written without a mode, `html-v4`, names the mode-less format.  eCommerce components are
downloaded that way and exist in 6 formats rather than 18, so asking a mode of them cannot match:
they are skipped, and the run reports how many were skipped and why.

## Dependencies

- Node.js and npm
- Playwright Chromium and its system dependencies — for logging in; a run with a saved session
  launches no browser
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
  "descriptions": {
    "products": {
      "Marketing": {
        "description": "Heroes, feature sections, newsletter sign up forms — ...",
        "pricing_description": "Heroes, feature sections, newsletter sign up forms — ..."
      }
    },
    "subcategories": {
      "Marketing.Page Sections.Hero Sections": {
        "description": "Hero section examples for Tailwind CSS, designed and built ...",
        "introduction": "Use these Tailwind CSS hero section examples to add ..."
      }
    }
  },
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

The `descriptions` section holds the prose TailwindPlus publishes for each product and
subcategory.  It sits beside the component tree rather than on its nodes, so the tree stays a
plain name-keyed hierarchy.  Subcategory keys are the dotted `product.category.subcategory` path
into that tree.  Categories and components have no descriptions upstream.

### Directory output

```
tailwindplus-components-[TIMESTAMP]/
├── metadata.json
├── descriptions.json
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

TailwindPlus renders each page's component data into the HTML as JSON, so the code is read out of
the response rather than off the rendered page.  Almost every step is a plain HTTP request.

1. Prompts for credentials, if not provided, and logs in to establish a session
2. Saves the session automatically, to use it on the next run -- no need to store credentials
3. Reads the component hierarchy from the discovery page
4. Sets the format -- framework, TailwindCSS version and mode -- with a single request
5. Runs workers to fetch component pages in parallel
6. Organizes the result into a hierarchy (JSON file or directory) matching the site

A browser is launched only for the login form.  A run with a saved session never starts one.

`--unauthenticated` works the same way, except the format applies per component rather than to the
whole account, so every format of a page is collected in one visit.

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

Unit tests cover the pure logic -- entity decoding, page-data parsing, format selection and
sorting -- and need no network.

```bash
npm run test:unit
```

The smoke tests cover option permutations (JSON and directory output, `--overwrite`, `--log`,
default timestamped paths, interrupts) using real downloads.  The ones that need no login run
against free sample components; the rest skip themselves unless a session or credentials file is
present, so the suite is usable without an account.

```bash
npm run smoke-test    # smoke tests only
npm test              # unit tests, then smoke tests
```
