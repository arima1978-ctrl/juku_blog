'use strict';

// Phase 4(複数校舎の日次自動オーケストレーション、daily_blog_all.sh)向け:
// listAutoGenerationBranches()の選定ロジック単体テスト。
// legacy(最も早く作成された校舎=id最小)はgeneration_enabledに関わらず常に除外
// (daily_blog.sh側で既に無条件実行されるため)、それ以外はgeneration_enabled=trueの
// ものだけを返す。branchesOverrideを渡せるため、DBを一切使わずプレーンオブジェクトで検証できる。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listAutoGenerationBranches } = require('../scripts/lib/branches_db');

test('listAutoGenerationBranches: legacy(id最小)はgeneration_enabled=trueでも除外される', () => {
  const branches = [
    { id: 1, slug: 'branch-1', generation_enabled: true },
    { id: 2, slug: 'ama-honbu', generation_enabled: true },
  ];
  const result = listAutoGenerationBranches(branches);
  assert.deepEqual(result.map((b) => b.slug), ['ama-honbu']);
});

test('listAutoGenerationBranches: legacy以外でもgeneration_enabled=falseなら対象外', () => {
  const branches = [
    { id: 1, slug: 'branch-1', generation_enabled: false },
    { id: 2, slug: 'ama-honbu', generation_enabled: false },
    { id: 3, slug: 'third-branch', generation_enabled: true },
  ];
  const result = listAutoGenerationBranches(branches);
  assert.deepEqual(result.map((b) => b.slug), ['third-branch']);
});

test('listAutoGenerationBranches: 複数校舎がgeneration_enabled=trueなら全件返す', () => {
  const branches = [
    { id: 1, slug: 'branch-1', generation_enabled: false },
    { id: 2, slug: 'ama-honbu', generation_enabled: true },
    { id: 3, slug: 'third-branch', generation_enabled: true },
  ];
  const result = listAutoGenerationBranches(branches);
  assert.deepEqual(
    result.map((b) => b.slug).sort(),
    ['ama-honbu', 'third-branch']
  );
});

test('listAutoGenerationBranches: 校舎が1件のみ(legacy自身)なら空配列', () => {
  const branches = [{ id: 1, slug: 'branch-1', generation_enabled: true }];
  const result = listAutoGenerationBranches(branches);
  assert.deepEqual(result, []);
});

test('listAutoGenerationBranches: 校舎が0件なら空配列(例外を投げない)', () => {
  const result = listAutoGenerationBranches([]);
  assert.deepEqual(result, []);
});

test('listAutoGenerationBranches: legacyの判定はid最小であり、配列内の並び順や作成順とは無関係', () => {
  // idが最小の校舎がlegacyであり、配列の先頭に無くても正しく判定できることを確認
  const branches = [
    { id: 5, slug: 'ama-honbu', generation_enabled: true },
    { id: 1, slug: 'branch-1', generation_enabled: true },
    { id: 3, slug: 'third-branch', generation_enabled: true },
  ];
  const result = listAutoGenerationBranches(branches);
  assert.deepEqual(
    result.map((b) => b.slug).sort(),
    ['ama-honbu', 'third-branch']
  );
});
