'use strict';

// scripts/lib/branch_area.js: Keyword Gap Liteの複数校舎対応の核となる
// normalizeBranchId/applyBranchAreaの単体テスト。実DBは使わず、branchesDbImplを
// フェイクに差し替えて検証する(config/juku.yamlや本番DBには一切触れない)。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBranchId, applyBranchArea } = require('../scripts/lib/branch_area');

function makeFakeBranchesDb(branches) {
  return {
    getBranchById: (id) => branches.find((b) => b.id === id) || null,
  };
}

test('normalizeBranchId: 数値文字列は数値化される', () => {
  assert.equal(normalizeBranchId('3'), 3);
});

test('normalizeBranchId: undefinedはthrowする', () => {
  assert.throws(() => normalizeBranchId(undefined), /branchIdが不正です/);
});

test('normalizeBranchId: nullはthrowする', () => {
  assert.throws(() => normalizeBranchId(null), /branchIdが不正です/);
});

test('normalizeBranchId: 非整数(小数・NaNになる文字列)はthrowする', () => {
  assert.throws(() => normalizeBranchId(1.5), /branchIdが不正です/);
  assert.throws(() => normalizeBranchId('abc'), /branchIdが不正です/);
});

test('applyBranchArea: 校舎のtarget_areaでconfig.area.cityを差し替える', () => {
  const fakeDb = makeFakeBranchesDb([{ id: 2, name: 'あま本部校', target_area: 'あま市' }]);
  const baseConfig = { area: { city: '名古屋市守山区', neighborhoods: ['小幡'] } };

  const { config, branch } = applyBranchArea(baseConfig, 2, fakeDb);

  assert.equal(config.area.city, 'あま市');
  assert.equal(branch.id, 2);
  // neighborhoods等、target_area以外のフィールドはbaseConfigのまま保持される
  assert.deepEqual(config.area.neighborhoods, ['小幡']);
});

test('applyBranchArea: 元のconfigオブジェクトを一切変更しない(ディープコピー)', () => {
  const fakeDb = makeFakeBranchesDb([{ id: 2, name: 'あま本部校', target_area: 'あま市' }]);
  const baseConfig = { area: { city: '名古屋市守山区' } };

  applyBranchArea(baseConfig, 2, fakeDb);

  assert.equal(baseConfig.area.city, '名古屋市守山区', 'baseConfig自体は書き換えられていないこと');
});

test('applyBranchArea: ループ実行しても前の校舎のエリアが残留しない', () => {
  const fakeDb = makeFakeBranchesDb([
    { id: 1, name: '小幡校', target_area: '名古屋市守山区' },
    { id: 2, name: 'あま本部校', target_area: 'あま市' },
  ]);
  const baseConfig = { area: { city: '共有configの既定値' } };

  const first = applyBranchArea(baseConfig, 1, fakeDb);
  const second = applyBranchArea(baseConfig, 2, fakeDb);

  assert.equal(first.config.area.city, '名古屋市守山区');
  assert.equal(second.config.area.city, 'あま市', '2校舎目の呼び出しで1校舎目のエリアが残留していないこと');
});

test('applyBranchArea: 存在しないbranch_idはthrowする', () => {
  const fakeDb = makeFakeBranchesDb([{ id: 1, name: '小幡校', target_area: '名古屋市守山区' }]);
  assert.throws(() => applyBranchArea({ area: {} }, 999, fakeDb), /branch_id=999 に該当する校舎が見つかりません/);
});

test('applyBranchArea: target_areaが空の校舎は共有config既定値へフォールバックする', () => {
  const fakeDb = makeFakeBranchesDb([{ id: 3, name: '新規校舎', target_area: null }]);
  const baseConfig = { area: { city: '共有configの既定値' } };

  const { config } = applyBranchArea(baseConfig, 3, fakeDb);

  assert.equal(config.area.city, '共有configの既定値');
});
