'use strict';

// ブランドページPage DraftのWordPress本文反映(2026-07-29)。ブランドページ
// (config/brand_pages.yaml)はREST APIで直接読み書きできる通常のWPページであり
// (校舎ページはREST非公開のため対象外、従来通り手動反映)、post_content全体が
// 既存の紹介文パラグラフそのものであることを確認済み(content.rawが導入文1段落のみ)。
// そのためPage Draftのgenerated_textでpost_content全体を置き換える設計とする。
//
// 安全設計: 既定では現在の本文とDraft文面の差分をプレビュー表示するのみ(書き込みなし)。
// --confirmを明示した場合のみ実際にWordPress REST API(POST /wp-json/wp/v2/pages/<id>、
// 部分更新)へ反映する。自動実行(cron等)には一切組み込まない。1回の実行で1件のDraftのみを
// 対象とする(反映は必ず人間の明示承認後、1件ずつ、というユーザー指示)。
//
// 使い方:
//   node scripts/seo_brand_page_draft_apply.js --draft-id=<id>            # プレビューのみ(既定)
//   node scripts/seo_brand_page_draft_apply.js --draft-id=<id> --confirm  # 実際に反映

const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .envが無い場合はスキップ(テスト等)
}

const seoDb = require('./lib/seo_db');
const { getBrandPageById } = require('./lib/seo/brand_page_registry');

function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const get = (prefix) => {
    const arg = argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
  };
  return {
    draftId: get('--draft-id=') !== undefined ? Number(get('--draft-id=')) : undefined,
    confirm: has('--confirm'),
  };
}

function buildAuthHeader(env) {
  const user = env.WP_USERNAME;
  const pass = env.WP_APP_PASSWORD;
  if (!user || !pass) throw new Error('WP_USERNAME / WP_APP_PASSWORD が.envに設定されていません');
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function fetchCurrentContent(wpUrl, wpPageId, authHeader, fetchImpl) {
  const res = await fetchImpl(`${wpUrl}/wp-json/wp/v2/pages/${wpPageId}?context=edit`, { headers: { Authorization: authHeader } });
  if (!res.ok) throw new Error(`現在の本文取得に失敗しました(status=${res.status})`);
  const body = await res.json();
  return body.content && body.content.raw != null ? body.content.raw : null;
}

async function applyContent(wpUrl, wpPageId, authHeader, newContent, fetchImpl) {
  const res = await fetchImpl(`${wpUrl}/wp-json/wp/v2/pages/${wpPageId}`, {
    method: 'POST', // WP REST APIの部分更新は仕様上POST(変更するフィールドのみ送ればよい)
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: newContent }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WordPress反映に失敗しました(status=${res.status}): ${errBody}`);
  }
  return res.json();
}

// コア処理(テスト容易性のため分離)。DB書き込みはconfirm=trueかつ実反映成功時のみ発生する。
async function resolveApply(
  { draftId, confirm },
  { seoDbImpl = seoDb, getBrandPageByIdImpl = getBrandPageById, fetchImpl = fetch, env = process.env, nowIso } = {}
) {
  const draft = seoDbImpl.getSeoPageDraftById(draftId);
  if (!draft) return { ok: false, error: 'draft_not_found', message: `Page Draft id=${draftId} が見つかりません` };

  // 2026-07-29修正: draft.statusを一切見ていなかったため、既にapplied(反映済み)の
  // Draftを再度--draft-id指定するだけで無警告に再反映できてしまっていた(二重反映防止漏れ)。
  // 'generated'にはPage Draft専用のレビュー承認機構が現状無い(seo_page_plans側と異なり
  // generated→approvedへ遷移させる仕組みが未実装)ため、'approved'必須にはせず、
  // 既にapplied状態であることのみを拒否する(反映自体の可否判断はCLAUDE.mdの承認フロー
  // ——差分提示→人間の明示承認→1件ずつ--confirm実行——に委ねる)。
  if (draft.status === 'applied') {
    return {
      ok: false,
      error: 'draft_already_applied',
      message: `Page Draft id=${draftId} は既にapplied状態です(${draft.applied_at}に反映済み)。再反映が必要な場合は新しいDraftを生成してください。`,
    };
  }

  const plan = seoDbImpl.getSeoPagePlanById(draft.page_plan_id);
  if (!plan) {
    return { ok: false, error: 'page_plan_not_found', message: `Page Draft id=${draftId} に対応するPage Plan(id=${draft.page_plan_id})が見つかりません` };
  }

  if (plan.target_page_type !== 'brand_page') {
    return {
      ok: false,
      error: 'not_brand_page',
      message:
        `このスクリプトはブランドページ(target_page_type='brand_page')専用です(このDraftは'${plan.target_page_type}')。` +
        '校舎ページはREST非公開のため、従来通りWordPress管理画面から手動で反映してください。',
    };
  }

  const brandPage = getBrandPageByIdImpl(plan.target_page_id);
  if (!brandPage || !brandPage.wp_page_id) {
    return { ok: false, error: 'brand_page_not_registered', message: `config/brand_pages.yamlに id="${plan.target_page_id}" のwp_page_idが見つかりません` };
  }

  const wpUrl = env.WP_URL;
  if (!wpUrl) return { ok: false, error: 'wp_url_missing', message: 'WP_URL が.envに設定されていません' };
  const authHeader = buildAuthHeader(env);

  const currentContent = await fetchCurrentContent(wpUrl, brandPage.wp_page_id, authHeader, fetchImpl);
  const newContent = draft.generated_text;
  const noChange = currentContent === newContent;

  if (!confirm || noChange) {
    return { ok: true, applied: false, noChange, brandPage, currentContent, newContent, draft };
  }

  await applyContent(wpUrl, brandPage.wp_page_id, authHeader, newContent, fetchImpl);
  const appliedAt = nowIso || new Date().toISOString();
  const updatedDraft = seoDbImpl.markSeoPageDraftApplied(draftId, appliedAt);

  return { ok: true, applied: true, noChange: false, brandPage, currentContent, newContent, draft: updatedDraft };
}

function printResult(result) {
  if (!result.ok) {
    console.error(`[seo_brand_page_draft_apply] ${result.message}`);
    return;
  }
  const { brandPage, currentContent, newContent, applied, noChange } = result;
  console.log(`=== ${brandPage.name}(${brandPage.url}) Page Draft id=${result.draft.id} ===`);
  console.log(`--- 現在の本文 ---\n${currentContent}\n`);
  console.log(`--- Draft本文(反映後) ---\n${newContent}\n`);
  if (noChange) {
    console.log('現在の本文とDraft本文は同一です。反映不要です。');
  } else if (applied) {
    console.log(`[seo_brand_page_draft_apply] 反映しました(${brandPage.url})。Page Draft id=${result.draft.id} をapplied状態に更新しました。`);
  } else {
    console.log('[seo_brand_page_draft_apply] --confirmが無いためプレビューのみです(反映していません)');
  }
}

async function main() {
  const { draftId, confirm } = parseArgs(process.argv.slice(2));
  if (!draftId) {
    console.error('使い方: node scripts/seo_brand_page_draft_apply.js --draft-id=<id> [--confirm]');
    process.exitCode = 1;
    return;
  }
  const result = await resolveApply({ draftId, confirm });
  printResult(result);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_brand_page_draft_apply] 予期しないエラー: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, buildAuthHeader, fetchCurrentContent, applyContent, resolveApply, main };
