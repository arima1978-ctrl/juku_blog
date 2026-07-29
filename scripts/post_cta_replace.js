'use strict';

// 公開済み記事(posts)末尾のCTAリンクを、既定CTA(free_consultation)へ一括置換する
// 半自動スクリプト(2026-07-29)。記事(posts)はCLAUDE.mdの上位ルールで通常運用が
// 許可されている対象(固定ページ・ブランドページ等とは異なりゲート不要)だが、
// 公開済み本文への一括変更のため、seo_brand_page_draft_apply.jsと同じ安全設計を踏襲する:
// 既定は差分プレビューのみ(書き込みなし)、--confirm明示時のみ実際にWordPress REST API
// (POST /wp-json/wp/v2/posts/<id>、部分更新)へ反映する。自動実行には一切組み込まない。
//
// 旧CTA(5種類、config/juku.yamlのcta_types)の<a>タグを正規表現で検出し、
// 校舎ごとの新CTA(free_consultation、utm_campaignが校舎別)へ置換する。
// 想定外のパターン(旧CTAが見つからない/複数ある等)は自動処理せず報告のみに留める。
//
// 使い方:
//   node scripts/post_cta_replace.js --post-id=<posts.idローカルDB> [--confirm]
//   node scripts/post_cta_replace.js --all [--confirm]

const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .envが無い場合はスキップ(テスト等)
}

const { loadJukuConfig } = require('./lib/config');
const db = require('./lib/db');

const OLD_CTA_LABELS = [
  '体験授業のお申込みはこちら',
  '学習相談のご予約はこちら',
  '教室見学のお申込みはこちら',
  '夏期講習の詳細はこちら',
  '進路・学習相談のご予約はこちら',
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildOldCtaPattern() {
  const alternation = OLD_CTA_LABELS.map(escapeRegExp).join('|');
  return new RegExp(`<a href="[^"]*">(${alternation})</a>`);
}

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    postId: get('--post-id=') !== undefined ? Number(get('--post-id=')) : undefined,
    all: has('--all'),
    confirm: has('--confirm'),
  };
}

function buildAuthHeader(env) {
  const user = env.WP_USERNAME;
  const pass = env.WP_APP_PASSWORD;
  if (!user || !pass) throw new Error('WP_USERNAME / WP_APP_PASSWORD が.envに設定されていません');
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function fetchCurrentContent(wpUrl, wpPostId, authHeader, fetchImpl) {
  const res = await fetchImpl(`${wpUrl}/wp-json/wp/v2/posts/${wpPostId}?context=edit`, { headers: { Authorization: authHeader } });
  if (!res.ok) throw new Error(`現在の本文取得に失敗しました(status=${res.status})`);
  const body = await res.json();
  return body.content && body.content.raw != null ? body.content.raw : null;
}

async function applyContent(wpUrl, wpPostId, authHeader, newContent, fetchImpl) {
  const res = await fetchImpl(`${wpUrl}/wp-json/wp/v2/posts/${wpPostId}`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: newContent }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WordPress反映に失敗しました(status=${res.status}): ${errBody}`);
  }
  return res.json();
}

function resolveNewCta(branchId, loadConfig) {
  const config = loadConfig(branchId);
  const cta = config.juku && config.juku.cta_types && config.juku.cta_types.free_consultation;
  if (!cta) throw new Error(`branch_id=${branchId}のconfig/juku.yamlにcta_types.free_consultationが見つかりません`);
  return cta;
}

// コア処理(テスト容易性のため分離)。1件分の検出・置換案を組み立てる(DB書き込みなし)。
function planReplacement(currentContent, newCta) {
  const pattern = buildOldCtaPattern();
  const matches = currentContent.match(new RegExp(pattern, 'g')) || [];
  if (matches.length === 0) {
    return { status: 'no_match', reason: '既知の旧CTAパターンが見つかりません(手動確認が必要)' };
  }
  if (matches.length > 1) {
    return { status: 'multiple_matches', reason: `旧CTAらしきリンクが${matches.length}箇所見つかりました(手動確認が必要)` };
  }
  const newAnchor = `<a href="${newCta.url}">${newCta.label}</a>`;
  const newContent = currentContent.replace(pattern, newAnchor);
  return { status: 'ok', oldAnchor: matches[0], newAnchor, newContent };
}

async function resolveOnePost(postId, { confirm, dbImpl = db, loadConfig = loadJukuConfig, fetchImpl = fetch, env = process.env } = {}) {
  const post = dbImpl.getPostById(postId);
  if (!post) return { ok: false, error: 'post_not_found', message: `posts.id=${postId} が見つかりません` };
  if (!post.wp_post_id) return { ok: false, error: 'wp_post_id_missing', message: `posts.id=${postId} にwp_post_idがありません` };

  const wpUrl = env.WP_URL;
  if (!wpUrl) return { ok: false, error: 'wp_url_missing', message: 'WP_URL が.envに設定されていません' };
  const authHeader = buildAuthHeader(env);

  const newCta = resolveNewCta(post.branch_id, loadConfig);
  const currentContent = await fetchCurrentContent(wpUrl, post.wp_post_id, authHeader, fetchImpl);
  const plan = planReplacement(currentContent, newCta);

  if (plan.status !== 'ok') {
    return { ok: false, error: plan.status, message: plan.reason, post, currentContent };
  }

  if (!confirm) {
    return { ok: true, applied: false, post, oldAnchor: plan.oldAnchor, newAnchor: plan.newAnchor };
  }

  await applyContent(wpUrl, post.wp_post_id, authHeader, plan.newContent, fetchImpl);
  return { ok: true, applied: true, post, oldAnchor: plan.oldAnchor, newAnchor: plan.newAnchor };
}

function printResult(result) {
  if (!result.ok) {
    console.error(`[post_cta_replace] posts.id=${result.post ? result.post.id : '?'}: ${result.message}`);
    return;
  }
  console.log(`=== posts.id=${result.post.id}(branch=${result.post.branch_id}) ${result.post.title} ===`);
  console.log(`  旧: ${result.oldAnchor}`);
  console.log(`  新: ${result.newAnchor}`);
  console.log(result.applied ? '  → 反映しました' : '  → --confirmが無いためプレビューのみです');
}

async function main() {
  const { postId, all, confirm } = parseArgs(process.argv.slice(2));
  if (!postId && !all) {
    console.error('使い方: node scripts/post_cta_replace.js --post-id=<id> [--confirm] | --all [--confirm]');
    process.exitCode = 1;
    return;
  }

  const targetIds = all ? db.listPosts({ status: 'published' }).map((p) => p.id) : [postId];

  let hadError = false;
  for (const id of targetIds) {
    const result = await resolveOnePost(id, { confirm });
    printResult(result);
    if (!result.ok) hadError = true;
  }
  if (hadError) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[post_cta_replace] 予期しないエラー: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, buildOldCtaPattern, planReplacement, resolveNewCta, resolveOnePost, OLD_CTA_LABELS, main };
