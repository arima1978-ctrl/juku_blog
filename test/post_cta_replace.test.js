'use strict';

// 公開済み記事のCTA一括置換(2026-07-29)のテスト。fetchImplを注入することで
// 実際のネットワーク接続(an-english.com/WordPress)は一切行わない。DBもフェイク実装を注入する。

const test = require('node:test');
const assert = require('node:assert/strict');
const { planReplacement, planInsertion, resolveOnePost, buildOldCtaPattern, OLD_CTA_LABELS } = require('../scripts/post_cta_replace');

const NEW_CTA_OBATA = {
  label: 'お子さまに合う学び方、無料相談で一緒に考えませんか?(0561-54-4449)',
  url: 'https://an-english.com/brand/anshingakujim/?utm_source=blog&utm_medium=cta&utm_campaign=free_consultation_obata#offer',
};
const NEW_CTA_AMA = {
  label: 'お子さまに合う学び方、無料相談で一緒に考えませんか?(0561-54-4449)',
  url: 'https://an-english.com/brand/anshingakujim/?utm_source=blog&utm_medium=cta&utm_campaign=free_consultation_ama#offer',
};

const POST = { id: 17, branch_id: 1, wp_post_id: 14311, title: 'テスト記事', status: 'published' };

const FAKE_ENV = { WP_URL: 'https://an-english.com', WP_USERNAME: 'juku-blog-bot', WP_APP_PASSWORD: 'fake-app-password' };

function makeDbImpl({ post = POST, listResult = [POST] } = {}) {
  return {
    getPostById: (id) => (id === post.id ? post : null),
    listPosts: () => listResult,
  };
}

function fakeFetchImpl({ currentContent, applyOk = true } = {}) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    if (!options || !options.method) {
      return { ok: true, json: async () => ({ content: { raw: currentContent } }) };
    }
    return { ok: applyOk, json: async () => ({ id: 14311 }), text: async () => 'error detail' };
  };
  impl.calls = calls;
  return impl;
}

test('buildOldCtaPattern: 5種類の旧CTAラベルいずれにもマッチする', () => {
  const pattern = buildOldCtaPattern();
  for (const label of OLD_CTA_LABELS) {
    assert.match(`<p><a href="https://an-english.com/school/obata/">${label}</a></p>`, pattern);
  }
});

test('planReplacement: 旧CTAが1つだけ見つかれば置換案を返す', () => {
  const content = '<p>本文</p>\n<p><a href="https://an-english.com/school/obata/">学習相談のご予約はこちら</a></p>';
  const plan = planReplacement(content, NEW_CTA_OBATA);
  assert.equal(plan.status, 'ok');
  assert.match(plan.newContent, /free_consultation_obata/);
  assert.doesNotMatch(plan.newContent, /学習相談のご予約はこちら/);
});

test('planReplacement: 旧CTAが見つからなければno_match(自動処理しない)', () => {
  const content = '<p>本文だけでCTAリンクが無い</p>';
  const plan = planReplacement(content, NEW_CTA_OBATA);
  assert.equal(plan.status, 'no_match');
});

test('planReplacement: 旧CTAらしきリンクが複数あればmultiple_matches(自動処理しない)', () => {
  const content =
    '<p><a href="https://an-english.com/school/obata/">学習相談のご予約はこちら</a></p>' +
    '<p><a href="https://an-english.com/school/obata/">体験授業のお申込みはこちら</a></p>';
  const plan = planReplacement(content, NEW_CTA_OBATA);
  assert.equal(plan.status, 'multiple_matches');
});

test('planInsertion: 既存CTAが無い記事の末尾に新CTAを追記する(あま本部のWP編集消失ケース回帰)', () => {
  const content = '<p>本文の続き。</p>\r\n\r\n&nbsp;';
  const plan = planInsertion(content, NEW_CTA_AMA);
  assert.equal(plan.status, 'ok');
  assert.equal(plan.oldAnchor, null);
  assert.match(plan.newContent, /free_consultation_ama/);
  assert.doesNotMatch(plan.newContent, /&nbsp;\s*$/, '末尾の空段落は除去されているはず');
  assert.match(plan.newContent, /本文の続き。/, '既存本文は保持されるはず');
});

test('resolveOnePost: insert=trueは既存CTAの有無に関わらず末尾に追記する', async () => {
  const dbImpl = makeDbImpl();
  const fetchImpl = fakeFetchImpl({ currentContent: '<p>CTAリンクが無い本文</p>\r\n\r\n&nbsp;' });
  const result = await resolveOnePost(17, {
    confirm: true,
    insert: true,
    dbImpl,
    loadConfig: () => ({ juku: { cta_types: { free_consultation: NEW_CTA_OBATA } } }),
    fetchImpl,
    env: FAKE_ENV,
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.oldAnchor, null);
});

test('resolveOnePost: confirm=falseはプレビューのみ(POSTは呼ばれない)', async () => {
  const dbImpl = makeDbImpl();
  const fetchImpl = fakeFetchImpl({ currentContent: '<p><a href="https://an-english.com/school/obata/">学習相談のご予約はこちら</a></p>' });
  const result = await resolveOnePost(17, { confirm: false, dbImpl, loadConfig: () => ({ juku: { cta_types: { free_consultation: NEW_CTA_OBATA } } }), fetchImpl, env: FAKE_ENV });
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.equal(fetchImpl.calls.length, 1);
});

test('resolveOnePost: confirm=trueかつ旧CTAが1つならPOSTで反映する', async () => {
  const dbImpl = makeDbImpl();
  const fetchImpl = fakeFetchImpl({ currentContent: '<p><a href="https://an-english.com/school/obata/">学習相談のご予約はこちら</a></p>' });
  const result = await resolveOnePost(17, { confirm: true, dbImpl, loadConfig: () => ({ juku: { cta_types: { free_consultation: NEW_CTA_OBATA } } }), fetchImpl, env: FAKE_ENV });
  assert.equal(result.applied, true);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[1].options.method, 'POST');
  assert.match(JSON.parse(fetchImpl.calls[1].options.body).content, /free_consultation_obata/);
});

test('resolveOnePost: branch_idに応じて校舎別utm_campaignのCTAを使う(あま本部)', async () => {
  const amaPost = { ...POST, id: 8, branch_id: 2, wp_post_id: 14241 };
  const dbImpl = makeDbImpl({ post: amaPost });
  const fetchImpl = fakeFetchImpl({ currentContent: '<p><a href="https://an-english.com/school/ama-honbu/">学習相談のご予約はこちら</a></p>' });
  const result = await resolveOnePost(8, {
    confirm: true,
    dbImpl,
    loadConfig: (branchId) => ({ juku: { cta_types: { free_consultation: branchId === 2 ? NEW_CTA_AMA : NEW_CTA_OBATA } } }),
    fetchImpl,
    env: FAKE_ENV,
  });
  assert.match(fetchImpl.calls[1].options.body, /free_consultation_ama/);
});

test('resolveOnePost: 旧CTAが見つからない記事はエラーを返しWordPress反映を試みない(confirm=trueでも)', async () => {
  const dbImpl = makeDbImpl();
  const fetchImpl = fakeFetchImpl({ currentContent: '<p>CTAリンクが無い本文</p>' });
  const result = await resolveOnePost(17, { confirm: true, dbImpl, loadConfig: () => ({ juku: { cta_types: { free_consultation: NEW_CTA_OBATA } } }), fetchImpl, env: FAKE_ENV });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no_match');
  assert.equal(fetchImpl.calls.length, 1, 'GETのみでPOSTは呼ばれないはず');
});

test('resolveOnePost: wp_post_idが無い記事はwp_post_id_missing', async () => {
  const noWpPost = { ...POST, wp_post_id: null };
  const dbImpl = makeDbImpl({ post: noWpPost });
  const result = await resolveOnePost(17, { confirm: false, dbImpl, fetchImpl: async () => { throw new Error('呼ばれてはいけない'); }, env: FAKE_ENV });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'wp_post_id_missing');
});
