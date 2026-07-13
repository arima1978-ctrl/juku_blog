'use strict';

// 軽量CSVパーサー(RFC4180準拠。追加npm依存を増やさないための自前実装)。
// BOM付きUTF-8・CRLF/LF混在・ダブルクォート内のカンマ/改行/エスケープ("")に対応する。

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// テキスト全体を1セルずつ状態機械でパースし、行(配列)の配列を返す。
// 末尾の空行は無視する。
function parseCsv(text) {
  const input = stripBom(text || '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\r') {
      continue; // \r\nの\rは無視し、\nで改行確定する
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }

  // 最終行(末尾に改行が無い場合)を確定する
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // 完全な空行(1セルのみで空文字)は除外する
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// 1行目をヘッダーとして扱い、{headers, rows: [{header: value, ...}]}を返す。
function parseCsvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], rows: [] };
  const [headers, ...dataRows] = rows;
  const objects = dataRows.map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] !== undefined ? r[i] : '';
    });
    return obj;
  });
  return { headers, rows: objects };
}

module.exports = { parseCsv, parseCsvToObjects, stripBom };
