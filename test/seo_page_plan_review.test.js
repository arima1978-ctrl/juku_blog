'use strict';

// Sprint 3.5: page_plan_review.js(状態遷移バリデーション)の単体テスト。
// DB非依存、純粋関数のみを対象。LLM呼び出し・外部通信は一切発生しない。

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePagePlanTransition, isReasonRequired, ALLOWED_TRANSITIONS } = require('../scripts/lib/seo/page_plan_review');

const BASE = { actor: 'admin', reason: undefined };

test('許可される遷移: proposed → reviewing', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'reviewing', ...BASE });
  assert.equal(result.valid, true);
  assert.deepEqual(result.transition, { from: 'proposed', to: 'reviewing' });
});

test('許可される遷移: proposed → rejected(reason必須)', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'rejected', actor: 'admin', reason: '内容が不適切' });
  assert.equal(result.valid, true);
});

test('許可される遷移: reviewing → approved', () => {
  const result = validatePagePlanTransition({ currentStatus: 'reviewing', nextStatus: 'approved', ...BASE });
  assert.equal(result.valid, true);
});

test('許可される遷移: reviewing → rejected(reason必須)', () => {
  const result = validatePagePlanTransition({ currentStatus: 'reviewing', nextStatus: 'rejected', actor: 'admin', reason: '事実確認NG' });
  assert.equal(result.valid, true);
});

test('許可される遷移: reviewing → proposed(reason必須)', () => {
  const result = validatePagePlanTransition({ currentStatus: 'reviewing', nextStatus: 'proposed', actor: 'admin', reason: '再検討のため差し戻し' });
  assert.equal(result.valid, true);
});

test('拒否: proposed → approved', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'approved', ...BASE });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('許可されていない状態遷移')));
});

test('拒否: approvedからの全遷移(終端状態)', () => {
  ['proposed', 'reviewing', 'rejected'].forEach((next) => {
    const result = validatePagePlanTransition({ currentStatus: 'approved', nextStatus: next, ...BASE });
    assert.equal(result.valid, false, `approved → ${next} は拒否されるべき`);
  });
  assert.equal(ALLOWED_TRANSITIONS.approved.size, 0);
});

test('拒否: rejectedからの全遷移(V1では終端状態として扱う)', () => {
  ['proposed', 'reviewing', 'approved'].forEach((next) => {
    const result = validatePagePlanTransition({ currentStatus: 'rejected', nextStatus: next, actor: 'admin', reason: '理由' });
    assert.equal(result.valid, false, `rejected → ${next} は拒否されるべき`);
  });
  assert.equal(ALLOWED_TRANSITIONS.rejected.size, 0);
});

test('拒否: 同一status間の遷移', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'proposed', ...BASE });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('同じ状態遷移')));
});

test('拒否: actorが空', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'reviewing', actor: '', reason: undefined });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('actorは必須')));
});

test('拒否: actorが未指定(undefined)', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'reviewing', reason: undefined });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('actorは必須')));
});

test('拒否: actorが100文字を超える', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'reviewing', actor: 'x'.repeat(101) });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('actorは100文字以内')));
});

test('境界値: actorが100文字ちょうどは許可', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'reviewing', actor: 'x'.repeat(100) });
  assert.equal(result.valid, true);
});

test('拒否: rejectedへの遷移でreason未指定', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'rejected', actor: 'admin' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('reasonが必須')));
});

test('拒否: reviewing → proposedでreason未指定', () => {
  const result = validatePagePlanTransition({ currentStatus: 'reviewing', nextStatus: 'proposed', actor: 'admin' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('reasonが必須')));
});

test('許可: proposed → reviewingはreason省略可', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'reviewing', actor: 'admin' });
  assert.equal(result.valid, true);
});

test('許可: reviewing → approvedはreason省略可', () => {
  const result = validatePagePlanTransition({ currentStatus: 'reviewing', nextStatus: 'approved', actor: 'admin' });
  assert.equal(result.valid, true);
});

test('拒否: reasonが1000文字を超える', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'rejected', actor: 'admin', reason: 'x'.repeat(1001) });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('reasonは1000文字以内')));
});

test('境界値: reasonが1000文字ちょうどは許可', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'rejected', actor: 'admin', reason: 'x'.repeat(1000) });
  assert.equal(result.valid, true);
});

test('HTML検出: actorにHTMLタグを含むと拒否', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'reviewing', actor: '<script>alert(1)</script>' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('HTMLタグ')));
});

test('HTML検出: reasonにHTMLタグを含むと拒否', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'rejected', actor: 'admin', reason: '<b>不適切</b>' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('HTMLタグ')));
});

test('Markdownコードフェンス検出: reasonにコードフェンスを含むと拒否', () => {
  const result = validatePagePlanTransition({ currentStatus: 'proposed', nextStatus: 'rejected', actor: 'admin', reason: '```rm -rf /```' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('コードフェンス')));
});

test('不正なcurrentStatus/nextStatusを検出する', () => {
  const result = validatePagePlanTransition({ currentStatus: 'in_progress', nextStatus: 'done', actor: 'admin' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('currentStatusが不正')));
  assert.ok(result.errors.some((e) => e.includes('nextStatusが不正')));
});

test('isReasonRequired: rejectedへの遷移とreviewing→proposedのみtrue', () => {
  assert.equal(isReasonRequired('proposed', 'rejected'), true);
  assert.equal(isReasonRequired('reviewing', 'rejected'), true);
  assert.equal(isReasonRequired('reviewing', 'proposed'), true);
  assert.equal(isReasonRequired('proposed', 'reviewing'), false);
  assert.equal(isReasonRequired('reviewing', 'approved'), false);
});
