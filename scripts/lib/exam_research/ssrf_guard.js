'use strict';

// 外部URL取得前のSSRF対策: localhost・プライベートIP・クラウドメタデータIPへの
// アクセスを禁止する。ホスト名の文字列だけでなく実際に解決されたIPを検証することで、
// DNSリバインディング(名前解決後に別IPへ差し替える攻撃)にも対応する。

const dns = require('node:dns').promises;

const METADATA_IPS = new Set(['169.254.169.254']);

function isPrivateOrLoopbackIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return false;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local(メタデータIP含む)
  return false;
}

function isPrivateOrLoopbackIpv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('fe80')) return true; // link-local
  return false;
}

function isDisallowedIp(ip) {
  if (METADATA_IPS.has(ip)) return true;
  if (ip.includes(':')) return isPrivateOrLoopbackIpv6(ip);
  return isPrivateOrLoopbackIpv4(ip);
}

// hostnameが'localhost'等の明示的な禁止名でないか、かつ実際に解決したIPが
// プライベート/ループバック/メタデータでないかを確認する。
// 問題なければ{ ok: true }、問題があれば{ ok: false, reason }を返す。
async function assertUrlIsSafeToFetch(urlString) {
  const url = new URL(urlString);

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `許可されていないプロトコル: ${url.protocol}` };
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'localhostへのアクセスは禁止されています' };
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    return { ok: false, reason: `名前解決に失敗しました: ${err.message}` };
  }

  const disallowed = addresses.find((a) => isDisallowedIp(a.address));
  if (disallowed) {
    return { ok: false, reason: `プライベート/ループバック/メタデータIPへの解決を検知しました: ${disallowed.address}` };
  }

  return { ok: true };
}

// リダイレクト先URLが、許可されたbase_url群のいずれかのドメインに属するかを確認する。
function isAllowedDomain(urlString, allowedBaseUrls) {
  try {
    const host = new URL(urlString).hostname;
    return (allowedBaseUrls || []).some((base) => {
      const baseHost = new URL(base).hostname;
      return host === baseHost || host.endsWith(`.${baseHost}`);
    });
  } catch {
    return false;
  }
}

module.exports = { assertUrlIsSafeToFetch, isAllowedDomain, isDisallowedIp };
