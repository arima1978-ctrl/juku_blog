'use strict';

// 競合サイトの取得(sitemap優先、無ければstart_urlからの内部リンク探索)。
// features.competitor_keyword_analysis.enabled と .crawl_enabled が両方trueの場合のみ動作する。
// 1競合の失敗は他競合の処理を止めない。取得本文はDBに入れずdata/seo/pages/配下に保存する
// (DB肥大化を避けるため。DBにはメタデータ・見出し・ハッシュのみ保持)。
//
// 複数校舎対応(Keyword Gap Lite): 校舎ごとにダッシュボード登録済みの競合だけを対象に
// するため、引数なし実行時は全校舎を1校舎ずつ処理する(main()参照)。
//
// 使い方:
//   node scripts/seo_competitor_crawl.js [--dry-run] [--competitor=<id>]        # 全校舎を順に処理
//   node scripts/seo_competitor_crawl.js --branch <id> [--dry-run] [--competitor=<id>]  # 指定校舎のみ(デバッグ用)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadJukuConfig, loadSeoCompetitorsConfig, ROOT } = require('./lib/config');
const seoDb = require('./lib/seo_db');
const branchesDb = require('./lib/branches_db');
const { fetchExternalUrl } = require('./lib/seo/fetcher');
const { extractFromHtml } = require('./lib/seo/html_extract');
const { resolveCanonicalUrl } = require('./lib/seo/url_normalize');
const { parseSitemapXml } = require('./lib/seo/sitemap_parser');
const { buildCrawlQueue } = require('./lib/seo/crawl_frontier');
const { decodeHtmlBuffer } = require('./lib/seo/charset');
const { logError } = require('./log_error');

const PAGES_DIR = path.join(ROOT, 'data', 'seo', 'pages');

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const competitorArg = argv.find((a) => a.startsWith('--competitor='));
  const competitorId = competitorArg ? competitorArg.split('=')[1] : null;
  const branchArgIndex = argv.indexOf('--branch');
  const branchId = branchArgIndex !== -1 ? Number(argv[branchArgIndex + 1]) : null;
  return { dryRun, competitorId, branchId };
}

function contentHashOf(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

function savePageBody(hash, bodyText) {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  fs.writeFileSync(path.join(PAGES_DIR, `${hash}.txt`), bodyText, 'utf8');
}

async function fetchSitemapLocs(sitemapUrl, fetchOptions) {
  const result = await fetchExternalUrl(sitemapUrl, fetchOptions);
  if (!result.ok) return [];
  const parsed = parseSitemapXml(result.body.toString('utf8'));
  if (parsed.type === 'urlset') return parsed.locs;
  if (parsed.type === 'index') {
    const nested = [];
    for (const loc of parsed.locs) {
      // eslint-disable-next-line no-await-in-loop
      const sub = await fetchSitemapLocs(loc, fetchOptions);
      nested.push(...sub);
    }
    return nested;
  }
  return [];
}

async function crawlCompetitor(competitor, seoConfig, dryRun) {
  const fetchOptions = {
    allowedBaseUrls: [`https://${competitor.domain}/`],
    userAgent: seoConfig.user_agent,
    timeoutMs: seoConfig.request_timeout_ms,
    intervalMs: seoConfig.request_interval_ms,
    maxRetries: seoConfig.max_retries,
  };
  const maxPages = competitor.max_pages || seoConfig.max_pages_per_site;

  const stats = { pages_fetched: 0, pages_new: 0, pages_updated: 0, pages_unchanged: 0, pages_skipped: 0, robots_disallowed_count: 0, error_count: 0 };

  // start_urlがトップページ("/")の場合のみsitemap.xmlの自動探索を行う。特定の支店・
  // 校舎ページ等、深い階層のURLがstart_urlに指定されている場合は、サイト全体の
  // sitemap(大手チェーンだと数百〜数千URL)を辿ると対象ページがmax_pagesの予算内に
  // 収まらないことがあるため、明示的な意図(この特定ページ配下だけを見たい)を優先し、
  // sitemap自動探索をスキップしてstart_urlからの内部リンク探索のみ行う。
  const startUrlIsRoot = competitor.start_url ? new URL(competitor.start_url).pathname === '/' : false;

  let sitemapLocs = [];
  if (competitor.sitemap_url) {
    sitemapLocs = await fetchSitemapLocs(competitor.sitemap_url, fetchOptions);
  } else if (competitor.start_url && startUrlIsRoot) {
    sitemapLocs = await fetchSitemapLocs(new URL('/sitemap.xml', `https://${competitor.domain}/`).toString(), fetchOptions);
  }

  let discoveredLinks = [];
  if (sitemapLocs.length === 0 && competitor.start_url) {
    const startResult = await fetchExternalUrl(competitor.start_url, fetchOptions);
    if (startResult.ok && startResult.contentType.includes('html')) {
      const extracted = extractFromHtml(decodeHtmlBuffer(startResult.body, startResult.contentType), competitor.start_url);
      discoveredLinks = extracted.links;
    }
  }

  const queue = buildCrawlQueue({
    sitemapLocs,
    startUrl: competitor.start_url,
    discoveredLinks,
    domain: competitor.domain,
    maxPages,
  });

  const nowIso = new Date().toISOString();

  for (const url of queue) {
    // eslint-disable-next-line no-await-in-loop
    const result = await fetchExternalUrl(url, fetchOptions);
    stats.pages_fetched += 1;

    if (!result.ok) {
      if (result.errorCode === 'ROBOTS_DISALLOWED') stats.robots_disallowed_count += 1;
      else stats.error_count += 1;
      continue;
    }
    if (!result.contentType.includes('html')) {
      stats.pages_skipped += 1;
      continue;
    }

    const html = decodeHtmlBuffer(result.body, result.contentType);
    const extracted = extractFromHtml(html, url);
    const canonicalUrl = resolveCanonicalUrl(result.finalUrl || url, extracted.canonicalUrl);
    const hash = contentHashOf(extracted.bodyText);

    if (dryRun) {
      console.log(`[seo_competitor_crawl][dry-run] ${competitor.id}: ${canonicalUrl} title="${extracted.title}"`);
      continue;
    }

    const pageResult = seoDb.upsertCompetitorPage(
      {
        competitor_id: competitor.id,
        url,
        canonical_url: canonicalUrl,
        http_status: result.statusCode,
        content_type: result.contentType,
        title: extracted.title,
        meta_description: extracted.metaDescription,
        fetched_at: nowIso,
        content_hash: hash,
        robots_allowed: true,
      },
      nowIso
    );

    if (pageResult.isNew) stats.pages_new += 1;
    else if (pageResult.wasUnchanged) stats.pages_unchanged += 1;
    else stats.pages_updated += 1;

    if (pageResult.isNew || !pageResult.wasUnchanged) {
      savePageBody(hash, extracted.bodyText);
      seoDb.replacePageHeadings(pageResult.id, extracted.headings, nowIso);
    }
  }

  return stats;
}

// コア処理(テスト容易性・API層からの呼び出しのため、process.exitを含まない形で分離)。
// branchIdを明示指定した場合(ダッシュボード/API経由): config/seo_competitors.yamlは
// 参照せず、その校舎がDBへ直接登録した競合(seoDb.listCompetitors({branchId}))のみを
// 対象にする(YAMLは既存の小幡校向け設定であり、他校舎の競合と混ざらないようにするため)。
// branchId未指定の場合(CLI/週次cron): 既存どおりconfig/seo_competitors.yamlを参照し、
// 現在アクティブな校舎へ同期する(挙動は完全に従来通り)。
async function resolveCompetitorCrawl({ dryRun = false, competitorId, branchId, seoDbImpl = seoDb, branchesDbImpl = branchesDb } = {}) {
  const config = loadJukuConfig();
  const feature = config.features && config.features.competitor_keyword_analysis;

  if (!feature || !feature.enabled || !feature.crawl_enabled) {
    return { ok: false, reason: 'feature_disabled', summary: [] };
  }

  const seoConfig = config.seo.competitor_analysis;
  const nowIso = new Date().toISOString();

  let targets;
  if (branchId !== undefined && branchId !== null) {
    targets = seoDbImpl
      .listCompetitors({ branchId, crawlEnabledOnly: true })
      .filter((c) => !competitorId || c.id === competitorId);
  } else {
    const competitorsConfig = loadSeoCompetitorsConfig();
    targets = (competitorsConfig.competitors || [])
      .filter((c) => c.crawl_enabled !== false)
      .filter((c) => !competitorId || c.id === competitorId);

    if (!dryRun) {
      // 複数校舎管理: 「1競合は1校舎に紐づく」という単純化(config/seo_competitors.yaml
      // 自体はフェーズ3対象外で校舎別に分離しないため、legacy校舎に紐づける)。
      // 2026-07-20判明: getActiveBranch()(ダッシュボードの可変な表示校舎トグル)ではなく
      // getEarliestBranch()を使う(sync_draft_to_db.jsと同じ実インシデントの回帰防止)。
      const earliestBranch = branchesDbImpl.getEarliestBranch();
      targets.forEach((c) => seoDbImpl.upsertCompetitor({ ...c, branch_id: earliestBranch ? earliestBranch.id : null }, nowIso));
    }
  }

  if (targets.length === 0) {
    return { ok: true, reason: 'no_targets', summary: [] };
  }

  const summary = [];
  for (const competitor of targets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const stats = await crawlCompetitor(competitor, seoConfig, dryRun);
      if (!dryRun) seoDbImpl.recordCompetitorCrawlSuccess(competitor.id, new Date().toISOString());
      summary.push({ competitor: competitor.id, name: competitor.name, ok: true, ...stats });
      console.log(`[seo_competitor_crawl] ${competitor.id}: ${JSON.stringify(stats)}`);
    } catch (err) {
      if (!dryRun) seoDbImpl.recordCompetitorCrawlError(competitor.id, new Date().toISOString(), err.message);
      logError('seo_competitor_crawl', `${competitor.id}: ${err.message}`, competitor.branch_id ?? branchId ?? null);
      console.error(`[seo_competitor_crawl] ${competitor.id} で失敗しましたが他の競合の処理を継続します: ${err.message}`);
      summary.push({ competitor: competitor.id, name: competitor.name, ok: false, error: err.message });
    }
  }

  return { ok: true, dryRun, summary };
}

// 校舎ごとにダッシュボード登録済みの競合(seo_competitors.branch_id)だけを対象にするため、
// 全校舎を1校舎ずつ順に処理する。--branch <id> 指定時はその校舎のみ処理する(デバッグ用)。
// 1校舎の失敗は他校舎の処理を止めず、いずれかが失敗していればexit codeを非ゼロにする
// (cronでの検知用)。
async function main() {
  const { dryRun, competitorId, branchId } = parseArgs(process.argv.slice(2));

  const targets = branchId ? [branchesDb.getBranchById(branchId)].filter(Boolean) : branchesDb.listBranches();
  if (branchId && targets.length === 0) {
    console.error(`[seo_competitor_crawl] branch_id=${branchId} に該当する校舎が見つかりません`);
    process.exitCode = 1;
    return;
  }

  for (const branch of targets) {
    console.log(`=== ${branch.name} (branchId=${branch.id}, area=${branch.target_area || '未設定'}) ===`);
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await resolveCompetitorCrawl({ dryRun, competitorId, branchId: branch.id });

      if (result.reason === 'feature_disabled') {
        console.log('[seo_competitor_crawl] competitor_keyword_analysis.enabled または crawl_enabled が false のため無処理で終了します');
        return; // 全校舎共通の設定のため、これ以降のループも同じ結果になる
      }
      if (result.reason === 'no_targets') {
        console.log(`[seo_competitor_crawl] ${branch.name}: 対象の競合が登録されていません`);
        continue;
      }

      console.log(`[seo_competitor_crawl] ${branch.name} 完了(dry-run=${dryRun}): ${JSON.stringify(result.summary)}`);
    } catch (err) {
      console.error(`[seo_competitor_crawl] ${branch.name}(branchId=${branch.id})で失敗しましたが他校舎の処理を継続します: ${err.message}`);
      logError('seo_competitor_crawl', `branchId=${branch.id}: ${err.message}`, branch.id);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[seo_competitor_crawl] 予期しないエラー: ${err.message}`);
    logError('seo_competitor_crawl', err.message);
    process.exit(1);
  });
}

module.exports = { main, crawlCompetitor, resolveCompetitorCrawl };
