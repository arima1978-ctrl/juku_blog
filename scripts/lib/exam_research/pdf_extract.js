'use strict';

// pdf-parse v2はクラスベースのAPI(v1のcallable関数とは異なる)。
// https://github.com/mehmet-kozan/pdf-parse#getting-started-with-v2-coming-from-v1
const { PDFParse } = require('pdf-parse');

// PDFバイナリからテキストを抽出する。抽出失敗時は例外を投げず
// { ok: false, reason } を返す(画像PDF等でテキストが取れない場合も同様に扱う)。
async function extractFromPdf(buffer) {
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
    // getInfo/getTextを並列実行すると内部のバッファ転送処理が競合し失敗するため、
    // 直列に呼び出す(実際に発生した不具合: "Cannot transfer object of unsupported type.")
    const textResult = await parser.getText();
    const info = await parser.getInfo();
    const text = (textResult.text || '').trim();
    if (!text) {
      return { ok: false, reason: 'テキストを抽出できませんでした(画像PDFの可能性)' };
    }
    return { ok: true, text, numPages: textResult.total || null, info: (info && info.info) || {} };
  } catch (err) {
    return { ok: false, reason: `PDF解析に失敗しました: ${err.message}` };
  } finally {
    if (parser) await parser.destroy();
  }
}

module.exports = { extractFromPdf };
