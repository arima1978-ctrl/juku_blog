'use strict';

// フェーズ1のダッシュボード用簡易APIサーバー。
// dashboard.html を静的配信しつつ、承認/差し戻し/エピソード追加を受け付ける。
// 起動: node scripts/api-server.js (既定ポート3013。PORT環境変数で変更可)

const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .env が無い場合はスキップ(WordPress自動投稿・Telegram通知は未設定として動作)
}

const express = require('express');
const fs = require('node:fs');
const {
  listPosts,
  getPostById,
  setStatus,
  setScheduled,
  updatePostFields,
  getLatestScheduleDate,
  getRecentScheduledValues,
  listRejectedWithNotes,
  monthlySummary,
} = require('./lib/db');
const { marked } = require('marked');
const { listEpisodes, appendEpisode } = require('./lib/episodes');
const { ROOT, loadJukuConfig } = require('./lib/config');
const { publishPost } = require('./lib/wordpress');
const { sendTelegram } = require('./lib/telegram');
const { logError } = require('./log_error');
const { computeNextScheduleSlot, isWithinPublishWindow, checkStreak } = require('./lib/schedule');
const { safeJsonParse } = require('./lib/json_field');
const { projectThemeCalendar } = require('./lib/theme_calendar');
const seoDb = require('./lib/seo_db');

const PORT = process.env.PORT || 3013;
const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${PORT}`;
const ERRORS_PATH = path.join(ROOT, 'logs', 'errors.json');

// ダッシュボードの確認が不定期でも、承認をまとめて行った際に同日に複数本
// 公開されないよう、直近の予約済み/公開済み日の翌日を次の枠として予約投稿する。
// (このサイトはJST運用のため、WordPressの`date`フィールドにはJSTのwall-clockを渡す)
function getNextScheduleSlot() {
  const config = loadJukuConfig();
  const runTime = (config.generation && config.generation.run_time) || '05:00';
  const latest = getLatestScheduleDate();
  return computeNextScheduleSlot(latest, runTime);
}

// 承認時に実際に使う判定(予約日・公開期限超過・カテゴリー/対象読者の連続警告)を
// 承認前プレビュー(GET /api/posts/:id/schedule-preview)とも共有する。
function computeApprovalPreview(post) {
  const config = loadJukuConfig();
  const slot = getNextScheduleSlot();
  const scheduledDateLabel = slot.dateOnly;
  const withinWindow = isWithinPublishWindow(scheduledDateLabel, post.publish_window_end);

  const maxCategoryStreak = (config.generation && config.generation.max_same_category_streak) || 0;
  const maxAudienceStreak = (config.generation && config.generation.max_same_audience_streak) || 0;
  const categoryStreak = checkStreak(getRecentScheduledValues('category', maxCategoryStreak || 10), post.category, maxCategoryStreak);
  const audienceStreak = checkStreak(getRecentScheduledValues('target_audience', maxAudienceStreak || 10), post.target_audience, maxAudienceStreak);

  const streakWarnings = [
    categoryStreak.warn ? `カテゴリー「${post.category}」が${categoryStreak.streak}日連続になります` : null,
    audienceStreak.warn ? `対象読者「${post.target_audience}」が${audienceStreak.streak}日連続になります` : null,
  ].filter(Boolean);

  return { slot, scheduledDateLabel, withinWindow, streakWarnings };
}

const app = express();
app.use(express.json());
// プロジェクトルート全体を静的配信するとconfig/scriptsのソースまで公開されてしまうため、
// dashboard.html 単体のみを配信する(外部公開を想定したセキュリティ対応)。
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'dashboard.html'));
});

app.get('/api/posts', (req, res) => {
  const { status, category } = req.query;
  const posts = listPosts({ status, category });
  res.json(posts);
});

app.get('/api/posts/:id', (req, res) => {
  const post = getPostById(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'not_found' });
  res.json({
    ...post,
    fact_check_report_parsed: safeJsonParse(post.fact_check_report),
    similarity_check_parsed: safeJsonParse(post.similarity_check),
    plan_rationale_parsed: safeJsonParse(post.plan_rationale),
    citations_parsed: safeJsonParse(post.citations),
    eyecatch_parsed: safeJsonParse(post.eyecatch),
    exam_validation_warnings_parsed: safeJsonParse(post.exam_validation_warnings),
  });
});

// ダッシュボードからの直接編集(承認前のreview_pendingの記事のみ許可。承認後は
// WordPress側に既に反映されている可能性があるため対象外。承認後に直したい場合は
// 差し戻すか、WordPress管理画面で直接編集する運用)。
const EDITABLE_FIELDS = ['title', 'category', 'target_audience', 'keywords', 'meta_description', 'body_md'];

app.patch('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  const post = getPostById(id);
  if (!post) return res.status(404).json({ error: 'not_found' });
  if (post.status !== 'review_pending') {
    return res.status(400).json({ error: 'not_editable', message: '承認前(review_pending)の記事のみ編集できます' });
  }

  const updates = {};
  for (const key of EDITABLE_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no_fields' });

  if (updates.body_md !== undefined) {
    updates.body_html = marked.parse(updates.body_md);
  }

  const changes = updatePostFields(id, updates);
  if (changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// 承認前に、実際に承認した場合の予約予定日・公開期限超過・連続警告をプレビューする
// (承認ボタンを押す前にダッシュボードで確認できるようにするため)。DBは変更しない。
app.get('/api/posts/:id/schedule-preview', (req, res) => {
  const post = getPostById(Number(req.params.id));
  if (!post) return res.status(404).json({ error: 'not_found' });
  const preview = computeApprovalPreview(post);
  res.json({
    scheduledDate: preview.scheduledDateLabel,
    withinWindow: preview.withinWindow,
    publishWindowEnd: post.publish_window_end || null,
    streakWarnings: preview.streakWarnings,
  });
});

app.post('/api/posts/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  const changes = setStatus(id, 'approved', null);
  if (changes === 0) return res.status(404).json({ error: 'not_found' });

  // 承認と同時にWordPressへ予約投稿する(フェーズ2)。まとめて承認しても同日に
  // 複数本公開されないよう、直近の予約枠の翌日を自動計算する。失敗しても承認自体は
  // 成立させ、ステータスはapprovedのまま残す(再度「承認」を押すとリトライできる)。
  const post = getPostById(id);
  const { slot, scheduledDateLabel, withinWindow, streakWarnings } = computeApprovalPreview(post);

  // 季節テーマ由来の記事(publish_window_endがある記事)が、計算された予約日には
  // すでに旬を過ぎている場合、自動投稿はせず人間の確認に戻す(自動での差し替え・
  // 再企画は次段階。安全側に倒し、まず必ず人間が気づける状態にする)。
  if (!withinWindow) {
    const note = `⚠️ 予約日(${scheduledDateLabel})が公開可能期間(〜${post.publish_window_end})を超えています。内容が季節に合っているか確認し、必要なら差し戻すか手動で対応してください。`;
    setStatus(id, 'approved', note);
    await sendTelegram(
      `⚠️ 公開期限超過のため自動投稿を保留しました\n${post.title}\n予約予定日: ${scheduledDateLabel} / 公開可能期限: ${post.publish_window_end}\n${DASHBOARD_URL}`
    );
    return res.json({ ok: true, published: false, reason: 'publish_window_expired' });
  }

  // 愛知県高校入試 情報ソース参照機能: 年度不一致・出典欠落等でblockedと判定された記事は
  // 自動投稿しない(石橋の差し戻しをすり抜けて手動編集された場合等の最終防衛ライン)。
  if (post.exam_validation_status === 'blocked') {
    const note = `⚠️ 愛知県高校入試ファクトチェックでblockedと判定されているため自動投稿を保留しました。内容を確認し、必要なら差し戻すか手動で対応してください。`;
    setStatus(id, 'approved', note);
    await sendTelegram(
      `⚠️ 入試ファクトチェックblockedのため自動投稿を保留しました\n${post.title}\n${DASHBOARD_URL}`
    );
    return res.json({ ok: true, published: false, reason: 'exam_fact_check_blocked' });
  }

  const streakWarningText = streakWarnings.map((w) => `\n⚠️ ${w}`).join('');

  // WordPressへの投稿処理を始める前に通知する(投稿完了後の事後通知ではなく、事前通知)
  await sendTelegram(`📅 記事を承認しました。${scheduledDateLabel} にWordPressで公開予定です\n${post.title}\n${DASHBOARD_URL}${streakWarningText}`);

  let published = false;
  try {
    const result = await publishPost(post, { date: slot.wpDate });
    setScheduled(id, { wpPostId: result.wpPostId, wpLink: result.link, scheduledAt: slot.utcIso });
    published = true;
  } catch (err) {
    logError('wordpress_publish', `${post.title}: ${err.message}`);
    await sendTelegram(`⚠️ WordPress投稿に失敗しました(承認自体は完了。ダッシュボードで再度「承認」を押すとリトライできます)\n${post.title}\n${err.message}`);
  }

  res.json({ ok: true, published, scheduledAt: slot.utcIso, streakWarnings });
});

app.post('/api/posts/:id/reject', (req, res) => {
  const note = (req.body && req.body.reviewer_note) || '';
  const changes = setStatus(Number(req.params.id), 'rejected', note);
  if (changes === 0) return res.status(404).json({ error: 'not_found' });

  // 翌日の智谷(planner-blog-btoc)が差し戻し理由を参照できるよう即時に再生成
  const rows = listRejectedWithNotes(20);
  fs.writeFileSync(path.join(ROOT, 'data', 'rejected_notes.json'), JSON.stringify(rows, null, 2), 'utf8');

  res.json({ ok: true });
});

app.get('/api/summary', (req, res) => {
  const now = new Date();
  const yearMonthPrefix = now.toISOString().slice(0, 7); // YYYY-MM
  const summary = monthlySummary(yearMonthPrefix);

  let errors = [];
  if (fs.existsSync(ERRORS_PATH)) {
    try {
      errors = JSON.parse(fs.readFileSync(ERRORS_PATH, 'utf8')).filter((e) => !e.resolved).slice(0, 10);
    } catch {
      errors = [];
    }
  }

  res.json({ ...summary, month: yearMonthPrefix, errors });
});

// ダッシュボードの「テーマカレンダー」表示用: 指定日から最大366日分の予定テーマを
// 智谷の企画ロジックと同じ優先順位(季節テーマバンク→曜日テーマ)で計算して返す。
// 実際の生成は行わない(あくまで見通し表示)。
app.get('/api/theme-calendar', (req, res) => {
  const days = Math.min(Number(req.query.days) || 365, 366);
  const start = req.query.start || new Date().toISOString().slice(0, 10);
  const calendar = projectThemeCalendar(start, days);
  res.json({ start, days, calendar });
});

app.get('/api/episodes', (req, res) => {
  res.json(listEpisodes());
});

app.post('/api/episodes', (req, res) => {
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  appendEpisode(text);
  res.json({ ok: true });
});

// --- 競合キーワード分析(Keyword Gap Lite) ---
// features.competitor_keyword_analysis.enabled の値に関わらず、既に保存されている
// 候補・競合の確認/承認/除外はできるようにする(分析を止めても過去の候補は確認できる)。

app.get('/api/seo/competitors', (req, res) => {
  res.json(seoDb.listCompetitors());
});

app.get('/api/seo/candidates', (req, res) => {
  const { status, gapType, targetArea, minScore, orderBy } = req.query;
  const candidates = seoDb.listKeywordCandidates({
    status,
    gapType,
    targetArea,
    minPriorityScore: minScore ? Number(minScore) : undefined,
    orderBy,
  });
  res.json(candidates);
});

app.get('/api/seo/candidates/:id', (req, res) => {
  const id = Number(req.params.id);
  const candidate = seoDb.getKeywordCandidateById(id);
  if (!candidate) return res.status(404).json({ error: 'not_found' });
  res.json({
    ...candidate,
    evidence: seoDb.listCandidateEvidence(id),
    existingArticles: seoDb.listCandidateExistingArticles(id),
    statusHistory: seoDb.listCandidateStatusHistory(id),
  });
});

// 承認時にaction(新規記事/既存記事改善/校舎ページ改善のいずれか)を確定させる。
// approved_actionは人間が確定した最終判断であり、recommended_action(機械判定)は上書きしない。
const APPROVABLE_ACTIONS = new Set(['create_article', 'improve_existing_article', 'improve_school_page']);

app.post('/api/seo/candidates/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  if (!seoDb.getKeywordCandidateById(id)) return res.status(404).json({ error: 'not_found' });
  const action = req.body && req.body.action;
  if (!APPROVABLE_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'invalid_action', message: `actionは${[...APPROVABLE_ACTIONS].join('/')}のいずれかを指定してください` });
  }
  const reason = (req.body && req.body.reason) || null;
  const result = seoDb.updateCandidateStatus(
    id,
    { toStatus: 'approved', reason, actor: 'dashboard', approvedAction: action },
    new Date().toISOString()
  );
  res.json({ ok: true, ...result });
});

app.post('/api/seo/candidates/:id/hold', (req, res) => {
  const id = Number(req.params.id);
  if (!seoDb.getKeywordCandidateById(id)) return res.status(404).json({ error: 'not_found' });
  const reason = (req.body && req.body.reason) || null;
  const result = seoDb.updateCandidateStatus(id, { toStatus: 'reviewing', reason, actor: 'dashboard' }, new Date().toISOString());
  res.json({ ok: true, ...result });
});

app.post('/api/seo/candidates/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  if (!seoDb.getKeywordCandidateById(id)) return res.status(404).json({ error: 'not_found' });
  const reason = (req.body && req.body.reason) || null;
  const result = seoDb.updateCandidateStatus(id, { toStatus: 'rejected', reason, actor: 'dashboard' }, new Date().toISOString());
  res.json({ ok: true, ...result });
});

app.post('/api/seo/candidates/:id/queue', (req, res) => {
  const id = Number(req.params.id);
  if (!seoDb.getKeywordCandidateById(id)) return res.status(404).json({ error: 'not_found' });
  try {
    const result = seoDb.updateCandidateStatus(id, { toStatus: 'queued', actor: 'dashboard' }, new Date().toISOString());
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: 'invalid_transition', message: err.message });
  }
});

// --- AI Growth Director(SEO Task) ---
// features.growth_director.enabled の値に関わらず、既に生成済みのTaskの確認/承認/除外は
// できるようにする(競合キーワード候補と同じ方針)。

app.get('/api/growth/tasks', (req, res) => {
  const { status, taskType, orderBy } = req.query;
  res.json(seoDb.listTasks({ status, taskType, orderBy }));
});

app.get('/api/growth/tasks/:id', (req, res) => {
  const task = seoDb.getTaskById(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'not_found' });
  res.json(task);
});

app.post('/api/growth/tasks/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  if (!seoDb.getTaskById(id)) return res.status(404).json({ error: 'not_found' });
  const result = seoDb.updateTaskStatus(id, 'approved', new Date().toISOString());
  res.json({ ok: true, ...result });
});

app.post('/api/growth/tasks/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  if (!seoDb.getTaskById(id)) return res.status(404).json({ error: 'not_found' });
  const result = seoDb.updateTaskStatus(id, 'rejected', new Date().toISOString());
  res.json({ ok: true, ...result });
});

app.listen(PORT, () => {
  console.log(`[api-server] juku-blog dashboard: http://localhost:${PORT}`);
});
