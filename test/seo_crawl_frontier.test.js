'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCrawlQueue } = require('../scripts/lib/seo/crawl_frontier');

test('buildCrawlQueue: sitemapLocsがあれば最優先で使い、他ドメインは除外する', () => {
  const queue = buildCrawlQueue({
    sitemapLocs: ['https://competitor.example.com/a', 'https://other.example.com/x', 'https://competitor.example.com/b'],
    domain: 'competitor.example.com',
    maxPages: 100,
  });
  assert.deepEqual(queue, ['https://competitor.example.com/a', 'https://competitor.example.com/b']);
});

test('buildCrawlQueue: sitemapが無ければstart_url+内部リンクにフォールバックする', () => {
  const queue = buildCrawlQueue({
    sitemapLocs: [],
    startUrl: 'https://competitor.example.com/',
    discoveredLinks: ['https://competitor.example.com/about', 'https://other.example.com/external'],
    domain: 'competitor.example.com',
    maxPages: 100,
  });
  assert.deepEqual(queue, ['https://competitor.example.com/', 'https://competitor.example.com/about']);
});

test('buildCrawlQueue: maxPagesで打ち切る', () => {
  const queue = buildCrawlQueue({
    sitemapLocs: ['https://c.example.com/1', 'https://c.example.com/2', 'https://c.example.com/3'],
    domain: 'c.example.com',
    maxPages: 2,
  });
  assert.equal(queue.length, 2);
});

test('buildCrawlQueue: 重複URL(正規化後同一)は1件のみ', () => {
  const queue = buildCrawlQueue({
    sitemapLocs: ['https://c.example.com/a?utm_source=x', 'https://c.example.com/a#frag', 'https://c.example.com/a'],
    domain: 'c.example.com',
    maxPages: 100,
  });
  assert.equal(queue.length, 1);
});
