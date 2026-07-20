'use strict';

// 複数校舎管理(プランA: データベース化)。config/juku.yamlの静的なwordpress.author_id/
// author_display_nameに代わり、DB上の「現在アクティブな校舎」(is_active=1、常に1件のみ)
// からWordPress投稿者検証(scripts/lib/wordpress_validation.js)の期待値を取得できるように
// する。category_idは今回のスキーマに含まれないため、引き続きconfig/juku.yamlの値を
// 全校舎共通で使用する(scripts/lib/wordpress.js側の責務)。
const { getDb } = require('./db');
const { loadJukuConfig } = require('./config');

function nowIso() {
  return new Date().toISOString();
}

// 初回起動時、branchesテーブルが空であればconfig/juku.yamlの現在値から1件目を自動投入
// する(このリポジトリに既存のseed-on-first-runパターンは無いため、テーブルが空かどうかを
// 都度確認する冪等な処理として実装する。呼び出しコストは軽量なCOUNTクエリのみ)。
function ensureSeeded() {
  const conn = getDb();
  const { count } = conn.prepare('SELECT COUNT(*) as count FROM branches').get();
  if (count > 0) return;

  const config = loadJukuConfig();
  const wpConf = (config && config.wordpress) || {};
  const areaConf = (config && config.area) || {};
  const jukuConf = (config && config.juku) || {};
  const ts = nowIso();

  const result = conn
    .prepare(
      `INSERT INTO branches (
        name, target_area, wordpress_author_id, wordpress_author_display_name,
        wordpress_api_token, is_active, created_at, updated_at
      ) VALUES (
        :name, :target_area, :wordpress_author_id, :wordpress_author_display_name,
        NULL, 1, :created_at, :updated_at
      )`
    )
    .run({
      name: jukuConf.name || '既存設定から自動作成された校舎',
      target_area: areaConf.city || null,
      wordpress_author_id: wpConf.author_id ?? null,
      wordpress_author_display_name: wpConf.author_display_name ?? null,
      created_at: ts,
      updated_at: ts,
    });
  // db.js側のgetDb()内slugバックフィルは、このINSERTより前(branchesがまだ空の時点)に
  // 実行されるため間に合わない。ここで自分の挿入行に対して明示的にslugを設定する
  // (記事生成パイプラインの複数校舎対応Phase 1: branch_context.js/config.jsが
  // slugを前提にbranches/<slug>/config/を解決するため、NULLのまま放置しない)。
  const newId = Number(result.lastInsertRowid);
  conn.prepare('UPDATE branches SET slug = :slug WHERE id = :id').run({ slug: `branch-${newId}`, id: newId });
}

function toBranch(row) {
  if (!row) return null;
  return { ...row, is_active: !!row.is_active, generation_enabled: !!row.generation_enabled };
}

function listBranches() {
  ensureSeeded();
  const conn = getDb();
  return conn.prepare('SELECT * FROM branches ORDER BY id').all().map(toBranch);
}

function getBranchById(id) {
  ensureSeeded();
  const conn = getDb();
  return toBranch(conn.prepare('SELECT * FROM branches WHERE id = ?').get(id));
}

// 記事生成パイプラインの複数校舎対応(Phase 1): branch_context.jsがJUKU_BRANCH_SLUG経由で
// 校舎を解決するために使う。
function getBranchBySlug(slug) {
  ensureSeeded();
  const conn = getDb();
  return toBranch(conn.prepare('SELECT * FROM branches WHERE slug = ?').get(slug));
}

// 状態不整合(is_active=1が0件/複数件)が万一発生しても、呼び出し側が確実に1件だけを
// 使えるよう、複数件ヒットした場合はid最小のものを返す(ORDER BY id LIMIT 1)。
function getActiveBranch() {
  ensureSeeded();
  const conn = getDb();
  return toBranch(conn.prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY id LIMIT 1').get());
}

// 2026-07-20判明(重要): is_active(現在アクティブな校舎)はダッシュボードの校舎切り替え
// トグルで随時変わる可変なUI状態であり、「校舎コンテキストが明示されていない(legacy)
// 処理が、どの校舎のデータとして扱われるべきか」の判定には使ってはいけない
// (db.js resolveBackfillBranchId()の2026-07-16インシデントで既に判明していた原則だが、
// sync_draft_to_db.js/seo_competitor_crawl.js/seo_publisher.js/seo_weekly_director.js/
// wordpress.jsが同じ原則を守らずgetActiveBranch()をlegacy解決に使っていたため、
// ダッシュボードの表示校舎をあま本部校のままにしていた数日間、共有config(小幡校の
// 守山区コンテンツ)で生成された毎朝の記事が誤ってbranch_id=2で保存され続ける実害が
// 発生した)。legacy(校舎コンテキスト無し)処理は、常に「最も早く作成された校舎」
// (id最小、単一テナント時代から存在する唯一の校舎)を使うこと。
function getEarliestBranch() {
  ensureSeeded();
  const conn = getDb();
  return toBranch(conn.prepare('SELECT * FROM branches ORDER BY id ASC LIMIT 1').get());
}

function createBranch(fields, nowIsoOverride) {
  ensureSeeded();
  const conn = getDb();
  const ts = nowIsoOverride || nowIso();
  const result = conn
    .prepare(
      `INSERT INTO branches (
        name, target_area, wordpress_author_id, wordpress_author_display_name,
        wordpress_api_token, is_active, created_at, updated_at
      ) VALUES (
        :name, :target_area, :wordpress_author_id, :wordpress_author_display_name,
        :wordpress_api_token, 0, :created_at, :updated_at
      )`
    )
    .run({
      name: fields.name,
      target_area: fields.target_area ?? null,
      wordpress_author_id: fields.wordpress_author_id ?? null,
      wordpress_author_display_name: fields.wordpress_author_display_name ?? null,
      wordpress_api_token: fields.wordpress_api_token ?? null,
      created_at: ts,
      updated_at: ts,
    });
  const newId = Number(result.lastInsertRowid);
  // 記事生成パイプラインの複数校舎対応Phase 1: 全校舎が常にslugを持つという不変条件を
  // 維持するため、指定が無ければ安全な仮値を即座に設定する(運用者はダッシュボードの
  // 編集フォームから本来の値、例: obata/amaへ後から変更できる)。
  conn.prepare('UPDATE branches SET slug = :slug WHERE id = :id').run({ slug: fields.slug || `branch-${newId}`, id: newId });
  return getBranchById(newId);
}

const UPDATABLE_FIELDS = [
  'name',
  'slug',
  'target_area',
  'wordpress_author_id',
  'wordpress_author_display_name',
  'wordpress_api_token',
  'wordpress_category_id',
  'generation_enabled',
];

function updateBranch(id, fields, nowIsoOverride) {
  const conn = getDb();
  const existing = conn.prepare('SELECT id FROM branches WHERE id = ?').get(id);
  if (!existing) return null;

  const setClauses = [];
  const params = { id };
  UPDATABLE_FIELDS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      setClauses.push(`${key} = :${key}`);
      params[key] = fields[key];
    }
  });
  if (setClauses.length === 0) return getBranchById(id);

  params.updated_at = nowIsoOverride || nowIso();
  setClauses.push('updated_at = :updated_at');
  conn.prepare(`UPDATE branches SET ${setClauses.join(', ')} WHERE id = :id`).run(params);
  return getBranchById(id);
}

// is_active=1の校舎は常に1件のみ、という不変条件をトランザクション内で保証する
// (先に全件を0へ落としてから対象の1件のみ1へ上げる)。
function activateBranch(id, nowIsoOverride) {
  const conn = getDb();
  const existing = conn.prepare('SELECT id FROM branches WHERE id = ?').get(id);
  if (!existing) return { ok: false, reason: 'not_found' };

  const ts = nowIsoOverride || nowIso();
  conn.exec('BEGIN');
  try {
    conn.prepare('UPDATE branches SET is_active = 0, updated_at = :updated_at WHERE is_active = 1').run({ updated_at: ts });
    conn.prepare('UPDATE branches SET is_active = 1, updated_at = :updated_at WHERE id = :id').run({ id, updated_at: ts });
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  return { ok: true, branch: getBranchById(id) };
}

// アクティブな校舎自体は削除できない(必ずどれか1件はアクティブでなければならないため、
// 先に別の校舎をactivateしてから削除する運用とする)。
function deleteBranch(id) {
  const conn = getDb();
  const existing = conn.prepare('SELECT id, is_active FROM branches WHERE id = ?').get(id);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.is_active) return { ok: false, reason: 'cannot_delete_active_branch' };

  conn.prepare('DELETE FROM branches WHERE id = ?').run(id);
  return { ok: true };
}

module.exports = {
  ensureSeeded,
  listBranches,
  getBranchById,
  getBranchBySlug,
  getActiveBranch,
  getEarliestBranch,
  createBranch,
  updateBranch,
  activateBranch,
  deleteBranch,
  UPDATABLE_FIELDS,
};
