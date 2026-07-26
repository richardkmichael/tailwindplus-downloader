---
name: release
description: Create release candidates or final releases for this project. Use when
  the user invokes `/release rc` (published pre-release RC), `/release` (published
  final release), `/release draft rc` (draft pre-release RC), or `/release draft`
  (draft final release). Handles version detection, semver assessment from commits,
  git tagging, package.json bumping, and GitHub release creation with a point-form
  changelog.
disable-model-invocation: true
---

# Release Skill

## Invocation
- `/release rc` — published pre-release (RC)
- `/release` — published final release
- `/release draft rc` — draft pre-release (RC)
- `/release draft` — draft final release

## Conventions
- Annotated tags only: `git tag -a <tag> -m "<tag>"`
- RC tags: `vX.Y.Z-rc.N` — bump package.json + package-lock.json to match, commit first
- Final tags: `vX.Y.Z` — bump package.json + package-lock.json, dropping the `-rc.N` suffix, commit first
- Conventional commits inform semver assessment: `feat:` → minor, `BREAKING CHANGE:` → major, else → patch

The dot in `-rc.N` is load-bearing.  Semver reads a dotless `rc10` as one alphanumeric identifier
and compares it as a string, so `3.4.0-rc10` sorts *below* `3.4.0-rc2`.  With the dot it is a
numeric identifier and compares numerically.

Every build reports its own version: `downloader_version` is written into each downloaded file, so
an RC whose package.json still held the previous release would be indistinguishable from it.

## Tag Queries
```bash
# Last tag of any kind
git tag -l 'v[0-9]*' --sort=-version:refname | head -1

# Last final tag (no rc) — grep needed; git tag -l patterns support inclusion only
git tag -l 'v[0-9]*' --sort=-version:refname | grep -v -- '-rc' | head -1
```

## RC Release Workflow

1. Find both the last final tag and the last RC tag (if any)
2. Get commits since last final: `git log <last-final>..HEAD --oneline`
3. Assess semver from commits:
   - Any `BREAKING CHANGE:` in commit body → major
   - Any `feat:` → at least minor
   - Otherwise → patch
   - Before conventional commits were adopted: use judgment — user-visible changes count, internal maintenance does not
4. Present proposed next tag and confirm with user:
   - If RC series already in progress (e.g. `v3.2.0-rc.3`): default is `v3.2.0-rc.4`; also show semver suggestion in case user wants to revise the version base
   - If starting fresh from a final tag: show all three options (`vX.Y.Z-rc.1` for patch/minor/major)
5. Get commits for changelog: `git log <last-rc-or-final>..HEAD --oneline` (incremental — since last RC, or since last final if this is rc.1)
6. Write point-form draft changelog (see Changelog Format below)
7. Show proposed tag + changelog, wait for user confirmation before executing
8. Bump `version` in package.json to `X.Y.Z-rc.N` (no `v` prefix), then run `npm install` to sync package-lock.json
9. Commit only the version bump: `git add package.json package-lock.json` then commit `chore: bump version to vX.Y.Z-rc.N`
10. Execute:
    ```bash
    git tag -a <new-rc-tag> -m "<new-rc-tag>"
    git push origin <new-rc-tag>
    # Add --draft if invoked as `/release draft rc`
    gh release create <new-rc-tag> --prerelease [--draft] --title "<new-rc-tag>" --notes "<changelog>"
    ```

## Final Release Workflow

1. Find last final tag
2. Check for package.json / tag version mismatch:
   - Strip `v` from last final tag, compare to `version` in package.json
   - A `-rc.N` suffix in package.json is expected when an RC series is in progress; compare the
     release portion, and the bump below drops the suffix
   - If the release portions disagree: tell user and ask how to proceed (use tag version as base,
     use package.json version, or specify manually)
3. Get commits since last final: `git log <last-final>..HEAD --oneline`
4. Assess semver (same rules as above); suggest version, confirm with user
5. Bump `version` in package.json (no `v` prefix), then run `npm install` to sync package-lock.json
6. Commit only the version bump: `git add package.json package-lock.json` then commit `chore: bump version to vX.Y.Z`
7. Write point-form draft changelog covering full range since last final (spans all RCs)
8. Show proposed tag + changelog, wait for user confirmation before executing
9. Execute:
   ```bash
   git tag -a <new-final-tag> -m "<new-final-tag>"
   git push origin <new-final-tag>
   # Add --draft if invoked as `/release draft`
   gh release create <new-final-tag> [--draft] --title "<new-final-tag>" --notes "<changelog>"
   ```

## Changelog Format

Point-form. Include: `feat:`, `fix:`, `perf:`, `docs:`. Omit: `chore:`, `refactor:`, `test:`.
Before conventional commits were adopted, use judgment: user-visible changes in, internal maintenance out.

Always end with the full changelog compare link:
`**Full Changelog**: https://github.com/richardkmichael/tailwindplus-downloader/compare/<from>...<to>`

If there are no user-facing changes, open with `No user-facing changes.` then list the internal items:

```markdown
No user-facing changes.

- Simplified internal helpers
- Updated dependencies

**Full Changelog**: https://github.com/richardkmichael/tailwindplus-downloader/compare/v3.2.0-rc.3...v3.2.0-rc.4
```

If there are user-facing changes, use sections:

```markdown
## What's Changed
- Added directory output format (`--output-format=dir`)
- Fixed navigation timeout retry handling

## Breaking Changes
- No longer silently overwrites existing output; use `--overwrite` to allow this.

**Full Changelog**: https://github.com/richardkmichael/tailwindplus-downloader/compare/v3.1.0...v3.2.0-rc.1
```
