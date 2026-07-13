'use strict';

// Keyword Gap判定。完全一致だけで判定せず、呼び出し側が正規化キーワード・地域/学校/
// 学年/教科軸で事前に名寄せした上でこの関数に渡すこと。
// データ不足の場合に推測でstrong判定しないことを最優先する(根拠の無い高評価を避ける)。

const LOW_CTR_THRESHOLD = 0.02; // 表示回数はあるがクリック率2%未満は「弱い」signalとして扱う
const WEAK_POSITION_THRESHOLD = 11; // 11位以下(2ページ目以降)は弱いsignal
const STRONG_POSITION_THRESHOLD = 10; // 10位以内なら強いsignalの候補

// input:
//   competitorCount: このキーワード/テーマを扱っている競合数
//   totalCompetitorsConsidered: 分析対象の登録競合総数(未指定なら「全社 or 該当社数のみ」の判定はしない)
//   ownHasArticle: 自社に関連記事があるか
//   ownAvgPosition / ownImpressions / ownClicks / ownCtr: 自社のSearch Console実績(無ければnull)
//   competitorBestPosition: 競合の最良順位(CSV/手動登録があれば。無ければnull)
//   ownContentThinnerThanCompetitor: 自社記事が競合より情報量で劣ると判定できればtrue/false、不明ならnull
//   matchType: 'exact'(キーワード完全一致相当) | 'theme'(テーマ単位、content_gap候補)
//
// 戻り値: { gapType, reasons } (gapTypeは根拠が無い場合null。呼び出し側はnullを候補生成対象から除外する)
function classifyKeywordGap(input) {
  const {
    competitorCount = 0,
    totalCompetitorsConsidered,
    ownHasArticle = false,
    ownAvgPosition = null,
    ownImpressions = null,
    ownClicks = null,
    ownCtr = null,
    competitorBestPosition = null,
    ownContentThinnerThanCompetitor = null,
    matchType = 'exact',
  } = input;

  const reasons = [];

  if (matchType === 'theme' && !ownHasArticle) {
    return { gapType: 'content_gap', reasons: ['theme_covered_by_competitors_not_by_own'] };
  }

  const hasOwnPresence = ownHasArticle || ownAvgPosition != null || (ownImpressions != null && ownImpressions > 0);

  if (!hasOwnPresence) {
    if (competitorCount === 0) {
      return { gapType: null, reasons: ['no_evidence_either_side'] };
    }
    if (totalCompetitorsConsidered != null && competitorCount < totalCompetitorsConsidered) {
      return { gapType: 'untapped', reasons: ['some_competitors_cover_own_absent'] };
    }
    return { gapType: 'missing', reasons: ['competitors_cover_own_absent'] };
  }

  // ここから自社に何らかの存在感(記事 or 検索実績)がある場合
  if (ownAvgPosition != null && ownAvgPosition >= WEAK_POSITION_THRESHOLD) {
    reasons.push('own_avg_position_11_or_worse');
  }
  if (competitorBestPosition != null && ownAvgPosition != null && competitorBestPosition < ownAvgPosition) {
    reasons.push('competitor_outranks_own');
  }
  if (ownImpressions != null && ownImpressions > 0 && ownCtr != null && ownCtr < LOW_CTR_THRESHOLD) {
    reasons.push('impressions_present_but_low_ctr');
  }
  if (ownContentThinnerThanCompetitor === true) {
    reasons.push('own_content_thinner_than_competitor');
  }

  if (reasons.length > 0) {
    return { gapType: 'weak', reasons };
  }

  if (competitorCount > 0) {
    const ownIsStrong =
      ownAvgPosition != null &&
      ownAvgPosition <= STRONG_POSITION_THRESHOLD &&
      (competitorBestPosition == null || ownAvgPosition < competitorBestPosition);
    if (ownIsStrong) {
      return { gapType: 'strong', reasons: ['own_top10_and_not_behind_competitor'] };
    }
    return { gapType: 'shared', reasons: ['both_present_no_clear_advantage'] };
  }

  // 競合データが無い(competitorCount=0)まま自社のみ存在感がある場合。
  // 順位データが無ければ推測でstrongにしない(データ不足時はshared=中立に倒す)。
  if (ownAvgPosition != null && ownAvgPosition <= STRONG_POSITION_THRESHOLD) {
    return { gapType: 'strong', reasons: ['own_top10_no_competitor_data'] };
  }
  return { gapType: 'shared', reasons: ['own_present_no_competitor_evidence'] };
}

module.exports = { classifyKeywordGap, LOW_CTR_THRESHOLD, WEAK_POSITION_THRESHOLD, STRONG_POSITION_THRESHOLD };
