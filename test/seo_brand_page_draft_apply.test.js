'use strict';

// ブランドページPage Draft反映(2026-07-29)のテスト。fetchImplを注入することで
// 実際のネットワーク接続(an-english.com/WordPress)は一切行わない。DBもフェイク実装を注入する。

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveApply } = require('../scripts/seo_brand_page_draft_apply');

const DRAFT = {
  id: 1,
  page_plan_id: 10,
  generated_text: '新しい導入文です。',
  status: 'generated',
};

const PLAN_BRAND = { id: 10, target_page_type: 'brand_page', target_page_id: 'eikaiwa' };
const PLAN_SCHOOL = { id: 11, target_page_type: 'school_page', target_page_id: 'obata' };

const BRAND_PAGE = { id: 'eikaiwa', name: '英会話クラブ(AEClub)', url: 'https://an-english.com/brand/aeclub/', wp_page_id: 546 };

const FAKE_ENV = { WP_URL: 'https://an-english.com', WP_USERNAME: 'juku-blog-bot', WP_APP_PASSWORD: 'fake-app-password' };

function makeSeoDbImpl({ draft = DRAFT, plan = PLAN_BRAND, markApplied } = {}) {
  return {
    getSeoPageDraftById: () => draft,
    getSeoPagePlanById: () => plan,
    markSeoPageDraftApplied: markApplied || (() => ({ ...draft, status: 'applied' })),
  };
}

function fakeFetchImpl({ currentContent = '古い導入文です。', applyOk = true } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    if (!options || !options.method) {
      // GET (現在の本文取得)
      return { ok: true, json: async () => ({ content: { raw: currentContent } }) };
    }
    // POST (反映)
    return { ok: applyOk, json: async () => ({ id: 546 }), text: async () => 'error detail' };
  };
  impl.calls = calls;
  return impl;
}

test('resolveApply: 既にapplied状態のDraftは再反映を拒否する(2026-07-29、二重反映防止漏れの回帰テスト)', async () => {
  const appliedDraft = { ...DRAFT, status: 'applied', applied_at: '2026-07-29T00:00:00.000Z' };
  const seoDbImpl = makeSeoDbImpl({ draft: appliedDraft });
  const result = await resolveApply(
    { draftId: 1, confirm: true },
    { seoDbImpl, getBrandPageByIdImpl: () => BRAND_PAGE, fetchImpl: async () => { throw new Error('呼ばれてはいけない'); }, env: FAKE_ENV }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'draft_already_applied');
});

test('resolveApply: Draftが見つからなければdraft_not_found', async () => {
  const seoDbImpl = makeSeoDbImpl({ draft: null });
  const result = await resolveApply({ draftId: 999, confirm: false }, { seoDbImpl, fetchImpl: fakeFetchImpl() });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'draft_not_found');
});

test('resolveApply: 対応するPage Planが無ければpage_plan_not_found', async () => {
  const seoDbImpl = makeSeoDbImpl({ plan: null });
  const result = await resolveApply({ draftId: 1, confirm: false }, { seoDbImpl, fetchImpl: fakeFetchImpl() });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'page_plan_not_found');
});

test('resolveApply: target_page_type=school_pageは対象外(not_brand_page、校舎ページはREST非公開のため)', async () => {
  const seoDbImpl = makeSeoDbImpl({ plan: PLAN_SCHOOL });
  const result = await resolveApply({ draftId: 1, confirm: false }, { seoDbImpl, fetchImpl: fakeFetchImpl() });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_brand_page');
});

test('resolveApply: brand_pages.yamlに未登録ならbrand_page_not_registered', async () => {
  const seoDbImpl = makeSeoDbImpl();
  const result = await resolveApply(
    { draftId: 1, confirm: false },
    { seoDbImpl, getBrandPageByIdImpl: () => null, fetchImpl: fakeFetchImpl() }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'brand_page_not_registered');
});

test('resolveApply: confirm=falseは常にプレビューのみ(現在の本文取得はするがPOSTしない)', async () => {
  const seoDbImpl = makeSeoDbImpl();
  const fetchImpl = fakeFetchImpl({ currentContent: '古い導入文です。' });
  const result = await resolveApply(
    { draftId: 1, confirm: false },
    { seoDbImpl, getBrandPageByIdImpl: () => BRAND_PAGE, fetchImpl, env: FAKE_ENV }
  );
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.equal(result.currentContent, '古い導入文です。');
  assert.equal(result.newContent, '新しい導入文です。');
  assert.equal(fetchImpl.calls.length, 1, 'GETのみでPOSTは呼ばれないはず');
});

test('resolveApply: 現在の本文とDraft本文が同一ならconfirm=trueでも反映しない(noChange)', async () => {
  const seoDbImpl = makeSeoDbImpl();
  const fetchImpl = fakeFetchImpl({ currentContent: '新しい導入文です。' }); // Draftと同一
  const result = await resolveApply(
    { draftId: 1, confirm: true },
    { seoDbImpl, getBrandPageByIdImpl: () => BRAND_PAGE, fetchImpl, env: FAKE_ENV }
  );
  assert.equal(result.applied, false);
  assert.equal(result.noChange, true);
  assert.equal(fetchImpl.calls.length, 1, '差分が無いのでPOSTは呼ばれないはず');
});

test('resolveApply: confirm=trueかつ差分ありならPOSTで反映しDBをapplied状態に更新する', async () => {
  let markAppliedCalledWith = null;
  const seoDbImpl = makeSeoDbImpl({
    markApplied: (id, appliedAt) => {
      markAppliedCalledWith = { id, appliedAt };
      return { ...DRAFT, status: 'applied', applied_at: appliedAt };
    },
  });
  const fetchImpl = fakeFetchImpl({ currentContent: '古い導入文です。' });
  const result = await resolveApply(
    { draftId: 1, confirm: true },
    { seoDbImpl, getBrandPageByIdImpl: () => BRAND_PAGE, fetchImpl, nowIso: '2026-07-29T12:00:00.000Z', env: FAKE_ENV }
  );
  assert.equal(result.applied, true);
  assert.equal(fetchImpl.calls.length, 2, 'GET(現在の本文)→POST(反映)の2回のはず');
  assert.equal(fetchImpl.calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].options.body), { content: '新しい導入文です。' });
  assert.deepEqual(markAppliedCalledWith, { id: 1, appliedAt: '2026-07-29T12:00:00.000Z' });
  assert.equal(result.draft.status, 'applied');
});

test('resolveApply: WordPress反映が失敗すればエラーを投げ、DBは更新しない', async () => {
  let markAppliedCalled = false;
  const seoDbImpl = makeSeoDbImpl({ markApplied: () => { markAppliedCalled = true; } });
  const fetchImpl = fakeFetchImpl({ currentContent: '古い導入文です。', applyOk: false });
  await assert.rejects(
    () => resolveApply({ draftId: 1, confirm: true }, { seoDbImpl, getBrandPageByIdImpl: () => BRAND_PAGE, fetchImpl, env: FAKE_ENV }),
    /WordPress反映に失敗しました/
  );
  assert.equal(markAppliedCalled, false);
});
