'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSitemapXml } = require('../scripts/lib/seo/sitemap_parser');

test('parseSitemapXml: 通常のurlsetからlocを抽出する', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://example.com/a</loc></url>
    <url><loc>https://example.com/b</loc></url>
  </urlset>`;
  const result = parseSitemapXml(xml);
  assert.equal(result.type, 'urlset');
  assert.deepEqual(result.locs, ['https://example.com/a', 'https://example.com/b']);
});

test('parseSitemapXml: sitemap index からlocを抽出する', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
    <sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>
  </sitemapindex>`;
  const result = parseSitemapXml(xml);
  assert.equal(result.type, 'index');
  assert.deepEqual(result.locs, ['https://example.com/sitemap-1.xml', 'https://example.com/sitemap-2.xml']);
});

test('parseSitemapXml: 不正なXMLはunknownで空配列', () => {
  const result = parseSitemapXml('<not-a-sitemap>');
  assert.equal(result.type, 'unknown');
  assert.deepEqual(result.locs, []);
});

test('parseSitemapXml: 空のsitemapもunknownで空配列', () => {
  const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
  const result = parseSitemapXml(xml);
  assert.equal(result.type, 'unknown');
  assert.deepEqual(result.locs, []);
});
