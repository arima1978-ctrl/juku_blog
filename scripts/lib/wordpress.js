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
          reject(new Error(`WordPress API ${method} ${wpPath} が ${res.statusCode} を返しました: ${JSON.stringify(parsed)}`));
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

async function publishPost(post) {
  const config = getWpConfig();
  const jukuConfig = loadJukuConfig();
  const categoryId = jukuConfig.wordpress && jukuConfig.wordpress.category_id;

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
    status: 'publish',
  };
  if (categoryId) body.categories = [categoryId];
  if (tagIds.length) body.tags = tagIds;

  const created = await wpRequest(config, 'POST', 'posts', body);
  return { wpPostId: created.id, link: created.link };
}

module.exports = { publishPost };
