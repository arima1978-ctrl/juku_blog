'use strict';

// seo_weekly_analysis.sh の結合テスト。featureフラグが既定(false)の間は、
// 各stepが無処理で即終了し、スクリプト全体が正常終了することだけを確認する
// (daily_blog.sh同様、実際のclaude CLI呼び出しは無いため軽量に検証できる)。

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('../scripts/lib/config');

const TMP_DB = path.join(os.tmpdir(), `juku_blog_seo_weekly_test_${process.pid}.sqlite`);
const LOG_PATH = path.join(ROOT, 'logs', `seo_weekly_${new Date().toISOString().slice(0, 10)}.log`);
const logExistedBefore = fs.existsSync(LOG_PATH);
let logContentBefore = null;
if (logExistedBefore) logContentBefore = fs.readFileSync(LOG_PATH, 'utf8');

after(() => {
  try {
    fs.unlinkSync(TMP_DB);
  } catch {
    // 既に無ければ無視
  }
  // 週次ログは実運用のログと混ざらないよう、テスト実行前の状態に戻す
  if (logExistedBefore) {
    fs.writeFileSync(LOG_PATH, logContentBefore, 'utf8');
  } else {
    try {
      fs.unlinkSync(LOG_PATH);
    } catch {
      // 既に無ければ無視
    }
  }
});

test('seo_weekly_analysis.sh: featureフラグOFFなら全stepが無処理で正常終了する', () => {
  const output = execFileSync('bash', [path.join(ROOT, 'scripts', 'seo_weekly_analysis.sh')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, JUKU_BLOG_DB_PATH: TMP_DB },
  });
  assert.match(output, /完了/);
  assert.ok(!output.includes('が失敗しました'));
});
