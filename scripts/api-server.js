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
  getLatestScheduleDate,
  listRejectedWithNotes,
  monthlySummary,
} = require('./lib/db');
const { listEpisodes, appendEpisode } = require('./lib/episodes');
const { ROOT, loadJukuConfig } = require('./lib/config');
const { publishPost } = require('./lib/wordpress');
const { sendTelegram } = require('./lib/telegram');
const { logError } = require('./log_error');

const PORT = process.env.PORT || 3013;
const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${PORT}`;
const ERRORS_PATH = path.join(ROOT, 'logs', 'errors.json');

// ダッシュボードの確認が不定期でも、承認をまとめて行った際に同日に複数本
// 公開されないよう、直近の予約済み/公開済み日の翌日を次の枠として予約投稿する。
// (このサイトはJST運用のため、WordPressの`date`フィールドにはJSTのwall-clockを渡す)
function computeNextScheduleSlot() {
  const config = loadJukuConfig();
  const runTime = (config.generation && config.generation.run_time) || '05:00';
  const [hh, mm] = runTime.split(':');

  const toJstDay = (d) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const now = new Date();
  const latest = getLatestScheduleDate();

  let baseDay = latest ? toJstDay(new Date(latest)) : toJstDay(now);
  const todayJstDay = toJstDay(now);
  if (baseDay < todayJstDay) baseDay = todayJstDay;

  const nextDay = new Date(`${baseDay}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().slice(0, 10);

  return {
    wpDate: `${nextDayStr}T${hh}:${mm}:00`,
    utcIso: new Date(`${nextDayStr}T${hh}:${mm}:00+09:00`).toISOString(),
  };
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
  let factCheckReport = null;
  if (post.fact_check_report) {
    try {
      factCheckReport = JSON.parse(post.fact_check_report);
    } catch {
      factCheckReport = { raw: post.fact_check_report };
    }
  }
  res.json({ ...post, fact_check_report_parsed: factCheckReport });
});

app.post('/api/posts/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  const changes = setStatus(id, 'approved', null);
  if (changes === 0) return res.status(404).json({ error: 'not_found' });

  // 承認と同時にWordPressへ予約投稿する(フェーズ2)。まとめて承認しても同日に
  // 複数本公開されないよう、直近の予約枠の翌日を自動計算する。失敗しても承認自体は
  // 成立させ、ステータスはapprovedのまま残す(再度「承認」を押すとリトライできる)。
  const post = getPostById(id);
  const slot = computeNextScheduleSlot();
  const scheduledDateLabel = slot.wpDate.slice(0, 10);

  // WordPressへの投稿処理を始める前に通知する(投稿完了後の事後通知ではなく、事前通知)
  await sendTelegram(`📅 記事を承認しました。${scheduledDateLabel} にWordPressで公開予定です\n${post.title}\n${DASHBOARD_URL}`);

  let published = false;
  try {
    const result = await publishPost(post, { date: slot.wpDate });
    setScheduled(id, { wpPostId: result.wpPostId, wpLink: result.link, scheduledAt: slot.utcIso });
    published = true;
  } catch (err) {
    logError('wordpress_publish', `${post.title}: ${err.message}`);
    await sendTelegram(`⚠️ WordPress投稿に失敗しました(承認自体は完了。ダッシュボードで再度「承認」を押すとリトライできます)\n${post.title}\n${err.message}`);
  }

  res.json({ ok: true, published, scheduledAt: slot.utcIso });
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

app.get('/api/episodes', (req, res) => {
  res.json(listEpisodes());
});

app.post('/api/episodes', (req, res) => {
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  appendEpisode(text);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[api-server] juku-blog dashboard: http://localhost:${PORT}`);
});
