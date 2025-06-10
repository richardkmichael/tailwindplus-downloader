const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Explicitly ignore directories and files
  {
    ignores: [
      "**/node_modules/**",
      "**/tmp/**",
      "**/diffs/**",
      "**/*.json",
      "!.eslintrc.json"
    ]
  },

  // Base configuration for all files
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },

  // Node.js files
  {
    files: ["**/*.js"],
    ...js.configs.recommended,
    rules: {
      // Rules specific to web scraping with Playwright
      "no-console": "off", // Allow console for scraping output
      "no-return-await": "off", // Helpful for async/await handling
      "no-await-in-loop": "off", // Playwright often needs these

      // Enforce proper async/await usage
      "require-await": "error",

      // Prevent promise leaks
      "no-constant-binary-expression": "error",

      // Style rules
      "indent": ["warn", 2],
      "quotes": ["warn", "single", { "allowTemplateLiterals": true }],
      "semi": ["warn", "always"],
      "no-trailing-spaces": ["error", { 
        "skipBlankLines": false,
        "ignoreComments": false 
      }],

      // Reduce noise for web scraping code
      "complexity": ["warn", 15],

      // Help avoid common async errors
      "no-return-assign": "error",
      "prefer-promise-reject-errors": "warn"
    },
  },

  // Browser context files (inside page.evaluate calls)
  {
    files: ["**/browser-scripts/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Rules specific to browser context
      "no-undef": "off", // Browser globals are available
    },
  },
];
