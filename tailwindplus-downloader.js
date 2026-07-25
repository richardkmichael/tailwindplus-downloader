#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { read } from 'read';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import packageJson from './package.json' with { type: 'json' };

// ===================================================================================
//
//  Custom Error, Logger, Array and Format Classes
//
// ===================================================================================

class DownloaderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DownloaderError';
  }
}

/**
 * Session-level authentication failure.  Unlike an ordinary job failure this is not
 * retryable: every subsequent request would fail the same way, so it aborts the run
 * instead of being re-queued.  Mid-run re-login is deliberately not attempted.
 */
class SessionError extends DownloaderError {
  constructor(message) {
    super(message);
    this.name = 'SessionError';
  }
}

const LogLevel = {
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4
};

class Logger {
  constructor(options = {}) {
    this.level = options.debug ? LogLevel.DEBUG : LogLevel.INFO;
    this.destination = options.log ? 'file' : 'console';
    this.log = options.log || null;
    this.identifierWidth = options.identifierWidth || 9;
    this.logStream = null;

    // Calculate the max width for level strings for padding
    this.levelWidth = Math.max(...Object.keys(LogLevel).map(level => level.length));

    if (this.destination === 'file') {
      this.logStream = fs.createWriteStream(this.log, { flags: 'w' });
    }
  }

  _log(level, message, stream = 'stdout') {
    if (level < this.level) {
      return;
    }

    const levelStr = Object.keys(LogLevel).find(key => LogLevel[key] === level);
    const paddedLevel = levelStr.padEnd(this.levelWidth);

    if (this.destination === 'file') {
      const timestamp = new Date().toISOString();
      this.logStream.write(`[${timestamp}] [${paddedLevel}] ${message}\n`);
    } else {
      const consoleMessage = `[${paddedLevel}] ${message}`;
      if (stream === 'stderr') {
        console.error(consoleMessage);
      } else {
        console.log(consoleMessage);
      }
    }
  }

  prefix(identifier) {
    const formattedIdentifier = `[${identifier.padEnd(this.identifierWidth)}]`;
    return {
      debug: (message) => this.debug(`${formattedIdentifier} ${message}`),
      info: (message) => this.info(`${formattedIdentifier} ${message}`),
      warn: (message) => this.warn(`${formattedIdentifier} ${message}`),
      error: (message) => this.error(`${formattedIdentifier} ${message}`),
    };
  }

  debug(message) {
    this._log(LogLevel.DEBUG, message, 'stdout');
  }

  info(message) {
    this._log(LogLevel.INFO, message, 'stdout');
  }

  warn(message) {
    this._log(LogLevel.WARN, message, 'stderr');
  }

  error(message) {
    this._log(LogLevel.ERROR, message, 'stderr');
  }

  /**
   * Closes the log stream, resolving once it has flushed.
   *
   * `end()` finishes asynchronously and `createWriteStream` opens the file lazily, so a caller
   * that exits the process without awaiting this loses buffered output — and a run that fails
   * early enough leaves no log file at all.
   *
   * @returns {Promise<void>} Resolves when the stream has finished, or immediately when logging
   *   to the console
   */
  close() {
    if (!this.logStream) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      // Resolve on error too: a shutdown must not hang because the log could not be written.
      this.logStream.once('error', resolve);
      this.logStream.end(resolve);
    });
  }
}

class ReflectingArray {
  /**
     * A list-like object that provides an iterator which alternates between
     * forward and reverse traversal on successive calls to its iterator.
     * @param {...*} items - The items to iterate over (like Array constructor)
     */
  constructor(...items) {
    this._items = items;
    this._direction = 1; // 1 for forward, -1 for backward
  }

  /**
     * Implements the iterable protocol. This method is a generator function
     * that yields items from the array, either forward or reversed,
     * and then flips the internal direction for the next iteration.
     * @returns {Generator} A generator object.
     */
  *[Symbol.iterator]() {
    if (this._direction === 1) {
      // Yield items in forward order
      yield* this._items;
    } else {
      // Yield items in reverse order
      for (let i = this._items.length - 1; i >= 0; i--) {
        yield this._items[i];
      }
    }
    this._direction *= -1; // Flip direction for the next iteration
  }
}

class Format {
  constructor(frameworkOrObj, version, mode) {
    if (typeof frameworkOrObj === 'object' && frameworkOrObj !== null) {
      // Object form: new Format({framework: 'html', version: 3, mode: 'dark'})
      this.framework = frameworkOrObj.framework;
      this.version = frameworkOrObj.version;
      this.mode = frameworkOrObj.mode;
    } else {
      // Bare values: new Format('html', 3, 'dark')
      this.framework = frameworkOrObj;
      this.version = version;
      this.mode = mode;
    }

    // Create string representation for comparison and display
    this._stringValue = this.mode === null ?
      `${this.framework}-v${this.version}` :
      `${this.framework}-v${this.version}-${this.mode}`;

    // Make immutable
    Object.freeze(this);
  }

  // Enable == comparison by implementing valueOf
  valueOf() {
    return this._stringValue;
  }

  // Enable string conversion
  toString() {
    return this._stringValue;
  }

  // Optional: explicit equals method for clarity
  equals(other) {
    return other instanceof Format && this.valueOf() === other.valueOf();
  }
}

// ===================================================================================
//
//  Top-Level Helper Functions
//
// ===================================================================================

/**
 * Starts Playwright tracing with standard configuration
 *
 * @param {BrowserContext} context - The browser context to start tracing on
 * @param {string} name - Name for the trace file
 * @param {string} title - Title to show in Trace Viewer
 */
async function startTracing(context, name, title) {
  await context.tracing.start({
    name,
    title,
    snapshots: true,
    screenshots: true,
    sources: true
  });
}

/**
 * Stops Playwright tracing and saves to ZIP file with error handling
 *
 * @param {BrowserContext} context - The browser context with active tracing
 * @param {string} tracesDir - Directory to save trace ZIP files
 * @param {string} identifier - Trace file identifier (becomes {identifier}.zip)
 */
async function stopTracing(context, tracesDir, identifier) {
  try {
    const traceFile = path.join(tracesDir, `${identifier}.zip`);
    await context.tracing.stop({ path: traceFile });
  } catch (error) {
    // Don't throw - this is called during cleanup and shouldn't break the flow
    console.error('Warning: Failed to stop trace:', error.message);
  }
}

/**
 * Decodes the HTML entities the server uses when embedding JSON in the data-page
 * attribute.  A single left-to-right pass replaces each entity once, matching the
 * browser's native attribute decoding: named (&quot; &apos; &amp; &lt; &gt;) plus
 * decimal (&#NN;) and hex (&#xNN;) numeric entities.  The server encodes apostrophes
 * as &#x27;, so numeric forms must be handled, not just a fixed named set.
 *
 * @param {string} text - Attribute value to decode
 * @returns {string} Decoded text
 */
function decodeHtmlEntities(text) {
  const named = { quot: '"', apos: '\'', amp: '&', lt: '<', gt: '>' };
  return text.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|(quot|apos|amp|lt|gt));/g,
    (match, hex, dec, name) => {
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      if (dec !== undefined) return String.fromCodePoint(parseInt(dec, 10));
      return named[name];
    }
  );
}

/**
 * Extracts and parses the Inertia data-page JSON from raw page HTML.
 * The attribute is server-rendered onto div#app, so no browser is needed to read it.
 *
 * @param {string} html - Raw HTML of a server-rendered Inertia page
 * @returns {Object|null} Parsed data-page object, or null when missing or unparseable
 */
function parseDataPageFromHtml(html) {
  const match = html.match(/data-page="([^"]*)"/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(decodeHtmlEntities(match[1]));
  } catch {
    return null;
  }
}

/**
 * Reports whether a URL is an eCommerce component page.  Those pages have no
 * light/dark/system controls, so their snippets carry a null mode and are identical across
 * the three mode passes of a framework/version.
 *
 * @param {string} url - Page URL
 * @returns {boolean} True when the URL is an eCommerce component page
 */
function isEcommerceUrl(url) {
  return url.startsWith(CONFIG.urls.eCommerce);
}

/**
 * Validates that every component in a page's data-page matches the expected format and
 * returns the subcategory object.  eCommerce components carry no mode, so mode is
 * compared as null for eCommerce URLs.
 *
 * The data-page of a plain GET is static, so a mismatch cannot resolve by waiting: it
 * means the server rendered with a different account-level format (e.g. a user changed
 * the on-page controls while the script was running).  Callers treat it as a failure.
 *
 * @param {Object} pageData - Parsed data-page object
 * @param {string} url - Page URL, used for eCommerce detection and error messages
 * @param {Format} expectedFormat - Format every component snippet must match
 * @returns {Object} The subcategory object from the page data
 * @throws {DownloaderError} When component data is missing or the format mismatches
 */
function subcategoryOfRequiredFormat(pageData, url, expectedFormat) {
  const subcategory = pageData?.props?.subcategory;
  const components = subcategory?.components;

  if (!Array.isArray(components) || components.length === 0) {
    throw new DownloaderError(`No component data found on ${url}`);
  }

  const expectedMode = isEcommerceUrl(url) ? null : expectedFormat.mode;

  const allSnippetsValid = components.every(component => {
    const snippet = component.snippet;
    return snippet?.name === expectedFormat.framework &&
      snippet?.version === expectedFormat.version &&
      snippet?.mode === expectedMode;
  });

  if (!allSnippetsValid) {
    const firstSnippet = components[0].snippet ?? {};
    const foundFormat = new Format(firstSnippet.name, firstSnippet.version, firstSnippet.mode ?? null);
    throw new DownloaderError(`Format mismatch on ${url}: expected ${expectedFormat}, got ${foundFormat}`);
  }

  return subcategory;
}

function createConfig() {
  const base = 'https://tailwindcss.com';

  const components = 'nav ~ div > div > section[id^="component-"]';
  const controlsRelative = 'div > :nth-child(2)';
  const codePanelRelative = 'div > :nth-child(3)';
  const componentControls = `${components} > ${controlsRelative}`;
  const codePanel = `${components} > ${codePanelRelative}`;

  // Generate timestamp for both output filenames and JSON content
  const version = new Date().toISOString().slice(0, 19).replace(/:/g, '').replace('T', '-');
  const outputBase = 'tailwindplus-components';

  return {
    outputBase,
    version,
    output: `${outputBase}-${version}.json`,

    session: '.tailwindplus-downloader-session.json',
    credentials: '.tailwindplus-downloader-credentials.json',

    urls: {
      base,
      login: `${base}/plus/login`,
      plus: `${base}/plus`,
      discovery: `${base}/plus/ui-blocks`,
      eCommerce: `${base}/plus/ui-blocks/ecommerce`
    },

    selectors: {
      // The `Code` buttons, the first one is clicked to reveal a version control.
      codeButtons: `${componentControls} button:has-text("Code")`,

      // The format controls, the script uses the first of each.
      modeInput: `${componentControls} input[name^="theme-"]`,
      frameworkSelect: `${componentControls} select`,
      versionSelect: `${codePanel} select`,
    },

    // Lower the default timeout to notify sooner if actions are failing.
    timeout: 10000,

    // Sub-resources aborted on the format-setting browser context.  All needed data is
    // in the server-rendered data-page JSON, so these only add load on the live site.
    // Stylesheets and scripts are kept: the page must hydrate to accept control clicks.
    blockedResourceTypes: ['image', 'media', 'font'],

    retries: {
      maxRetries: 3
    },

    download: {
      frameworks: ['react', 'vue', 'html'],
      versions: [3, 4],
      modes: ['system', 'light', 'dark']
    }
  };
}

const CONFIG = createConfig();

// ===================================================================================
//
//  JSON Sorting Utilities for Stable Output
//
// ===================================================================================

/**
 * Recursively finds and in-place sorts any array property named "snippets".
 *
 * @param {any} data The data structure to traverse (object or array).
 */
function sortSnippetsRecursively(data) {
  if (typeof data !== 'object' || data === null) {
    return; // Do nothing for primitives
  }

  // If the object has a 'snippets' array, sort it by name, version, and mode
  if (Array.isArray(data.snippets)) {
    data.snippets.sort((a, b) => {
      // 1. Compare by name (string comparison)
      const nameCompare = String(a.name ?? '').localeCompare(String(b.name ?? ''));
      if (nameCompare !== 0) return nameCompare;

      // 2. Compare by version (numeric comparison)
      // Treat missing versions as the lowest possible value
      const aVersion = a.version ?? -Infinity;
      const bVersion = b.version ?? -Infinity;
      if (aVersion !== bVersion) return aVersion - bVersion;

      // 3. Compare by mode (string comparison)
      return String(a.mode ?? '').localeCompare(String(b.mode ?? ''));
    });
  }

  // Recurse into every property of the object or element of the array
  for (const value of Object.values(data)) {
    sortSnippetsRecursively(value);
  }
}

/**
 * Replacer function to sort object keys for JSON.stringify
 */
function sortedObjects(key, value) {
  if (value instanceof Object && !(value instanceof Array)) {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]]));
  }
  return value;
}

// ===================================================================================
//
//  Downloader Class
//
// ===================================================================================

class TailwindPlusDownloader {
  constructor(options) {
    this.options = options;
    this.startTime = new Date();

    this.version = CONFIG.version;

    // Given to each worker to write to the same log file
    const baseLogger = new Logger({
      debug: this.options.debug,
      log: this.options.log,
      identifierWidth: 9
    });

    this.logger = baseLogger.prefix('Main');
    this.baseLogger = baseLogger;
    this.browser = null;
    this.context = null;
    this.contextOptions = null;
    this.mainPage = null;
    this.credentials = this.options.credentials;
    this.session = this.options.session;

    this.componentData = {};
    this.componentCount = 0;

    // Human-authored prose TailwindPlus ships alongside the components.  Kept beside the
    // component tree rather than on its nodes, so the tree stays a pure name-keyed tree.
    // Subcategories are keyed by the dotted "product.category.subcategory" path.
    this.descriptions = { products: {}, subcategories: {} };

    // Components actually downloaded, which is fewer than the discovered
    // `componentCount` in unauthenticated mode: only free samples are reachable.
    // Set when the output metadata is built.
    this.capturedComponentCount = null;

    this.urls = [];
    this.urlCount = 0;
    this.jobQueue = [];
    this.currentFormat = null;

    // The account-level format in effect when the run started.  The site persists the format
    // server-side, so it is restored when the format passes finish.  Null in unauthenticated
    // mode, which has no account format.
    this.initialFormat = null;

    // Mid-run re-authentication state.  `sessionGeneration` increments on each successful
    // re-login; `_reauthPromise` single-flights concurrent re-auth attempts so a burst of
    // simultaneous session expiries across workers triggers exactly one login.
    this.sessionGeneration = 0;
    this._reauthPromise = null;
  }

  _elapsedSecondsSinceStart() {
    return ((new Date() - this.startTime) / 1000).toFixed(1);
  }

  async start() {
    // Exiting from the `catch` would skip the `finally` below, leaving the browser running, the
    // trace unfinalized and the log file unflushed.  Record the outcome, tear down, then exit.
    let succeeded = false;
    let exitCode = 0;

    try {
      await this._checkOutputExists();
      await this._initializeBrowser();

      const discovery = await this._discoverUrls();
      this.urls = discovery.urls;
      this.urlCount = discovery.urlCount;
      this.componentCount = discovery.componentCount;

      let formats;
      if (this.options.unauthenticated) {
        // In unauthenticated mode, use default format order (no detection needed)
        formats = this._generateFormats();
      } else {
        this.initialFormat = await this._detectFormat();
        formats = this._generateFormats(this.initialFormat);
      }

      this._showStartMessage();
      await this._processFormats(formats);

      if (this.options.outputFormat === 'dir') {
        this._processResultsAndWriteDirectory();
      } else {
        this._processResultsAndWriteOutput();
      }

      succeeded = true;
    } catch (error) {
      // Logged here rather than after teardown, which closes the logger.  An unexpected error is
      // recorded before rethrowing, so `--log` captures why the run died; the rethrow still
      // reaches the top-level handler, which reports it on the console and sets the exit code.
      if (error instanceof DownloaderError) {
        this.logger.error(error.message);
        this.logger.error('Exiting');
        exitCode = 1;
      } else {
        this.logger.error(`Unexpected error: ${error.stack || error.message}`);
        throw error;
      }
    } finally {
      await this.stop({ completed: succeeded });
    }

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  /**
   * Initializes Playwright browser with configuration and session management
   * Sets up tracing directory if enabled, launches browser, and loads saved session
   * `session` is a filename for a Playwright `browserContext.storageState` file (saved after successful login)
   *
   * @throws {Error} When browser launch fails or session loading fails
   */
  async _initializeBrowser() {
    this.logger.debug('Initializing browser');

    const playwrightConfiguration = {
      headless: !this.options.debugHeaded
    };

    // Set up tracing directory if tracing is enabled
    if (this.options.debugTrace) {
      const extension = path.extname(this.options.output);
      const baseName = path.basename(this.options.output, extension);
      this.tracesDir = `${baseName}.traces`;

      fs.mkdirSync(this.tracesDir, { recursive: true });

      this.logger.debug(`Tracing enabled, traces will be saved to: ${this.tracesDir}`);
    }

    this.browser = await chromium.launch(playwrightConfiguration);

    // Load saved session if it exists (skip for unauthenticated mode)
    this.contextOptions = {};
    if (!this.options.unauthenticated && fs.existsSync(this.session)) {
      this.contextOptions.storageState = this.session;
      this.logger.debug('Loading saved session');
    }

    this.context = await this.browser.newContext(this.contextOptions);
    this.context.setDefaultTimeout(CONFIG.timeout);

    // Plain HTTP requests that share this context's cookies (kept in sync live, so a
    // fresh login is picked up automatically).  Used for all authenticated page reads.
    this.requestContext = this.context.request;

    // Authenticated mode never renders previews, so heavy sub-resources are aborted to
    // reduce load on the live site.  Unauthenticated mode is left untouched: its
    // extraction drives on-page controls and is kept exactly as validated.
    if (!this.options.unauthenticated) {
      await this.context.route('**/*', route => {
        if (CONFIG.blockedResourceTypes.includes(route.request().resourceType())) {
          return route.abort();
        }
        return route.continue();
      });
    }

    // Start tracing if enabled
    if (this.options.debugTrace) {
      await startTracing(this.context, 'main', 'Main Downloader');
    }

    this.mainPage = await this.context.newPage();

    // Skip authentication for unauthenticated mode
    if (this.options.unauthenticated) {
      this.logger.debug('Unauthenticated mode - skipping login');
      return;
    }

    // Validate session and authenticate if needed
    const isAuthenticated = await this._validateSession();

    if (!isAuthenticated) {
      this.logger.debug('Authentication required');
      await this._login();
    } else {
      this.logger.debug('Using existing valid session');
    }
  }

  /**
   * Attempts page navigation with retries, converting TimeoutError to DownloaderError
   *
   * @param {Page} page - Playwright page instance
   * @param {string} url - URL to navigate to
   * @throws {DownloaderError} When navigation fails after all retries due to timeouts
   */
  async _retryGoto(page, url) {
    for (let attempt = 1; attempt <= CONFIG.retries.maxRetries; attempt++) {
      try {
        await page.goto(url);
        return;
      } catch (error) {
        if (error.name !== 'TimeoutError') {
          throw error;
        }
        if (attempt === CONFIG.retries.maxRetries) {
          throw new DownloaderError(`Navigation to ${url} failed after ${CONFIG.retries.maxRetries} attempts due to known intermittent Playwright issue. Please re-run.`);
        }
        this.logger.warn(`Navigation timeout (attempt ${attempt}/${CONFIG.retries.maxRetries}): ${url}`);
      }
    }
  }

  /**
   * Validates whether the current session is authenticated with TailwindPlus.
   * Reads auth state from the Inertia.js data-page JSON on div#app, which is
   * reliable regardless of viewport size or responsive layout changes.
   * The session can eventually expire, depending on TailwindPlus policy.  When this occurs the
   * session is `invalid`, and credentials will be prompted for again.
   *
   * @returns {Promise<boolean>} True if session is valid (user is logged in)
   * @throws {DownloaderError} When navigation to TailwindPlus fails
   */
  async _validateSession() {
    this.logger.debug('Validating session');
    await this._retryGoto(this.mainPage, CONFIG.urls.plus);

    const isAuthenticated = await this.mainPage.evaluate(() => {
      const app = document.querySelector('div#app');
      if (!app) return false;
      try {
        const pageData = JSON.parse(app.getAttribute('data-page') || '{}');
        return !!pageData?.props?.auth?.user;
      } catch {
        return false;
      }
    });

    this.logger.debug(`Session validation result: ${isAuthenticated ? 'valid' : 'invalid'}`);

    return isAuthenticated;
  }

  /**
   * Performs complete login flow for TailwindPlus authentication.
   * Obtains credentials, retries login with resilient error handling, and saves session.
   * If the credentials do not work (typo, password change, etc.) they are prompted for again.
   * If the user provided credentials via a prompt, offer to save (update) the credentials file.
   * Storing credentials is a convenience, and not required.
   *
   * @throws {DownloaderError} When login fails after all retry attempts or user cancels
   */
  async _login({ offerSave = true } = {}) {
    this.logger.debug('Logging in');

    // Mutable, since it could be invalid (if a typo) and re-prompted during flow.
    let credentials = await this._obtainCredentials();

    while (true) {
      // Reload the login page in the loop to clear any incorrect credentials errors
      await this.mainPage.goto(CONFIG.urls.login);

      const result = await this._resilientLogin({
        page: this.mainPage,
        email: credentials.email,
        password: credentials.password,
        successUrl: CONFIG.urls.plus
      });

      if (result === 'success') {
        break;
      }

      if (result === 'bad_credentials') {
        this.logger.error('Login failed, bad credentials.');

        if (!process.stdin.isTTY) {
          throw new DownloaderError('Login failed: bad credentials. Cannot prompt for new credentials in non-interactive mode.');
        }
        const answer = (await read({ prompt: 'Try again with new credentials? [Y/n]: ' })).toLowerCase();
        if (answer === 'n' || answer === 'no') {
          throw new DownloaderError('User aborted after failed login attempt.');
        }
        credentials = await this._promptCredentials();
      }
    }

    this.logger.debug('Login successful');

    // Save the session to a file, then use the file path in contextOptions (passed to Workers).
    // Using the file path is consistent with the pre-existing session path, and avoids any
    // issue with in-memory storageState objects not being correctly applied to new contexts.
    await this.context.storageState({ path: this.session });
    this.logger.debug(`Session saved to ${this.session}`);
    this.contextOptions.storageState = this.session;

    // Only save if credentials came from user input (never when silently re-authenticating)
    if (offerSave && credentials.source === 'prompt') {
      await this._trySaveCredentials(credentials);
    }
  }

  /**
   * Obtains login credentials from file or user prompt
   * First attempts to load from credentials file, falls back to interactive prompt
   *
   * @returns {Promise<{email: string, password: string, source: string}>} Credentials object with source indicator
   */
  async _obtainCredentials() {
    let credentials = this._tryLoadCredentials(this.credentials);
    if (!credentials) {
      if (!process.stdin.isTTY) {
        throw new DownloaderError(
          `No credentials found. Provide a credentials file (${this.credentials}) or run interactively.`
        );
      }
      credentials = await this._promptCredentials();
    }

    return credentials;
  }

  /**
   * Performs login with resilience to various on page scenarios
   * Handles multiple scenarios during login process:
   * - Form element not appearing (fatal error); unlikely to occur
   * - React re-rendering clearing Playwright-filled inputs (HTML5 validation retry for 'required' inputs)
   *     This is a bug in the Tailwind page -- form elements should be `disabled` until stable to accept input.
   * - Invalid credentials will be retried after re-prompting, handling user-typo, password change, etc.
   * - Successful login with redirect
   * Uses Promise.race() to handle whichever condition occurs first
   *
   * @param {Object} params - Login parameters
   * @param {Page} params.page - Playwright page instance
   * @param {string} params.email - User email for login
   * @param {string} params.password - User password for login
   * @param {string} params.successUrl - URL to expect after successful login
   * @param {string} [params.formSelector='form'] - CSS selector for login form
   * @param {number} [params.timeout=15000] - Timeout in milliseconds for login attempt
   * @returns {Promise<string>} Login result: 'success', 'bad_credentials', etc.
   * @throws {Error} When login process fails after timeout
   */
  async _resilientLogin({ page, email, password, successUrl, formSelector = 'form', timeout = 15000 }) {
    const startTime = Date.now();
    const emailInput = page.getByRole('textbox', { name: 'Email' });
    const passwordInput = page.getByRole('textbox', { name: 'Password' });
    const submitButton = page.getByRole('button', { name: 'Sign in to account' });

    while (Date.now() - startTime < timeout) {
      await emailInput.fill(email);
      await passwordInput.fill(password);

      // --- Promise Declarations with Result Transformation ---

      // Outcome 1: Successful navigation.
      const navigationPromise = page.waitForURL(successUrl, { timeout: 5000 })
        .then(() => 'success');

      // Outcome 2: Incorrect credentials error message appears.
      const badCredentialsPromise = page.getByText('These credentials do not match our records')
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => 'bad_credentials');

      // Outcome 3: Native form validation fails, or form isn't present, or context is destroyed.
      const validationFailedPromise = page.evaluate((selector) => {
        return new Promise((resolve) => {
          const form = document.querySelector(selector);
          if (!form) return resolve('form_not_found');
          const requiredInputs = form.querySelectorAll('[required]');
          if (requiredInputs.length === 0) return;
          requiredInputs.forEach(input => {
            input.addEventListener('invalid', (e) => {
              e.preventDefault();
              resolve('validation_failed');
            }, { once: true });
          });
        });
      }, formSelector).catch(error => {
        if (error.message.includes('Execution context was destroyed')) {
          return 'context_destroyed_by_navigation';
        }
        throw error;
      });

      // Click the button to trigger one of the outcomes.
      await submitButton.click();

      // Arrange the promises; one of the outcomes will occur, determining what is done next.
      const winner = await Promise.race([
        navigationPromise,
        validationFailedPromise,
        badCredentialsPromise
      ]).catch(error => {
        if (error.name === 'TimeoutError') return 'timeout';
        throw error;
      });

      // --- Handle the winner of the race ---

      if (winner === 'form_not_found') {
        throw new DownloaderError(`Login failed: Could not find the form element using the selector: "${formSelector}".`);
      }

      if (winner === 'validation_failed') {
        this.logger.debug('Native form validation failed, likely due to a re-render. Retrying');
        await page.waitForTimeout(100);
        continue;
      }

      if (winner === 'bad_credentials') {
        return 'bad_credentials';
      }

      // Check for the two possible success outcomes.
      if (winner === 'success' || winner === 'context_destroyed_by_navigation') {
        return 'success';
      }

      // Fallback for any other unexpected state.
      this.logger.warn(`Login attempt ended in ambiguous state ('${winner}'). Retrying...`);
      await page.waitForTimeout(250);
    }
    throw new Error(`Login failed to complete within the ${timeout}ms timeout.`);
  }

  _tryLoadCredentials(path) {
    try {
      const credentials = JSON.parse(fs.readFileSync(path, 'utf8'));
      this.logger.debug(`Credentials loaded from: ${path}`);
      return { email: credentials.email, password: credentials.password, source: 'file' };
    } catch (error) {
      this.logger.debug(`Failed credentials load: ${error.message}`);
      return null;
    }
  }

  async _promptCredentials() {
    this.logger.info('\nTailwindPlus login required.');
    const email = await read({ prompt: 'Email: ' });
    const password = await read({ prompt: 'Password: ', silent: true, replace: '*' });
    return { email: email.trim(), password: password.trim(), source: 'prompt' };
  }

  async _checkOutputExists() {
    const output = this.options.output;
    const isDir = this.options.outputFormat === 'dir';
    const kind = isDir ? 'directory' : 'file';

    if (!fs.existsSync(output)) return;

    // For directories, only warn if non-empty (empty dir has no data to lose)
    if (isDir && fs.readdirSync(output).length === 0) return;

    if (this.options.overwrite) {
      process.stderr.write(`Output ${kind} exists: ${output} — overwriting.\n`);
      this.logger.warn(`Output ${kind} exists: ${output} — overwriting.`);
    } else {
      // Non-interactive stdin (piped/CI): abort rather than hang
      if (!process.stdin.isTTY) {
        throw new DownloaderError(
          `Output ${kind} already exists: ${output}. Use --overwrite to overwrite.`
        );
      }

      process.stderr.write(`\nOutput ${kind} exists: ${output}\n`);
      process.stderr.write('Overwrite?  Will result in data loss.\n');
      const answer = await read({ prompt: '> NO/yes  (type `yes`): ' });
      if (answer.trim() !== 'yes') {
        throw new DownloaderError('Aborted.');
      }
      this.logger.warn(`Output ${kind} exists: ${output} — overwriting.`);
    }

    // For directories: delete before recreating to eliminate stale orphan files.
    // JSON writeFileSync already replaces atomically, no pre-deletion needed.
    if (isDir) {
      fs.rmSync(output, { recursive: true });
    }
  }

  async _trySaveCredentials(credentials) {
    if (!process.stdin.isTTY) return;

    const save = await read({ prompt: `\nSave credentials to file '${this.credentials}'? (WARNING: Security risk) [y/N]: ` });
    if (save.toLowerCase().startsWith('y')) {
      const { email, password } = credentials;
      fs.writeFileSync(this.credentials, JSON.stringify({ email, password }, null, 2));
      this.logger.info(`Credentials saved to ${this.credentials}`);
    }
  }

  _processDiscoveredSubcategory(subcategory, debugUrlFilter) {
    if (!subcategory?.name || !subcategory.url || !subcategory.components) {
      return null;
    }

    const debugUrlFilterDisabled = debugUrlFilter.size === 0;
    if (debugUrlFilterDisabled || debugUrlFilter.has(subcategory.url)) {
      const match = subcategory.components.match(/^(?<componentCount>\d+)/);
      const componentCount = parseInt(match?.groups?.componentCount, 10) || 0;
      return { url: subcategory.url, componentCount };
    }

    return null;
  }

  /**
   * Discovers all component URLs by extracting from the data on the "main" TailwindPlus page
   * Extracts page data from data-page attribute and processes subcategories
   * Each subcategory object has a `name`, `url` and `components` (simple string, e.g., "12 components")
   *
   * @returns {Promise<{urls: string[], urlCount: number, componentCount: number}>} Discovery results
   * @throws {DownloaderError} When page data extraction fails or no products found
   */
  async _discoverUrls() {
    const url = CONFIG.urls.discovery;

    this.logger.debug(`Discovering component URLs from: ${url}`);

    const debugUrlFilter = this._initializeDebugFilter();

    // Custom wait function that waits specifically for the required product data
    const productsOfValidStructure = () => {
      try {
        const app = document.querySelector('div#app');
        if (!app) return false;

        const pageDataJson = app.getAttribute('data-page');
        if (!pageDataJson) return false;

        const pageData = JSON.parse(pageDataJson);
        const products = pageData?.props?.products;

        if (!Array.isArray(products) || products.length === 0) {
          return false;
        }

        // Return only what we actually need
        return products;
      } catch (error) {
        return false; // JSON parse error or structure not ready
      }
    };

    // Use domcontentloaded to avoid waiting for background assets
    await this.mainPage.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for the product data and extract it directly
    let products;
    try {
      const dataHandle = await this.mainPage.waitForFunction(productsOfValidStructure);
      products = await dataHandle.evaluate(data => data);
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new DownloaderError(`Timeout waiting for valid product data on ${url}`);
      }
      throw error;
    }

    // Product descriptions exist only here, on the discovery page; the component pages
    // carry a product object with just a name and URL.
    for (const product of products) {
      this.descriptions.products[product.name] = {
        description: product.description,
        pricing_description: product.pricing_description
      };
    }

    // Extract URLs from page data
    const subcategories = products.flatMap(p => p.categories?.flatMap(c => c.subcategories || []) || []);

    const urls = [];
    let totalComponentCount = 0;

    for (const subcategory of subcategories) {
      const subcategoryData = this._processDiscoveredSubcategory(subcategory, debugUrlFilter);
      if (subcategoryData) {
        urls.push(subcategoryData.url);
        totalComponentCount += subcategoryData.componentCount;
      }
    }

    this.logger.debug(`Discovered ${urls.length} component URLs with a total of ${totalComponentCount} individual components.`);
    return { urls, urlCount: urls.length, componentCount: totalComponentCount };
  }

  _initializeDebugFilter() {
    const urlFile = this.options.debugUrlFile;
    if (urlFile) {
      if (!fs.existsSync(urlFile)) {
        throw new DownloaderError(`URL file not found at: ${urlFile}`);
      }
      const urls = fs.readFileSync(urlFile, 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));

      // An empty set means "no filtering" downstream, which would silently download every
      // component instead of the requested subset.  Refuse, as for a missing file.
      if (urls.length === 0) {
        throw new DownloaderError(`URL file contains no URLs: ${urlFile}`);
      }

      this.logger.info(`URL file mode enabled. Filtering by ${urls.length} URL(s) from: ${urlFile}`);
      return new Set(urls);
    }
    return new Set();
  }

  /**
   * Re-authenticates after a mid-run session expiry, coordinating concurrent workers.
   *
   * Single-flight: the first caller performs the login while any others await the same attempt.
   * `observedGeneration` is the session generation the caller saw before its failed request; if
   * the session was already refreshed since (another worker won the race), this returns
   * immediately so the caller simply retries.  A failed login is fatal and re-thrown as a
   * SessionError so the run aborts loudly instead of looping.
   *
   * @param {number} observedGeneration - Session generation observed before the failed request
   * @throws {SessionError} When re-authentication fails (e.g. credentials no longer valid)
   */
  _reauthenticate(observedGeneration) {
    if (this.sessionGeneration > observedGeneration) {
      return Promise.resolve();  // Another worker already refreshed the session; just retry.
    }
    if (!this._reauthPromise) {
      this._reauthPromise = (async () => {
        this.logger.warn('Session expired mid-run; re-authenticating with stored credentials');
        try {
          await this._login({ offerSave: false });
        } catch (error) {
          throw new SessionError(`Re-authentication failed: ${error.message}`);
        }
        this.sessionGeneration++;
        this.logger.info('Re-authentication succeeded; resuming download');
      })().finally(() => {
        this._reauthPromise = null;
      });
    }
    return this._reauthPromise;
  }

  /**
   * Fetches a page with a plain authenticated GET (no browser page) and returns its parsed
   * Inertia data-page object.  The format is an account-level server-side setting which a GET
   * cannot disturb, so concurrent reads are safe.
   *
   * On a mid-run session expiry (login redirect, or an unauthenticated data-page) it
   * re-authenticates and retries rather than failing, up to `maxRetries` re-auth attempts.  A
   * SessionError escapes only when the session cannot be restored.
   *
   * @param {string} url - Page URL to fetch
   * @returns {Promise<Object>} Parsed data-page object
   * @throws {SessionError} When re-authentication cannot restore a valid session
   * @throws {DownloaderError} When the request fails with a non-2xx status (retryable)
   */
  async _fetchPageData(url) {
    for (let sessionAttempt = 0; ; sessionAttempt++) {
      const observedGeneration = this.sessionGeneration;
      const response = await this.requestContext.get(url, { timeout: CONFIG.timeout });

      // A non-2xx that is not a login redirect is a transient/server problem, not a session
      // problem: surface it as retryable so the normal job retry handles it.
      const loginRedirect = response.url().includes('/login');
      if (!loginRedirect && !response.ok()) {
        throw new DownloaderError(`Request to ${url} failed with HTTP ${response.status()}`);
      }

      const pageData = loginRedirect ? null : parseDataPageFromHtml(await response.text());
      if (pageData?.props?.auth?.user) {
        return pageData;
      }

      // The response is unauthenticated: the session died.  Re-authenticate and retry.
      if (sessionAttempt >= CONFIG.retries.maxRetries) {
        throw new SessionError(`Session still invalid for ${url} after ${sessionAttempt} re-auth attempt(s)`);
      }
      this.logger.warn(`Session expired fetching ${url}; re-authenticating (attempt ${sessionAttempt + 1}/${CONFIG.retries.maxRetries})`);
      await this._reauthenticate(observedGeneration);
    }
  }

  /**
   * Reads the current format from the on-page form controls (framework, version, mode).
   * Assumes the page is already loaded and a code panel is visible.
   *
   * @returns {Promise<Format>} Current format from the page controls
   * @throws {DownloaderError} When required controls are not found
   */
  async _readCurrentFormat() {
    const frameworkSelect = this.mainPage.locator(CONFIG.selectors.frameworkSelect).first();
    const versionSelect = this.mainPage.locator(CONFIG.selectors.versionSelect).first();
    const currentModeInput = this.mainPage.locator(`${CONFIG.selectors.modeInput}:checked`).first();

    const framework = await frameworkSelect.inputValue();
    const version = parseInt(await versionSelect.inputValue(), 10);
    const mode = await currentModeInput.inputValue();

    if (!framework || isNaN(version) || !mode) {
      throw new DownloaderError('Failed to get value for framework, version or mode - required controls not found');
    }

    return new Format(framework, version, mode);
  }

  /**
   * Detects the current format/mode of TailwindPlus components (e.g., html-v3-system).
   * Navigates to the first URL and determines the format from the current values of the on-page form controls.
   * See `createConfig()` for CSS selectors and downloaded formats (all).
   *
   * @returns {Promise<Format>} Detected format object
   * @throws {DownloaderError} When no URLs available or format detection fails
   */
  async _detectFormat() {
    if (this.urls.length === 0) {
      throw new DownloaderError('No URLs available to detect current format');
    }

    await this.mainPage.goto(this.urls[0], { waitUntil: 'domcontentloaded' });

    // Wait for the server-rendered page data
    await this.mainPage.waitForFunction(() => {
      const app = document.querySelector('div#app');
      return app && app.getAttribute('data-page');
    });

    // Show a code panel to reveal a version control
    await this._showOneCodePanel();

    const detectedFormat = await this._readCurrentFormat();
    this.logger.debug(`Detected format: ${detectedFormat}`);

    return detectedFormat;
  }

  /**
   * Generates all possible format combinations using ReflectingArray for efficient iteration
   * @param {Object} startFormat - Starting format to prioritize (e.g., the currently set format for the user account)
   * @returns {Array} Array of format objects with framework, version, and mode
   */
  _generateFormats(startFormat = new Format('react', 3, 'system')) {
    this.logger.debug(`Generating formats starting with: ${startFormat}`);
    const { framework: startFramework, version: startVersion, mode: startMode } = startFormat;

    // Setup the formats from the startFormat, then the remaining
    const frameworks = new ReflectingArray(startFramework, ...CONFIG.download.frameworks.filter(f => f !== startFramework));
    const versions = new ReflectingArray(startVersion, ...CONFIG.download.versions.filter(v => v !== startVersion));
    const modes = new ReflectingArray(startMode, ...CONFIG.download.modes.filter(m => m !== startMode));

    // Allows single element permutation, similar to Gray Code
    const formats = [];
    for (const framework of frameworks) {
      for (const version of versions) {
        for (const mode of modes) {
          formats.push(new Format(framework, version, mode));
        }
      }
    }
    return formats;
  }

  _showStartMessage() {
    if (this.options.unauthenticated) {
      this.logger.info('Unauthenticated mode: downloading free components only');
    }

    if (this.options.debugTrace) {
      this.logger.info(`Tracing enabled. Traces will be saved to: ${this.tracesDir}`);
    }

    if (this.options.debugShortTest) {
      this.logger.info(`Short test mode: Limiting to 2 URLs.`);
    }

    this.logger.info(`Starting download to ${this.options.output} with ${this.options.workers} workers`);
  }

  /**
   * Processes multiple formats by coordinating worker pool and job queue
   * Creates workers, manages job distribution, and handles format switching
   *
   * The job "queue" is just an array.  Each format is downloaded by using the collection of
   * discovered URLs (which must be downloaded for each format) to generate a job for each URL.  The
   * jobs are pushed onto the job queue array.  Each Worker reads from the queue array until there
   * are no jobs left remaining.  When all workers stop (i.e., no jobs remain) the next format is
   * set, the job queue re-populated, workers started, and URLs downloaded "again".  The format is a
   * persisted server-side user account-level setting, and so all URLs must be downloaded in the
   * current format before the format may be changed.  Because the setting persists beyond the run,
   * the format the account started on is restored once the passes finish.
   *
   * eCommerce pages are the exception: they have no mode controls and render identically in every
   * mode, so they are queued once per framework/version rather than once per format.
   *
   * In unauthenticated mode, workers handle all formats per-page in a single visit, since format
   * controls work per-component without authentication.
   *
   * @param {string[]} formats - Array of format identifiers to process
   * @throws {DownloaderError} When worker creation fails or format processing fails
   */
  async _processFormats(formats) {
    this.logger.debug(`Processing ${formats.length} formats`);

    const numberOfWorkers = Math.min(this.options.workers, this.urls.length);
    const workers = [];

    this.logger.debug(`Creating ${numberOfWorkers} workers`);
    for (let i = 0; i < numberOfWorkers; i++) {
      const worker = new Worker(i + 1, this.browser, this.contextOptions, this, this.baseLogger);
      workers.push(worker);
    }

    // In unauthenticated mode, workers handle all formats per-page
    if (this.options.unauthenticated) {
      this.logger.info(`Unauthenticated mode: downloading ${formats.length} formats per page`);
      this.formats = formats;  // Workers will use this
      this._populateJobQueue();

      const workerPromises = workers.map(worker => worker.start());
      await Promise.all(workerPromises);
      await Promise.all(workers.map(worker => worker.stop()));

      this.logger.debug('All formats downloaded');
      return;
    }

    // eCommerce pages render the same content in every mode, so only the first mode pass of
    // each framework/version needs them.  The remaining two passes skip those URLs entirely.
    const eCommerceDownloadedFor = new Set();

    // Authenticated mode: iterate through formats, setting account-level format.  The format the
    // account started on is restored in a `finally`, so a pass that throws partway does not strand
    // the account on the format it stopped on.
    try {
      for (const format of formats) {
        this.logger.info(`Starting download for format: ${format}`);

        // Workers reference this to sanity check data
        this.currentFormat = format;

        await this._setFormat(format);

        const frameworkVersion = `${format.framework}-v${format.version}`;
        const includeEcommerce = !eCommerceDownloadedFor.has(frameworkVersion);
        eCommerceDownloadedFor.add(frameworkVersion);

        this._populateJobQueue({ includeEcommerce });

        // Run workers
        const workerPromises = workers.map(worker => worker.start());
        await Promise.all(workerPromises);
        await Promise.all(workers.map(worker => worker.stop()));

        this.logger.info(`Downloaded format: ${format}`);
      }
    } finally {
      await this._restoreInitialFormat();
    }

    this.logger.debug('All formats downloaded');
  }

  /**
   * Sets the account format by changing UI controls and waiting for responses
   * @param {Object} format - Target format with framework, version, and mode
   */
  async _setFormat(targetFormat) {
    // Navigate to first page to access format controls
    await this.mainPage.goto(this.urls[0], { waitUntil: 'domcontentloaded' });

    const app = this.mainPage.locator('div#app');

    const pageDataJson = await app.getAttribute('data-page');
    if (!pageDataJson) {
      throw new DownloaderError(`No data-page attribute found on ${this.urls[0]}`);
    }

    // Expose the version control
    await this._showOneCodePanel();

    let currentFormat = await this._readCurrentFormat();
    const { framework: targetFramework, version: targetVersion, mode: targetMode } = targetFormat;

    // If the format is already the target format, just return.  Workers can start.
    if (currentFormat.toString() === targetFormat.toString()) {
      this.logger.debug(`Format is already: ${targetFormat}`);
      return;
    }

    // Validate that every component in a response matches the given intermediate target format.
    // Each control change (framework, then version, then mode) only reaches the final target one
    // axis at a time, so the response must be matched against the intermediate target, not the
    // final one.
    const isTargetFormat = (target, { snippet: { name: framework, version, mode } }) =>
      framework === target.framework && version === target.version && mode === target.mode;

    const responseForTarget = (target) => {
      return async (response) => {
        if (response.request().method() !== 'GET' || response.status() !== 200) {
          return false;
        }
        const contentType = response.headers()['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
          return false;
        }
        try {
          const data = await response.json();
          const components = data.props?.subcategory?.components;
          if (!Array.isArray(components) || components.length === 0) {
            return false;
          }
          return components.every(c => isTargetFormat(target, c));
        } catch (e) {
          return false;
        }
      };
    };

    this.logger.debug(`Setting format: ${targetFormat}, current format: ${currentFormat}`);

    try {
      const frameworkSelect = this.mainPage.locator(CONFIG.selectors.frameworkSelect).first();
      const versionSelect = this.mainPage.locator(CONFIG.selectors.versionSelect).first();
      const targetModeInput = this.mainPage.locator(`${CONFIG.selectors.modeInput}[value="${targetMode}"]`).first();

      // Change one axis at a time: arm the response wait, trigger the control, then wait for the
      // matching response before the next change. Sequential (not Promise.all) so each network
      // response is handled before the next control is touched. Returns the new current format.
      const changeAxis = async (target, triggerControl) => {
        const responsePromise = this.mainPage.waitForResponse(responseForTarget(target));
        await triggerControl();
        await responsePromise;
        return target;
      };

      if (currentFormat.framework !== targetFramework) {
        this.logger.debug(`Changing framework: ${currentFormat.framework} -> ${targetFramework}`);
        currentFormat = await changeAxis(
          new Format(targetFramework, currentFormat.version, currentFormat.mode),
          () => frameworkSelect.selectOption(targetFramework)
        );
      }

      if (currentFormat.version !== targetVersion) {
        this.logger.debug(`Changing version: ${currentFormat.version} -> ${targetVersion}`);
        currentFormat = await changeAxis(
          new Format(currentFormat.framework, targetVersion, currentFormat.mode),
          // Version is converted to a string, which is required by selectOption
          () => versionSelect.selectOption(String(targetVersion))
        );
      }

      if (targetMode !== null && currentFormat.mode !== targetMode) {
        this.logger.debug(`Changing mode: ${currentFormat.mode} -> ${targetMode}`);
        currentFormat = await changeAxis(
          new Format(currentFormat.framework, currentFormat.version, targetMode),
          () => targetModeInput.click()
        );
      }

      // Verify the format persisted server-side: a fresh GET must render every
      // component in the target format.  Cheaper than a browser navigation, and checks
      // the server's persisted state rather than the just-clicked on-page controls.
      const verifyData = await this._fetchPageData(this.urls[0]);
      subcategoryOfRequiredFormat(verifyData, this.urls[0], targetFormat);

      this.logger.debug(`Set format: ${targetFormat}`);
    } catch (error) {
      throw new DownloaderError(`Failed to set format. ${error.message}`);
    }
  }

  /**
   * Restores the account-level format captured at the start of the run.
   *
   * `_setFormat` re-reads the live format and returns early when it already matches, so a run whose
   * last pass happened to end on the initial format costs a page load and changes nothing.
   *
   * A failed restore is logged and swallowed.  It must not fail an otherwise successful run, nor
   * replace the error that ended a failed one.
   */
  async _restoreInitialFormat() {
    // Unauthenticated mode has no account format to restore, and an authenticated run that aborted
    // before detection never changed one.
    if (!this.initialFormat) {
      return;
    }

    this.logger.info(`Restoring initial format: ${this.initialFormat}`);

    try {
      await this._setFormat(this.initialFormat);
    } catch (error) {
      this.logger.warn(`Failed to restore initial format ${this.initialFormat}. ${error.message}`);
    }
  }

  async _showOneCodePanel() {
    const codeButton = this.mainPage.locator(CONFIG.selectors.codeButtons).first();
    const versionSelect = this.mainPage.locator(CONFIG.selectors.versionSelect).first();

    // After a domcontentloaded navigation the click can land before React has attached
    // its handlers, in which case the code panel never opens; re-click until it does.
    for (let attempt = 1; attempt <= CONFIG.retries.maxRetries; attempt++) {
      try {
        await codeButton.click();
        await versionSelect.waitFor({ state: 'visible', timeout: 2000 });
        return;
      } catch (e) {
        if (attempt === CONFIG.retries.maxRetries) {
          throw new DownloaderError(`Could not reveal a code panel. ${e.message}`);
        }
      }
    }
  }

  /**
   * Populates the job queue with one job per discovered URL.
   *
   * @param {Object} [options] - Queue population options
   * @param {boolean} [options.includeEcommerce=true] - When false, drop eCommerce URLs from the
   *   queue because this pass would re-download content already captured for the same
   *   framework and version
   */
  _populateJobQueue({ includeEcommerce = true } = {}) {
    this.logger.debug('Populating job queue from discovered URLs');

    let urlsToProcess = [...this.urls];

    if (this.options.debugShortTest) {
      urlsToProcess = urlsToProcess.slice(0, 2);
    }

    if (!includeEcommerce) {
      const nonEcommerceUrls = urlsToProcess.filter(url => !isEcommerceUrl(url));
      const skippedCount = urlsToProcess.length - nonEcommerceUrls.length;
      if (skippedCount > 0) {
        this.logger.debug(`Skipping ${skippedCount} eCommerce URL(s) already downloaded for this framework and version`);
      }
      urlsToProcess = nonEcommerceUrls;
    }

    // Transform the list of URLs to a list of jobs
    this.jobQueue = urlsToProcess.map(url => ({
      url,
      status: 'pending',
      retryCount: 0
    }));

    this.logger.debug(`Populated job queue with ${this.jobQueue.length} jobs for current format`);
  }

  /**
   * Records a subcategory's prose, keyed by its dotted "product.category.subcategory" path.
   *
   * Called by workers as they extract each page.  The prose does not vary with the snippet
   * format, so every format pass over a page records the same values: writes are idempotent
   * and last-writer-wins is correct.  A single synchronous assignment also means concurrent
   * workers cannot interleave a partial write.
   *
   * @param {string} product - Product name, e.g. "Marketing"
   * @param {string} category - Category name, e.g. "Page Sections"
   * @param {Object} subcategory - Subcategory object from the page data (`name`, `description`, `introduction`)
   */
  _recordSubcategoryDescription(product, category, subcategory) {
    const subcategoryPath = `${product}.${category}.${subcategory.name}`;
    this.descriptions.subcategories[subcategoryPath] = {
      description: subcategory.description,
      introduction: subcategory.introduction
    };
  }

  _mergeComponentData(target, source) {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value.snippets)) {
          // This is a component - merge snippets
          if (!target[key]) {
            target[key] = { name: value.name, snippets: [] };
          }
          target[key].snippets = target[key].snippets.concat(value.snippets);
        } else {
          // This is a product / category / subcategory - recurse
          if (!target[key]) {
            target[key] = {};
          }
          this._mergeComponentData(target[key], value);
        }
      }
    }
  }

  _processJobResult(job) {
    if (job.status === 'completed' && job.data) {
      const componentCount = this._countComponents(job.data);
      this.logger.debug(`Processed ${this.currentFormat} for ${job.url} (${componentCount} components)`);

      this._mergeComponentData(this.componentData, job.data);

    } else if (job.status === 'failed') {
      // The worker that ran the job already reported the failure, under its own log prefix.
      // Report only what is decided here: whether the job is retried.

      // Re-queue failed job as pending, for retry, if under maxRetries
      if (job.retryCount < CONFIG.retries.maxRetries) {
        job.retryCount++;
        job.status = 'pending';
        this.jobQueue.push(job);
        this.logger.warn(`Retrying ${job.url} (attempt ${job.retryCount}/${CONFIG.retries.maxRetries})`);
      } else {
        this.logger.error(`Max retries exceeded for ${job.url}, skipping`);
      }
    }
  }

  _countComponents(data) {
    let count = 0;
    for (const value of Object.values(data)) {
      if (value !== null && typeof value === 'object') {
        if (Array.isArray(value.snippets)) {
          count++;
        } else {
          count += this._countComponents(value);
        }
      }
    }
    return count;
  }

  _buildMetadata() {
    const durationSec = this._elapsedSecondsSinceStart();
    const componentCount = this._countComponents(this.componentData);
    this.capturedComponentCount = componentCount;

    this.logger.debug('Sorting component data for stable output');
    sortSnippetsRecursively(this.componentData);

    return {
      component_count: componentCount,
      download_duration: `${durationSec}s`,
      downloaded_at: this.startTime.toISOString(),
      downloader_version: packageJson.version,
      version: this.version,
    };
  }

  _processResultsAndWriteOutput() {
    const outputFile = this.options.output;
    const metadata = this._buildMetadata();

    const outputData = {
      ...metadata,
      descriptions: this.descriptions,
      tailwindplus: this.componentData
    };

    this.logger.debug(`Writing output file: ${outputFile}`);
    // Unfortunately, using a replacer prevents V8's 2x fast-path serialization.
    // See: `Limitations`, https://v8.dev/blog/json-stringify
    fs.writeFileSync(outputFile, JSON.stringify(outputData, sortedObjects, 2));
  }

  _processResultsAndWriteDirectory() {
    const outputDir = this.options.output;
    const metadata = this._buildMetadata();

    this.logger.debug(`Writing component directory: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });

    this._writeComponentFiles(outputDir, this.componentData, []);
    fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, sortedObjects, 2));
    fs.writeFileSync(path.join(outputDir, 'descriptions.json'), JSON.stringify(this.descriptions, sortedObjects, 2));
  }

  _writeComponentFiles(outputDir, data, pathParts) {
    for (const [key, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value.snippets)) {
        for (const snippet of value.snippets) {
          let ext;
          switch (snippet.name) {
          case 'react': ext = 'jsx'; break;
          case 'vue':   ext = 'vue'; break;
          default:      ext = 'html';
          }
          const modePart = snippet.mode ? `-${snippet.mode}` : '';
          const filename = `${snippet.name}${modePart}.${ext}`;
          const versionDir = `v${snippet.version}`;
          const snippetDir = path.join(outputDir, ...pathParts, key, versionDir);
          fs.mkdirSync(snippetDir, { recursive: true });
          fs.writeFileSync(path.join(snippetDir, filename), snippet.code);
        }
      } else {
        this._writeComponentFiles(outputDir, value, [...pathParts, key]);
      }
    }
  }

  _showStopMessage() {
    const durationSec = this._elapsedSecondsSinceStart();

    if (fs.existsSync(this.options.output)) {
      let savedMessage;
      if (this.options.outputFormat === 'dir') {
        savedMessage = `Download complete! Components saved to directory ${this.options.output}`;
      } else {
        const sizeKB = Math.round(fs.statSync(this.options.output).size / 1024);
        savedMessage = `Download complete! Components saved to ${this.options.output} (${sizeKB} KB)`;
      }

      const capturedSuffix = this.capturedComponentCount === null ?
        '' :
        ` Captured ${this.capturedComponentCount}.`;

      const messageLines = [
        `Discovered ${this.urlCount} URLs with ${this.componentCount} individual components.${capturedSuffix}`,
        savedMessage,
        `Duration: ${durationSec}s`
      ];

      messageLines.forEach(line => this.logger.info(line));
    } else {
      this.logger.info(`Download completed in ${durationSec}s. Discovered ${this.urlCount} URLs with ${this.componentCount} total components.`);
    }
  }

  /**
   * Tears down the run: reports the outcome, closes the page, finalizes any trace, closes the
   * browser, and closes the logger.
   *
   * @param {Object} [options] - Teardown options
   * @param {boolean} [options.completed=true] - Whether the run finished its work.  A failed run
   *   skips the summary, which would otherwise report a download that did not happen
   */
  async stop({ completed = true } = {}) {
    this.logger.debug('--- Shutting down ---');

    if (completed) {
      this._showStopMessage();
    }

    // Close main page if it exists.  As in `Worker.stop`, the browser may already be gone.
    if (this.mainPage && !this.mainPage.isClosed()) {
      try {
        await this.mainPage.close();
      } catch (error) {
        this.logger.debug(`Main page already closed: ${error.message}`);
      }
    }

    // Stop tracing if enabled.  A run that failed before the browser was created has no context.
    if (this.options.debugTrace && this.context) {
      await stopTracing(this.context, this.tracesDir, 'main');
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        this.logger.debug(`Browser already closed: ${error.message}`);
      }
    }

    await this.baseLogger.close();
  }
}

// ===================================================================================
//
//  Worker Class
//
// ===================================================================================

class Worker {
  constructor(id, browser, contextOptions, downloader, logger) {
    this.id = id;
    this.browser = browser;
    this.contextOptions = contextOptions;
    this.context = null;
    this.downloader = downloader;
    this.page = null;
    this.state = 'stopped';

    // Pad the worker ID to ensure consistent identifier length
    const identifier = `Worker ${id.toString().padStart(2, ' ')}`;
    this.logger = logger.prefix(identifier);
  }

  /**
   * Starts the worker and begins processing jobs from the downloader's job queue.
   * Authenticated jobs are plain HTTP GETs through the downloader's request context; only
   * unauthenticated mode creates a browser context and page, since its extraction drives
   * on-page controls.
   *
   * If a job (URL to download in the current format) fails, it is returned to the main downloader,
   * and re-queued to be attempted again; up to maxRetries.  A job generally fails with a timeout
   * error caused by network failure.  Some such failures may be successfully retried, however if
   * `maxRetries` is reached the script must be re-run, because "partial downloads" are not
   * supported.  A mid-run session expiry is re-authenticated and resumed automatically; a
   * SessionError aborts the run only when the session cannot be restored.
   *
   * @throws {DownloaderError} When context creation fails or job processing encounters fatal errors
   */
  async start() {
    if (this.state === 'started') {
      this.logger.warn('Already started, returning without running jobs');
      return;
    }

    this.state = 'started';

    // Unauthenticated extraction needs a real page (received with session)
    if (this.downloader.options.unauthenticated) {
      this.context = await this.browser.newContext(this.contextOptions);
      this.context.setDefaultTimeout(CONFIG.timeout);

      // Start tracing if enabled
      if (this.downloader.options.debugTrace) {
        await startTracing(this.context, `worker-${this.id}-unauthenticated`, `Worker ${this.id} (unauthenticated)`);
      }

      this.page = await this.context.newPage();
    }

    // Job processing loop
    while (this.downloader.jobQueue.length > 0) {
      const job = this.downloader.jobQueue.shift();
      if (!job) break;

      try {
        this.logger.debug(`Started job: ${job.url}`);
        job.status = 'processing';

        // Use unauthenticated extraction when in that mode
        const pageData = this.downloader.options.unauthenticated
          ? await this._extractUnauthenticatedPageData(job)
          : await this.extractPageData(job);

        job.data = pageData;
        job.status = 'completed';
        this.downloader._processJobResult(job);
        this.logger.debug(`Completed job: ${job.url}`);
      } catch (error) {
        // _fetchPageData already re-authenticates and retries on expiry; a SessionError here
        // means the session could not be restored (bad credentials, or it kept failing).
        // Abort rather than write partial data.
        if (error instanceof SessionError) {
          throw error;
        }
        this.logger.warn(`Job failed: ${job.url} - ${error.message}`);
        job.status = 'failed';
        this.downloader._processJobResult(job);
      }
    }

    this.logger.debug('Job queue empty');
  }

  // Whitelist snippet properties for serialization; exclude internal page data fields.
  _shapeSnippet(snippet) {
    const { code, name, language, version, mode, supportsDarkMode, preview } = snippet;
    return { code, name, language, version, mode, supportsDarkMode, preview };
  }

  /**
   * Extracts component data from a page and validates format consistency.
   * Fetches the job URL with a plain authenticated GET, parses the data-page JSON out of the raw
   * HTML, validates the expected format, and processes components.
   *
   * The code is not obtained from the `<code>` DOM elements visible on the page, but rather
   * directly from the server-rendered JSON on the #app root, so no browser page is needed at all.
   * This is significantly more reliable and much faster than (even automated) clicks on the page
   * elements to reveal the code.  It is a fatal error if the expected code format is not found in
   * the page JSON data.  This is to safeguard against the format being changed manually during
   * script execution.  (This can occur if a user browses the TailwindPlus site while the script is
   * running and changes the form controls.)
   *
   * @param {Object} job - Job object containing URL and hierarchy info (product/category/subcategory)
   * @returns {Promise<Object>} Component data organized by component name with HTML content
   * @throws {SessionError} When the session cannot be restored by re-authentication (aborts the run)
   * @throws {DownloaderError} When the request fails, data extraction fails, or format validation fails
   */
  async extractPageData(job) {
    const url = job.url;

    // Get expected format from downloader
    const expectedFormat = this.downloader.currentFormat;
    if (!expectedFormat) {
      throw new DownloaderError('No current format set by downloader');
    }

    const pageData = await this.downloader._fetchPageData(url);
    const subcategory = subcategoryOfRequiredFormat(pageData, url, expectedFormat);

    // Data is now guaranteed to be available and in the correct format
    const components = subcategory.components;
    const category = subcategory.category;
    const product = subcategory.category.product;

    this.downloader._recordSubcategoryDescription(product.name, category.name, subcategory);

    const componentData = {};
    componentData[product.name] = {};
    componentData[product.name][category.name] = {};
    componentData[product.name][category.name][subcategory.name] = {};

    // Transform components to expected structure
    components.forEach(component => {
      componentData[product.name][category.name][subcategory.name][component.name] = {
        name: component.name,
        snippets: [this._shapeSnippet(component.snippet)]
      };
    });

    this.logger.debug(`Extracted ${components.length} components from ${product.name}/${category.name}/${subcategory.name}`);
    return componentData;
  }

  /**
   * Extracts component data for unauthenticated (free) components by changing format controls
   * per-component and capturing snippets from JSON responses.
   *
   * Uses data-page JSON to identify downloadable components by UUID, then iterates through all
   * format combinations (framework/version/mode) for each component. Captures snippets either
   * from JSON responses when controls are changed, or from initial data-page when format already
   * matches.
   *
   * @param {Object} job - Job object containing URL
   * @returns {Promise<Object>} Component data organized by hierarchy with all format snippets
   * @throws {DownloaderError} When page navigation fails or data extraction fails
   */
  async _extractUnauthenticatedPageData(job) {
    const url = job.url;
    const formats = this.downloader.formats;

    // Relative selectors within a component section
    const controlsRelative = 'div > :nth-child(2)';
    const codeButtonRelative = `${controlsRelative} button:has-text("Code")`;
    const frameworkSelectRelative = `${controlsRelative} select`;
    const modeInputRelative = (mode) => `${controlsRelative} input[value="${mode}"]`;

    // Predicate for JSON response to the page URL
    const isInertiaJsonResponse = response =>
      response.url() === url &&
      response.status() === 200 &&
      (response.headers()['content-type'] || '').includes('application/json');

    await this.page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for data-page to be available
    await this.page.waitForFunction(() => {
      const app = document.querySelector('#app');
      return app && app.getAttribute('data-page');
    });

    // Get page structure and downloadable components from data-page JSON
    const pageInfo = await this.page.evaluate(() => {
      const data = JSON.parse(document.querySelector('#app').getAttribute('data-page'));
      const subcategory = data.props.subcategory;
      return {
        product: subcategory.category.product.name,
        category: subcategory.category.name,
        subcategory: subcategory.name,
        description: subcategory.description,
        introduction: subcategory.introduction,
        downloadableComponents: data.props.subcategory.components
          .filter(c => c.downloadable && c.preview === 'light')
          .map(c => ({ uuid: c.uuid, name: c.name, initialSnippet: c.snippet }))
      };
    });

    const { product, category, subcategory, description, introduction, downloadableComponents } = pageInfo;

    this.downloader._recordSubcategoryDescription(product, category, { name: subcategory, description, introduction });

    if (downloadableComponents.length === 0) {
      this.logger.debug(`No downloadable components on ${url}`);
      return {};
    }

    this.logger.debug(`Found ${downloadableComponents.length} downloadable components`);

    // Build component data structure
    const componentData = {};
    componentData[product] = {};
    componentData[product][category] = {};
    componentData[product][category][subcategory] = {};

    // Process each downloadable component by UUID
    for (const comp of downloadableComponents) {
      const snippets = [];

      // Locate section by UUID
      const section = this.page.locator(`#component-${comp.uuid}`);
      await section.waitFor({ state: 'visible', timeout: CONFIG.timeout });

      // Click Code button to reveal controls
      const codeButton = section.locator(codeButtonRelative);
      await codeButton.click();

      // Get framework select (first select in controls)
      const frameworkSelect = section.locator(frameworkSelectRelative).first();

      // Check if mode inputs exist (eCommerce pages don't have them)
      const modeInputCount = await section.locator(`${controlsRelative} input[type="radio"]`).count();
      const hasModeInputs = modeInputCount > 0;

      // For pages without mode inputs, filter to unique framework/version combinations
      let formatsToUse = formats;
      if (!hasModeInputs) {
        const seen = new Set();
        formatsToUse = formats.filter(f => {
          const key = `${f.framework}-${f.version}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      // Iterate through format combinations
      for (const format of formatsToUse) {
        let responseBody = null;

        // Change framework if needed
        const currentFramework = await frameworkSelect.inputValue();
        if (currentFramework !== format.framework) {
          const resp = this.page.waitForResponse(isInertiaJsonResponse);
          await frameworkSelect.selectOption(format.framework);
          responseBody = await (await resp).json();
        }

        // Change version if needed
        const versionSelect = section.locator(frameworkSelectRelative).nth(1);
        const actualVersion = await versionSelect.inputValue();
        const targetVersion = String(format.version);
        if (actualVersion !== targetVersion) {
          const resp = this.page.waitForResponse(isInertiaJsonResponse);
          await versionSelect.selectOption(targetVersion);
          responseBody = await (await resp).json();
        }

        // Change mode if needed (only for pages with mode inputs)
        if (hasModeInputs) {
          const modeInput = section.locator(modeInputRelative(format.mode)).first();
          const isChecked = await modeInput.isChecked();

          if (!isChecked) {
            const resp = this.page.waitForResponse(isInertiaJsonResponse);
            await modeInput.click();
            responseBody = await (await resp).json();
          }
        }

        // Extract snippet - either from response or initial data-page
        let snippet;
        if (responseBody) {
          const components = responseBody.props.subcategory.components;
          const targetInResponse = components.find(c => c.uuid === comp.uuid);
          snippet = targetInResponse?.snippet;
        } else {
          // No changes made - use initial snippet from data-page
          snippet = comp.initialSnippet;
        }

        if (snippet) {
          snippets.push(this._shapeSnippet(snippet));
        }
      }

      componentData[product][category][subcategory][comp.name] = {
        name: comp.name,
        snippets
      };

      this.logger.debug(`Collected ${snippets.length} snippets for ${comp.name}`);
    }

    this.logger.debug(`Extracted ${downloadableComponents.length} components from ${product}/${category}/${subcategory}`);
    return componentData;
  }

  /**
   * Stops the worker and performs cleanup
   * Stops tracing if enabled, closes the browser context and pages (unauthenticated mode
   * only; authenticated workers hold no browser resources), and resets state
   */
  async stop() {
    if (this.context) {
      // Stop tracing if enabled
      if (this.downloader.options.debugTrace) {
        await stopTracing(this.context, this.downloader.tracesDir, `worker-${this.id}-unauthenticated`);
      }

      // This will close all pages in the context.  The browser process may already be gone, and
      // closing a dead context throws; teardown must survive that.
      try {
        await this.context.close();
      } catch (error) {
        this.logger.debug(`Context already closed: ${error.message}`);
      }

      this.context = null;
      this.page = null;
    }
    this.state = 'stopped';
  }
}

// ===================================================================================
//
//  Command-Line Argument Parsing and Main Execution
//
// ===================================================================================

function parseArgs() {
  const argv = yargs(hideBin(process.argv))
    .wrap(yargs().terminalWidth())
    .version('version', 'Show version number', packageJson.version)
    .strict()
    .option('output', {
      type: 'string',
      requiresArg: true,
      describe: `Path to save downloaded components. For --output-format=json (default): ${CONFIG.outputBase}-[TIMESTAMP].json. For --output-format=dir: ${CONFIG.outputBase}-[TIMESTAMP]/`
    })
    .option('workers', {
      type: 'number',
      requiresArg: true,
      default: 15,
      describe: 'Number of pages to download in parallel'
    })
    .option('session', {
      type: 'string',
      requiresArg: true,
      default: CONFIG.session,
      describe: 'Path to session file (optional)'
    })
    .option('credentials', {
      type: 'string',
      requiresArg: true,
      default: CONFIG.credentials,
      describe: 'Path to credentials file (optional)'
    })
    .option('log', {
      describe: 'Path to log file (optional). If without a path, defaults to the output filename with a .log extension.'
    })
    .option('debug', {
      type: 'boolean',
      default: false,
      describe: 'Enable debug level logging'
    })
    .option('debug-short-test', {
      type: 'boolean',
      describe: 'Limits download to two URLs for fast testing'
    })
    .option('debug-url-file', {
      type: 'string',
      requiresArg: true,
      describe: 'Process only specific URLs from a file, comments allowed with #'
    })
    .option('debug-headed', {
      type: 'boolean',
      describe: 'Run browser in headed mode (shows browser window)'
    })
    .option('debug-trace', {
      type: 'boolean',
      describe: 'Enable tracing to debug browser interactions, saved in directory `[OUTPUT].traces`'
    })
    .option('unauthenticated', {
      type: 'boolean',
      default: false,
      describe: 'Download only free (unauthenticated) components without login'
    })
    .option('output-format', {
      choices: ['json', 'dir'],
      default: 'json',
      describe: 'Output format: json (single file) or dir (directory tree of individual component files)'
    })
    .option('overwrite', {
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing output file or directory without prompting'
    })
    .check((argv) => {
      // Validate workers bounds
      if (argv.workers <= 0) {
        throw new Error('workers must be a positive number');
      }
      if (argv.workers > 50) {
        throw new Error('workers should not exceed 50 to prevent resource exhaustion');
      }
      if (argv.debugUrlFile && !fs.existsSync(argv.debugUrlFile)) {
        throw new Error(`URL file not found: ${argv.debugUrlFile}`);
      }
      return true;
    })
    .usage('Usage: $0 [options]')
    .example('$0 --output=components.json', 'Download to specific file')
    .example('$0 --output-format=dir --output=components/', 'Write components as a directory tree')
    .example('$0 --workers=5 --debug', 'Slower download with debug logging')
    .epilog('Options can be specified as --option=value or --option value')
    .help('help')
    .alias('help', 'h')
    .parseSync();

  return {
    output: argv.output,
    outputFormat: argv.outputFormat,
    overwrite: argv.overwrite,
    workers: argv.workers,
    session: argv.session || CONFIG.session,
    credentials: argv.credentials || CONFIG.credentials,
    log: argv.log,
    debug: argv.debug,
    debugShortTest: argv.debugShortTest,
    debugUrlFile: argv.debugUrlFile,
    debugHeaded: argv.debugHeaded,
    debugTrace: argv.debugTrace,
    unauthenticated: argv.unauthenticated
  };
}

async function main() {
  const options = parseArgs();

  // Derive output path default based on format when not explicitly specified
  if (!options.output) {
    options.output = options.outputFormat === 'dir'
      ? `${CONFIG.outputBase}-${CONFIG.version}`
      : CONFIG.output;
  }

  // Derive log filename if --log is used as a flag
  if (options.log === true) {
    if (options.output.endsWith('.json')) {
      options.log = options.output.replace(/\.json$/, '.log');
    } else {
      options.log = options.output + '.log';
    }
  }

  const downloader = new TailwindPlusDownloader(options);
  await downloader.start();
}

main().catch(error => {
  console.error('[FATAL]', error);
  process.exit(1);
});
