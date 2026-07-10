'use strict';

// robots.txtを尊重する。取得できない/パース失敗の場合は「許可」として扱う
// (robots.txtが無いサイトも多いため、無いことを禁止扱いにはしない)。

const robotsParser = require('robots-parser');

const USER_AGENT = 'juku-blog-exam-research-bot/1.0 (+https://an-english.com/school/obata/)';

async function fetchRobotsTxt(baseUrl, httpGetText) {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString();
  try {
    const text = await httpGetText(robotsUrl);
    return robotsParser(robotsUrl, text);
  } catch {
    return null;
  }
}

async function isAllowedByRobots(targetUrl, baseUrl, httpGetText) {
  const robots = await fetchRobotsTxt(baseUrl, httpGetText);
  if (!robots) return true; // 取得不可はアクセス許可として扱う
  return robots.isAllowed(targetUrl, USER_AGENT) !== false;
}

module.exports = { fetchRobotsTxt, isAllowedByRobots, USER_AGENT };
