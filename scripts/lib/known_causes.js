'use strict';

// バッチ監視アラートの既知原因パターン検出(2026-08-08)。config/alert_known_causes.yaml に
// 登録された正規表現パターンをエラー本文へ照合し、一致すればremedy(対処法)を返す。
// パターンの追加・削除はYAML編集のみで完結し、コード変更を必要としない設計。

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { ROOT } = require('./config');

// テスト時のみ、JUKU_BLOG_KNOWN_CAUSES_PATH で本番と別ファイルを使う。
const KNOWN_CAUSES_PATH = process.env.JUKU_BLOG_KNOWN_CAUSES_PATH || path.join(ROOT, 'config', 'alert_known_causes.yaml');

function loadKnownCauses() {
  if (!fs.existsSync(KNOWN_CAUSES_PATH)) return [];
  try {
    const parsed = yaml.load(fs.readFileSync(KNOWN_CAUSES_PATH, 'utf8'));
    return Array.isArray(parsed && parsed.known_causes) ? parsed.known_causes : [];
  } catch {
    return [];
  }
}

// causesを省略した場合はYAMLから読み込む(呼び出し側は通常省略でよい。テストでのみ
// 固定リストを直接渡す)。不正な正規表現を含むエントリはスキップして他のパターン照合を続ける。
function detectKnownCause(text, causes = loadKnownCauses()) {
  if (!text) return null;
  for (const cause of causes) {
    if (!cause || !cause.pattern) continue;
    let matched = false;
    try {
      matched = new RegExp(cause.pattern).test(text);
    } catch {
      continue;
    }
    if (matched) return cause;
  }
  return null;
}

module.exports = { loadKnownCauses, detectKnownCause, KNOWN_CAUSES_PATH };
