'use strict';

// 既知原因パターン検出(2026-08-08)。8/7・8/8のOAuth失効インシデントで、実際のログ本文
// (「Failed to authenticate: OAuth session expired and could not be refreshed」)から
// 対処法を自動で拾えるようにするための単体テスト。ネットワークやCLI起動を伴わない
// 純粋関数のみを検証する(このリポジトリの既存方針: 実I/Oはfake/一時ファイルで代替)。

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.JUKU_BLOG_KNOWN_CAUSES_PATH = path.join(os.tmpdir(), `juku_blog_known_causes_test_${process.pid}.yaml`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadKnownCauses, detectKnownCause } = require('../scripts/lib/known_causes');

after(() => {
  try {
    fs.unlinkSync(process.env.JUKU_BLOG_KNOWN_CAUSES_PATH);
  } catch {
    // 既に無ければ無視
  }
});

test('loadKnownCauses: ファイルが無ければ空配列', () => {
  assert.deepEqual(loadKnownCauses(), []);
});

test('loadKnownCauses: YAMLのknown_causesをそのまま返す', () => {
  fs.writeFileSync(
    process.env.JUKU_BLOG_KNOWN_CAUSES_PATH,
    'known_causes:\n  - id: test_cause\n    pattern: "foo|bar"\n    remedy: "対処法テキスト"\n',
    'utf8'
  );
  const causes = loadKnownCauses();
  assert.equal(causes.length, 1);
  assert.equal(causes[0].id, 'test_cause');
});

test('detectKnownCause: 実インシデントの文言(OAuth session expired)にマッチする', () => {
  const causes = [{ id: 'claude_oauth_expired', pattern: 'OAuth session expired|Please run /login', remedy: 'VPSで再ログインが必要' }];
  const text = 'claude -p --agent researcher-local が非ゼロ終了。末尾: Failed to authenticate: OAuth session expired and could not be refreshed';
  const cause = detectKnownCause(text, causes);
  assert.equal(cause.id, 'claude_oauth_expired');
});

test('detectKnownCause: 別表現(Please run /login)でも同じパターンにマッチする', () => {
  const causes = [{ id: 'claude_oauth_expired', pattern: 'OAuth session expired|Please run /login', remedy: 'VPSで再ログインが必要' }];
  assert.ok(detectKnownCause('Not logged in · Please run /login', causes));
});

test('detectKnownCause: どのパターンにも一致しなければnull', () => {
  const causes = [{ id: 'claude_oauth_expired', pattern: 'OAuth session expired', remedy: 'x' }];
  assert.equal(detectKnownCause('全く関係のないエラー文言', causes), null);
});

test('detectKnownCause: 空/未定義テキストはnull', () => {
  assert.equal(detectKnownCause('', [{ id: 'x', pattern: 'foo', remedy: 'y' }]), null);
  assert.equal(detectKnownCause(undefined, [{ id: 'x', pattern: 'foo', remedy: 'y' }]), null);
});

test('detectKnownCause: 不正な正規表現のエントリはスキップして後続を照合する', () => {
  const causes = [
    { id: 'broken', pattern: '(unclosed', remedy: 'z' },
    { id: 'ok_pattern', pattern: 'matched_text', remedy: 'ok' },
  ];
  const cause = detectKnownCause('matched_text が出現', causes);
  assert.equal(cause.id, 'ok_pattern');
});
