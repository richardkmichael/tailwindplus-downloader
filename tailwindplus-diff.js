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

/**
 * Configure and parse command line arguments with yargs
 */
function parseArgs() {
  const argv = yargs(hideBin(process.argv))
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
      describe: 'Compare only this version <3|4> between old and new files (default: all versions)'
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
    .check((argv) => {
      // Check for mutually exclusive version options
      const hasVersion = argv['tw'] !== undefined;
      const hasFromTo = argv['tw-from'] !== undefined || argv['tw-to'] !== undefined;

      if (hasVersion && hasFromTo) {
        throw new Error('--tw cannot be used with --tw-from/--tw-to');
      }

      // If using --tw-from or --tw-to, both must be specified
      if ((argv['tw-from'] !== undefined) !== (argv['tw-to'] !== undefined)) {
        throw new Error('Both --tw-from and --tw-to must be specified together');
      }

      return true;
    })
    .usage('Usage: $0 [options]')
    .example('$0 --tw=4', 'Compare v4 components between two most recent downloads')
    .example('$0 --tw-from=3 --tw-to=4', 'Compare v3 to v4 for upgrade planning')
    .example('$0 --old-file=old.json --new-file=new.json --tw=4', 'Compare specific files')
    .help('help')
    .alias('help', 'h')
    .wrap(null)
    .parseSync();

  // Convert kebab-case to camelCase for internal use
  return {
    oldFile: argv['old-file'],
    newFile: argv['new-file'],
    version: argv['tw'],
    fromVersion: argv['tw-from'],
    toVersion: argv['tw-to'],
    framework: argv['framework'],
    verbose: argv['verbose']
  };
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
function generateDiff(oldContent, newContent, outputFile, framework, safeName) {
  const oldFile = writeTempFile(oldContent, 'old', framework, safeName);
  const newFile = writeTempFile(newContent, 'new', framework, safeName);

  return new Promise((resolve) => {
    // Try git diff first (better word-level diffs)
    const gitProcess = spawn('git', ['diff', '--no-index', '--word-diff=color', oldFile, newFile], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    gitProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    gitProcess.on('close', (code) => {
      // Git diff returns 1 when files differ, which is expected
      if (code <= 1 && output.trim()) {
        fs.writeFileSync(outputFile, output);
        console.log(`        Diff saved: ${outputFile}`);
      } else {
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

          // Clean up temp files
          fs.unlinkSync(oldFile);
          fs.unlinkSync(newFile);
          resolve();
        });
      }

      if (code <= 1) {
        // Clean up temp files
        fs.unlinkSync(oldFile);
        fs.unlinkSync(newFile);
        resolve();
      }
    });
  });
}

/**
 * Find snippet code by version and framework from component's snippets array
 */
function findSnippetCode(component, version, framework) {
  if (!component || !component.snippets || !Array.isArray(component.snippets)) {
    return null;
  }

  const snippet = component.snippets.find(s =>
    s.version === version && s.name === framework
  );

  return snippet ? snippet.code : null;
}

/**
 * Get comparison configurations based on options and available data
 */
function getComparisons(options, oldComponents, newComponents) {
  // If specific version comparisons are requested, use those
  if (options.fromVersion && options.toVersion) {
    return [{
      oldVersion: parseInt(options.fromVersion, 10),
      newVersion: parseInt(options.toVersion, 10),
      label: `v${options.fromVersion} -> v${options.toVersion}`
    }];
  }

  if (options.version) {
    return [{
      oldVersion: parseInt(options.version, 10),
      newVersion: parseInt(options.version, 10),
      label: `v${options.version}`
    }];
  }

  // Auto-detect available versions from both files
  const allVersions = new Set();

  // Scan through all components to find available versions
  function collectVersions(components) {
    for (const category of Object.values(components)) {
      for (const subcategory of Object.values(category)) {
        for (const group of Object.values(subcategory)) {
          for (const component of Object.values(group)) {
            if (component && component.snippets && Array.isArray(component.snippets)) {
              component.snippets.forEach(snippet => {
                if (snippet.version) {
                  allVersions.add(snippet.version);
                }
              });
            }
          }
        }
      }
    }
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
 * Compare a single component across versions and frameworks
 */
async function compareComponent(oldComponent, newComponent, comparisons, componentPath, options, componentHeader) {
  let diffs = 0;
  let hasDifferences = false;
  let headerPrinted = false;
  const frameworks = options.framework ? [options.framework] : ['html', 'react', 'vue'];

  for (const comparison of comparisons) {
    for (const framework of frameworks) {
      const oldContent = findSnippetCode(oldComponent, comparison.oldVersion, framework);
      const newContent = findSnippetCode(newComponent, comparison.newVersion, framework);

      if (!oldContent || !newContent) {
        if (!headerPrinted) {
          console.log(componentHeader);
          headerPrinted = true;
        }
        if (!oldContent) {
          console.log(`        Missing ${comparison.label}.${framework} in ${options.oldFile}`);
        } else {
          console.log(`        Missing ${comparison.label}.${framework} in ${options.newFile}`);
        }
        hasDifferences = true;
        continue;
      }

      if (oldContent !== newContent) {
        if (!headerPrinted) {
          console.log(componentHeader);
          headerPrinted = true;
        }
        const safeName = `${componentPath}_${comparison.label}_${framework}`
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .replace(/__+/g, '_');
        const diffFileName = `${safeName}.diff`;

        const diffPath = path.join(DIFF_DIR, diffFileName);
        await generateDiff(oldContent, newContent, diffPath, framework, safeName);
        diffs++;
        hasDifferences = true;
      } else if (options.verbose) {
        if (!headerPrinted) {
          console.log(componentHeader);
          headerPrinted = true;
        }
        console.log(`        No changes in ${comparison.label}.${framework}`);
      }
    }
  }

  return { diffs, hasDifferences };
}

/**
 * Compare component versions
 */
async function compareComponents(oldComponents, newComponents, options) {
  console.log('Processing components...\n');

  let totalDiffs = 0;
  let differencesFound = false;
  const comparisons = getComparisons(options, oldComponents, newComponents);

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
  // Handle help early before any processing, or when no args provided
  if (process.argv.includes('--help') || process.argv.includes('-h') || process.argv.length <= 2) {
    const helpYargs = yargs()
      .version(false)
      .option('old-file', { type: 'string', requiresArg: true, describe: 'Old component file <file> (auto-detected if not specified)' })
      .option('new-file', { type: 'string', requiresArg: true, describe: 'New component file <file> (auto-detected if not specified)' })
      .option('tw', { type: 'string', choices: ['3', '4'], requiresArg: true, describe: 'Compare only this version <3|4> between old and new files (default: all versions)' })
      .option('tw-from', { type: 'string', choices: ['3', '4'], requiresArg: true, describe: 'Source version <3|4> (requires --tw-to)' })
      .option('tw-to', { type: 'string', choices: ['3', '4'], requiresArg: true, describe: 'Target version <3|4> (requires --tw-from)' })
      .option('framework', { type: 'string', choices: ['html', 'react', 'vue'], requiresArg: true, describe: 'Only diff this framework <html|react|vue> (default: all)' })
      .option('verbose', { type: 'boolean', describe: 'Show detailed output including "No changes" messages' })
      .usage('Usage: $0 [options]')
      .example('$0 --tw=4', 'Compare v4 components between two most recent downloads')
      .example('$0 --tw-from=3 --tw-to=4', 'Compare v3 to v4 for upgrade planning')
      .example('$0 --old-file=old.json --new-file=new.json --tw=4', 'Compare specific files')
      .example('$0 --tw=4 --framework=react', 'Compare only React components')
      .example('$0 --verbose', 'Show detailed output including "No changes" messages')
      .help('help')
      .alias('help', 'h');

    helpYargs.showHelp();
    return;
  }

  try {
    const options = parseArgs();
    discoverFiles(options);

    const { oldData, newData, oldComponents, newComponents } = loadFiles(options);

    console.log(`Comparing:`);
    console.log(`  Old: ${options.oldFile}`);
    console.log(`  New: ${options.newFile}`);

    getVersionInfo(oldData, newData);
    ensureDiffDir();

    await compareComponents(oldComponents, newComponents, options);
  } catch (error) {
    if (error.message.includes('Need at least 2 component files')) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

main().catch(console.error);