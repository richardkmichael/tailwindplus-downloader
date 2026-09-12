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
  retryDecision,
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

describe('retryDecision', () => {
  test('retries while attempts remain', () => {
    assert.equal(retryDecision(0, 3), 'retry');
    assert.equal(retryDecision(2, 3), 'retry');
  });

  test('gives up once the limit is reached', () => {
    assert.equal(retryDecision(3, 3), 'exhausted');
    assert.equal(retryDecision(4, 3), 'exhausted');
  });

  test('--retries=0 means no retry at all', () => {
    assert.equal(retryDecision(0, 0), 'exhausted');
  });

  test('an absent limit gives up rather than retrying forever', () => {
    // --retries was once declared but never carried through, leaving the limit undefined.  The
    // comparison was false for every page, so nothing was ever retried and each failure went
    // straight to exhausted -- silently, because that is also what a correct limit eventually says.
    assert.equal(retryDecision(0, undefined), 'exhausted');
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
