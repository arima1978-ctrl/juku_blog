'use strict';

// httpGetTextをモックし、実際のネットワークアクセスを行わずrobots.txt判定をテストする。

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedByRobots } = require('../scripts/lib/exam_research/robots_guard');

test('isAllowedByRobots: Disallowされたパスはfalseを返す', async () => {
  const robotsTxt = 'User-agent: *\nDisallow: /private/\n';
  const mockGet = async () => robotsTxt;
  const result = await isAllowedByRobots('https://example.com/private/page', 'https://example.com/', mockGet);
  assert.equal(result, false);
});

test('isAllowedByRobots: Disallow対象外のパスはtrueを返す', async () => {
  const robotsTxt = 'User-agent: *\nDisallow: /private/\n';
  const mockGet = async () => robotsTxt;
  const result = await isAllowedByRobots('https://example.com/public/page', 'https://example.com/', mockGet);
  assert.equal(result, true);
});

test('isAllowedByRobots: robots.txt取得不可の場合は許可として扱う', async () => {
  const mockGet = async () => {
    throw new Error('404');
  };
  const result = await isAllowedByRobots('https://example.com/any/page', 'https://example.com/', mockGet);
  assert.equal(result, true);
});
