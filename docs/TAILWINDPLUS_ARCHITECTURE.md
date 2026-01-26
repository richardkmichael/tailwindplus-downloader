# TailwindPlus Site Architecture

This document explains how the TailwindPlus website works. Understanding this is
critical for maintaining the downloader script, because the site uses InertiaJS
which has non-obvious behavior that affects how we extract component data.

## InertiaJS: The Core Concept

TailwindPlus is built with InertiaJS (https://inertiajs.com/), a library that
creates single-page application (SPA) behavior on top of server-rendered pages.

The key insight: InertiaJS pages look like traditional server-rendered HTML, but
after the initial load, all navigation happens via XHR requests that return JSON.
The page never fully reloads - React updates the DOM from the JSON response.

This has major implications for scraping.

## The `#app` Element and `data-page` Attribute

### Initial Page Load

When you first navigate to a TailwindPlus page (e.g., opening a URL in a new tab),
the server returns full HTML. Inside this HTML is:

```html
<div id="app" data-page='{"component":"ComponentCategory","props":{...}}'></div>
```

The `data-page` attribute contains a JSON string with everything React needs:
- `component`: Which React component to render
- `props`: All the data for that component (categories, components, snippets, etc.)

React hydrates from this JSON, and the page becomes interactive.

### After XHR Navigation: `data-page` Becomes Stale

Here's the critical point: once InertiaJS takes over, the `data-page` attribute
is never updated again.

When you click a link or change a control, InertiaJS:
1. Intercepts the action
2. Makes an XHR request to the server
3. Receives JSON response
4. Updates React state directly from the JSON
5. React re-renders the DOM

The `data-page` attribute still contains the original page load data. It's now
stale and does not reflect the current page state.

This means:
- Reading `data-page` after any InertiaJS navigation gives you OLD data
- The only reliable data source after navigation is the XHR response itself
- Or, perform a full page navigation (`page.goto()`) to get fresh `data-page`

## The Format Change Flow

When a user changes the framework, version, or mode controls, this triggers the
InertiaJS request cycle. Here's exactly what happens:

### Step 1: PUT Request

InertiaJS sends a PUT request to change the format:

```
PUT https://tailwindcss.com/plus/ui-blocks/language HTTP/2
Content-Type: application/json
X-Inertia: true
X-Inertia-Version: 10759303c8f56a2e262beafc966738bc
X-Requested-With: XMLHttpRequest

{"uuid":"b9bcab4538776a17fff93d18f82a8272","snippet_lang":"react-v4-light"}
```

Key headers:
- `X-Inertia: true` - Tells the server this is an InertiaJS request
- `X-Inertia-Version` - Asset version hash for cache invalidation
- `X-Requested-With: XMLHttpRequest` - Standard XHR marker

The body contains:
- `uuid`: Any component ID on the current page (used to identify the page context)
- `snippet_lang`: Target format as `{framework}-v{version}-{mode}`

### Step 2: 303 See Other Response

The server responds with HTTP 303:

```
HTTP/2 303 See Other
Location: https://tailwindcss.com/plus/ui-blocks/marketing/sections/heroes
Set-Cookie: tailwind_plus_session=...; (updated session with new format preference)
```

The 303 status tells the browser to follow the redirect with a GET request.
The updated session cookie stores the format preference.

### Step 3: Redirect GET Request

InertiaJS automatically follows the redirect:

```
GET https://tailwindcss.com/plus/ui-blocks/marketing/sections/heroes HTTP/2
X-Inertia: true
X-Inertia-Version: 10759303c8f56a2e262beafc966738bc
```

The `X-Inertia: true` header is crucial - it tells the server to return JSON
instead of HTML.

### Step 4: JSON Response

Because of the `X-Inertia` header, the server returns JSON:

```
HTTP/2 200 OK
Content-Type: application/json
X-Inertia: true

{
  "component": "ComponentCategory",
  "props": {
    "subcategory": {
      "components": [
        {
          "id": "b9bcab4538776a17fff93d18f82a8272",
          "name": "Simple centered",
          "downloadable": true,
          "snippet": {
            "name": "react",
            "version": 4,
            "mode": "light",
            "code": "export default function Example() { ... }"
          }
        }
      ]
    }
  }
}
```

React receives this JSON and updates its state. The DOM re-renders with the new
component code. But remember: `data-page` is NOT updated.

## Why the Script Uses Full Navigation

The downloader script uses `page.goto(url)` for each component page, which
performs a full browser navigation. This is intentional:

1. Full navigation returns HTML with a fresh `data-page` attribute
2. The script can reliably read `data-page` to get component data
3. No need to intercept XHR responses or manage InertiaJS state

If the script used InertiaJS-style navigation (clicking links), it would need to:
- Intercept network responses to capture the JSON
- Parse the XHR response instead of reading `data-page`
- Handle the complexity of InertiaJS's client-side routing

Full navigation is simpler and more reliable, at the cost of being slightly slower.

## Worker Architecture and Data Extraction

The script supports both authenticated and unauthenticated sessions, but they use
different extraction strategies. Understanding this requires understanding how
Workers interact with the server.

### How Workers Extract Data

Workers do NOT interact with page UI controls. They extract data directly from
the `data-page` attribute:

```javascript
// Worker.extractPageData() - simplified
await this.page.goto(url, { waitUntil: 'domcontentloaded' });

// Wait for data-page to contain correctly-formatted components
const dataHandle = await this.page.waitForFunction(snippetsOfRequiredFormat, {
  expectedFormat: expectedFormat
});
const subcategory = await dataHandle.evaluate(data => data);

// Extract directly from the JSON - no UI interaction
components.forEach(component => {
  // component.snippet.code contains the source code
  // No need to click "Code" buttons or copy from the UI
});
```

This is possible because:
1. The main Downloader sets format once via `_setFormat()` before Workers start
2. Format is stored server-side in the authenticated user's account preferences
3. Every subsequent page load returns HTML with `data-page` already in the correct format
4. Workers just read the JSON - the code is embedded in the page data

### Why Each Worker Has Its Own BrowserContext

Each Worker creates a new `BrowserContext` cloned from the main session:

```javascript
this.context = await this.browser.newContext(this.contextOptions);
```

The `contextOptions` includes the authenticated session cookies. Benefits:
- Isolation: Workers don't interfere with each other's page state
- Tracing: Each Worker can have its own Playwright trace for debugging
- Session cloning: All Workers share the same authenticated session
- Parallelism: Multiple Workers can load different URLs simultaneously

Because format is stored server-side (not in cookies or local storage), all Workers
see the same format regardless of which BrowserContext they use.

### The Optimization: No UI Interaction Required

Traditional scraping might:
1. Navigate to page
2. Click "Code" button to reveal source
3. Find the code element in the DOM
4. Copy the text content

The script's approach:
1. Navigate to page
2. Read `data-page` JSON attribute
3. Parse and extract `component.snippet.code`

This is faster and more reliable because:
- The code is already in the page data - no need to reveal it
- JSON parsing is deterministic - no DOM traversal or selector fragility
- No waiting for UI animations or transitions
- Works even if the "Code" panel never renders

### Why This Only Works for Authenticated Sessions

For authenticated users:
- Format preference is account-level, stored on the server
- Changing format once affects all pages globally
- Every `page.goto()` returns `data-page` with the selected format
- Workers can extract data immediately without any format changes

For unauthenticated users:
- Format preference is per-page, stored in session cookie
- Changing format only affects that specific page URL
- New pages load with default format (HTML v4 light)
- Would need to change format on EVERY page, defeating the optimization

### Unauthenticated Mode: Different Architecture

In unauthenticated mode (`--unauthenticated` flag), Workers cannot use the `data-page`
optimization because format is per-page, not account-level. Instead, Workers use
`_extractUnauthenticatedPageData()` which:

1. Navigates to the page (receives default format in `data-page`)
2. Identifies downloadable components from `data-page` JSON (`downloadable && preview === 'light'`)
3. Locates each component section by UUID (`#component-{uuid}`)
4. For each component, iterates through all 18 format combinations:
   a. Changes format via UI controls (framework select, version select, mode radio)
   b. Waits for InertiaJS JSON response
   c. Extracts snippet from response (or uses initial snippet if format already matches)
5. Collects all snippets before moving to the next page

Why `data-page` won't work after format changes:
- After navigation, `data-page` contains the initial format
- After changing controls, `data-page` is stale - InertiaJS updates React state directly
- The new format data is only in the InertiaJS JSON response
- Reading `data-page` after format change gives wrong data

The extraction captures responses per-component:
```javascript
// Unauthenticated: capture response JSON per format change
await page.goto(url);

// Get downloadable components from initial data-page
const downloadableComponents = await page.evaluate(() => {
  const data = JSON.parse(document.querySelector('#app').getAttribute('data-page'));
  return data.props.subcategory.components
    .filter(c => c.downloadable && c.preview === 'light')
    .map(c => ({ uuid: c.uuid, name: c.name, initialSnippet: c.snippet }));
});

// For each component, iterate through formats
for (const comp of downloadableComponents) {
  const section = page.locator(`#component-${comp.uuid}`);

  for (const format of formats) {
    // Change controls and capture response
    const resp = page.waitForResponse(isInertiaJsonResponse);
    await frameworkSelect.selectOption(format.framework);
    const responseBody = await (await resp).json();

    // Extract snippet from response
    const targetComp = responseBody.props.subcategory.components.find(c => c.uuid === comp.uuid);
    snippets.push(targetComp.snippet);
  }
}
```

Key differences from authenticated mode:
- Downloads all 18 formats per page in a single visit (vs one format per visit)
- Uses component UUID to locate sections (vs reading all from `data-page`)
- Captures snippets from JSON responses (vs reading `data-page` directly)
- Filters by `downloadable === true` (only free components)
- eCommerce pages have no mode inputs, so only 6 formats (detected at runtime)

### Actual Implementation: Separate Code Paths

Rather than a unified code path, the script uses separate extraction methods:

```javascript
// In Worker.start() job processing loop
const pageData = this.downloader.options.unauthenticated
  ? await this._extractUnauthenticatedPageData(job)
  : await this.extractPageData(job);
```

This separation exists because the workflows are fundamentally different:

Authenticated (`extractPageData`):
- Format is set once globally before Workers start
- Each page visit returns data in the correct format
- Workers process one format at a time across all pages
- Simple: navigate, read `data-page`, extract

Unauthenticated (`_extractUnauthenticatedPageData`):
- Format must be changed per-component via UI controls
- Each page visit collects all 18 formats in one go
- Workers process all formats per page before moving on
- Complex: navigate, find components, iterate formats, capture responses

The main Downloader also branches in `_processFormats()`:

```javascript
if (this.options.unauthenticated) {
  // Run workers once - they handle all formats per page
  this.formats = formats;  // Workers iterate through these
  this._populateJobQueue();
  await Promise.all(workers.map(w => w.start()));
} else {
  // Run workers once per format - they extract single format per page
  for (const format of formats) {
    this.currentFormat = format;
    await this._setFormat(format);  // Set account-level format
    this._populateJobQueue();
    await Promise.all(workers.map(w => w.start()));
  }
}
```

## Format Persistence

How format preferences are stored differs significantly between authenticated and
unauthenticated sessions. This affects how the script must handle format changes.

### Authenticated Users

Format preference is stored at the account level on the server:
- Changing format on one page affects ALL pages immediately
- The preference is tied to your account, not the browser session
- Persists across browser sessions, devices, and cookie clearing
- All pages return data in the selected format on first load
- No need to change format per-page; one change applies globally

This is why the script can set the format once (via `_setFormat()`) and then have
all workers download pages - every `page.goto()` returns data in the set format.

### Unauthenticated Users

Format preference is stored per-page in the encrypted session cookie:
- Each page URL has its own independent format preference
- Changing format on `/marketing/sections/heroes` does NOT affect `/marketing/sections/cta-sections`
- Visiting a new page loads with defaults (HTML v4 light)
- Revisiting a previously-configured page remembers its format (if cookies persist)
- Clearing cookies resets ALL pages to defaults
- Preference is lost when the session expires

This per-page storage means:
1. The script cannot rely on a single format change applying globally
2. Each page would need its own format change, OR
3. The script must use full navigation which sends session cookies, and the server
   returns the format stored for that specific page

### Implications for the Script

For authenticated sessions (current implementation):
- `_setFormat()` changes the account-level preference once
- All subsequent `page.goto()` calls return data in that format
- Workers can process URLs in parallel without format conflicts

For unauthenticated sessions (implemented via `--unauthenticated` flag):
- Cannot set format globally - it's per-page
- Workers change format per-component and capture response JSON
- All 18 formats collected in one page visit before moving to next page
- Filters by `downloadable === true` to get only free components

### How the Script Currently Sets Format

The main Downloader sets format by:
1. Navigating to the first URL
2. Changing the UI controls (framework select, version select, mode radio)
3. Waiting for the InertiaJS response confirming the change
4. The server updates the account preference (authenticated) or page preference (unauthenticated)

For authenticated users, this single change propagates to all pages. For unauthenticated
users, this only affects that one page - but since the script immediately does full
navigation to other URLs, those pages load with their own (default) preferences.

## Component Data Structure

The component data in `props.subcategory.components` contains:

```javascript
{
  id: "b9bcab4538776a17fff93d18f82a8272",
  uuid: "b9bcab4538776a17fff93d18f82a8272",  // Same as id
  name: "Simple centered",
  downloadable: true,                         // Can we access the code?
  isNew: false,
  archived: false,
  snippet: {
    name: "react",                            // Framework: html, react, vue
    version: 4,                               // Tailwind version: 3, 4
    mode: "light",                            // Theme: system, light, dark
    language: "jsx",
    code: "...",                              // The actual component code
    preview: "...",                           // Preview HTML
    supportsDarkMode: true
  }
}
```

## Format Combinations

Components are available in 18 format combinations:

- Frameworks: html, react, vue (3)
- Versions: 3, 4 (2)
- Modes: system, light, dark (3)

Total: 3 × 2 × 3 = 18 combinations

Exception: eCommerce components have no mode (mode is null), giving 6 combinations.

### Mode Meanings

- `system`: Code includes both light and dark classes (`dark:` variants)
- `light`: Explicit light theme only
- `dark`: Explicit dark theme only

These are different code variants, not display preferences.

## Authenticated vs Unauthenticated Data Differences

### Authenticated Response

Clean, consistent data:
- All components have `downloadable: true`
- All components match the selected format
- No duplicate or anomalous entries

### Unauthenticated Response: The HTML v4 Dark Baseline Anomaly

When unauthenticated, the JSON response includes an unexpected duplicate entry:

| Selected Format | Actual Response Contains |
|-----------------|--------------------------|
| React v4 light  | React v4 light + HTML v4 dark |
| Vue v3 system   | Vue v3 system + HTML v4 dark |
| Any format      | Requested format + HTML v4 dark |

This HTML v4 dark "baseline" component:
- Is always present regardless of what format you request
- Has `downloadable: true` even though it doesn't match the requested format
- Appears to be a server-side bug

Both the requested component and the baseline have `downloadable: true`, so
filtering by `downloadable` alone is insufficient. The script must also filter
by format match (framework, version, mode).

## Script Architecture Implications

### Current Implementation (Lines 1387 and 1436)

The script currently validates that ALL components match the expected format:

```javascript
// Line 1387: Fails if ANY component doesn't match
const allSnippetsValid = components.every(component => {
  const snippet = component.snippet;
  return snippet.name === expectedFormat.framework &&
         snippet.version === expectedFormat.version &&
         snippet.mode === expectedMode;
});

// Line 1436: Processes ALL components
components.forEach(component => { ... });
```

This works for authenticated sessions (clean data) but fails for unauthenticated
sessions (HTML v4 dark baseline would fail the `every()` check).

### How Unauthenticated Mode Handles This

The `_extractUnauthenticatedPageData()` method filters components upfront:

```javascript
// Filter by downloadable AND preview === 'light' (excludes dark preview duplicates)
const downloadableComponents = data.props.subcategory.components
  .filter(c => c.downloadable && c.preview === 'light')
  .map(c => ({ uuid: c.uuid, name: c.name, initialSnippet: c.snippet }));
```

Then for each component, it iterates through formats and extracts from JSON responses,
avoiding the stale `data-page` entirely.

## Session Cookies

Four encrypted Laravel cookies are set:
- `XSRF-TOKEN`: CSRF protection
- `tailwind_plus_session`: Main session data
- Two additional cookies with random-looking names

All values are encrypted and base64-encoded. The session cookie stores:
- Authentication state
- Per-page format preferences (for unauthenticated users)

Clearing cookies resets to default format (HTML v4 light).

## URL Structure

Base: `https://tailwindcss.com/plus/ui-blocks`

Component pages: `/plus/ui-blocks/{product}/{category}/{subcategory}`

Examples:
- `/plus/ui-blocks/marketing/sections/heroes`
- `/plus/ui-blocks/application-ui/forms/form-layouts`
- `/plus/ui-blocks/ecommerce/components/product-overviews`

## Wait Conditions in the Script

Understanding the InertiaJS architecture explains why the script has specific wait
conditions. Each wait is designed to handle a particular aspect of how the page loads
and updates.

### Wait for DOM Content (`waitUntil: 'domcontentloaded'`)

```javascript
await this.page.goto(url, { waitUntil: 'domcontentloaded' });
```

The script uses `domcontentloaded` instead of `load` because:
- We only need the HTML with the `data-page` attribute
- We don't need images, fonts, or other background assets
- `load` would wait for everything, wasting time

The `data-page` JSON is embedded in the initial HTML, so it's available as soon as
the DOM is parsed.

### Wait for Valid Data Structure (`waitForFunction`)

```javascript
const dataHandle = await this.page.waitForFunction(snippetsOfRequiredFormat, {
  url: url,
  expectedFormat: expectedFormat,
  ecommerceUrl: CONFIG.urls.eCommerce
});
```

After `domcontentloaded`, the page may not be fully ready because:
1. React needs to hydrate the page
2. The `data-page` attribute might be present but not yet parsed
3. The data might exist but not match the expected format (if session state is stale)

The `snippetsOfRequiredFormat` function polls the DOM until:
- `div#app` exists
- `data-page` attribute is present and parseable
- Components array exists and is non-empty
- All components match the expected format (framework, version, mode)

This is the core reliability mechanism: the script won't proceed until the data is
both present AND in the correct format.

### Wait for Format Change Response (`waitForResponse`)

```javascript
const responsePromise = this.mainPage.waitForResponse(responseForTarget(target));
await frameworkSelect.selectOption(targetFramework);
await responsePromise;
```

When changing format, the script:
1. Sets up a response listener before triggering the change
2. Triggers the control change (which fires the PUT request)
3. Waits for a response containing data in the target format

This ensures the format change completed successfully before moving on. The response
validation checks that the returned components match the new format.

### Why Not Just Wait for Navigation?

You might wonder why we don't simply wait for navigation to complete. The problem is
InertiaJS's XHR-based updates:

1. Changing a control doesn't cause navigation - the URL stays the same
2. The PUT → 303 → GET cycle happens via XHR, not page navigation
3. The DOM updates without the URL changing or `data-page` updating

So we must wait for the response content, not navigation events.

### Race Condition Considerations

The format change involves a race between:
- The browser receiving and processing the response
- React updating its state from the response
- Our script checking for the updated data

The script handles this by:
1. Waiting for the response (confirms server processed the request)
2. Then doing full navigation for actual data extraction (fresh `data-page`)

For the main Downloader class setting account format, waiting for response is
sufficient. For Workers extracting data, full navigation via `page.goto()` ensures
we always read fresh `data-page`.

## Summary: Key Takeaways

1. InertiaJS makes the page behave like an SPA after initial load
2. The `data-page` attribute is only valid on initial load - stale after any XHR navigation
3. Format changes trigger PUT → 303 → GET(X-Inertia) → JSON flow
4. The script supports two modes with different strategies:
   - Authenticated: full navigation (`page.goto()`) reads fresh `data-page`
   - Unauthenticated: captures JSON responses after changing format controls
5. Wait conditions are designed around InertiaJS's behavior:
   - `domcontentloaded` for fast initial load
   - `waitForFunction` to confirm data is ready and correct
   - `waitForResponse` to confirm format changes
6. Authenticated data is clean; unauthenticated filters by `downloadable && preview === 'light'`
7. eCommerce components have no mode (6 formats vs 18), detected at runtime
