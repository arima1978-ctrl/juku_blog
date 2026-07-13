'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedByRobots } = require('../scripts/lib/seo/robots_guard');

const UA = 'JukuBlogSEOResearchBot/1.0 (+https://an-english.com/school/obata/)';

test('isAllowedByRobots: Disallowされたパスはfalse', async () => {
  const mockGet = async () => 'User-agent: *\nDisallow: /private/\n';
  const allowed = await isAllowedByRobots('https://example.com/private/page', 'https://example.com/', mockGet, UA);
  assert.equal(allowed, false);
});

test('isAllowedByRobots: 許可されたパスはtrue', async () => {
  const mockGet = async () => 'User-agent: *\nDisallow: /private/\n';
  const allowed = await isAllowedByRobots('https://example.com/blog/post', 'https://example.com/', mockGet, UA);
  assert.equal(allowed, true);
});

test('isAllowedByRobots: robots.txt取得失敗はfail-openでtrue', async () => {
  const mockGet = async () => {
    throw new Error('network error');
  };
  const allowed = await isAllowedByRobots('https://example.com/any', 'https://example.com/', mockGet, UA);
  assert.equal(allowed, true);
});
