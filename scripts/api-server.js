'use strict';

// フェーズ1のダッシュボード用簡易APIサーバー。
// dashboard.html を静的配信しつつ、承認/差し戻し/エピソード追加を受け付ける。
// 起動: node scripts/api-server.js (既定ポート3013。PORT環境変数で変更可)

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const {
  listPosts,
  getPostById,
  setStatus,
  listRejectedWithNotes,
  monthlySummary,
} = require('./lib/db');
const { listEpisodes, appendEpisode } = require('./lib/episodes');
const { ROOT } = require('./lib/config');

const PORT = process.env.PORT || 3013;
const ERRORS_PATH = path.join(ROOT, 'logs', 'errors.json');

const app = express();
app.use(express.json());
app.use(express.static(ROOT, { index: 'dashboard.html' }));

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

app.post('/api/posts/:id/approve', (req, res) => {
  const changes = setStatus(Number(req.params.id), 'approved', null);
  if (changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
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
