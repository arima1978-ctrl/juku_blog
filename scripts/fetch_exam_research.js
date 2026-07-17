'use strict';

// 愛知県高校入試 情報ソース参照機能: 早瀬(researcher-local)の直後・智谷の前に実行する
// 決定的スクリプト(LLM不使用)。今日のネタ候補(data/topics/YYYY-MM-DD.json)が
// 愛知県高校入試関連かを判定し、該当すれば登録済みソースを取得・キャッシュし、
// data/exam_research/YYYY-MM-DD.raw.json に構造化前の生データを出力する。
//
// features.aichi_exam_research.enabled が false の場合は即座に無処理で終了する
// (既存の記事生成フローに一切影響しない)。
//
// 使い方: node scripts/fetch_exam_research.js YYYY-MM-DD

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadJukuConfig } = require('./lib/config');
const { getBranchContext } = require('./lib/branch_context');
const { loadEnabledSources, loadClassificationKeywords, selectSourcesByTags } = require('./lib/exam_research/source_registry');
const { classifyIsExamRelated, extractTagsFromText } = require('./lib/exam_research/topic_classifier');
const { fetchExternalUrl } = require('./lib/exam_research/fetcher');
const { extractFromHtml } = require('./lib/exam_research/html_extract');
const { extractFromPdf } = require('./lib/exam_research/pdf_extract');
const { extractYear, extractYearPreferTitle } = require('./lib/exam_research/year_normalizer');
const { getFresh, saveFetchResult } = require('./lib/exam_research/cache');

// 「次に迎える入試の年度」を決定的に計算する(1-3月は当年、4-12月は翌年が対象年度になる)。
// 智谷/構造化エージェントの既定値として使い、明示的な指定があればそちらを優先する。
function computeDefaultTargetYear(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return m <= 3 ? y : y + 1;
}

const OUT_DIR = path.join(ROOT, 'data', 'exam_research');
// preferCurrentYearPdfLinks()で過去年度のアーカイブを除外した後の件数に対する上限。
// 実際の愛知県教育委員会ページでは当年度分だけで7件前後(Q&A・面接実施・特色選抜・
// 推薦選抜・実施日程・調査書変更等)あるため、5件では日程PDFのような後方リンクが
// 漏れる実例があった。10件あれば当年度分は通常すべて収まる。
const MAX_PDF_LINKS_PER_SOURCE = 10;

function log(msg) {
  console.log(`[fetch_exam_research] ${msg}`);
}

function writeRawOutput(date, payload) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${date}.raw.json`), JSON.stringify(payload, null, 2), 'utf8');
}

// 1件のURL(PDF)を取得・解析・キャッシュ保存し、正規化済みエントリを返す(fromCache無し=新規取得)
async function fetchAndCachePdf(source, pdfUrl, parentUrl, fallbackTitle, nowIso) {
  const pdfResult = await fetchExternalUrl(pdfUrl, { allowedBaseUrls: [source.base_url], sourceId: source.id });
  if (!pdfResult.ok) {
    return {
      sourceUrl: pdfUrl,
      parentUrl,
      contentType: 'pdf',
      documentTitle: fallbackTitle,
      targetYear: null,
      extractedText: null,
      parseStatus: 'fetch_failed',
      errorMessage: pdfResult.reason,
    };
  }
  const parsed = await extractFromPdf(pdfResult.body);
  const documentTitle = (parsed.info && parsed.info.Title) || fallbackTitle;
  const targetYear = extractYearPreferTitle(documentTitle, parsed.ok ? parsed.text : null);
  saveFetchResult({
    sourceId: source.id,
    sourceUrl: pdfUrl,
    parentUrl,
    contentType: 'pdf',
    documentTitle,
    targetYear,
    fetchedAt: nowIso,
    ttlHours: source.ttl_hours,
    httpStatus: pdfResult.statusCode,
    extractedText: parsed.ok ? parsed.text : null,
    rawText: parsed.ok ? parsed.text : null,
    parseStatus: parsed.ok ? 'ok' : 'parse_failed',
    errorMessage: parsed.ok ? null : parsed.reason,
  });
  return {
    sourceUrl: pdfUrl,
    parentUrl,
    contentType: 'pdf',
    documentTitle,
    targetYear,
    extractedText: parsed.ok ? parsed.text : null,
    parseStatus: parsed.ok ? 'ok' : 'parse_failed',
    errorMessage: parsed.ok ? null : parsed.reason,
  };
}

// 対象年度と明確に異なる年度のPDF(例: 令和9年度の記事で令和8年度以前の過去分アーカイブ)を
// 除外する。県教委のページ等は当年度の情報と過去数年分のアーカイブが同一ページに並ぶため、
// リンクテキストに年度の記載が無い場合(当年度の一般的なQ&A等)は除外せず残す。
// この絞り込みをMAX_PDF_LINKS_PER_SOURCEの上限判定より先に行うことで、
// 「本文中の出現順が後ろにあるだけの当年度PDF」が古い年度のPDFに押し出されて
// 上限から漏れることを防ぐ(実際に発生した不具合: 学力検査日程PDFが5件目の枠に入らず欠落)。
function preferCurrentYearPdfLinks(pdfLinks, preferredYear) {
  if (!preferredYear) return pdfLinks;
  return pdfLinks.filter((link) => {
    const year = extractYear(link.linkText);
    return year == null || year === preferredYear;
  });
}

// PDFリンク一覧を、キャッシュが有効なものはキャッシュから、無効なものは新規取得して
// 正規化済みエントリの配列で返す(対象年度以外の過去アーカイブを除外した上で最大
// MAX_PDF_LINKS_PER_SOURCE件)。
async function resolvePdfLinkEntries(source, pdfLinks, nowIso, preferredYear) {
  const filtered = preferCurrentYearPdfLinks(pdfLinks, preferredYear);
  const entries = [];
  for (const pdfLink of filtered.slice(0, MAX_PDF_LINKS_PER_SOURCE)) {
    const cachedPdf = getFresh(pdfLink.url, nowIso);
    if (cachedPdf) {
      entries.push({
        sourceUrl: pdfLink.url,
        parentUrl: source.entry_url,
        contentType: 'pdf',
        documentTitle: cachedPdf.document_title,
        targetYear: cachedPdf.target_year,
        extractedText: cachedPdf.extracted_text,
        parseStatus: cachedPdf.parse_status,
        errorMessage: cachedPdf.error_message,
      });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const entry = await fetchAndCachePdf(source, pdfLink.url, source.entry_url, pdfLink.linkText, nowIso);
    entries.push(entry);
  }
  return entries;
}

// 1ソース(entry_url)を取得する。entry_url自体がHTMLなら、そのページ内のPDFリンクも
// (source.supports_pdfがtrueの場合)あわせて取得・キャッシュする。
// entry_urlがキャッシュ済みでHTMLの場合、raw_text(生HTML)を使ってネットワークアクセス無しで
// PDFリンクを再抽出できるため、TTL内は完全にオフラインで動作する。
async function fetchSourceEntry(source, nowIso, preferredYear) {
  const cached = getFresh(source.entry_url, nowIso);

  if (cached && cached.parse_status === 'ok') {
    log(`${source.id}: キャッシュ有効(HTML取得スキップ) expires_at=${cached.expires_at}`);
    if (cached.content_type === 'pdf') {
      // entry_url自体がPDFの場合、サブリンクという概念が無いためそのまま返す
      return {
        sourceId: source.id,
        sourceUrl: source.entry_url,
        entries: [
          {
            sourceUrl: source.entry_url,
            parentUrl: null,
            contentType: 'pdf',
            documentTitle: cached.document_title,
            targetYear: cached.target_year,
            extractedText: cached.extracted_text,
            parseStatus: cached.parse_status,
            errorMessage: cached.error_message,
          },
        ],
      };
    }

    const htmlEntry = {
      sourceUrl: source.entry_url,
      parentUrl: null,
      contentType: 'html',
      documentTitle: cached.document_title,
      targetYear: cached.target_year,
      extractedText: cached.extracted_text,
      parseStatus: 'ok',
      errorMessage: null,
    };
    const entries = [htmlEntry];
    if (source.supports_pdf) {
      const extracted = extractFromHtml(cached.raw_text || '', source.entry_url);
      entries.push(...(await resolvePdfLinkEntries(source, extracted.pdfLinks, nowIso, preferredYear)));
    }
    return { sourceId: source.id, sourceUrl: source.entry_url, entries };
  }

  const result = await fetchExternalUrl(source.entry_url, { allowedBaseUrls: [source.base_url], sourceId: source.id });
  if (!result.ok) {
    saveFetchResult({
      sourceId: source.id,
      sourceUrl: source.entry_url,
      contentType: null,
      documentTitle: null,
      targetYear: null,
      fetchedAt: nowIso,
      ttlHours: source.ttl_hours,
      httpStatus: result.httpStatus || null,
      extractedText: null,
      rawText: null,
      parseStatus: 'fetch_failed',
      errorMessage: `${result.errorCode}: ${result.reason}`,
    });
    return { sourceId: source.id, sourceUrl: source.entry_url, parseStatus: 'fetch_failed', errorMessage: result.reason };
  }

  const isPdf = result.contentType.includes('application/pdf');

  if (isPdf) {
    const parsed = await extractFromPdf(result.body);
    const documentTitle = (parsed.info && parsed.info.Title) || null;
    const targetYear = extractYearPreferTitle(documentTitle, parsed.ok ? parsed.text : null);
    saveFetchResult({
      sourceId: source.id,
      sourceUrl: source.entry_url,
      parentUrl: null,
      contentType: 'pdf',
      documentTitle,
      targetYear,
      fetchedAt: nowIso,
      ttlHours: source.ttl_hours,
      httpStatus: result.statusCode,
      extractedText: parsed.ok ? parsed.text : null,
      rawText: parsed.ok ? parsed.text : null,
      parseStatus: parsed.ok ? 'ok' : 'parse_failed',
      errorMessage: parsed.ok ? null : parsed.reason,
    });
    return {
      sourceId: source.id,
      sourceUrl: source.entry_url,
      entries: [
        {
          sourceUrl: source.entry_url,
          parentUrl: null,
          contentType: 'pdf',
          documentTitle,
          targetYear,
          extractedText: parsed.ok ? parsed.text : null,
          parseStatus: parsed.ok ? 'ok' : 'parse_failed',
          errorMessage: parsed.ok ? null : parsed.reason,
        },
      ],
    };
  }

  const html = result.body.toString('utf8');
  const extracted = extractFromHtml(html, source.entry_url);
  const targetYear = extractYearPreferTitle(extracted.title, extracted.text);
  saveFetchResult({
    sourceId: source.id,
    sourceUrl: source.entry_url,
    parentUrl: null,
    contentType: 'html',
    documentTitle: extracted.title,
    targetYear,
    fetchedAt: nowIso,
    ttlHours: source.ttl_hours,
    httpStatus: result.statusCode,
    extractedText: extracted.text,
    rawText: html, // PDFリンク再抽出のため生HTMLを保持する(extractedTextはプレーンテキストのみ)
    parseStatus: 'ok',
    errorMessage: null,
  });

  const entries = [
    {
      sourceUrl: source.entry_url,
      parentUrl: null,
      contentType: 'html',
      documentTitle: extracted.title,
      targetYear,
      extractedText: extracted.text,
      parseStatus: 'ok',
      errorMessage: null,
    },
  ];
  if (source.supports_pdf && extracted.pdfLinks.length > 0) {
    entries.push(...(await resolvePdfLinkEntries(source, extracted.pdfLinks, nowIso, preferredYear)));
  }

  return { sourceId: source.id, sourceUrl: source.entry_url, entries };
}

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error('使い方: node scripts/fetch_exam_research.js YYYY-MM-DD');
    process.exit(1);
  }

  // 2026-07-17判明の一連の「branchId無しでconfig/共有パスを読む」バグと同種のため、
  // 校舎コンテキスト(daily_blog.sh <slug>実行時にexportされるJUKU_BRANCH_ID/SLUG)を
  // ここでも解決する。無効化中(既定)は挙動に影響しないが、有効化した際に
  // 早瀬(researcher-local)が書いたbranches/<slug>/topics/配下ではなく共有
  // data/topics/配下を見てしまい、常に「見つからない」扱いになるのを防ぐ。
  const ctx = getBranchContext();
  const config = loadJukuConfig(ctx.isLegacy ? undefined : ctx.branchId);
  if (!config.features || !config.features.aichi_exam_research || !config.features.aichi_exam_research.enabled) {
    log('features.aichi_exam_research.enabled が false のため無処理で終了します');
    process.exit(0);
  }

  const topicsDir = ctx.isLegacy ? path.join(ROOT, 'data', 'topics') : path.join(ctx.dataDir, 'topics');
  const topicsPath = path.join(topicsDir, `${date}.json`);
  if (!fs.existsSync(topicsPath)) {
    log(`${topicsPath} が見つからないため無処理で終了します`);
    process.exit(0);
  }

  const topics = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
  const candidateTexts = topics.flatMap((t) => [t.headline, t.detail, t.category_hint]);
  const branchId = ctx.isLegacy ? undefined : ctx.branchId;
  const classificationKeywords = loadClassificationKeywords(branchId);
  const classification = classifyIsExamRelated(candidateTexts, classificationKeywords);

  if (!classification.isExamRelated) {
    log('本日のネタ候補は愛知県高校入試関連ではないため無処理で終了します');
    process.exit(0);
  }

  log(`愛知県高校入試関連と判定しました(一致キーワード: ${classification.matchedKeywords.join(', ')})`);

  const tags = [...new Set(candidateTexts.flatMap((t) => extractTagsFromText(t)))];
  const sources = selectSourcesByTags(loadEnabledSources(branchId), tags);
  log(`選定したソース: ${sources.map((s) => s.id).join(', ') || '(タグ一致なし。全有効ソースをtier順で使用)'}`);

  const defaultTargetYear = computeDefaultTargetYear(date);
  const nowIso = new Date().toISOString();
  const sourceResults = [];
  for (const source of sources) {
    // eslint-disable-next-line no-await-in-loop
    const result = await fetchSourceEntry(source, nowIso, defaultTargetYear);
    sourceResults.push({ ...result, tier: source.tier, sourceName: source.name });
  }

  const tier1Sources = sources.filter((s) => s.tier === 1).map((s) => s.id);
  const tier1AllFailed =
    tier1Sources.length > 0 &&
    tier1Sources.every((id) => {
      const r = sourceResults.find((sr) => sr.sourceId === id);
      return !r || r.parseStatus === 'fetch_failed' || (r.entries && r.entries.every((e) => e.parseStatus !== 'ok'));
    });

  writeRawOutput(date, {
    date,
    generated_at: nowIso,
    matched_keywords: classification.matchedKeywords,
    tags,
    default_target_year: defaultTargetYear,
    tier1_fetch_failed: tier1AllFailed,
    sources: sourceResults,
  });

  log(`data/exam_research/${date}.raw.json を出力しました(tier1_fetch_failed=${tier1AllFailed})`);
}

main().catch((err) => {
  console.error(`[fetch_exam_research] 予期しないエラー: ${err.message}`);
  process.exit(1);
});
