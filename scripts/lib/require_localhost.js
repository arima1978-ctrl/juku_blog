'use strict';

// Sprint 4.0: api-server.jsには認証機構が無いため、状態を変更するエンドポイント
// (週次提案の承認等)は、リクエスト送信元がループバックアドレス以外の場合に
// 403で遮断するミドルウェアで保護する。単体テストで非ローカルホストのケースを
// 決定的に検証できるよう、Expressミドルウェアとは独立した関数として切り出す。

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocalhostIp(ip) {
  return LOCALHOST_IPS.has(ip);
}

function requireLocalhost(req, res, next) {
  // 本番環境(Nginx+Basic認証+HTTPS配下)では、塾長がどこからでも承認操作を行える必要が
  // あるため、環境変数ALLOW_REMOTE_APPROVE=trueが設定されている場合のみIP判定をスキップ
  // する。このバイパスはBasic認証がサイト全体を保護している前提の運用フラグであり、
  // 開発環境(.envにこの変数が無い)では従来通りループバックアドレス限定のままになる。
  if (process.env.ALLOW_REMOTE_APPROVE === 'true') {
    next();
    return;
  }

  const ip = req.ip || (req.socket && req.socket.remoteAddress);
  if (!isLocalhostIp(ip)) {
    res.status(403).json({ error: 'forbidden_non_localhost' });
    return;
  }
  next();
}

module.exports = { requireLocalhost, isLocalhostIp, LOCALHOST_IPS };
