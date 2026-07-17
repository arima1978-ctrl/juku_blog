'use strict';

// フェーズ2: 承認済み記事をWordPress REST API(/wp-json/wp/v2/posts)へ自動投稿する。
// 投稿専用ユーザー(投稿者権限)のアプリケーションパスワードでBasic認証する想定。
//
// カテゴリーについて: このWordPressサイトは教室ごとに同名の子カテゴリー
// (例:「コラム」「学校情報」「教室の様子」)が並ぶ構造になっており、名前だけで
// 検索すると他教室の同名カテゴリーに誤投稿する恐れがある。そのため名前検索はせず、
// config/juku.yaml の `wordpress.category_id` に設定した固定IDのみを使う。
//
// タグについて: タグは教室横断で共有される想定のため、キーワードから名前で検索し、
// 見つかったものだけを付与する(投稿者権限には新規タグ作成権限がないため、
// 見つからないタグは付けずに投稿する)。

const https = require('node:https');
const { URL } = require('node:url');
const { loadJukuConfig } = require('./config');
const { validateAuthor, validateCategory, hasEditOthersPostsCapability } = require('./wordpress_validation');
const { getActiveBranch, getBranchById } = require('./branches_db');

// 2026-07-17判明(重要): 以前はbranchIdを一切受け取らず、常に「ダッシュボードで
// 現在アクティブな校舎(branches.is_active=1、ユーザーが随時切り替えられるUIトグル)」を
// 見ていた。これは「今まさに投稿しようとしている記事(post)がどの校舎のものか」とは
// 無関係な、グローバルな可変状態であり、あま本部校の記事を投稿する瞬間にダッシュボードの
// 表示が小幡校に切り替わっていれば、投稿者名だけ差し替わってもcategory_idは元々
// 校舎ごとの設定を持たず常に共有config/juku.yaml(小幡校のコラム、263)のままになる、
// という実害が発生した(あま本部校の記事がカテゴリー・投稿者ともに小幡校のまま
// WordPressへ同期されたインシデント)。呼び出し側(publishPost等)が投稿対象の
// post.branch_idを明示的に渡すよう変更し、category_idもbranches.wordpress_category_id
// (Phase 1で列だけ用意されていた)から校舎ごとに解決する。
function resolveWpConf(branchId) {
  const staticWpConf = loadJukuConfig(branchId).wordpress || {};
  const branch = branchId != null ? getBranchById(branchId) : getActiveBranch();
  if (!branch) return staticWpConf;
  return {
    ...staticWpConf,
    author_id: branch.wordpress_author_id ?? staticWpConf.author_id,
    author_display_name: branch.wordpress_author_display_name ?? staticWpConf.author_display_name,
    category_id: branch.wordpress_category_id ?? staticWpConf.category_id,
  };
}

function getWpConfig() {
  const baseUrl = process.env.WP_URL;
  const username = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APP_PASSWORD;
  if (!baseUrl || !username || !appPassword) {
    throw new Error('WP_URL / WP_USERNAME / WP_APP_PASSWORD が.envに設定されていません');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), username, appPassword };
}

function wpRequest(config, method, wpPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${config.baseUrl}/wp-json/wp/v2/${wpPath}`);
    const payload = body ? JSON.stringify(body) : null;
    const token = Buffer.from(`${config.username}:${config.appPassword}`).toString('base64');
    const options = {
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          // レスポンスがJSONでない場合はnullのまま
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          const err = new Error(`WordPress API ${method} ${wpPath} が ${res.statusCode} を返しました: ${JSON.stringify(parsed)}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function findTermId(config, taxonomy, name) {
  if (!name) return null;
  const results = await wpRequest(config, 'GET', `${taxonomy}?search=${encodeURIComponent(name)}`);
  if (!Array.isArray(results)) return null;
  const exact = results.find((t) => t.name === name);
  return exact ? exact.id : null;
}

async function fetchCategoryOrNull(config, categoryId) {
  try {
    return await wpRequest(config, 'GET', `categories/${categoryId}`);
  } catch {
    return null;
  }
}

async function fetchUserOrNull(config, userId) {
  try {
    return await wpRequest(config, 'GET', `users/${userId}`);
  } catch {
    return null;
  }
}

// 投稿前に、認証中のWordPressユーザー・投稿先カテゴリーが想定通りかを確認する。
// 「教室からのBLOG」一覧が投稿者IDで絞り込まれる構造のため、想定と異なるアカウント
// で誤って投稿すると記事が意図した場所に表示されない、という事故を防ぐための検証。
//
// 2026-07-17追加: 校舎ごとに投稿者を書き分けられるよう、authorをWordPress投稿の
// author欄に明示指定する運用に変更した(共有の編集者以上権限アカウントで認証し、
// 投稿ごとにauthorだけ切り替える)。認証中のユーザー自身がexpected.author_idと
// 一致する場合(従来通りの個人アカウント運用)は追加確認不要。異なる場合は、
// 認証中のユーザーがedit_others_posts(他ユーザーをauthor指定する権限)を
// 持っているか、かつexpected.author_idが実在し表示名が一致するかを確認する。
async function assertWordPressTargetIsValid(config, wpConf) {
  // capabilities(edit_others_posts等)はWordPress REST APIのview(既定)contextには
  // 含まれず、edit contextでのみ返される。context指定を忘れるとcapabilitiesが
  // 常にundefinedになり、実際にはedit_others_postsを持つアカウントでも
  // hasEditOthersPostsCapability()がfalseと誤判定してしまう(実際に発生した不具合)。
  const currentUser = await wpRequest(config, 'GET', 'users/me?context=edit').catch(() => null);

  if (wpConf && wpConf.author_id && currentUser && String(currentUser.id) === String(wpConf.author_id)) {
    const authorCheck = validateAuthor(currentUser, wpConf);
    if (!authorCheck.ok) {
      throw new Error(`WordPress投稿者の事前検証に失敗しました: ${authorCheck.reason}`);
    }
  } else if (wpConf && wpConf.author_id) {
    if (!hasEditOthersPostsCapability(currentUser)) {
      throw new Error(
        `WordPress投稿者の事前検証に失敗しました: 認証中のユーザー(id=${currentUser ? currentUser.id : '取得失敗'})には` +
        `他ユーザー(id=${wpConf.author_id})を投稿者に指定する権限(edit_others_posts)がありません`
      );
    }
    const targetAuthor = await fetchUserOrNull(config, wpConf.author_id);
    const authorCheck = validateAuthor(targetAuthor, wpConf);
    if (!authorCheck.ok) {
      throw new Error(`WordPress投稿者の事前検証に失敗しました: ${authorCheck.reason}`);
    }
  }

  if (wpConf && wpConf.category_id) {
    const category = await fetchCategoryOrNull(config, wpConf.category_id);
    const categoryCheck = validateCategory(category, wpConf.category_id);
    if (!categoryCheck.ok) {
      throw new Error(`WordPressカテゴリーの事前検証に失敗しました: ${categoryCheck.reason}`);
    }
  }
}

// date: WordPressサイトのローカル時刻(このサイトはJST確認済み)のwall-clock文字列
// (例: "2026-07-12T05:00:00")。指定するとstatus:'future'の予約投稿になる。
// 省略時は従来通り即時公開(status:'publish')。
// 2026-07-17追加: post.branch_idからその校舎のwpConf(投稿者ID・カテゴリーID)を解決し、
// 共有の編集者以上権限アカウントで認証しつつ、投稿ごとにauthorを明示指定する。
async function publishPost(post, { date } = {}) {
  const config = getWpConfig();
  const wpConf = resolveWpConf(post.branch_id);
  const categoryId = wpConf.category_id;

  await assertWordPressTargetIsValid(config, wpConf);

  const tagNames = (post.keywords || '').split(',').map((k) => k.trim()).filter(Boolean);
  const tagIds = [];
  for (const name of tagNames) {
    const id = await findTermId(config, 'tags', name);
    if (id) tagIds.push(id);
  }

  const body = {
    title: post.title,
    slug: post.slug,
    content: post.body_html,
    excerpt: post.meta_description || '',
    status: date ? 'future' : 'publish',
  };
  if (date) body.date = date;
  if (wpConf.author_id) body.author = wpConf.author_id;
  if (categoryId) body.categories = [categoryId];
  if (tagIds.length) body.tags = tagIds;

  const created = await wpRequest(config, 'POST', 'posts', body);
  return { wpPostId: created.id, link: created.link, date: created.date };
}

// Sprint 4.1: AI Growth Director(SEO Task)のcreate_article原稿を、確認前提の
// 下書き(status:'draft')としてWordPressへ投稿する。publishPost()とは異なり、
// 承認済み記事(data/posts.sqliteのposts行)ではなくseo_tasks/seo_weekly_recommendations
// 由来の原稿を扱うため、引数の形も{title, bodyHtml, metaDescription}に絞っている
// (slug/keywords/予約投稿日時は現時点では扱わない。人間がWordPress管理画面で
// 下書きを確認してから公開する運用を前提とする)。
// 2026-07-17追加: branchIdを渡すとその校舎のauthor_id/category_idを使う(publishPostと同様)。
async function createDraftPost({ title, bodyHtml, metaDescription, branchId } = {}) {
  const config = getWpConfig();
  const wpConf = resolveWpConf(branchId);
  const categoryId = wpConf.category_id;

  await assertWordPressTargetIsValid(config, wpConf);

  const body = {
    title,
    content: bodyHtml,
    excerpt: metaDescription || '',
    status: 'draft',
  };
  if (wpConf.author_id) body.author = wpConf.author_id;
  if (categoryId) body.categories = [categoryId];

  const created = await wpRequest(config, 'POST', 'posts', body);
  return { wpPostId: created.id, link: created.link, status: created.status };
}

// WordPress上の実際のstatus(future/publish/draft/pending/trash等)を取得する。
// 予約投稿(status:future)は認証なしでは見えないため認証付きで取得する。
// 記事が見つからない(削除された)場合は例外を投げず { status: 'not_found' } を返す。
async function fetchPostStatus(wpPostId) {
  const config = getWpConfig();
  try {
    const post = await wpRequest(config, 'GET', `posts/${wpPostId}?context=edit`);
    return { status: post.status };
  } catch (err) {
    if (err.statusCode === 404) {
      return { status: 'not_found' };
    }
    throw err;
  }
}

// dry-run用: 投稿者・カテゴリーの検証結果を(投稿せず)そのまま返す。
// assertWordPressTargetIsValid()と同じロジックだが、例外を投げずに結果を返す。
async function checkWordPressTargetDryRun(branchId) {
  const config = getWpConfig();
  const wpConf = resolveWpConf(branchId);

  const currentUser = await wpRequest(config, 'GET', 'users/me?context=edit').catch(() => null);

  let authorCheck;
  if (wpConf.author_id && currentUser && String(currentUser.id) === String(wpConf.author_id)) {
    authorCheck = validateAuthor(currentUser, wpConf);
  } else if (wpConf.author_id) {
    if (!hasEditOthersPostsCapability(currentUser)) {
      authorCheck = {
        ok: false,
        reason: `認証中のユーザー(id=${currentUser ? currentUser.id : '取得失敗'})には他ユーザー(id=${wpConf.author_id})を投稿者に指定する権限(edit_others_posts)がありません`,
      };
    } else {
      const targetAuthor = await fetchUserOrNull(config, wpConf.author_id);
      authorCheck = validateAuthor(targetAuthor, wpConf);
    }
  } else {
    authorCheck = validateAuthor(currentUser, wpConf);
  }

  let categoryCheck = { ok: true, skipped: true };
  if (wpConf.category_id) {
    const category = await fetchCategoryOrNull(config, wpConf.category_id);
    categoryCheck = validateCategory(category, wpConf.category_id);
  }

  return { authorCheck, categoryCheck, currentUser };
}

// dry-run用: キーワードがWordPress上の既存タグと一致するかを(投稿せず)確認する。
async function resolveTagCandidates(keywordsCsv) {
  const config = getWpConfig();
  const names = (keywordsCsv || '').split(',').map((k) => k.trim()).filter(Boolean);
  const results = [];
  for (const name of names) {
    const id = await findTermId(config, 'tags', name);
    results.push({ name, found: !!id, tagId: id });
  }
  return results;
}

module.exports = {
  publishPost,
  createDraftPost,
  fetchPostStatus,
  checkWordPressTargetDryRun,
  resolveTagCandidates,
  resolveWpConf,
};
