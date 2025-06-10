/**
* TailwindPlus Component Scraper
* 
* This script uses Playwright to navigate the TailwindPlus website and extract component code.
* It creates a separate browser tab for each product category and navigates through the
* hierarchical structure to collect all component HTML.
* 
* The scraper processes pages using DOM API executed in browser context for performance.
* It builds a hierarchical JSON structure matching the website organization.
* 
* Data structure progression:
* 1. Extract product categories and their base URLs
* 2. Extract sections within each category
* 3. Navigate to component pages and extract HTML code
* 4. Replace URL placeholders with actual component data
*/

/**
 * Example of intermediate data structure before component extraction:
 * {
 *   "Marketing": {
 *     "Page Sections": {
 *       "Hero Sections": "http://hero-sections",
 *       "Feature Sections": "http://feature-sections",
 *       "CTA Sections": "http://cta-sections",
 *       "Bento Grids": "http://bento-grids"
 *     },
 *     "Elements": {
 *       "Headers": "http://headers",
 *       "Flyout Menus": "http://flyout-menus",
 *       "Banners": "http://banners"
 *     }
 *   },
 *   "Application UI": {
 *     "Application Shells": {
 *       "Stacked Layouts": "http://stacked-layouts",
 *       "Sidebar Layouts": "http://sidebar-layouts"
 *     },
 *     "Headings": {
 *       "Page Headings": "http://page-headings",
 *       "Card Headings": "http://card-headings"
 *     }
 *   }
 * }
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration constants
const COMPONENT_LOAD_DELAY_MS = 250; // Delay for component code to render
const LOGIN_TIMEOUT_MS = 60 * 1000; // 60 seconds for manual login
const NAVIGATION_TIMEOUT_MS = 30 * 1000; // 30 seconds for page navigation
const GOBACK_TIMEOUT_MS = 15 * 1000; // 15 seconds for go back navigation

/**
 * Validation functions
 */

/**
 * Validates if a string is a properly formatted HTTP/HTTPS URL
 * @param {string} string - The URL string to validate
 * @returns {boolean} True if valid URL, false otherwise
 */
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates if a file path is safe and accessible
 * @param {string} filePath - The file path to validate
 * @returns {boolean} True if valid and accessible path, false otherwise
 */
function isValidFilePath(filePath) {
  // Check for invalid characters and ensure it's not empty
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }

  // Check for potentially dangerous patterns
  const dangerousPatterns = /[<>:"|?*\x00-\x1F]/;
  if (dangerousPatterns.test(filePath)) {
    return false;
  }

  // Ensure the directory exists or can be created
  const dirPath = path.dirname(filePath);
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Command line argument parsing
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed options object
 */
function parseArgs(args) {
  // Generate default timestamped filename
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '').replace('T', '-');
  const defaultOutputPath = `./tailwindplus-components-${timestamp}.json`;

  const options = {
    outputPath: defaultOutputPath,
    cookiesPath: './cookies.json',
    auth: false,
    debug: false,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help') {
      options.help = true;
    } else if (arg === '--auth') {
      options.auth = true;
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const [key, value] = arg.split('=', 2);
      switch (key) {
      case '--output-path':
        options.outputPath = value;
        break;
      case '--cookies-path':
        options.cookiesPath = value;
        break;
      default:
        console.error(`Unknown option: ${key}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      console.error(`Invalid argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

/**
 * Display help information for command line usage
 */
function showHelp() {
  console.log(`Usage: node tailwindplus-download.js [options]

Options:
  --output-path=<filename>   Path to save TailwindPlus components (default: timestamped filename)
  --cookies-path=<filename>  Path to save cookies (default: "./cookies.json")
  --auth                     Open browser to allow Tailwind login
  --debug                    Show browser and debug output
  --help                     Display this help message
`);
}

/**
 * Log messages based on debug mode
 * @param {string} message - Message to log
 * @param {boolean} isDebug - Whether this is a debug message
 * @param {boolean} DEBUG - Whether debug mode is enabled
 */
function log(message, isDebug = false, DEBUG = false) {
  if (!isDebug || DEBUG) {
    console.log(message);
  }
}

/**
 * Load cookies from file
 * @param {string} cookiePath - Path to the cookie file
 * @returns {Object|null} Parsed cookies or null if file doesn't exist
 */
function loadCookiesFromFile(cookiePath) {
  if (!fs.existsSync(cookiePath)) {
    return null;
  }
  const cookiesString = fs.readFileSync(cookiePath, 'utf8');
  return JSON.parse(cookiesString);
}

/**
 * Main scraping function to handle the hierarchical structure
 * @param {string} rootUrl - The root URL to start scraping from
 * @param {Object} cookies - Authentication cookies
 * @param {string} outputPath - Path where results will be saved
 * @param {boolean} DEBUG - Whether to show browser and debug output
 * @returns {Promise<Object>} The complete scraped data hierarchy
 */
async function scrapeTailwindPlus(rootUrl, cookies, outputPath, DEBUG = false) {

  // Launch browser, only show browser in debug mode
  const browser = await chromium.launch({ headless: !DEBUG });
  const context = await browser.newContext();
  const rootPage = await context.newPage();

  try {
    // Load authentication cookies if provided
    if (cookies) {
      await context.addCookies(cookies);
      log('Cookies loaded successfully.', false, DEBUG);
    }

    // Navigate to the root page
    log(`Navigating to root page: ${rootUrl}`, false, DEBUG);
    await rootPage.goto(rootUrl, { waitUntil: 'networkidle' });

    // Find all products
    const productHierarchy = await getProductNamesAndPageUrls(rootPage);

    // Root no longer needed
    await rootPage.close();

    // Process each product page in a separate tab
    for (const [product, productPageUrl] of Object.entries(productHierarchy)) {

      console.log(`Processing ${product}`);

      const productPage = await context.newPage();
      try {
        await productPage.goto(productPageUrl, { waitUntil: 'networkidle', timeout: NAVIGATION_TIMEOUT_MS });

        productHierarchy[product] = await getProductSectionsAndPageUrls(productPage);

        for (const productSection of Object.keys(productHierarchy[product])) {
          for (const [subSection, componentsUrl] of Object.entries(productHierarchy[product][productSection])) {
            try {
              await productPage.goto(componentsUrl, { waitUntil: 'networkidle', timeout: NAVIGATION_TIMEOUT_MS });
              let components = await getComponentsAndData(productPage);
              console.log(`Downloaded components from: ${componentsUrl}`);
              productHierarchy[product][productSection][subSection] = components;
              await productPage.goBack({ waitUntil: 'networkidle', timeout: GOBACK_TIMEOUT_MS });
            } catch (error) {
              console.error(`Failed to extract components from ${componentsUrl}: ${error.message}`);
              productHierarchy[product][productSection][subSection] = { error: error.message };
            }
          }
        }
      } catch (error) {
        console.error(`Failed to process product ${product}: ${error.message}`);
        productHierarchy[product] = { error: error.message };
      } finally {
        await productPage.close();
      }
    }

    // Return the complete results
    return productHierarchy;

  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * Save cookies after manual login and return them
 * @param {string} loginUrl - URL to navigate to for login
 * @param {string} cookiePath - Path to save cookies to
 * @returns {Promise<Object>} The saved cookies
 */
async function saveCookies(loginUrl, cookiePath) {

  // Always show browser for login
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(loginUrl);

    console.log('Please log in manually in the browser window...');

    // Wait for navigation after login, the Account button appears in the header
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll('header button'));
      return buttons.some(button => button.textContent.includes('Account'));
    }, { timeout: LOGIN_TIMEOUT_MS }); // Timeout to give time for manual login

    console.log('Login detected, saving cookies...');

    // Get cookies
    const cookies = await context.cookies();

    // Create directory if it doesn't exist
    const dirPath = path.dirname(cookiePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Save to file
    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));

    console.log(`Cookies saved to ${cookiePath}`);

    // Return cookies for immediate use
    return cookies;

  } finally {
    await browser.close();
  }
}

/**
 * Extract product names and their base page URLs from the root page
 * @param {Object} rootPage - Playwright page object for the root page
 * @returns {Promise<Object>} Object mapping product names to their base URLs
 */
async function getProductNamesAndPageUrls(rootPage) {
  return await rootPage.evaluate(() => {

    // Helper function; needs to be defined in the code executing in the browser.
    function findUrlBasePath(urls) {
      if (!urls.length) return '';
      if (urls.length === 1) return urls[0];

      // Sort the array (this puts alphabetically similar strings next to each other)
      urls = [...urls].sort();

      // Compare first and last strings (most dissimilar after sorting)
      const first = urls[0];
      const last = urls[urls.length - 1];

      let i = 0;
      while (i < first.length && i < last.length && first[i] === last[i]) {
        i++;
      }
      return first.substring(0, i);
    }

    return Array.from(
      document.querySelectorAll('nav ~ section[id^="product-"]')
    ).reduce(
      (namesAndUrls, section) => (
        {
          ...namesAndUrls,
          [section.querySelector('h2').textContent]: findUrlBasePath(Array.from(section.querySelectorAll('li a')).map(a => a.href))
        }
      ), {}
    );
  });
}

/**
 * Extract product sections and their page URLs from a product page
 * @param {Object} productPage - Playwright page object for a product page
 * @returns {Promise<Object>} Object mapping sections to their page URLs
 */
async function getProductSectionsAndPageUrls(productPage) {
  return await productPage.evaluate(() => {

    // Helper function; needs to be defined in the code executing in the browser.
    //
    // Accepts a productSubSection ("Page Sections")
    // Returns "Hero Sections", "Feature Sections", "CTA Sections", etc., with the respective page URLs:
    //
    //   { "Page Sections": {
    //     "Hero Sections": "http://hero-sections",
    //     "Feature Sections": "http://feature-sections",
    //     "CTA Sections": "http://cta-sections",
    //     ... }
    function productSectionToNamesAndPageUrls(pageSection) {
      return Array.from(
        pageSection.querySelectorAll('li :is(p:first-child, a)')
      ).map(
        e => { if (e.nodeName == 'A') { return e.href; } else if (e.nodeName == 'P') { return e.textContent; }}
      ).reduce(
        (obj, item, index, array) => {
          if (index % 2 === 1) {
            obj[item] = array[index - 1];
          }
          return obj;
        }, {}
      );
    }

    return Array.from(
      document.querySelectorAll('nav ~ div > section[id^="product-"]')
    ).reduce((namesAndUrls, section) => {
      return {
        ...namesAndUrls,
        [section.querySelector('h3').textContent]: productSectionToNamesAndPageUrls(section)
      };
    }, {}
    );
  });
}

/**
 * Extract components and their HTML code from a component page
 * @param {Object} componentPage - Playwright page object for a component page
 * @returns {Promise<Object>} Object mapping component names to their HTML code
 */
async function getComponentsAndData(componentPage) {
  try {
    return await componentPage.evaluate(async (delay) => {

      // Helper function; needs to be defined in the code executing in the browser.
      async function componentSectionToNameAndData(componentSection) {
        let codeButton = componentSection.querySelector('div:has(> button:first-child + button:last-child) > button:last-child');
        codeButton.click();
        await new Promise(resolve => setTimeout(resolve, delay));

        return {
          [componentSection.querySelector('h2').textContent]: componentSection.querySelector('pre code').textContent
        };
      }

      return await Array.from(document.querySelectorAll('nav ~ div > section[id^="component-"]'))
        .reduce(async (obj, section) => {
          return {
            ...(await obj),
            ...(await componentSectionToNameAndData(section))
          };
        }, Promise.resolve({})
        );
    }, COMPONENT_LOAD_DELAY_MS);
  } catch (error) {
    console.error('Error extracting components:', error.message);
    return {};
  }
}

/**
 * Authentication handling
 * @param {Object} options - Command line options
 * @returns {Promise<Object>} Authentication cookies
 */
async function handleAuthentication(options) {
  const loginUrl = 'https://tailwindcss.com/plus/login';

  if (options.auth) {
    // User wants to authenticate - save and use cookies
    // Create directory if it doesn't exist
    const dirPath = path.dirname(options.cookiesPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return await saveCookies(loginUrl, options.cookiesPath);
  } else {
    // Try to load existing cookies
    const cookies = loadCookiesFromFile(options.cookiesPath);
    if (!cookies) {
      console.error(`No cookies found at ${options.cookiesPath}`);
      console.error('Please either:');
      console.error('  - Run with --auth to authenticate');
      console.error('  - Use --cookies-path=<FILE> to specify existing cookies');
      process.exit(1);
    }
    return cookies;
  }
}

/**
 * Result processing and validation
 * @param {Object} componentData - The scraped component data
 * @param {Object} options - Command line options
 */
function processAndSaveResults(componentData, options) {
  // Basic validation - ensure we got some data
  if (!componentData || Object.keys(componentData).length === 0) {
    console.error('Error: Downloaded data appears to be empty');
    process.exit(1);
  }

  // Save results
  fs.writeFileSync(options.outputPath, JSON.stringify(componentData, null, 2));

  // Success message with file size
  const stats = fs.statSync(options.outputPath);
  const sizeKB = Math.round(stats.size / 1024);
  log(`Download complete! ${sizeKB}KB saved to ${options.outputPath}`, false, options.debug);
}

/**
 * Input validation
 * @param {Object} options - Command line options to validate
 */
function validateInputs(options) {
  const rootUrl = 'https://tailwindcss.com/plus/ui-blocks';
  const loginUrl = 'https://tailwindcss.com/plus/login';

  // Validate URLs
  if (!isValidUrl(rootUrl)) {
    console.error('Error: Invalid root URL');
    process.exit(1);
  }
  if (!isValidUrl(loginUrl)) {
    console.error('Error: Invalid login URL');
    process.exit(1);
  }

  // Validate file paths
  if (!isValidFilePath(options.outputPath)) {
    console.error(`Error: Invalid output path: ${options.outputPath}`);
    process.exit(1);
  }
  if (!isValidFilePath(options.cookiesPath)) {
    console.error(`Error: Invalid cookies path: ${options.cookiesPath}`);
    process.exit(1);
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    return;
  }

  validateInputs(options);
  const cookies = await handleAuthentication(options);

  const rootUrl = 'https://tailwindcss.com/plus/ui-blocks';
  const componentData = await scrapeTailwindPlus(rootUrl, cookies, options.outputPath, options.debug);

  await processAndSaveResults(componentData, options);
}

main().catch(console.error);
