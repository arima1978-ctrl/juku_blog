'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectCannibalization } = require('../scripts/lib/seo/cannibalization');

test('detectCannibalization: 同一クエリで複数ページに表示があれば警告を返す', () => {
  const rows = [
    { page: '/blog/a', impressions: 30 },
    { page: '/blog/b', impressions: 10 },
  ];
  const result = detectCannibalization(rows);
  assert.ok(result);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].page, '/blog/a'); // impressions降順
});

test('detectCannibalization: 1ページのみならnull', () => {
  const rows = [
    { page: '/blog/a', impressions: 30 },
    { page: '/blog/a', impressions: 10 },
  ];
  assert.equal(detectCannibalization(rows), null);
});

test('detectCannibalization: impressions=0の行は無視する', () => {
  const rows = [
    { page: '/blog/a', impressions: 30 },
    { page: '/blog/b', impressions: 0 },
  ];
  assert.equal(detectCannibalization(rows), null);
});

test('detectCannibalization: 行が無ければnull', () => {
  assert.equal(detectCannibalization([]), null);
  assert.equal(detectCannibalization(undefined), null);
});
