'use strict';

// バッチ監視(2026-07-27)。cron実行されるバッチ(daily_blog_all.sh/seo_weekly_analysis.sh/
// backup_db.sh等)が「実行され完了した」ことを記録する軽量な生存確認(デッドマンスイッチ)。
// 各バッチはstep単位の失敗有無に関わらず、スクリプト自体が最後まで走った時点で
// recordHeartbeat()を呼ぶ(cronが起動すらしていない・途中で無応答になった、といった
// 「失敗イベントが発火しようがないケース」を、この生存確認の欠落側から検知するため)。

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./config');

// テスト時のみ、JUKU_BLOG_HEARTBEATS_DIR で本番と別ディレクトリを使う。
const HEARTBEATS_DIR = process.env.JUKU_BLOG_HEARTBEATS_DIR || path.join(ROOT, 'logs', 'heartbeats');

function heartbeatPath(name) {
  return path.join(HEARTBEATS_DIR, `${name}.json`);
}

function recordHeartbeat(name, { ok, detail, completedAt } = {}) {
  fs.mkdirSync(HEARTBEATS_DIR, { recursive: true });
  const payload = { name, ok: ok !== false, detail: detail || null, completedAt: completedAt || new Date().toISOString() };
  fs.writeFileSync(heartbeatPath(name), JSON.stringify(payload, null, 2), 'utf8');
  // 成功時はインシデントを即座にクリアする(2026-08-08)。以前はcheck_batch_heartbeats.jsの
  // 次回4時間おきチェックまでクリアが遅れ得たが、daily_blog_all.shが失敗時に自らその場で
  // recordFailureDetection()を呼ぶよう変更した(scripts/notify_batch_failure.js)のに合わせ、
  // 成功時も同じ即時性で対称に扱う。
  if (payload.ok) clearIncident(name);
  return payload;
}

function readHeartbeat(name) {
  const p = heartbeatPath(name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// 監視導入直後の猶予(2026-07-28)。あるバッチのheartbeatがまだ一度も記録されていない場合、
// 「本当に一度も実行されていない」のか「監視導入がそのバッチの実行周期より後だっただけ」かを
// 区別できない。前者は警告すべきだが後者は誤報になる(seo_weekly_analysisが週次のため、
// 監視導入直後の数日間は必ず誤報になっていた実インシデントの再発防止)。
// このJSONファイルは、あるバッチ名を監視対象としてcheck_batch_heartbeats.jsが「初めて
// heartbeat無しの状態を観測した時刻」を1回だけ記録し、以降は上書きしない(=そのバッチの
// 監視が実質的に開始された時刻の代理指標)。
const FIRST_SEEN_PATH = path.join(HEARTBEATS_DIR, '_first_seen.json');

function readFirstSeenMap() {
  if (!fs.existsSync(FIRST_SEEN_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(FIRST_SEEN_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// 既に記録済みのバッチ名は上書きしない(冪等)。新規に観測したバッチ名だけをmapへ追加する。
function recordFirstSeenIfAbsent(names, nowIso) {
  const map = readFirstSeenMap();
  let changed = false;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(map, name)) {
      map[name] = nowIso;
      changed = true;
    }
  }
  if (changed) {
    fs.mkdirSync(HEARTBEATS_DIR, { recursive: true });
    fs.writeFileSync(FIRST_SEEN_PATH, JSON.stringify(map, null, 2), 'utf8');
  }
  return map;
}

// 反復アラートの通算検知回数・連続検知日数(2026-08-08)。8/7・8/8のOAuth失効インシデントで、
// 同一文面のアラートが4時間おきに繰り返されるだけで「これは何日目・何回目の継続障害か」が
// 一目でわからず、深夜の連続配信に紛れて気づかれなかった反省から追加。checkBatches()が
// 問題ありと判定するたびにrecordFailureDetection()を呼んで積み上げ、正常に戻ったら
// clearIncident()で消す(このモジュール自身は障害の解消を検知しないため、呼び出し元
// <check_batch_heartbeats.js>がheartbeat.ok===trueを見て呼ぶ)。
function incidentPath(name) {
  return path.join(HEARTBEATS_DIR, `${name}.incident.json`);
}

function readIncident(name) {
  const p = incidentPath(name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function clearIncident(name) {
  try {
    fs.rmSync(incidentPath(name), { force: true });
  } catch {
    // 既に無ければ無視
  }
}

// JSTの日付(YYYY-MM-DD)。サーバのタイムゾーン設定(TZ環境変数等)に挙動を左右されないよう、
// UTC時刻に9時間を足してからUTC基準のgetterで取り出す(サーバ自体はAsia/Tokyoだが、
// テスト実行環境のTZに依存させたくないため計算で固定する)。
function toJstDateKey(isoOrMs) {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 戻り値のconsecutiveDaysは「検知した日(JST)の異なり数」。detectionCountは検知そのものの
// 通算回数(1日に複数回検知されればその分加算される)。
function recordFailureDetection(name, nowIso = new Date().toISOString()) {
  const existing = readIncident(name) || { firstDetectedAt: nowIso, detectionCount: 0, detectedDates: [] };
  const dateKey = toJstDateKey(nowIso);
  const detectedDates = existing.detectedDates.includes(dateKey) ? existing.detectedDates : [...existing.detectedDates, dateKey];
  const incident = { firstDetectedAt: existing.firstDetectedAt, detectionCount: existing.detectionCount + 1, detectedDates };
  fs.mkdirSync(HEARTBEATS_DIR, { recursive: true });
  fs.writeFileSync(incidentPath(name), JSON.stringify(incident, null, 2), 'utf8');
  return { firstDetectedAt: incident.firstDetectedAt, detectionCount: incident.detectionCount, consecutiveDays: incident.detectedDates.length };
}

module.exports = {
  recordHeartbeat,
  readHeartbeat,
  readFirstSeenMap,
  recordFirstSeenIfAbsent,
  readIncident,
  clearIncident,
  recordFailureDetection,
  HEARTBEATS_DIR,
};
