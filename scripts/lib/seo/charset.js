'use strict';

// レスポンスの文字コードを検出してデコードする。日本語の競合サイトはUTF-8以外
// (Shift-JIS/EUC-JP等)で配信されていることが多く、決め打ちUTF-8デコードでは
// title/見出し/本文が文字化けし、キーワード抽出が機能しなくなる。
// Node組み込みのTextDecoder(WHATWG Encoding Standard)で追加npm依存なしに対応する。

function normalizeEncodingName(name) {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  if (lower === 'shift-jis' || lower === 'sjis' || lower === 'shift_jis' || lower === 'x-sjis') return 'shift_jis';
  if (lower === 'euc-jp' || lower === 'eucjp') return 'euc-jp';
  if (lower === 'iso-2022-jp') return 'iso-2022-jp';
  if (lower === 'utf-8' || lower === 'utf8') return 'utf-8';
  return lower;
}

// HTTP Content-Typeヘッダー(例: "text/html;charset=shift_jis")から文字コードを検出する
function detectFromContentType(contentTypeHeader) {
  const match = (contentTypeHeader || '').match(/charset=["']?([\w-]+)/i);
  return match ? normalizeEncodingName(match[1]) : null;
}

// <meta charset="..."> / <meta http-equiv="Content-Type" content="...charset=...">を検出する。
// charset宣言自体は常にASCII範囲の文字のみのため、実際の文字コードに関わらずlatin1で
// 読んでも安全に検出できる(日本語部分が化けても宣言部分の抽出には影響しない)。
function detectFromMetaTag(buffer) {
  const head = buffer.slice(0, 2048).toString('latin1');
  const match = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
  return match ? normalizeEncodingName(match[1]) : null;
}

// HTMLバイト列を文字コード検出の上でデコードする。検出できない/非対応の場合はUTF-8にフォールバックする。
function decodeHtmlBuffer(buffer, contentTypeHeader) {
  const encoding = detectFromContentType(contentTypeHeader) || detectFromMetaTag(buffer) || 'utf-8';
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

module.exports = { decodeHtmlBuffer, normalizeEncodingName, detectFromContentType, detectFromMetaTag };
