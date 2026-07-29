'use strict';

// 自社ブランドページのレジストリ。config/brand_pages.yamlを正データとする。
// school_page_registry.js(地域でマッチング)と同じ思想だが、ブランドページは
// 地域ではなくキーワード(そろばん/英会話等)でマッチングする点が異なる。
// 競合レジストリ(config/seo_competitors.yaml)とは完全に分離する
// (このモジュールは外部サイトへは一切アクセスしない)。

const { loadBrandPagesConfig } = require('../config');

function validateBrandPages(rawPages) {
  if (!Array.isArray(rawPages)) {
    throw new Error('brand_pages.yaml: brand_pagesは配列である必要があります');
  }
  const seenIds = new Set();
  rawPages.forEach((page, index) => {
    const label = page && page.id ? page.id : `[${index}]`;
    if (!page || !page.id) {
      throw new Error(`brand_pages${label}: idが必須です`);
    }
    if (seenIds.has(page.id)) {
      throw new Error(`brand_pages: id "${page.id}" が重複しています`);
    }
    seenIds.add(page.id);

    if (!page.url || !/^https:\/\//.test(page.url)) {
      throw new Error(`brand_pages[${page.id}]: urlはhttps://で始まる必要があります(現在値: ${page.url})`);
    }
    if (!Array.isArray(page.target_keywords) || page.target_keywords.length === 0) {
      throw new Error(`brand_pages[${page.id}]: target_keywordsは1件以上の配列である必要があります`);
    }
  });
}

function loadValidatedBrandPages() {
  const config = loadBrandPagesConfig() || {};
  const pages = config.brand_pages || [];
  validateBrandPages(pages);
  return pages;
}

function filterEnabled(pages) {
  return pages.filter((page) => page.enabled !== false);
}

function listEnabledBrandPages() {
  return filterEnabled(loadValidatedBrandPages());
}

// キーワード文字列がいずれかのブランドページのtarget_keywordsに含まれるかで判定する
// (school_page_registry.jsのfindSchoolPageInと同様、部分一致・類似度判定は行わない)。
// classifyContentCategory()と同じ「含む」判定を使うことで、辞書分類との一貫性を保つ。
function findBrandPageIn(pages, keyword) {
  if (!keyword) return null;
  return pages.find((page) => (page.target_keywords || []).some((kw) => keyword.includes(kw))) || null;
}

function findBrandPageByKeyword(keyword) {
  return findBrandPageIn(listEnabledBrandPages(), keyword);
}

function getBrandPageById(id) {
  return listEnabledBrandPages().find((page) => page.id === id) || null;
}

function getBrandPageByUrl(url) {
  return listEnabledBrandPages().find((page) => page.url === url) || null;
}

module.exports = {
  validateBrandPages,
  loadValidatedBrandPages,
  filterEnabled,
  listEnabledBrandPages,
  findBrandPageIn,
  findBrandPageByKeyword,
  getBrandPageById,
  getBrandPageByUrl,
};
