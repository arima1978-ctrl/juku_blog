'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');

function loadYaml(relPath) {
  const abs = path.join(ROOT, relPath);
  const raw = fs.readFileSync(abs, 'utf8');
  return yaml.load(raw);
}

// テスト時のみ、JUKU_BLOG_CONFIG_PATH で本番設定(config/juku.yaml)と別の一時ファイルを
// 指定できるようにする(JUKU_BLOG_DB_PATHと同じ方針。Feature Flag有効時の挙動を
// 結合テストで検証する際、共有ファイルである本番configを書き換えずに済むようにするため)。
function loadJukuConfig() {
  if (process.env.JUKU_BLOG_CONFIG_PATH) {
    return yaml.load(fs.readFileSync(process.env.JUKU_BLOG_CONFIG_PATH, 'utf8'));
  }
  return loadYaml('config/juku.yaml');
}

function loadCalendarConfig() {
  return loadYaml('config/calendar.yaml');
}

function loadExamSourcesConfig() {
  return loadYaml('config/aichi_exam_sources.yaml');
}

function loadSeoCompetitorsConfig() {
  return loadYaml('config/seo_competitors.yaml');
}

// 自社の校舎ページ(固定ページ)レジストリ。競合設定(loadSeoCompetitorsConfig)とは
// 完全に分離されたファイル。詳細はscripts/lib/seo/school_page_registry.js参照。
function loadSchoolPagesConfig() {
  return loadYaml('config/school_pages.yaml');
}

module.exports = {
  ROOT,
  loadYaml,
  loadJukuConfig,
  loadCalendarConfig,
  loadExamSourcesConfig,
  loadSeoCompetitorsConfig,
  loadSchoolPagesConfig,
};
