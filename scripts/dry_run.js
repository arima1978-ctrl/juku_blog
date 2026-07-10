'use strict';

// 実際にWordPressへ投稿・DBへ登録せず、指定日(省略時は今日)の記事が承認された場合に
// 何が起きるかを確認するための診断スクリプト。副作用は一切ない(読み取りのみ)。
//
// 使い方: node scripts/dry_run.js [YYYY-MM-DD]
// (daily_blog.shの生成が完了した後、承認前の最終確認として実行する想定)

const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .env が無い場合はWordPress関連のセクションのみ確認不可として表示する
}

const { findDraftForDate } = require('./lib/draft');
const { loadJukuConfig } = require('./lib/config');
const { computeNextScheduleSlot, isWithinPublishWindow, checkStreak } = require('./lib/schedule');
const { getLatestScheduleDate, getRecentScheduledValues } = require('./lib/db');
const { checkWordPressTargetDryRun, resolveTagCandidates } = require('./lib/wordpress');

function todayStr() {
  // JST運用のため、cronから呼ぶ場合はサーバーのローカル日付(JST)がそのまま today になる。
  // 手動で別日を確認したい場合は引数でYYYY-MM-DDを指定する。
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const date = process.argv[2] || todayStr();
  console.log(`=== dry-run: ${date}(WordPressへの投稿・DBへの登録は一切行いません) ===\n`);

  const draft = findDraftForDate(date);
  if (!draft) {
    console.log(`data/drafts/${date}-*.md が見つかりません。まだ生成されていない可能性があります。`);
    process.exitCode = 1;
    return;
  }
  const fm = draft.frontmatter;

  console.log('■ 記事');
  console.log(`  タイトル: ${fm.title}`);
  console.log(`  カテゴリー: ${fm.category} / 対象読者: ${fm.target_audience}`);
  console.log(`  パイプライン内部ステータス: ${fm.status}`);

  const pr = fm.plan_rationale || {};
  console.log('\n■ 企画採用理由・採点(智谷)');
  console.log(`  合計点: ${pr.selection_score ?? '-'}点`);
  if (pr.selection_score_breakdown) {
    const b = pr.selection_score_breakdown;
    console.log(
      `  内訳: 検索意図${b.search_intent_match ?? '-'} / 地域性${b.local_relevance ?? '-'} / 季節性${b.seasonality ?? '-'} / 悩み${b.reader_concern_strength ?? '-'} / 差別化${b.differentiation ?? '-'} / 素材${b.material_availability ?? '-'}`
    );
  }
  console.log(`  採用理由: ${pr.selection_reasons || '-'}`);
  console.log(`  検索意図: ${pr.search_intent || '-'}`);
  console.log(`  地域との関連: ${pr.local_connection || '-'}`);
  console.log(`  過去記事との違い: ${pr.difference_from_past_posts || '-'}`);

  console.log('\n■ 過去記事との類似度チェック');
  const sc = fm.similarity_check;
  if (sc && sc.matched_post_id !== null && sc.matched_post_id !== undefined) {
    console.log(`  is_duplicate: ${sc.is_duplicate}(最高類似度${sc.highest_score}, id=${sc.matched_post_id} "${sc.matched_title}")`);
  } else {
    console.log('  類似する過去記事なし(または未実行)');
  }

  console.log('\n■ 出典');
  console.log(`  エピソード: ${(fm.episode_sources || []).join(', ') || 'なし'}`);
  console.log(`  保護者Q&A: ${(fm.parent_qa_sources || []).join(', ') || 'なし'}`);
  console.log(`  Web出典: ${(fm.web_sources || []).length}件`);
  if (fm.citation_check) {
    console.log(`  出典ID検証: ok=${fm.citation_check.ok}`);
  }

  console.log('\n■ 公開可能期間');
  console.log(`  季節テーマID: ${fm.seasonal_topic_id || 'なし(通常記事)'}`);
  console.log(`  公開期限: ${fm.publish_window_end || 'なし'}`);

  console.log('\n■ 予約予定日時');
  const config = loadJukuConfig();
  const runTime = (config.generation && config.generation.run_time) || '05:00';
  const latest = getLatestScheduleDate();
  const slot = computeNextScheduleSlot(latest, runTime);
  const withinWindow = isWithinPublishWindow(slot.dateOnly, fm.publish_window_end);
  console.log(`  予約予定日: ${slot.dateOnly} ${runTime}(JST)`);
  console.log(`  公開期限内か: ${withinWindow ? 'OK' : '❌ 期限超過(承認しても自動投稿されず人間確認になります)'}`);

  const maxCategoryStreak = (config.generation && config.generation.max_same_category_streak) || 0;
  const maxAudienceStreak = (config.generation && config.generation.max_same_audience_streak) || 0;
  const categoryStreak = checkStreak(getRecentScheduledValues('category', maxCategoryStreak || 10), fm.category, maxCategoryStreak);
  const audienceStreak = checkStreak(
    getRecentScheduledValues('target_audience', maxAudienceStreak || 10),
    fm.target_audience,
    maxAudienceStreak
  );
  if (categoryStreak.warn) console.log(`  ⚠️ カテゴリー「${fm.category}」が${categoryStreak.streak}日連続になります`);
  if (audienceStreak.warn) console.log(`  ⚠️ 対象読者「${fm.target_audience}」が${audienceStreak.streak}日連続になります`);
  if (!categoryStreak.warn && !audienceStreak.warn) console.log('  連続警告なし');

  console.log('\n■ CTA(赤羽)');
  const ctaType = fm.cta_type;
  const ctaConf = config.juku && config.juku.cta_types && config.juku.cta_types[ctaType];
  console.log(`  種別: ${ctaType || '未設定'}`);
  console.log(`  文言: ${ctaConf ? ctaConf.label : '⚠️ config/juku.yamlにこのcta_typeが見つかりません'}`);

  console.log('\n■ WordPress事前検証(投稿はしません)');
  try {
    const wpCheck = await checkWordPressTargetDryRun();
    console.log(`  投稿者: ${wpCheck.authorCheck.ok ? 'OK' : `❌ ${wpCheck.authorCheck.reason}`}`);
    console.log(
      `  カテゴリー: ${wpCheck.categoryCheck.ok ? (wpCheck.categoryCheck.skipped ? 'OK(未設定のためスキップ)' : 'OK') : `❌ ${wpCheck.categoryCheck.reason}`}`
    );
  } catch (err) {
    console.log(`  確認できませんでした(.env未設定等): ${err.message}`);
  }

  console.log('\n■ タグ候補(投稿はしません)');
  try {
    const tags = await resolveTagCandidates(Array.isArray(fm.keywords) ? fm.keywords.join(',') : fm.keywords || '');
    if (tags.length === 0) {
      console.log('  キーワードなし');
    } else {
      for (const t of tags) {
        console.log(`  ${t.name}: ${t.found ? `既存タグあり(id=${t.tagId})` : '既存タグなし(付与されません)'}`);
      }
    }
  } catch (err) {
    console.log(`  確認できませんでした(.env未設定等): ${err.message}`);
  }

  console.log('\n■ アイキャッチメタデータ(実画像生成は未実装)');
  if (fm.eyecatch) {
    console.log(`  テンプレート: ${fm.eyecatch.template || '-'}`);
    console.log(`  見出し: ${fm.eyecatch.headline || '-'} / ${fm.eyecatch.subheadline || '-'}`);
    console.log(`  alt: ${fm.eyecatch.alt || '-'}`);
  } else {
    console.log('  未設定(このdraftは赤羽のアイキャッチ生成より前に作られた可能性があります)');
  }

  console.log('\n=== dry-run完了 ===');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[dry_run] 予期しないエラー:', err);
    process.exitCode = 1;
  });
}

module.exports = { main };
