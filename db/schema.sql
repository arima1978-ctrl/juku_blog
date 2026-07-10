-- posts テーブル: フェーズ2(WordPress REST API投稿)を見据えたスキーマ
CREATE TABLE IF NOT EXISTS posts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at         TEXT NOT NULL,               -- 生成日時 (ISO8601)
  title              TEXT NOT NULL,                -- タイトル
  slug               TEXT NOT NULL UNIQUE,          -- URL用スラッグ(英数字)
  category           TEXT NOT NULL,                 -- 地域情報/勉強のコツ/入試情報/保護者コラム 等
  target_audience    TEXT,                          -- 想定読者(例: 中2保護者)
  keywords           TEXT,                          -- 想定検索キーワード(カンマ区切り)
  meta_description   TEXT,                          -- メタディスクリプション(120字以内)
  body_md            TEXT NOT NULL,                 -- 本文(Markdown)
  body_html          TEXT NOT NULL,                 -- 本文(HTML変換済み、WordPress投稿用)
  fact_check_report  TEXT,                          -- 石橋のチェック結果(JSON文字列)
  status             TEXT NOT NULL DEFAULT 'review_pending', -- review_pending/approved/rejected/scheduled/published
  reviewer_note      TEXT,                          -- 差し戻し時のメモ
  published_at       TEXT,                          -- 公開(予定)日時。scheduledの間は未来の予約日時、実際に公開されても値は更新しない
  wp_post_id         TEXT,                          -- WordPress投稿ID(フェーズ2用)
  wp_link            TEXT,                          -- WordPress投稿URL(予約中は?p=形式、公開後はパーマリンク)
  seasonal_topic_id  TEXT,                          -- config/seasonal_topics.yamlの採用テーマID(季節テーマ以外はNULL)
  publish_window_end TEXT,                          -- 採用テーマの公開可能期間の終了日(YYYY-MM-DD)。季節テーマ以外はNULL
  similarity_check   TEXT,                          -- 過去記事との類似度チェック結果(JSON文字列。scripts/check_similarity.js)
  plan_rationale     TEXT,                          -- 智谷の企画採用理由・採点結果(JSON文字列。.claude/agents/planner-blog-btoc.md)
  citations          TEXT,                          -- 出典情報(episode_sources/parent_qa_sources/web_sources/citation_checkのJSON文字列)
  wp_status          TEXT,                          -- 最後に確認できたWordPress側の実際のstatus(future/publish/draft/pending/trash等)
  wp_last_synced_at  TEXT,                          -- scripts/sync_wordpress_status.js が最後に確認した日時(ISO8601)
  wp_sync_error      TEXT,                          -- 同期時に検知した問題(記事消失・想定外ステータス等)。問題なければNULL
  eyecatch           TEXT                           -- アイキャッチメタデータ(JSON文字列: template/headline/subheadline/alt)。赤羽が生成。実画像生成は未実装
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);

-- エピソード素材(data/episodes.md が正だが、使用済みフラグの検索用に補助テーブルを用意)
CREATE TABLE IF NOT EXISTS episode_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_key TEXT NOT NULL UNIQUE,   -- episodes.md内の行を特定するハッシュ/キー
  used_in_post_id INTEGER,
  used_at     TEXT,
  FOREIGN KEY (used_in_post_id) REFERENCES posts(id)
);

-- 将来のSearch Console等との連携を見据えた記事成果データの置き場(設計のみ、
-- 現時点ではどのスクリプトからも書き込まれない。Search Console API連携は未実装)。
-- 同一記事・同一期間で複数回記録できるよう (post_id, period, recorded_at) で管理する。
CREATE TABLE IF NOT EXISTS post_analytics (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id          INTEGER NOT NULL,
  period           TEXT NOT NULL,      -- '7d' (公開後7日) / '30d' (公開後30日) 等
  recorded_at      TEXT NOT NULL,      -- 記録日時(ISO8601)
  impressions      INTEGER,            -- Search Console: 表示回数
  clicks           INTEGER,            -- Search Console: クリック数
  ctr              REAL,               -- Search Console: クリック率
  avg_position     REAL,               -- Search Console: 平均掲載順位
  search_queries   TEXT,               -- 上位検索クエリ(JSON配列文字列)
  cta_clicks       INTEGER,            -- CTAリンクのクリック数(計測未実装)
  inquiries        INTEGER,            -- 問い合わせ数(計測未実装)
  trial_signups    INTEGER,            -- 体験申込数(計測未実装)
  FOREIGN KEY (post_id) REFERENCES posts(id)
);
CREATE INDEX IF NOT EXISTS idx_post_analytics_post_id ON post_analytics(post_id);

-- 愛知県高校入試 情報ソース参照機能(features.aichi_exam_research)のキャッシュ置き場。
-- 別DBを新設せず既存posts.sqliteに相乗りする。scripts/lib/exam_research/cache.js が読み書きする。
-- 同一source_idを何度も取得しないよう、TTL内はここを見るだけで済ませる。
CREATE TABLE IF NOT EXISTS exam_research_cache (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id        TEXT NOT NULL,       -- config/aichi_exam_sources.yamlのid
  source_url       TEXT NOT NULL,       -- 実際に取得したURL(PDF個別URL等、entry_urlと異なる場合あり)
  parent_url       TEXT,                -- PDFの場合、リンク元のentry_url
  content_type      TEXT,                -- 'html' / 'pdf'
  document_title   TEXT,                -- PDFタイトル・HTMLのtitle等
  target_year      INTEGER,             -- 本文から抽出した対象年度(西暦。複数/不明ならNULL)
  fetched_at       TEXT NOT NULL,       -- 取得日時(ISO8601)
  expires_at       TEXT NOT NULL,       -- ttl_hoursから計算した有効期限(ISO8601)
  http_status      INTEGER,
  content_hash     TEXT,                -- 本文のハッシュ(更新検知用)
  raw_text         TEXT,                -- 抽出直後の生テキスト(長大な場合は要約のみ保持を検討)
  extracted_text   TEXT,                -- 記事化に使う範囲に絞ったテキスト
  parse_status     TEXT NOT NULL,       -- 'ok' / 'fetch_failed' / 'parse_failed'
  error_message    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exam_research_cache_source_id ON exam_research_cache(source_id);
CREATE INDEX IF NOT EXISTS idx_exam_research_cache_source_url ON exam_research_cache(source_url);

-- ソース本文の更新検知履歴(前回取得時とのハッシュ差分を記録。既存記事の自動書き換えはしない)
CREATE TABLE IF NOT EXISTS exam_research_updates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id        TEXT NOT NULL,
  source_url       TEXT NOT NULL,
  previous_hash    TEXT,
  current_hash     TEXT NOT NULL,
  target_year      INTEGER,
  detected_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exam_research_updates_source_id ON exam_research_updates(source_id);
