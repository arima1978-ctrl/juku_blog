'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUrl, resolveCanonicalUrl } = require('../scripts/lib/seo/url_normalize');

test('normalizeUrl: fragmentを除去する', () => {
  assert.equal(normalizeUrl('https://example.com/page#section'), 'https://example.com/page');
});

test('normalizeUrl: trackingクエリ(utm_*, fbclid等)を除去する', () => {
  const result = normalizeUrl('https://example.com/page?utm_source=x&utm_medium=y&fbclid=abc&keep=1');
  assert.equal(result, 'https://example.com/page?keep=1');
});

test('normalizeUrl: 不正なURLはnull', () => {
  assert.equal(normalizeUrl('not-a-url'), null);
});

test('resolveCanonicalUrl: ページ自身のcanonicalを優先する', () => {
  const result = resolveCanonicalUrl('https://example.com/page?utm_source=x', 'https://example.com/canonical-page');
  assert.equal(result, 'https://example.com/canonical-page');
});

test('resolveCanonicalUrl: canonicalが無ければ取得URLを正規化する', () => {
  const result = resolveCanonicalUrl('https://example.com/page?utm_source=x#frag', null);
  assert.equal(result, 'https://example.com/page');
});
