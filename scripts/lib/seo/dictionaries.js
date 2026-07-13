'use strict';

// キーワード抽出用の辞書。地域名・学校名は塾ごとに異なる(config/juku.yamlの
// area設定から動的に組み立てる。ハードコード禁止)。学年・教科・指導形態・検索意図・
// 除外語は日本の学習塾業界に共通する固定語彙のため、ここに列挙する。

const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3'];

const SUBJECTS = ['国語', '算数', '数学', '英語', '理科', '社会', '英会話'];

const TEACHING_STYLES = ['集団指導', '個別指導', '自立学習'];

// 複合キーワード生成(compound_keyword_builder.js)の「塾」スロット用の一般語。
// 指導形態(TEACHING_STYLES)とは別に、単に「塾」であることを示す語として扱う。
const SERVICE_TERMS = ['塾', '学習塾'];

const EXAM_TERMS = [
  '高校入試', '高校受験', '中学受験', '定期テスト', '内申点', '通知表',
  '夏期講習', '冬期講習', '春期講習', '体験授業', '無料体験',
];

// 検索意図が強い(問い合わせに繋がりやすい)語句。優先度スコアの加点対象。
const HIGH_INTENT_TERMS = [
  '塾', '学習塾', '個別指導', '料金', '月謝', '無料体験', '体験授業',
  '夏期講習', '冬期講習', '春期講習', '高校受験', '高校入試', '定期テスト対策',
  '口コミ', '塾選び', '勉強方法', '学習習慣', '英検', '漢検', '数検',
  'プログラミング', 'そろばん', '英会話',
];

// 優先度スコアを下げる語句(求人・対象外サービス等)。
const LOW_INTENT_TERMS = ['求人', 'アルバイト', '講師募集', '採用', '教材販売'];

// URL Allocator(scripts/lib/seo/url_allocator.js)がFAQ追加を判定するための語句。
// 料金・手続き等の業務案内的な検索は、ブログ記事より既存ページのFAQ追加で対応する方が適切なため。
const FAQ_TERMS = ['料金', '月謝', '入塾金', 'アクセス', '送迎', '振替'];

// 一般語との混同を避けるための除外語(競合塾名はconfig/seo_competitors.yamlの
// nameを別途動的に追加すること。ここには入れない)。
const GENERIC_EXCLUSION_TERMS = ['プライバシーポリシー', '利用規約', '会社概要', '講師紹介'];

function buildAreaDictionary(jukuConfig) {
  const area = jukuConfig.area || {};
  const city = area.city || null;
  // "名古屋市守山区"のような市区連結表記から区名単体も辞書化する
  // (ページ上では「守山区」単体で言及されることが多いため)。
  const wardMatch = city ? city.match(/市([一-龥]{1,4}区)$/) : null;
  return {
    prefecture: area.prefecture || null,
    city,
    ward: wardMatch ? wardMatch[1] : null,
    neighborhoods: area.neighborhoods || [],
    elementarySchools: area.elementary_schools || [],
    juniorHighSchools: area.junior_high_schools || [],
    highSchools: area.target_high_schools || [],
  };
}

module.exports = {
  GRADES,
  SUBJECTS,
  TEACHING_STYLES,
  SERVICE_TERMS,
  EXAM_TERMS,
  HIGH_INTENT_TERMS,
  LOW_INTENT_TERMS,
  FAQ_TERMS,
  GENERIC_EXCLUSION_TERMS,
  buildAreaDictionary,
};
