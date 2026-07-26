// Unit tests for the downloader's pure logic: no network, browser or session, so these run in
// milliseconds and gate the slow smoke suite.
//
// Run with `node --test test/`, or through `npm test` which runs these first.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeHtmlEntities,
  parseDataPageFromHtml,
  isEcommerceUrl,
  selectFreeComponents,
  uniqueFrameworkVersions,
  subcategoryOfRequiredFormat,
  sortSnippetsRecursively,
  Format
} from '../tailwindplus-downloader.js';

describe('decodeHtmlEntities', () => {
  test('decodes named entities', () => {
    assert.equal(decodeHtmlEntities('a &quot;b&quot; &lt;c&gt; &apos;d&apos;'), 'a "b" <c> \'d\'');
  });

  test('decodes decimal and hexadecimal references', () => {
    assert.equal(decodeHtmlEntities('&#39;&#x27;'), '\'\'');
  });

  test('decodes in a single pass', () => {
    // Sequential replaces would turn `&amp;` into `&` and then decode the `&quot;` that appears,
    // corrupting any page data containing a literal entity.
    assert.equal(decodeHtmlEntities('&amp;quot;'), '&quot;');
  });

  test('leaves unknown entities alone', () => {
    assert.equal(decodeHtmlEntities('&nbsp;&unknown;'), '&nbsp;&unknown;');
  });
});

describe('parseDataPageFromHtml', () => {
  test('parses the data-page attribute', () => {
    const html = '<div id="app" data-page="{&quot;props&quot;:{&quot;n&quot;:1}}"></div>';
    assert.deepEqual(parseDataPageFromHtml(html), { props: { n: 1 } });
  });

  test('returns null when absent', () => {
    assert.equal(parseDataPageFromHtml('<div id="app"></div>'), null);
  });

  test('returns null rather than throwing on malformed JSON', () => {
    assert.equal(parseDataPageFromHtml('<div data-page="{not json"></div>'), null);
  });
});

describe('isEcommerceUrl', () => {
  test('matches only eCommerce component pages', () => {
    assert.equal(isEcommerceUrl('https://tailwindcss.com/plus/ui-blocks/ecommerce/components/x'), true);
    assert.equal(isEcommerceUrl('https://tailwindcss.com/plus/ui-blocks/marketing/sections/heroes'), false);
  });
});

describe('selectFreeComponents', () => {
  const light = { name: 'Hero', preview: 'light', downloadable: true, uuid: 'a' };
  const dark = { name: 'Hero', preview: 'dark', downloadable: true, uuid: 'b' };

  test('takes one record per component, preferring the light preview', () => {
    const chosen = selectFreeComponents([light, dark]);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].preview, 'light');
  });

  test('prefers light regardless of the order listed', () => {
    const chosen = selectFreeComponents([dark, light]);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].preview, 'light');
  });

  test('takes the dark record when only it is downloadable', () => {
    const chosen = selectFreeComponents([{ ...light, downloadable: false }, dark]);
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].preview, 'dark');
  });

  test('ignores components that are not downloadable', () => {
    assert.deepEqual(selectFreeComponents([{ ...light, downloadable: false }]), []);
  });

  test('keeps distinct components apart', () => {
    const other = { name: 'Footer', preview: 'light', downloadable: true, uuid: 'c' };
    assert.equal(selectFreeComponents([light, dark, other]).length, 2);
  });
});

describe('uniqueFrameworkVersions', () => {
  test('collapses modes, keeping one entry per framework and version', () => {
    const formats = ['system', 'light', 'dark'].flatMap(mode => [
      new Format('html', 4, mode),
      new Format('vue', 3, mode)
    ]);
    const unique = uniqueFrameworkVersions(formats);

    assert.equal(unique.length, 2);
    assert.deepEqual(unique.map(f => `${f.framework}-v${f.version}`), ['html-v4', 'vue-v3']);
  });

  test('preserves the order given', () => {
    const formats = [new Format('vue', 3, 'dark'), new Format('html', 4, 'dark')];
    assert.deepEqual(uniqueFrameworkVersions(formats).map(f => f.framework), ['vue', 'html']);
  });
});

describe('Format', () => {
  test('renders framework, version and mode', () => {
    assert.equal(String(new Format('vue', 4, 'dark')), 'vue-v4-dark');
  });

  test('omits the mode when there is none', () => {
    assert.equal(String(new Format('html', 3, null)), 'html-v3');
  });

  test('accepts the object form', () => {
    assert.equal(String(new Format({ framework: 'react', version: 4, mode: 'light' })), 'react-v4-light');
  });

  test('compares by value', () => {
    assert.ok(new Format('html', 4, 'dark').equals(new Format('html', 4, 'dark')));
    assert.ok(!new Format('html', 4, 'dark').equals(new Format('html', 4, 'light')));
  });
});

describe('subcategoryOfRequiredFormat', () => {
  const pageDataFor = (snippet) => ({
    props: { subcategory: { name: 'Heroes', components: [{ name: 'One', snippet }] } }
  });
  const marketing = 'https://tailwindcss.com/plus/ui-blocks/marketing/sections/heroes';
  const ecommerce = 'https://tailwindcss.com/plus/ui-blocks/ecommerce/components/product-lists';

  test('returns the subcategory when every snippet matches', () => {
    const pageData = pageDataFor({ name: 'html', version: 4, mode: 'dark' });
    const subcategory = subcategoryOfRequiredFormat(pageData, marketing, new Format('html', 4, 'dark'));
    assert.equal(subcategory.name, 'Heroes');
  });

  test('throws when a snippet is in another format', () => {
    const pageData = pageDataFor({ name: 'html', version: 4, mode: 'light' });
    assert.throws(
      () => subcategoryOfRequiredFormat(pageData, marketing, new Format('html', 4, 'dark')),
      /Format mismatch/
    );
  });

  test('expects a null mode on eCommerce pages, whatever mode was asked for', () => {
    const pageData = pageDataFor({ name: 'html', version: 4, mode: null });
    const subcategory = subcategoryOfRequiredFormat(pageData, ecommerce, new Format('html', 4, 'dark'));
    assert.equal(subcategory.name, 'Heroes');
  });

  test('throws when there is no component data', () => {
    const pageData = { props: { subcategory: { name: 'Heroes', components: [] } } };
    assert.throws(
      () => subcategoryOfRequiredFormat(pageData, marketing, new Format('html', 4, 'dark')),
      /No component data/
    );
  });
});

describe('sortSnippetsRecursively', () => {
  test('orders snippets by name, then version, then mode', () => {
    const data = {
      Component: {
        snippets: [
          { name: 'vue', version: 4, mode: 'light' },
          { name: 'html', version: 4, mode: 'dark' },
          { name: 'html', version: 3, mode: 'light' },
          { name: 'html', version: 4, mode: 'light' }
        ]
      }
    };

    sortSnippetsRecursively(data);

    assert.deepEqual(
      data.Component.snippets.map(s => `${s.name}-v${s.version}-${s.mode}`),
      ['html-v3-light', 'html-v4-dark', 'html-v4-light', 'vue-v4-light']
    );
  });

  test('reaches snippets nested anywhere in the tree', () => {
    const data = { Product: { Category: { Sub: { Item: { snippets: [
      { name: 'vue', version: 3, mode: null },
      { name: 'html', version: 3, mode: null }
    ] } } } } };

    sortSnippetsRecursively(data);

    assert.deepEqual(data.Product.Category.Sub.Item.snippets.map(s => s.name), ['html', 'vue']);
  });
});
