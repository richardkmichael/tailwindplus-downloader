#!/usr/bin/env node

/**
 * TailwindPlus Component Diff Tool
 *
 * Compares TailwindPlus component files between downloads, with support for
 * version-specific comparisons (v3 vs v4) and framework-specific diffs.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Configuration
const DIFF_DIR = 'diffs';

// The axes a component is downloaded across.  Every component carries a snippet for each
// framework and version; only the mode varies, and eCommerce components have none.
const FRAMEWORKS = ['html', 'react', 'vue'];

const toCamelCase = (key) => key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

/**
 * Configure and parse command line arguments with yargs
 *
 * @param {string[]} args - Arguments to parse, defaulting to the process's own
 * @returns {Object} Options, keyed by the camelCase spelling of each declared option
 */
function parseArgs(args = hideBin(process.argv)) {
  const parser = yargs(args)
    .version(false)
    .strict()
    .option('old-file', {
      type: 'string',
      requiresArg: true,
      describe: 'Old component file <file> (auto-detected if not specified)'
    })
    .option('new-file', {
      type: 'string',
      requiresArg: true,
      describe: 'New component file <file> (auto-detected if not specified)'
    })
    .option('tw', {
      type: 'string',
      choices: ['3', '4'],
      requiresArg: true,
      describe: 'Compare only this version <3|4> between old and new files (default: all)'
    })
    .option('tw-from', {
      type: 'string',
      choices: ['3', '4'],
      requiresArg: true,
      describe: 'Source version <3|4> (requires --tw-to)'
    })
    .option('tw-to', {
      type: 'string',
      choices: ['3', '4'],
      requiresArg: true,
      describe: 'Target version <3|4> (requires --tw-from)'
    })
    .option('framework', {
      type: 'string',
      choices: ['html', 'react', 'vue'],
      requiresArg: true,
      describe: 'Only diff this framework <html|react|vue> (default: all)'
    })
    .option('verbose', {
      type: 'boolean',
      describe: 'Show detailed output including "No changes" messages'
    })
    .option('names-only', {
      type: 'boolean',
      describe: 'Only show component names that differ between files (no content comparison)'
    })
    .check((argv) => {
      // Check for mutually exclusive version options
      const hasVersion = argv.tw !== undefined;
      const hasFromTo = argv.twFrom !== undefined || argv.twTo !== undefined;

      if (hasVersion && hasFromTo) {
        throw new Error('--tw cannot be used with --tw-from/--tw-to');
      }

      // If using --tw-from or --tw-to, both must be specified
      if ((argv.twFrom !== undefined) !== (argv.twTo !== undefined)) {
        throw new Error('Both --tw-from and --tw-to must be specified together');
      }

      return true;
    })
    .usage('Usage: $0 [options]')
    .example('$0 --tw=4', 'Compare v4 components between two most recent downloads')
    .example('$0 --tw-from=3 --tw-to=4', 'Compare v3 to v4 for upgrade planning')
    .example('$0 --old-file=old.json --new-file=new.json --tw=4', 'Compare specific files')
    .epilog('Options can be specified as --option=value or --option value')
    .help('help')
    .alias('help', 'h')
    .wrap(yargs().terminalWidth());

  const argv = parser.parseSync();

  // Derived rather than listed by hand: a list has to be updated whenever an option is added, and
  // one missed there is accepted on the command line but undefined everywhere it is read, silently,
  // since reading an absent property is not an error.
  //
  // Values come from argv, dropping yargs' own `_` and `$0` and the hyphenated spellings that
  // duplicate the camelCase ones.
  const YARGS_INTERNAL = new Set(['_', '$0']);
  const options = Object.fromEntries(
    Object.entries(argv).filter(([key]) => !YARGS_INTERNAL.has(key) && !key.includes('-'))
  );

  // An option that is declared, unset and has no default is absent from argv entirely.  Add it so
  // every option is present; reading one is undefined either way.  Best-effort: `getOptions` is
  // yargs' own accessor, and losing it would cost only the completeness of the object.
  for (const declared of Object.keys(parser.getOptions().key)) {
    const key = toCamelCase(declared);
    if (key !== 'help' && !(key in options)) {
      options[key] = undefined;
    }
  }

  return options;
}

/**
 * Auto-discover component files
 */
function discoverFiles(options) {
  if (options.oldFile && options.newFile) {
    return; // Both files specified
  }

  // Find all tailwindplus component files
  const files = fs.readdirSync('.')
    .filter(file => file.startsWith('tailwindplus-components-') && file.endsWith('.json'))
    .sort();

  if (files.length < 2) {
    console.error('Error: Need at least 2 component files for comparison');
    console.error('Available files:', files);
    process.exit(1);
  }

  if (!options.oldFile) {
    options.oldFile = files[files.length - 2]; // Second most recent
  }
  if (!options.newFile) {
    options.newFile = files[files.length - 1]; // Most recent
  }

  console.log(`Auto-discovered files:`);
  console.log(`  Old: ${options.oldFile}`);
  console.log(`  New: ${options.newFile}`);
}

/**
 * Load and validate JSON files
 */
function loadFiles(options) {
  const oldData = JSON.parse(fs.readFileSync(options.oldFile, 'utf8'));
  const newData = JSON.parse(fs.readFileSync(options.newFile, 'utf8'));

  // Extract component data (handle both old and new formats)
  const oldComponents = oldData.tailwindplus || oldData;
  const newComponents = newData.tailwindplus || newData;

  return { oldData, newData, oldComponents, newComponents };
}

/**
 * Get version info from files
 */
function getVersionInfo(oldData, newData) {
  const oldVersion = oldData.version || 'unknown';
  const newVersion = newData.version || 'unknown';

  console.log(`\nVersions:`);
  console.log(`  Old: ${oldVersion}`);
  console.log(`  New: ${newVersion}`);
  console.log('');
}

/**
 * Create diff directory
 */
function ensureDiffDir() {
  if (!fs.existsSync(DIFF_DIR)) {
    fs.mkdirSync(DIFF_DIR, { recursive: true });
  }
}

/**
 * Write content to temporary file for diffing
 */
function writeTempFile(content, suffix, framework, safeName) {
  const extensions = {
    html: 'html',
    react: 'jsx',
    vue: 'vue'
  };
  const extension = extensions[framework] || 'html';
  const tempFile = path.join(DIFF_DIR, `${safeName}_${suffix}.${extension}`);
  fs.writeFileSync(tempFile, content);
  return tempFile;
}

/**
 * Generate diff using git or regular diff
 */
function generateDiff(oldContent, newContent, outputFile, comparison, safeName) {
  const oldFile = writeTempFile(oldContent, 'old', comparison.from.framework, safeName);
  const newFile = writeTempFile(newContent, 'new', comparison.to.framework, safeName);

  return new Promise((resolve) => {
    // Try git diff first (better word-level diffs)
    const gitProcess = spawn('git', ['diff', '--no-index', '--word-diff=color', oldFile, newFile], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    const cleanup = () => {
      fs.unlinkSync(oldFile);
      fs.unlinkSync(newFile);
    };

    gitProcess.on('close', (code) => {
      // Git diff returns 1 when files differ, which is expected
      if (code <= 1 && output.trim()) {
        fs.writeFileSync(outputFile, output);
        console.log(`        Diff saved: ${outputFile}`);
        cleanup();
        resolve();
        return;
      }

      // Fall back to regular diff
      const diffProcess = spawn('diff', ['-u', oldFile, newFile], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let diffOutput = '';
      diffProcess.stdout.on('data', (data) => {
        diffOutput += data.toString();
      });

      diffProcess.on('close', (diffCode) => {
        if (diffCode === 1 && diffOutput.trim()) {
          fs.writeFileSync(outputFile, diffOutput);
          console.log(`        Diff saved: ${outputFile}`);
        } else if (diffCode === 0) {
          console.log(`        No differences found`);
        } else {
          console.log(`        Error generating diff`);
        }

        cleanup();
        resolve();
      });
    });
  });
}

/**
 * Return a component's snippets array, or an empty array when it has none
 */
function getSnippets(component) {
  if (component && Array.isArray(component.snippets)) {
    return component.snippets;
  }
  return [];
}

/**
 * Find snippet code by version, framework, and mode from component's snippets array
 */
function findSnippetCode(component, version, framework, mode = null) {
  const snippet = getSnippets(component).find(s =>
    s.version === version && s.name === framework && s.mode === mode
  );

  return snippet ? snippet.code : null;
}

/**
 * Walk the nested category > subcategory > group > component structure,
 * invoking callback(componentData, { category, subcategory, group, component })
 * for every leaf component.
 */
function forEachComponent(components, callback) {
  for (const [category, categoryData] of Object.entries(components)) {
    for (const [subcategory, subcategoryData] of Object.entries(categoryData)) {
      for (const [group, groupData] of Object.entries(subcategoryData)) {
        for (const [component, componentData] of Object.entries(groupData)) {
          callback(componentData, { category, subcategory, group, component });
        }
      }
    }
  }
}

/**
 * Sort modes with null first, then alphabetically
 */
function compareModes(a, b) {
  if (a === null) return -1;
  if (b === null) return 1;
  return String(a).localeCompare(String(b));
}

/**
 * Extract all component paths from the nested structure
 */
function getComponentPaths(components) {
  const paths = [];

  forEachComponent(components, (componentData, { category, subcategory, group, component }) => {
    // Only include objects that have a snippets property
    if (componentData && typeof componentData === 'object' && componentData.snippets) {
      paths.push(`${category} > ${subcategory} > ${group} > ${component}`);
    }
  });

  return paths.sort();
}

/**
 * Compare component names between old and new files
 */
function compareComponentNames(oldComponents, newComponents, options) {
  const oldPaths = getComponentPaths(oldComponents);
  const newPaths = getComponentPaths(newComponents);

  const oldSet = new Set(oldPaths);
  const newSet = new Set(newPaths);

  const onlyInOld = oldPaths.filter(path => !newSet.has(path));
  const onlyInNew = newPaths.filter(path => !oldSet.has(path));

  console.log(`Comparing component names:`);
  console.log(`  Old: ${options.oldFile} (${oldPaths.length} components)`);
  console.log(`  New: ${options.newFile} (${newPaths.length} components)`);
  console.log('');

  if (onlyInOld.length > 0) {
    console.log('Only in old file:');
    onlyInOld.forEach(path => console.log(path));
    console.log('');
  }

  if (onlyInNew.length > 0) {
    console.log('Only in new file:');
    onlyInNew.forEach(path => console.log(path));
    console.log('');
  }

  if (onlyInOld.length === 0 && onlyInNew.length === 0) {
    console.log('Component names are identical between files.');
  } else {
    console.log(`Summary: ${onlyInOld.length} only in old, ${onlyInNew.length} only in new`);
  }
}

/**
 * Collect all unique modes from components
 */
function collectModes(components) {
  const allModes = new Set();

  forEachComponent(components, (component) => {
    getSnippets(component).forEach(snippet => allModes.add(snippet.mode));
  });

  return Array.from(allModes).sort(compareModes);
}

/**
 * Version pairs to compare, from the options or from the versions the files actually carry
 *
 * @param {Object} options - Parsed command line options
 * @param {Object} oldComponents - Components from the old file
 * @param {Object} newComponents - Components from the new file
 * @returns {Object[]} Pairs of `oldVersion`, `newVersion` and a display `label`
 */
function getVersionPairs(options, oldComponents, newComponents) {
  // If specific version comparisons are requested, use those
  if (options.twFrom && options.twTo) {
    return [{
      oldVersion: parseInt(options.twFrom, 10),
      newVersion: parseInt(options.twTo, 10),
      label: `v${options.twFrom} -> v${options.twTo}`
    }];
  }

  if (options.tw) {
    return [{
      oldVersion: parseInt(options.tw, 10),
      newVersion: parseInt(options.tw, 10),
      label: `v${options.tw}`
    }];
  }

  // Auto-detect available versions from both files
  const allVersions = new Set();

  // Scan through all components to find available versions
  function collectVersions(components) {
    forEachComponent(components, (component) => {
      getSnippets(component).forEach(snippet => {
        if (snippet.version) {
          allVersions.add(snippet.version);
        }
      });
    });
  }

  collectVersions(oldComponents);
  collectVersions(newComponents);

  const versions = Array.from(allVersions).sort();
  console.log(`Auto-detected versions: ${versions.map(v => `v${v}`).join(', ')}`);

  // Create comparisons for all detected versions
  return versions.map(version => ({
    oldVersion: version,
    newVersion: version,
    label: `v${version}`
  }));
}

/**
 * Expand the options into the list of comparisons to run.  A comparison names a format on each
 * side, so sweeping versions, frameworks and modes is a list of pairs rather than three nested
 * loops carried through the walk.
 *
 * @param {Object} options - Parsed command line options
 * @param {Object} oldComponents - Components from the old file
 * @param {Object} newComponents - Components from the new file
 * @param {Array<string|null>} modes - Modes present across both files
 * @returns {Object[]} Comparisons, each with `from`, `to`, `describe`, `fromLabel`, `toLabel` and
 *   `fileLabel`
 */
function getComparisons(options, oldComponents, newComponents, modes) {
  const versionPairs = getVersionPairs(options, oldComponents, newComponents);
  const frameworks = options.framework ? [options.framework] : FRAMEWORKS;

  return versionPairs.flatMap(({ oldVersion, newVersion, label }) =>
    frameworks.flatMap(framework =>
      modes.map(mode => {
        const suffix = `.${framework}${mode === null ? '' : `.${mode}`}`;
        return {
          from: { framework, version: oldVersion, mode },
          to: { framework, version: newVersion, mode },
          describe: `${label}${suffix}`,
          fromLabel: `v${oldVersion}${suffix}`,
          toLabel: `v${newVersion}${suffix}`,
          fileLabel: `${label}_${framework}${mode === null ? '' : `_${mode}`}`
        };
      })
    )
  );
}

/**
 * Compare one format against another for a single component
 */
async function compareSnippetCombination(oldComponent, newComponent, comparison, componentPath, options, state) {
  const { from, to } = comparison;
  const oldContent = findSnippetCode(oldComponent, from.version, from.framework, from.mode);
  const newContent = findSnippetCode(newComponent, to.version, to.framework, to.mode);

  // Skip if neither component has this combination
  if (!oldContent && !newContent) {
    return;
  }

  if (!oldContent || !newContent) {
    ensureHeaderPrinted(state);
    if (!oldContent) {
      console.log(`        Missing ${comparison.fromLabel} in ${options.oldFile}`);
    } else {
      console.log(`        Missing ${comparison.toLabel} in ${options.newFile}`);
    }
    state.hasDifferences = true;
    return;
  }

  if (oldContent !== newContent) {
    ensureHeaderPrinted(state);
    const safeName = `${componentPath}_${comparison.fileLabel}`
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/__+/g, '_');
    const diffFileName = `${safeName}.diff`;

    const diffPath = path.join(DIFF_DIR, diffFileName);
    await generateDiff(oldContent, newContent, diffPath, comparison, safeName);
    state.diffs++;
    state.hasDifferences = true;
  } else if (options.verbose) {
    ensureHeaderPrinted(state);
    console.log(`        No changes in ${comparison.describe}`);
  }
}

/**
 * Print the component header once, on the first difference found for it
 */
function ensureHeaderPrinted(state) {
  if (!state.headerPrinted) {
    console.log(state.componentHeader);
    state.headerPrinted = true;
  }
}

/**
 * Compare a single component across every requested pair of formats
 */
async function compareComponent(oldComponent, newComponent, comparisons, componentPath, options, componentHeader) {
  const state = {
    diffs: 0,
    hasDifferences: false,
    headerPrinted: false,
    componentHeader
  };

  for (const comparison of comparisons) {
    await compareSnippetCombination(oldComponent, newComponent, comparison, componentPath, options, state);
  }

  return { diffs: state.diffs, hasDifferences: state.hasDifferences };
}

/**
 * Compare component versions
 */
async function compareComponents(oldComponents, newComponents, options) {
  console.log('Processing components...\n');

  let totalDiffs = 0;
  let differencesFound = false;

  // Collect all available modes from both old and new components
  const oldModes = collectModes(oldComponents);
  const newModes = collectModes(newComponents);
  const allModes = [...new Set([...oldModes, ...newModes])].sort(compareModes);

  const comparisons = getComparisons(options, oldComponents, newComponents, allModes);

  console.log(`Available modes: ${allModes.map(m => m === null ? 'null' : m).join(', ')}\n`);

  // Iterate through categories
  for (const category of Object.keys(newComponents)) {
    console.log(`Processing category: ${category}`);

    for (const subcategory of Object.keys(newComponents[category])) {
      console.log(`  Processing subcategory: ${subcategory}`);

      for (const group of Object.keys(newComponents[category][subcategory])) {
        console.log(`    Processing group: ${group}`);

        for (const component of Object.keys(newComponents[category][subcategory][group])) {
          const oldComponent = oldComponents[category]?.[subcategory]?.[group]?.[component];
          const newComponent = newComponents[category][subcategory][group][component];
          const componentHeader = `      ${category} > ${subcategory} > ${group} > "${component}"`;

          if (!oldComponent) {
            console.log(componentHeader);
            console.log(`        Component not found in old file`);
            differencesFound = true;
            continue;
          }

          const componentPath = `${category}_${subcategory}_${group}_${component}`;
          const result = await compareComponent(oldComponent, newComponent, comparisons, componentPath, options, componentHeader);

          if (result.hasDifferences) {
            differencesFound = true;
          }

          totalDiffs += result.diffs;
        }
      }
    }
  }

  if (differencesFound) {
    console.log(`\nComparison complete. Generated ${totalDiffs} diff files in '${DIFF_DIR}/' directory.`);
  } else {
    console.log(`\nTailwindPlus components are identical.`);
  }
}

/**
 * Main execution
 */
async function main() {
  const options = parseArgs();
  discoverFiles(options);

  const { oldData, newData, oldComponents, newComponents } = loadFiles(options);

  if (options.namesOnly) {
    // Names-only mode: compare component names without content comparison
    compareComponentNames(oldComponents, newComponents, options);
    return;
  }

  // Counted here rather than read from `component_count`, so a file written by another tool, or
  // an older downloader that did not record it, still reports.
  const oldCount = getComponentPaths(oldComponents).length;
  const newCount = getComponentPaths(newComponents).length;
  const delta = newCount - oldCount;

  console.log(`Comparing:`);
  console.log(`  Old: ${options.oldFile} (${oldCount} components)`);
  console.log(`  New: ${options.newFile} (${newCount} components)${delta === 0 ? '' : ` — ${delta > 0 ? '+' : ''}${delta}`}`);

  getVersionInfo(oldData, newData);
  ensureDiffDir();

  await compareComponents(oldComponents, newComponents, options);
}

main().catch(console.error);
