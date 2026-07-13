'use strict';

// robots.txtを尊重する。取得できない/パース失敗の場合は「許可」として扱う
// (robots.txtが無いサイトも多いため、無いことを禁止扱いにはしない)。
// 愛知県高校入試機能のscripts/lib/exam_research/robots_guard.jsと同じロジックだが、
// User-Agentを競合分析専用にし、config/juku.yamlから設定できるようにしている。

const robotsParser = require('robots-parser');

async function fetchRobotsTxt(baseUrl, httpGetText) {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString();
  try {
    const text = await httpGetText(robotsUrl);
    return robotsParser(robotsUrl, text);
  } catch {
    return null;
  }
}

async function isAllowedByRobots(targetUrl, baseUrl, httpGetText, userAgent) {
  const robots = await fetchRobotsTxt(baseUrl, httpGetText);
  if (!robots) return true; // 取得不可はアクセス許可として扱う
  return robots.isAllowed(targetUrl, userAgent) !== false;
}

module.exports = { fetchRobotsTxt, isAllowedByRobots };
