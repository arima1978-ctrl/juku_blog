'use strict';

// 自社校舎ページのレジストリ。config/school_pages.yamlを正データとする。
// 競合レジストリ(config/seo_competitors.yaml/scripts/lib/seo/(競合系).js)とは
// 完全に分離する(このモジュールは外部サイトへは一切アクセスしない)。
// ページ本文の取得・解析は行わない(URLと対象地域の対応を宣言するだけ)。

const { loadSchoolPagesConfig } = require('../config');
const { normalizeKeyword } = require('./normalizer');

function validateSchoolPages(rawPages) {
  if (!Array.isArray(rawPages)) {
    throw new Error('school_pages.yaml: school_pagesは配列である必要があります');
  }
  const seenIds = new Set();
  rawPages.forEach((page, index) => {
    const label = page && page.id ? page.id : `[${index}]`;
    if (!page || !page.id) {
      throw new Error(`school_pages${label}: idが必須です`);
    }
    if (seenIds.has(page.id)) {
      throw new Error(`school_pages: id "${page.id}" が重複しています`);
    }
    seenIds.add(page.id);

    if (!page.url || !/^https:\/\//.test(page.url)) {
      throw new Error(`school_pages[${page.id}]: urlはhttps://で始まる必要があります(現在値: ${page.url})`);
    }
    if (!Array.isArray(page.target_areas) || page.target_areas.length === 0) {
      throw new Error(`school_pages[${page.id}]: target_areasは1件以上の配列である必要があります`);
    }
  });
}

function loadValidatedSchoolPages() {
  const config = loadSchoolPagesConfig() || {};
  const pages = config.school_pages || [];
  validateSchoolPages(pages);
  return pages;
}

// filterEnabled/findSchoolPageInは配列を直接受け取る純粋関数として切り出し、
// YAMLファイルを読まずにフィルタ・マッチングロジック単体をテストできるようにする。
function filterEnabled(pages) {
  return pages.filter((page) => page.enabled !== false);
}

function listEnabledSchoolPages() {
  return filterEnabled(loadValidatedSchoolPages());
}

function normalizeAreaForMatch(area) {
  return normalizeKeyword(area || '').normalized;
}

// 表記揺れ(例: 「名古屋市守山区」⇔「守山区」)は既存のnormalizeKeyword()で吸収するが、
// 完全一致のみを対象とする(部分一致・類似度判定などの過度に曖昧なマッチングは行わない)。
function findSchoolPageIn(pages, targetArea) {
  if (!targetArea) return null;
  const normalizedTarget = normalizeAreaForMatch(targetArea);
  if (!normalizedTarget) return null;
  return (
    pages.find((page) => (page.target_areas || []).some((area) => normalizeAreaForMatch(area) === normalizedTarget)) ||
    null
  );
}

function findSchoolPageByArea(targetArea) {
  return findSchoolPageIn(listEnabledSchoolPages(), targetArea);
}

function getSchoolPageById(id) {
  return listEnabledSchoolPages().find((page) => page.id === id) || null;
}

function getSchoolPageByUrl(url) {
  return listEnabledSchoolPages().find((page) => page.url === url) || null;
}

module.exports = {
  validateSchoolPages,
  loadValidatedSchoolPages,
  filterEnabled,
  findSchoolPageIn,
  listEnabledSchoolPages,
  findSchoolPageByArea,
  getSchoolPageById,
  getSchoolPageByUrl,
};
