# TailwindPlus Site Architecture

How the TailwindPlus website works, and which of its behaviours the downloader depends on.  The
site is an InertiaJS application, which shapes both what can be read and how the format is changed.

Everything here was observed against the live site.  Where a behaviour is relied upon, the way it
was confirmed is stated, because these are someone else's implementation details and can change.

## The data is in the page

Every component page is server-rendered with its data embedded as JSON:

```html
<div id="app" data-page='{"component":"ComponentCategory","props":{...}}'></div>
```

`props.subcategory.components` carries each component's name, flags, and a `snippet` holding the
actual source code.  Nothing needs to be clicked or scraped out of the rendered DOM: a plain GET
returns the code.

This is the single most important fact about the site for this tool.  `parseDataPageFromHtml`
extracts and parses that attribute, and every read in the downloader goes through it.

### `data-page` is only fresh on a full load

Once React hydrates, InertiaJS intercepts navigation and control changes, requests JSON over XHR,
and updates React state directly.  The `data-page` attribute is never rewritten.

Reading it after an in-page interaction therefore yields the original load's data.  The downloader
sidesteps this entirely by never interacting with a page: each read is a new request, so the
attribute it parses is always the response's own.

## Changing format

Format is a triple of framework, TailwindCSS version and mode, written `framework-vN-mode` — for
example `react-v4-dark`.  Components with no mode are written `html-v4`.

The site changes it with a request, which the downloader issues directly:

```
PUT https://tailwindcss.com/plus/ui-blocks/language
  content-type: application/json
  x-xsrf-token: <URL-decoded XSRF-TOKEN cookie>

  {"uuid":"<component uuid>","snippet_lang":"react-v4-dark"}
```

The response redirects back to the page, which there is no need to follow: the caller reads the
page itself afterwards.

Two details matter and are easy to get wrong:

The `x-xsrf-token` header is required.  Without it the request is rejected with `419 Page Expired`.
Its value is the `XSRF-TOKEN` cookie, URL-decoded.

`snippet_lang` sets all three axes at once.  There is no need to change framework, version and mode
separately.

### Scope differs by authentication, and that shapes everything

| Session | Scope of a format change | Consequence |
|---|---|---|
| Authenticated | The whole account | One request, then every page returns that format |
| Anonymous | The named component only | Each component must be set individually |

Confirmed by measurement rather than assumption.  Authenticated, a PUT naming one component
changed all twelve components on the page — and a PUT with no `uuid` at all also worked, so the
downloader omits it.  Anonymous, the same request changed only the named component and left a
second component on the same page untouched; a PUT without a `uuid` was accepted and changed
nothing.

This is why the two modes are shaped differently and cannot be collapsed into one:

- Authenticated: set the format once, then fetch every page.  Repeat for each of the 18 formats.
- Anonymous: set every component on a page, read the page once, and repeat per format.  A page's
  whole format set is collected in one visit.

The second is why anonymous runs cost one read per format rather than one per component per format.

### Reading the response

After setting the format, the page can be read either way:

- A plain GET returns the rendered HTML, and `data-page` carries the new snippets.
- A GET with `x-inertia: true`, `x-inertia-version: <version>` and
  `x-requested-with: XMLHttpRequest` returns the same props as JSON, at roughly a third of the
  bytes.

The downloader uses the Inertia form and falls back to a full read when it has no version yet.  A
stale version — after the site is redeployed mid-run — is answered with `409 Conflict` and an
`X-Inertia-Location` header, which is handled by re-reading the page in full to pick up the current
version.

The version value comes from the `version` field of the page data itself.

## No browser is needed to read

Playwright's `APIRequestContext` performs all of this with no browser binary present.  Confirmed by
running with `PLAYWRIGHT_BROWSERS_PATH` pointed at an empty directory: requests succeeded while
`chromium.launch` failed because no executable existed.

A browser is launched only for the login form, which is the one interaction that genuinely needs
one.  The session is then exported with `storageState` and handed to a request context, so a run
with a valid session never starts a browser at all.

That is also why CI installs no browser: the tests that run without credentials never reach login.

## Component listings

### Every component is listed twice

Each component appears once per preview variant, light and dark.  The two records have distinct
uuids and different snippets — the light record carries `mode: "light"` code, the dark record
`mode: "dark"` code.  On a page of twelve components, `props.subcategory.components` holds
twenty-four entries with twenty-four distinct uuids and twelve distinct names.

Only one record per component is wanted, since the downloader drives the format across all of them
anyway, and two records sharing a name would collide in the output.  `selectFreeComponents` keeps
one per name, preferring the light record, and takes whichever is flagged if only one is.

An earlier version of this document described the duplicate as an apparent server-side bug.  It is
not: it is how the catalogue is structured.

### uuids are opaque and unstable

The uuid is TailwindPlus-internal.  It is required by the format request when anonymous, and is
used within a single page's fetch cycle to match a response back to the component it belongs to.
It is never written to the output and nothing assumes it survives between runs.

Because it could change underneath a run, the count of collected formats is checked before a
component is written; a page that comes up short fails its job rather than being written with
formats missing.

### `downloadable` marks free components

Anonymous, only components with `downloadable: true` return code.  Everything else requires a
license.  Which components are free is TailwindPlus's choice and changes: some subcategories offer
one free sample, some offer two, and some — footers, for instance — offer none at all.

## Format combinations

Three frameworks, two versions and three modes give 18 combinations.

eCommerce components have no mode: their snippets carry `mode: null`, so they exist in 6
combinations, one per framework and version.  Asking for a mode on them cannot match.  Both the
downloader and the diff tool detect this from the data rather than by probing the page.

Modes are code variants, not display preferences:

- `system` — includes both light and dark classes, using `dark:` variants
- `light` — light theme only
- `dark` — dark theme only

## Session cookies

An anonymous GET of any page returns everything needed to make a format request:

| Cookie | Role |
|---|---|
| `XSRF-TOKEN` | CSRF token; readable, not httpOnly |
| `tailwind_plus_session` | Laravel session |
| 40-character random name | Encrypted state; the name varies per session |

Values are encrypted and base64-encoded.  Clearing them resets the format to the default.

## URL structure

Base: `https://tailwindcss.com/plus/ui-blocks`

Component pages: `/plus/ui-blocks/{product}/{category}/{subcategory}`, for example
`/plus/ui-blocks/marketing/sections/heroes` or
`/plus/ui-blocks/ecommerce/components/product-overviews`.

The discovery page at the base URL carries the whole hierarchy in its page data, including the
prose descriptions TailwindPlus publishes for each product.  Subcategory descriptions appear on the
component pages instead, which is why the two are captured at different points in a run.

## What would break this

The site is not a documented API, so it is worth knowing what the tool is exposed to:

- The `data-page` attribute, and the shape of `props.subcategory.components`
- The format endpoint, its `snippet_lang` spelling, and the CSRF header it requires
- The scope difference between authenticated and anonymous format changes
- The login form, the only remaining browser interaction

A change to any of these surfaces as a failed run rather than as wrong output: format verification
re-reads the page after setting it, and a component whose formats do not all arrive fails its job.
