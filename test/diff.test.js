// Unit tests for the diff tool's pure logic: no files read, no subprocess spawned, so these run in
// milliseconds alongside the downloader's unit tests and gate the slow smoke suite.
//
// Run with `node --test test/`, or through `npm test` which runs these first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFormat,
  formatName,
  validateOptions,
  parseArgs,
  getComparisons,
  getComponentPaths,
  getComponentPathsAtFormat,
  collectModes,
  skipReason,
  SKIP_NO_MODES,
  SKIP_NOT_PRESENT
} from '../tailwindplus-diff.js';

// A component carrying every framework, version and mode, as marketing components are downloaded.
const fullComponent = () => ({
  name: 'Simple centered',
  snippets: ['html', 'react', 'vue'].flatMap(framework =>
    [3, 4].flatMap(version =>
      ['system', 'light', 'dark'].map(mode => ({
        name: framework,
        version,
        mode,
        code: `${framework}-v${version}-${mode}`
      }))))
});

// A component with no mode variants, as eCommerce components are downloaded.
const modelessComponent = () => ({
  name: 'With inline price',
  snippets: ['html', 'react', 'vue'].flatMap(framework =>
    [3, 4].map(version => ({
      name: framework,
      version,
      mode: null,
      code: `${framework}-v${version}`
    })))
});

const components = () => ({
  Marketing: { Sections: { Heroes: { 'Simple centered': fullComponent() } } },
  Ecommerce: { Components: { 'Product lists': { 'With inline price': modelessComponent() } } }
});

describe('parseFormat', () => {
  test('reads framework, version and mode', () => {
    assert.deepEqual(parseFormat('html-v4-dark'), { framework: 'html', version: 4, mode: 'dark' });
  });

  test('reads the mode-less format', () => {
    assert.deepEqual(parseFormat('react-v3'), { framework: 'react', version: 3, mode: null });
  });

  test('rejects an unknown framework, version or mode', () => {
    assert.throws(() => parseFormat('svelte-v4-dark'), /Invalid format/);
    assert.throws(() => parseFormat('html-v5-dark'), /Invalid format/);
    assert.throws(() => parseFormat('html-v4-sepia'), /Invalid format/);
  });

  test('rejects a spec that is not in the downloader\'s form', () => {
    assert.throws(() => parseFormat('html-4-dark'), /Invalid format/);
    assert.throws(() => parseFormat('html'), /Invalid format/);
    assert.throws(() => parseFormat(''), /Invalid format/);
    assert.throws(() => parseFormat(undefined), /Invalid format/);
  });

  test('round-trips through formatName', () => {
    for (const spec of ['html-v4-dark', 'vue-v3-system', 'react-v4']) {
      assert.equal(formatName(parseFormat(spec)), spec);
    }
  });
});

describe('validateOptions', () => {
  test('accepts a format pair', () => {
    assert.equal(validateOptions({ from: 'html-v4-light', to: 'html-v4-dark' }), true);
  });

  test('requires a format pair alongside --file', () => {
    // Without one there is nothing to compare the file against but itself, which the default sweep
    // does happily and reports as identical.
    assert.throws(() => validateOptions({ file: 'components.json' }), /--from and --to are required/);
  });

  test('accepts --file with a format pair', () => {
    assert.equal(
      validateOptions({ file: 'components.json', from: 'html-v4-light', to: 'html-v4-dark' }),
      true
    );
  });

  test('requires both sides of the format pair', () => {
    assert.throws(() => validateOptions({ from: 'html-v4-light' }), /--from and --to/);
    assert.throws(() => validateOptions({ to: 'html-v4-dark' }), /--from and --to/);
  });

  test('rejects options that select the same axes as the format pair', () => {
    assert.throws(
      () => validateOptions({ from: 'html-v4-light', to: 'html-v4-dark', framework: 'vue' }),
      /drop --framework/
    );
    assert.throws(
      () => validateOptions({ from: 'html-v4-light', to: 'html-v4-dark', twFrom: '3', twTo: '4' }),
      /drop --tw-from, --tw-to/
    );
  });

  test('rejects an unreadable format', () => {
    assert.throws(() => validateOptions({ from: 'html-v4-light', to: 'nonsense' }), /Invalid format/);
  });

  test('rejects --file alongside a named side', () => {
    assert.throws(() => validateOptions({ file: 'a.json', oldFile: 'b.json' }), /--file/);
    assert.throws(() => validateOptions({ file: 'a.json', newFile: 'b.json' }), /--file/);
  });

  test('keeps the version option rules', () => {
    assert.throws(() => validateOptions({ tw: '4', twFrom: '3' }), /--tw cannot be used/);
    assert.throws(() => validateOptions({ twFrom: '3' }), /--tw-from and --tw-to/);
    assert.equal(validateOptions({ tw: '4' }), true);
  });

  test('accepts no options at all', () => {
    assert.equal(validateOptions({}), true);
  });
});

// An option accepted on the command line but never carried through to the run is invisible:
// reading an absent property is not an error, so the value behaves as though it were never passed.
describe('parseArgs', () => {
  test('carries every option through to the returned object', () => {
    const options = parseArgs([
      '--file=components.json',
      '--from=html-v4-light',
      '--to=html-v4-dark',
      '--verbose',
      '--names-only'
    ]);

    assert.equal(options.file, 'components.json');
    assert.equal(options.from, 'html-v4-light');
    assert.equal(options.to, 'html-v4-dark');
    assert.equal(options.verbose, true);
    assert.equal(options.namesOnly, true);
  });

  test('carries the version and framework options through', () => {
    const options = parseArgs(['--old-file=a.json', '--new-file=b.json', '--tw-from=3', '--tw-to=4', '--framework=vue']);

    assert.equal(options.oldFile, 'a.json');
    assert.equal(options.newFile, 'b.json');
    assert.equal(options.twFrom, '3');
    assert.equal(options.twTo, '4');
    assert.equal(options.framework, 'vue');
  });

  test('lists every declared option, set or not', () => {
    const options = parseArgs([]);

    assert.deepEqual(
      Object.keys(options).sort(),
      ['file', 'framework', 'from', 'namesOnly', 'newFile', 'oldFile', 'to', 'tw', 'twFrom', 'twTo', 'verbose']
    );
  });

  test('keeps only the camelCase spelling', () => {
    const options = parseArgs(['--names-only', '--tw-from=3', '--tw-to=4']);

    assert.ok(!('names-only' in options));
    assert.ok(!('tw-from' in options));
  });
});

describe('getComparisons', () => {
  const modes = [null, 'dark', 'light', 'system'];

  test('a format pair is one comparison, whatever the modes present', () => {
    const comparisons = getComparisons({ from: 'html-v4-light', to: 'react-v3' }, {}, {}, modes);

    assert.equal(comparisons.length, 1);
    assert.deepEqual(comparisons[0].from, { framework: 'html', version: 4, mode: 'light' });
    assert.deepEqual(comparisons[0].to, { framework: 'react', version: 3, mode: null });
  });

  test('a format pair labels both sides and the diff file by format', () => {
    const [comparison] = getComparisons({ from: 'html-v4-light', to: 'html-v4-dark' }, {}, {}, modes);

    assert.equal(comparison.describe, 'html-v4-light -> html-v4-dark');
    assert.equal(comparison.fromLabel, 'html-v4-light');
    assert.equal(comparison.toLabel, 'html-v4-dark');
    assert.equal(comparison.fileLabel, 'html-v4-light_to_html-v4-dark');
  });

  test('a within-file comparison names a diff file the between-file one cannot', () => {
    const [withinFile] = getComparisons({ from: 'html-v4-light', to: 'html-v4-dark' }, {}, {}, modes);
    const [betweenFiles] = getComparisons({ tw: '4' }, {}, {}, ['dark']);

    assert.notEqual(withinFile.fileLabel, betweenFiles.fileLabel);
  });

  test('--tw sweeps every framework and mode at one version', () => {
    const comparisons = getComparisons({ tw: '4' }, {}, {}, ['light', 'dark']);

    assert.equal(comparisons.length, 6);
    assert.ok(comparisons.every(({ from, to }) => from.version === 4 && to.version === 4));
    assert.deepEqual(
      [...new Set(comparisons.map(c => c.from.framework))],
      ['html', 'react', 'vue']
    );
  });

  test('--framework narrows the sweep to one framework', () => {
    const comparisons = getComparisons({ tw: '4', framework: 'vue' }, {}, {}, ['light', 'dark']);

    assert.equal(comparisons.length, 2);
    assert.ok(comparisons.every(({ from }) => from.framework === 'vue'));
  });

  test('--tw-from and --tw-to hold the framework and mode while the version moves', () => {
    const comparisons = getComparisons({ twFrom: '3', twTo: '4', framework: 'html' }, {}, {}, ['dark']);

    assert.equal(comparisons.length, 1);
    assert.deepEqual(comparisons[0].from, { framework: 'html', version: 3, mode: 'dark' });
    assert.deepEqual(comparisons[0].to, { framework: 'html', version: 4, mode: 'dark' });
    assert.equal(comparisons[0].fromLabel, 'v3.html.dark');
    assert.equal(comparisons[0].toLabel, 'v4.html.dark');
    assert.equal(comparisons[0].fileLabel, 'v3 -> v4_html_dark');
  });

  test('detects the versions present when no version is asked for', () => {
    const comparisons = getComparisons({ framework: 'html' }, components(), {}, [null]);

    assert.deepEqual(comparisons.map(c => c.from.version), [3, 4]);
  });
});

describe('getComponentPathsAtFormat', () => {
  test('lists only the components carrying that format', () => {
    assert.deepEqual(
      getComponentPathsAtFormat(components(), parseFormat('html-v4-dark')),
      ['Marketing > Sections > Heroes > Simple centered']
    );
  });

  test('the mode-less format reaches the components that have no modes', () => {
    assert.deepEqual(
      getComponentPathsAtFormat(components(), parseFormat('html-v4')),
      ['Ecommerce > Components > Product lists > With inline price']
    );
  });

  test('is a subset of every component path', () => {
    const all = getComponentPaths(components());
    const atFormat = getComponentPathsAtFormat(components(), parseFormat('vue-v3-system'));

    assert.equal(all.length, 2);
    assert.ok(atFormat.every(path => all.includes(path)));
  });
});

describe('skipReason', () => {
  test('a mode-less component asked for a mode is reported as having none', () => {
    assert.equal(skipReason(modelessComponent(), true), SKIP_NO_MODES);
  });

  test('a mode-less component not asked for a mode is an ordinary absence', () => {
    assert.equal(skipReason(modelessComponent(), false), SKIP_NOT_PRESENT);
  });

  test('a component with modes is an ordinary absence', () => {
    assert.equal(skipReason(fullComponent(), true), SKIP_NOT_PRESENT);
  });

  test('a component with no snippets at all is an ordinary absence', () => {
    assert.equal(skipReason({ snippets: [] }, true), SKIP_NOT_PRESENT);
  });
});

describe('collectModes', () => {
  test('gathers the modes present, null first', () => {
    assert.deepEqual(collectModes(components()), [null, 'dark', 'light', 'system']);
  });
});
