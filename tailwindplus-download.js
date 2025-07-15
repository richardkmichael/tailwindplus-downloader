#!/usr/bin/env node

/**
 * TailwindPlus Component Downloader
 *
 * This script uses a class-based architecture and a parallel worker pool to
 * download component data from the TailwindPlus website. It is designed for
 * robustness, with fail-fast error handling and comprehensive debugging features.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import packageJson from './package.json' with { type: 'json' };

// ===================================================================================
//
//  Custom Error and Logger Classes
//
// ===================================================================================

class CriticalDownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CriticalDownloadError';
  }
}

class Logger {
  constructor(options = {}) {
    this.isDebug = options.isDebug || false;
    this.logFilePath = options.logFilePath || null;
    this.logStream = null;

    if (this.logFilePath) {
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'w' });
    }
  }

  log(message) {
    const logMessage = `[${new Date().toISOString()}] ${message}`;
    if (this.isDebug) {
      console.log(logMessage);
    }
    if (this.logStream) {
      this.logStream.write(logMessage + '\n');
    }
  }

  close() {
    if (this.logStream) {
      this.logStream.end();
    }
  }
}

// ===================================================================================
//
//  Top-Level Helper Functions
//
// ===================================================================================

/**
 * A factory function that builds and returns an object
 * containing all necessary configuration values.
 */
function createConfig() {
  const baseURL = 'https://tailwindcss.com';
  const plusBase = `${baseURL}/plus`;

  const components = 'nav ~ div > section[id^="component-"]';
  const firstComponent = `${components}:first-of-type`;

  return {
    urls: {
      base: baseURL,
      login: `${plusBase}/login`,
      loginSuccess: plusBase,
      discovery: `${plusBase}/ui-blocks`
    },

    selectors: {
      components,
      firstComponent,
      codeButtons: `${components} > div > :nth-child(2) > div > button:last-child`,
      frameworkSelect: `${firstComponent} > div > :nth-child(2) > :nth-child(3) select`,
      versionSelect: `${firstComponent} > div > :nth-child(3) > :nth-child(2) select`,
    },

    timeouts: {
      response: 5000,
      slowMo: 750
    },

    retries: {
      maxRetries: 9
    },

    download: {
      frameworks: ['html', 'react', 'vue'],
      versions: [3, 4]
    }
  };
}

const CONFIG = createConfig();

async function login(context, credentials, logger) {
  const page = await context.newPage();
  try {
    logger.log('   Logging in...');
    await page.goto(CONFIG.urls.login);
    await page.getByRole('textbox', { name: 'Email' }).fill(credentials.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign in to account' }).click();
    await page.waitForURL(CONFIG.urls.loginSuccess);
    logger.log('   Login successful.');
  } finally {
    await page.close();
  }
}


// ===================================================================================
//
//  Worker Class
//
// ===================================================================================

class Worker {
  constructor(id, browser, credentials, logger, isTrace = false) {
    this.id = id;
    this.browser = browser;
    this.credentials = credentials;
    this.isTrace = isTrace;
    this.context = null;
    this.page = null;

    // Override logger to automatically add worker prefix
    this.logger = {
      log: (message) => logger.log(`[Worker ${this.id.toString().padStart(2, ' ')}] ${message}`)
    };
  }

  async checkExistingPageData(framework, version) {
    try {
      const appElement = await this.page.locator('div#app');
      const pageDataJson = await appElement.getAttribute('data-page');
      const pageData = JSON.parse(pageDataJson);
      const pageComponents = pageData?.props?.subcategory?.components;

      if (!pageComponents || pageComponents.length === 0) {
        return null;
      }

      const isDesiredPair = components => components.every(c => (c.snippet.name == framework) && (c.snippet.version == version));

      if (isDesiredPair(pageComponents)) {
        this.logger.log(`   Page data exists for { ${framework}, v${version} }`);

        // Transform to component objects with snippets arrays
        const componentObjects = {};
        pageComponents.forEach(component => {
          componentObjects[component.name] = {
            name: component.name,
            snippets: [{
              code: component.snippet.code,
              name: component.snippet.name,
              language: component.snippet.language,
              version: component.snippet.version,
              mode: component.snippet.mode,
              supportsDarkMode: component.snippet.supportsDarkMode,
              preview: component.snippet.preview
            }]
          };
        });

        return componentObjects;
      }

      return null;
    } catch (error) {
      this.logger.log(`   Error checking existing page data: ${error.message}`);
      return null;
    }
  }

  async initialize() {
    this.context = await this.browser.newContext();
    if (this.isTrace) {
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      this.logger.log(`   Tracing started`);
    }
    await login(this.context, this.credentials, this.logger);
  }

  async processJob(job) {
    this.page = await this.context.newPage();
    try {
      const result = await this.extractPageData(job);
      return result;
    } finally {
      if(this.page && !this.page.isClosed()) {
        await this.page.close();
      }
    }
  }

  async extractPageData(job) {
    this.logger.log(`   Go to: ${job.url}`);
    await this.page.goto(job.url, { waitUntil: 'networkidle' });
    await this.page.waitForLoadState('networkidle');
    const pageUrlPart = job.url.split('/').pop();

    this.logger.log(`   Starting ${job.tasks.length} tasks`);

    // Process tasks sequentially with fail-fast strategy
    for (let i = 0; i < job.tasks.length; i++) {
      const task = job.tasks[i];
      this.logger.log(`   Running task: { ${task.framework}, v${task.version} }`);

      try {
        // Set up page state for this task
        await this.showOneCode();
        const frameworkAndVersionSelectors = await this.findFrameworkAndVersionSelectors();

        // Check if data for this framework/version already exists on the page
        const existingComponents = await this.checkExistingPageData(task.framework, task.version);

        let componentData;
        if (existingComponents) {
          // Data exists, use it directly
          componentData = existingComponents;
          this.logger.log(`   Using existing page data for: { ${task.framework}, v${task.version} }`);
        } else {
          // Data doesn't exist, configure selectors and fetch it
          componentData = await this.configureAndWaitForData(task, frameworkAndVersionSelectors, pageUrlPart);
        }

        // Validate component data
        for (const name in componentData) {
          const component = componentData[name];
          if (!component.name || !component.snippets || component.snippets.length === 0) {
            throw new CriticalDownloadError(`Component "${name}" was missing name or snippets.`);
          }
        }

        this.logger.log(`🟢 Task succeeded for { ${task.framework}, v${task.version} } with ${Object.keys(componentData).length} components`);

        task.status = 'succeeded';
        task.data = componentData;

      } catch (error) {
        this.logger.log(`🟡 Task failed for { ${task.framework}, v${task.version} }: ${error.message}`);

        // Mark this task as failed
        task.status = 'failed';
        task.error = error.message;

        // Mark all remaining tasks as failed (not attempted) due to browser being stuck
        for (let j = i + 1; j < job.tasks.length; j++) {
          job.tasks[j].status = 'failed';
          job.tasks[j].error = 'not attempted';
        }

        // Fail-fast: stop processing remaining tasks
        break;
      }
    }

    return job; // Return mutated job with task results
  }

  async configureAndWaitForData({ framework, version }, { frameworkSelect, versionSelect }, pageUrlPart) {
    this.logger.log(`   Configuring page for: { ${framework}, v${version} }`);

    // Set up response promise to wait for data after selector changes
    const isDesiredPair = components => components.every(c => (c.snippet.name == framework) && (c.snippet.version == version));

    const dataResponsePromise = this.page.waitForResponse(async (response) => {
      if (response.request().method() !== 'GET' || !response.url().includes(pageUrlPart)) {
        return false;
      }
      try {
        const data = await response.json();
        const components = data?.props?.subcategory?.components;
        if (!components || components.length === 0) return false;
        return isDesiredPair(components);
      } catch (e) {
        return false;
      }
    }, { timeout: CONFIG.timeouts.response });

    // FIXME: Can we wait for the *request(s) to be sent* ?  That would tell us if there has been
    // a hydration problem (no select options to click properly), hence no request sent, hence
    // there will never be a response, so it's useless to wait for one.

    // Optimization:
    //
    // Only change selectors that need changing (since extractPageData() already
    // checked for existing data, we know at least one selector needs to change)
    //
    // PERFORMANCE NOTE: With slowMo: 750, each inputValue() call adds 750ms overhead.
    // Current cost: 2 × inputValue() + potential selectOption() savings = net +750ms per call.
    // This optimization may be counterproductive unless:
    // 1. selectOption() with unchanged value triggers expensive network requests (unconfirmed)
    // 2. Smart task ordering makes many selectors unchanged (future optimization)
    //
    // TODO: Test if selectOption() with same value is truly a no-op or triggers requests.
    // If it's already a no-op, remove this optimization entirely.

    // Check current selector values before changing
    const currentFramework = await frameworkSelect.inputValue();
    const currentVersion = await versionSelect.inputValue();

    // Only change selectors that need changing
    let changedSelectors = [];
    if (currentFramework !== framework) {
      await frameworkSelect.selectOption(framework);
      changedSelectors.push(`framework: ${currentFramework} → ${framework}`);
    } else {
      changedSelectors.push(`framework: ${framework} (unchanged)`);
    }

    if (currentVersion !== version.toString()) {
      await versionSelect.selectOption(version.toString());
      changedSelectors.push(`version: ${currentVersion} → ${version}`);
    } else {
      changedSelectors.push(`version: ${version} (unchanged)`);
    }

    this.logger.log(`   Selector changes: ${changedSelectors.join(', ')}`);

    // Wait for and extract the new data
    const response = await dataResponsePromise;
    const responseBody = await response.json();
    const components = responseBody?.props?.subcategory?.components;
    this.logger.log(`   Data extracted for { ${framework}, v${version} }`);

    // Transform to component objects with snippets arrays
    const componentObjects = {};
    components.forEach(component => {
      componentObjects[component.name] = {
        name: component.name,
        snippets: [{
          code: component.snippet.code,
          name: component.snippet.name,
          language: component.snippet.language,
          version: component.snippet.version,
          mode: component.snippet.mode,
          supportsDarkMode: component.snippet.supportsDarkMode,
          preview: component.snippet.preview
        }]
      };
    });

    return componentObjects;
  }

  async showOneCode() {
    const codeButton = this.page.locator(CONFIG.selectors.codeButtons).first();
    try {
      await codeButton.click();
    } catch (e) {
      throw new CriticalDownloadError(`Could not find framework or version select elements. ${e.message}`);
    }
  }

  async findFrameworkAndVersionSelectors() {
    const frameworkSelect = this.page.locator(CONFIG.selectors.frameworkSelect);
    const versionSelect = this.page.locator(CONFIG.selectors.versionSelect);
    try {
      await frameworkSelect.waitFor();
      await versionSelect.waitFor();
    } catch (e) {
      throw new CriticalDownloadError(`Could not find framework or version select elements. ${e.message}`);
    }
    return { frameworkSelect, versionSelect };
  }

  async shutdown() {
    if (this.context) {
      if (this.isTrace) {
        try {
          const traceFile = `tmp/trace-worker-${this.id}-${Date.now()}.zip`;
          await this.context.tracing.stop({ path: traceFile });
          this.logger.log(`   Trace saved to: ${traceFile}`);
        } catch (error) {
          this.logger.log(`   Warning: Failed to save trace file: ${error.message}`);
        }
      }
      await this.context.close();
    }
  }
}

// ===================================================================================
//
//  Main Downloader Class
//
// ===================================================================================

class TailwindPlusDownloader {
  constructor(options) {
    this.options = options;
    this.startTime = new Date();

    // Always generate version from startup time
    this.version = this.startTime.toISOString().slice(0, 19).replace(/:/g, '').replace('T', '-');

    const baseLogger = new Logger({
      isDebug: !!this.options.debugLog,
      logFilePath: this.options.debugLog || this.options.output.replace(/\.json$/, '.log'),
    });

    // Create main logger with [Main] prefix
    this.logger = {
      log: (message) => baseLogger.log(`[Main] ${message}`),
      close: () => baseLogger.close()
    };

    // Store base logger for worker use
    this.baseLogger = baseLogger;
    this.browser = null;
    this.urlQueue = [];
    this.results = [];
    this.credentials = null;
    this.discoveredUrlCount = 0;
    this.totalComponentCount = 0;
  }

  getDownloadTasks() {
    const tasks = [];
    for (const framework of CONFIG.download.frameworks) {
      for (const version of CONFIG.download.versions) {
        tasks.push({ framework, version });
      }
    }
    return tasks;
  }

  async startup() {
    this.logger.log('--- Started ---');
    try {
      this._loadCredentials(this.options.credentials);
      this._showStartupMessage();
      await this._initializeBrowser();
      const discoveryResult = await this._discoverComponentUrls(this.browser);
      this.discoveredUrlCount = discoveryResult.urlCount;
      this.totalComponentCount = discoveryResult.totalComponentCount;
      this._populateUrlQueueFromHierarchy(discoveryResult.hierarchicalData);
      await this._createAndRunWorkers();
      this._processAndSaveResults();
    } catch (error) {
      // Always show critical errors to the user, regardless of debug mode
      console.error(`🔴 Error: ${error.message}`);
      this.logger.log(`🔴 Error uncaught: ${error.message}`);
      process.exit(1);
    } finally {
      await this._shutdown();
    }
  }

  _showStartupMessage() {
    const message = `Starting download to ${this.options.output} with ${this.options.workers} workers`;

    if (this.options.debugLog) {
      this.logger.log(`   ${message}`);
    } else {
      console.log(message);
    }
  }

  _showShutdownMessage() {
    const successfulDownloads = this.results.filter(r => r.data);
    const failedDownloads = this.results.filter(r => r.error);

    const endTime = new Date();
    const durationMs = endTime - this.startTime;
    const durationSec = (durationMs / 1000).toFixed(1);

    const stats = fs.statSync(this.options.output);
    const sizeKB = Math.round(stats.size / 1024);

    // Read back the saved file to get component count
    const savedData = JSON.parse(fs.readFileSync(this.options.output, 'utf8'));
    const componentCount = savedData.component_count;

    const message = `Download complete! ${componentCount} components (${sizeKB}KB) saved to ${this.options.output}`;

    // Count unique URLs processed (not result entries)
    const uniqueSuccessfulUrls = new Set(successfulDownloads.map(r => r.job.url));
    const uniqueFailedUrls = new Set(failedDownloads.map(r => r.job.url));

    // Generate summary messages as plain strings
    const summaryLines = [
      `Processed ${uniqueSuccessfulUrls.size} successful and ${uniqueFailedUrls.size} failed URLs of ${this.discoveredUrlCount} discovered.`,
      `Total component count from discovery: ${this.totalComponentCount}.`,
      message
    ];

    if (failedDownloads.length > 0) {
      summaryLines.push(`Note: ${failedDownloads.length} jobs failed and were excluded from results`);
    }

    // Output to console or logger based on debug mode (same pattern as startup)
    if (this.options.debugLog) {
      summaryLines.forEach(line => this.logger.log(`   ${line}`));
    } else {
      summaryLines.forEach(line => console.log(line));
    }
  }

  _loadCredentials(credentialsPath) {
    if (!fs.existsSync(credentialsPath)) {
      throw new CriticalDownloadError(`No credentials found at ${credentialsPath}

To get started, create a credentials file with your TailwindPlus login details:
{
  "email": "your-email@example.com",
  "password": "your-password"
}

Save this as '${credentialsPath}' or specify a different path with --credentials

For more options, run: node tailwindplus-download.js --help`);
    }
    this.credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    this.logger.log('   Credentials loaded successfully');
  }

  async _initializeBrowser() {
    this.logger.log('   Initializing shared browser...');
    this.browser = await chromium.launch({
      headless: !this.options.debugHeaded,
      slowMo: this.options.slowMo
    });
  }

  _loadUrlsFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new CriticalDownloadError(`URL file not found at: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  }

  async _discoverComponentUrls(browser) {
    this.logger.log('   Discovering hierarchical component structure...');
    const discoveryContext = await browser.newContext();
    const page = await discoveryContext.newPage();
    try {
      await login(discoveryContext, this.credentials, this.logger);
      this.logger.log(`   Discovering component URLs from: ${CONFIG.urls.discovery}`);
      await page.goto(CONFIG.urls.discovery, { waitUntil: 'networkidle' });

      const appElement = await page.locator('div#app');
      if ((await appElement.count()) === 0) {
        throw new Error('Could not find the root element \'div#app\' on the page.');
      }
      const jsonString = await appElement.getAttribute('data-page');
      if (!jsonString) {
        throw new Error('The \'data-page\' attribute on \'div#app\' was empty or not found.');
      }

      const componentData = JSON.parse(jsonString);
      const products = componentData?.props?.products;
      if (!products || !Array.isArray(products)) {
        throw new Error('Expected \'props.products\' to be an array in the data-page JSON.');
      }

      let urlCount = 0;
      let totalComponentCount = 0;
      const hierarchicalData = products.reduce((prodAcc, product) => {
        if (!product.name || !Array.isArray(product.categories)) throw new Error(`Product missing name/categories.`);
        prodAcc[product.name] = product.categories.reduce((catAcc, category) => {
          if (!category.name || !Array.isArray(category.subcategories)) throw new Error(`Category missing name/subcategories.`);
          catAcc[category.name] = category.subcategories.map((subcategory) => {
            if (!subcategory.name || !subcategory.url || !subcategory.components) throw new Error(`Subcategory missing name/url/components.`);
            urlCount++;
            const match = subcategory.components.match(/^(?<componentCount>\d+)/);
            if (match) totalComponentCount += parseInt(match.groups.componentCount, 10);
            return { name: subcategory.name, url: subcategory.url };
          });
          return catAcc;
        }, {});
        return prodAcc;
      }, {});

      this.logger.log(`   Discovered ${urlCount} component URLs with a total of ${totalComponentCount} individual components.`);
      return { hierarchicalData, urlCount, totalComponentCount };
    } finally {
      await discoveryContext.close();
    }
  }

  _populateUrlQueueFromHierarchy(hierarchicalData) {
    this.logger.log('   Populating job queue from discovered hierarchy...');
    for (const product in hierarchicalData) {
      for (const category in hierarchicalData[product]) {
        for (const subcategory of hierarchicalData[product][category]) {
          const job = {
            url: subcategory.url,
            hierarchy: { product, category, subcategory: subcategory.name },
            tasks: this.getDownloadTasks(),
            retries: 0
          };
          this.urlQueue.push(job);
        }
      }
    }

    if (this.options.debugUrlFile) {
      this.logger.log(`   URL file mode enabled. Filtering by: ${this.options.debugUrlFile}`);
      const debugUrlsToProcess = this._loadUrlsFromFile(this.options.debugUrlFile);
      this.urlQueue = this.urlQueue.filter(job => debugUrlsToProcess.includes(job.url));
    }
    if (this.options.debugShortTest) {
      this.logger.log(`   Short test mode: Limiting to 2 jobs.`);
      this.urlQueue = this.urlQueue.slice(0, 2);
    }
    this.logger.log(`   Job queue populated with ${this.urlQueue.length} jobs.`);
  }

  async _createAndRunWorkers() {
    const actualConcurrency = Math.min(this.options.workers, this.urlQueue.length);
    this.logger.log(`   Starting worker pool with concurrency of ${actualConcurrency} (${this.urlQueue.length} jobs)...`);

    const workers = [];
    for (let i = 0; i < actualConcurrency; i++) {
      const worker = new Worker(i + 1, this.browser, this.credentials, this.baseLogger, this.options.debugTrace);
      await worker.initialize();
      workers.push(worker);
    }

    const workerPromises = workers.map(worker => this._runWorker(worker));

    try {
      await Promise.all(workerPromises);
    } finally {
      await Promise.all(workers.map(worker => worker.shutdown()));
    }
  }

  async _runWorker(worker) {
    while (this.urlQueue.length > 0) {
      const job = this.urlQueue.shift();
      if (!job) continue;

      try {
        this.logger.log(`🚀 Worker ${worker.id} start: ${job.url}`);
        const result = await worker.processJob(job);
        this._processJobResult(result);
        this.logger.log(`✅ Worker ${worker.id} finish: ${job.url}`);
      } catch (error) {
        this.logger.log(`🔴 Worker ${worker.id} critical error: ${job.url}: ${error.message}`);

        if (error instanceof CriticalDownloadError) {
          this.logger.log(`🔴 Critical error: Halting execution.`);
          if (this.options.debugHeaded && worker.page) {
            await worker.page.pause();
          }
          throw error;
        }

        // For critical errors, mark entire job as failed
        this.results.push({ job: { url: job.url, hierarchy: job.hierarchy }, error: error.message });
      }
    }
  }

  _processJobResult(result) {
    // Extract successful tasks with data
    const successfulTasks = result.tasks.filter(task => task.status === 'succeeded');

    if (successfulTasks.length > 0) {
      // Merge component data from successful tasks by concatenating snippets arrays
      const mergedData = {};
      const taskSummary = successfulTasks.map(t => `${t.framework}v${t.version}`).join(', ');

      successfulTasks.forEach(task => {
        for (const componentName in task.data) {
          const component = task.data[componentName];

          if (!mergedData[componentName]) {
            mergedData[componentName] = {
              name: component.name,
              snippets: []
            };
          }

          // Concatenate snippets arrays
          mergedData[componentName].snippets = mergedData[componentName].snippets.concat(component.snippets);
        }
      });

      const componentCount = Object.keys(mergedData).length;
      this.logger.log(`   Successfully merged data from [${taskSummary}] for ${result.url} (${componentCount} components)`);

      // Store successful results in expected format
      this.results.push({
        job: { url: result.url, hierarchy: result.hierarchy },
        data: mergedData
      });
    }

    // Handle failed tasks for re-queuing
    const failedTasks = result.tasks.filter(task => task.status === 'failed');
    if (failedTasks.length > 0) {
      if (result.retries < CONFIG.retries.maxRetries) {
        const job = {
          url: result.url,
          hierarchy: result.hierarchy,
          // Strip status/error properties by creating clean task objects
          tasks: failedTasks.map(({framework, version}) => ({framework, version})),
          retries: result.retries + 1
        };
        this.urlQueue.push(job);
        this.logger.log(`↪️ Requeuing ${failedTasks.length} failed tasks for ${result.url} (retry ${job.retries}/${CONFIG.retries.maxRetries})`);
      } else {
        this.logger.log(`🔴 Final failure: ${result.url} failed after ${result.retries} attempts. Not requeuing.`);
        this.results.push({
          job: { url: result.url, hierarchy: result.hierarchy },
          error: `Job failed after ${result.retries} attempts`
        });
      }
    }
  }

  _countComponents(data) {
    let count = 0;
    function countRecursive(obj) {
      for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          if (obj[key].snippets && Array.isArray(obj[key].snippets)) {
            count++;
          } else {
            countRecursive(obj[key]);
          }
        }
      }
    }
    countRecursive(data);
    return count;
  }

  _processAndSaveResults() {
    this.logger.log('   All workers finished. Processing and saving results...');
    const successfulDownloads = this.results.filter(r => r.data);
    const failedDownloads = this.results.filter(r => r.error);

    if (failedDownloads.length > 0) {
      this.logger.log(`⚠️  Warning: ${failedDownloads.length} jobs failed to download`);
      failedDownloads.forEach(failure => {
        this.logger.log(`   Failed: ${failure.job.url} - ${failure.error}`);
      });
    }

    this.logger.log('   Building hierarchical structure...');
    const hierarchicalData = {};

    successfulDownloads.forEach(result => {
      const { job, data: pageData } = result;
      const { product, category, subcategory } = job.hierarchy;

      if (!hierarchicalData[product]) hierarchicalData[product] = {};
      if (!hierarchicalData[product][category]) hierarchicalData[product][category] = {};
      if (!hierarchicalData[product][category][subcategory]) hierarchicalData[product][category][subcategory] = {};

      // Merge component data by concatenating snippets arrays
      for (const componentName in pageData) {
        const component = pageData[componentName];

        if (!hierarchicalData[product][category][subcategory][componentName]) {
          hierarchicalData[product][category][subcategory][componentName] = {
            name: component.name,
            snippets: []
          };
        }

        // Concatenate snippets arrays from all jobs for this component
        hierarchicalData[product][category][subcategory][componentName].snippets =
          hierarchicalData[product][category][subcategory][componentName].snippets.concat(component.snippets);
      }
    });

    const endTime = new Date();
    const durationMs = endTime - this.startTime;
    const durationSec = (durationMs / 1000).toFixed(1);

    const componentCount = this._countComponents(hierarchicalData);

    const finalOutput = {
      version: this.version,
      downloaded_at: this.startTime.toISOString(),
      component_count: componentCount,
      download_duration: `${durationSec}s`,
      downloader_version: packageJson.version,
      tailwindplus: hierarchicalData
    };

    fs.writeFileSync(this.options.output, JSON.stringify(finalOutput, null, 2));
  }

  async _shutdown() {
    this.logger.log('--- Shutting down ---');
    this._showShutdownMessage();
    if (this.browser) {
      await this.browser.close();
    }
    this.logger.close();
  }
}

// ===================================================================================
//
//  Command-Line Argument Parsing and Main Execution
//
// ===================================================================================

function parseArgs() {
  const argv = yargs(hideBin(process.argv))
    .version('version', 'Show version number', packageJson.version)
    .strict()
    .option('output', {
      type: 'string',
      requiresArg: true,
      describe: 'Path to save downloaded components (default: auto-generated)'
    })
    .option('workers', {
      type: 'number',
      requiresArg: true,
      default: 5,
      describe: 'Number of pages to download in parallel'
    })
    .option('cookies', {
      type: 'string',
      requiresArg: true,
      describe: 'Path to cookies file'
    })
    .option('slow-mo', {
      type: 'number',
      requiresArg: true,
      default: CONFIG.timeouts.slowMo,
      describe: 'Slow down browser actions by specified milliseconds'
    })
    .option('credentials', {
      type: 'string',
      requiresArg: true,
      default: 'credentials.json',
      describe: 'Path to credentials file'
    })
    .option('debug-short-test', {
      type: 'boolean',
      describe: 'Limits download to a few sections for fast testing'
    })
    .option('debug-log', {
      describe: 'Enable logging to file and console (default: same as output with .log extension)'
    })
    .option('debug-url-file', {
      type: 'string',
      requiresArg: true,
      describe: 'Process only specific URLs from a file'
    })
    .option('debug-trace', {
      type: 'boolean',
      describe: 'Enable playwright tracing for debugging'
    })
    .option('debug-headed', {
      type: 'boolean',
      describe: 'Run browser in headed mode (shows browser window)'
    })
    .usage('Usage: $0 [options]')
    .help('help')
    .alias('help', 'h')
    .parseSync();

  // Set default output filename if not specified
  if (!argv.output) {
    // Generate version timestamp that will be used in both filename and JSON
    const version = new Date().toISOString().slice(0, 19).replace(/:/g, '').replace('T', '-');
    argv.output = `tailwindplus-components-${version}.json`;
  }

  // Handle debug-log without value
  if (argv.debugLog === true) {
    argv.debugLog = argv.output.replace(/\.json$/, '.log');
  }

  return {
    output: argv.output,
    workers: argv.workers,
    cookies: argv.cookies,
    slowMo: argv.slowMo,
    credentials: argv.credentials,
    debugShortTest: argv.debugShortTest,
    debugLog: argv.debugLog,
    debugUrlFile: argv.debugUrlFile,
    debugTrace: argv.debugTrace,
    debugHeaded: argv.debugHeaded
  };
}

async function main() {
  const options = parseArgs();
  const downloader = new TailwindPlusDownloader(options);
  await downloader.startup();
}

main().catch(console.error);
