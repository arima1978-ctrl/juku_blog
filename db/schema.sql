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

-- ============================================================
-- 競合キーワード分析(Keyword Gap Lite, features.competitor_keyword_analysis)
-- 別DBを新設せず既存posts.sqliteに相乗りする(自社postsとのJOINが必須のため)。
-- features.competitor_keyword_analysis.enabled が false の間は
-- どのスクリプトもこれらのテーブルへ読み書きしない。
-- ============================================================

-- 競合塾レジストリ(config/seo_competitors.yamlの内容 + クロール実行状態)。
-- idはyaml側のidと一致させる。未登録ドメインは他のどのテーブルにも現れない(許可リスト方式)。
CREATE TABLE IF NOT EXISTS seo_competitors (
  id                  TEXT PRIMARY KEY,       -- config/seo_competitors.yamlのid
  name                TEXT NOT NULL,
  domain              TEXT NOT NULL,
  start_url           TEXT,
  sitemap_url         TEXT,
  competitor_type     TEXT,                   -- local/major_chain/exam_specialist/subject_specialist/information_media/other
  target_areas        TEXT,                   -- JSON配列文字列
  target_schools      TEXT,                   -- JSON配列文字列
  target_grades       TEXT,                   -- JSON配列文字列
  target_subjects     TEXT,                   -- JSON配列文字列
  crawl_enabled       INTEGER NOT NULL DEFAULT 0,  -- 0/1
  crawl_interval_days INTEGER,
  max_pages           INTEGER,
  last_crawled_at     TEXT,
  last_success_at     TEXT,
  last_error_at       TEXT,
  last_error_message  TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (domain)
);

-- 競合サイトから取得したページ(本文は原則data/seo/配下のファイルに保存し、
-- ここにはメタデータ・見出し・ハッシュ・スコアのみを持たせてDB肥大化を避ける)。
CREATE TABLE IF NOT EXISTS seo_competitor_pages (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id      TEXT NOT NULL,
  url                TEXT NOT NULL,
  canonical_url      TEXT NOT NULL,
  http_status        INTEGER,
  content_type       TEXT,
  title              TEXT,
  meta_description   TEXT,
  published_at       TEXT,           -- サイト側が示す公開日(取得できる場合)
  updated_at_source  TEXT,           -- サイト側が示す更新日(取得できる場合)
  fetched_at         TEXT NOT NULL,
  content_hash       TEXT,           -- 抽出後テキストのSHA-256(更新検知・再解析スキップ用)
  robots_allowed     INTEGER NOT NULL DEFAULT 1,
  last_analyzed_at   TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  FOREIGN KEY (competitor_id) REFERENCES seo_competitors(id),
  UNIQUE (competitor_id, canonical_url)
);
CREATE INDEX IF NOT EXISTS idx_seo_competitor_pages_competitor_id ON seo_competitor_pages(competitor_id);
CREATE INDEX IF NOT EXISTS idx_seo_competitor_pages_content_hash ON seo_competitor_pages(content_hash);

-- 競合ページの見出し(H1〜H3)。テーマ抽出の根拠として個別に保持する。
CREATE TABLE IF NOT EXISTS seo_page_headings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     INTEGER NOT NULL,
  level       TEXT NOT NULL,     -- 'h1' / 'h2' / 'h3'
  text        TEXT NOT NULL,
  position    INTEGER,           -- ページ内での出現順
  created_at  TEXT NOT NULL,
  FOREIGN KEY (page_id) REFERENCES seo_competitor_pages(id)
);
CREATE INDEX IF NOT EXISTS idx_seo_page_headings_page_id ON seo_page_headings(page_id);

-- 正規化済みキーワード/テーマの辞書(表記揺れの正規化前後を両方保持)。
CREATE TABLE IF NOT EXISTS seo_topics (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_keyword          TEXT NOT NULL,
  normalized_keyword   TEXT NOT NULL,
  normalization_rule   TEXT,               -- 適用した正規化ルール名(無ければNULL=そのまま)
  target_area          TEXT,
  target_school        TEXT,
  target_grade         TEXT,
  target_subject       TEXT,
  created_at           TEXT NOT NULL,
  UNIQUE (normalized_keyword, target_area, target_school, target_grade, target_subject)
);
CREATE INDEX IF NOT EXISTS idx_seo_topics_normalized_keyword ON seo_topics(normalized_keyword);

-- どのページからどのテーマがどの根拠で抽出されたか(根拠の追跡用)。
CREATE TABLE IF NOT EXISTS seo_page_topics (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id             INTEGER NOT NULL,
  topic_id            INTEGER NOT NULL,
  score               REAL,               -- 重み付けスコア(config/juku.yamlのextraction_weights由来)
  occurrence_count    INTEGER,
  extraction_method   TEXT,               -- title/h1/h2/h3/meta_description/body/ngram
  confidence          REAL,
  created_at          TEXT NOT NULL,
  FOREIGN KEY (page_id) REFERENCES seo_competitor_pages(id),
  FOREIGN KEY (topic_id) REFERENCES seo_topics(id),
  UNIQUE (page_id, topic_id, extraction_method)
);
CREATE INDEX IF NOT EXISTS idx_seo_page_topics_topic_id ON seo_page_topics(topic_id);

-- Google Search Console実績(自社サイトのみ取得可能)。日次取得・upsert前提。
CREATE TABLE IF NOT EXISTS seo_gsc_queries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  site_property  TEXT NOT NULL,
  date           TEXT NOT NULL,
  query          TEXT NOT NULL,
  page           TEXT,
  device         TEXT,
  country        TEXT,
  search_type    TEXT,
  clicks         INTEGER,
  impressions    INTEGER,
  ctr            REAL,
  position       REAL,
  fetched_at     TEXT NOT NULL,
  UNIQUE (site_property, date, query, page, device, country, search_type)
);
CREATE INDEX IF NOT EXISTS idx_seo_gsc_queries_date ON seo_gsc_queries(date);
CREATE INDEX IF NOT EXISTS idx_seo_gsc_queries_query ON seo_gsc_queries(query);

-- キーワードプランナー等のCSV取込による検索需要データ。
CREATE TABLE IF NOT EXISTS seo_keyword_metrics (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword                   TEXT NOT NULL,
  normalized_keyword        TEXT NOT NULL,
  average_monthly_searches  INTEGER,
  competition               TEXT,
  competition_index         REAL,
  low_top_of_page_bid       REAL,
  high_top_of_page_bid      REAL,
  source                    TEXT NOT NULL,   -- 'keyword_planner_csv' 等
  source_file               TEXT,
  imported_at               TEXT NOT NULL,
  UNIQUE (normalized_keyword, source)
);
CREATE INDEX IF NOT EXISTS idx_seo_keyword_metrics_normalized_keyword ON seo_keyword_metrics(normalized_keyword);

-- 検索順位データ(CSV取込 or 手動登録)。Google検索結果ページの直接取得は行わない。
CREATE TABLE IF NOT EXISTS seo_serp_rankings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword             TEXT NOT NULL,
  normalized_keyword  TEXT NOT NULL,
  domain              TEXT NOT NULL,
  ranking_url         TEXT,
  position            INTEGER,
  checked_at          TEXT NOT NULL,
  device              TEXT,
  location            TEXT,
  source              TEXT NOT NULL,   -- 'serp_csv' / 'manual'
  imported_at         TEXT NOT NULL,
  UNIQUE (normalized_keyword, domain, checked_at, device, location)
);
CREATE INDEX IF NOT EXISTS idx_seo_serp_rankings_normalized_keyword ON seo_serp_rankings(normalized_keyword);

-- Keyword Gap判定結果 + 優先度スコアを持つ記事候補(人間の承認フローの対象)。
CREATE TABLE IF NOT EXISTS seo_keyword_candidates (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_keyword   TEXT NOT NULL,
  raw_keyword          TEXT,
  target_area          TEXT,
  target_school        TEXT,
  target_grade         TEXT,
  target_subject       TEXT,
  gap_type             TEXT NOT NULL,    -- missing/weak/untapped/shared/strong/content_gap
  priority_score       INTEGER NOT NULL, -- 0〜100
  score_breakdown      TEXT,             -- JSON(内訳)
  search_demand        INTEGER,
  own_avg_position     REAL,
  competitor_count     INTEGER,
  recommended_action   TEXT,             -- create_article/improve_existing_article/... /exclude
  suggested_title      TEXT,
  suggested_outline    TEXT,             -- JSON
  status               TEXT NOT NULL DEFAULT 'discovered', -- discovered/reviewing/approved/queued/article_created/rejected/monitoring/archived
  analysis_run_id      TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY (analysis_run_id) REFERENCES seo_analysis_runs(id),
  UNIQUE (normalized_keyword, target_area, target_school, target_grade, target_subject)
);
CREATE INDEX IF NOT EXISTS idx_seo_keyword_candidates_status ON seo_keyword_candidates(status);
CREATE INDEX IF NOT EXISTS idx_seo_keyword_candidates_priority_score ON seo_keyword_candidates(priority_score);
CREATE INDEX IF NOT EXISTS idx_seo_keyword_candidates_gap_type ON seo_keyword_candidates(gap_type);

-- 候補ごとの抽出根拠(「なぜこの候補が出たか」を後から確認できるようにする)。
CREATE TABLE IF NOT EXISTS seo_candidate_evidence (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id         INTEGER NOT NULL,
  competitor_page_id   INTEGER,
  evidence_type        TEXT NOT NULL,   -- title/h1/h2/h3/meta_description/body/gsc/csv
  detail               TEXT,            -- JSON(該当見出し・出現箇所・confidence等)
  confidence           REAL,
  created_at           TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES seo_keyword_candidates(id),
  FOREIGN KEY (competitor_page_id) REFERENCES seo_competitor_pages(id),
  UNIQUE (candidate_id, competitor_page_id, evidence_type)
);
CREATE INDEX IF NOT EXISTS idx_seo_candidate_evidence_candidate_id ON seo_candidate_evidence(candidate_id);

-- カニバリゼーション対策: 候補と類似する既存記事(posts)の紐付け。
CREATE TABLE IF NOT EXISTS seo_candidate_existing_articles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id      INTEGER NOT NULL,
  post_id           INTEGER,
  similarity_score  REAL,
  match_reason      TEXT,   -- title_similarity/heading_similarity/theme_match/gsc_query_overlap 等
  created_at        TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES seo_keyword_candidates(id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  UNIQUE (candidate_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_seo_candidate_existing_articles_candidate_id ON seo_candidate_existing_articles(candidate_id);

-- 候補の承認・除外・保留の操作履歴(操作日時・内容・理由・操作者を保存)。
CREATE TABLE IF NOT EXISTS seo_candidate_status_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id  INTEGER NOT NULL,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  reason        TEXT,
  actor         TEXT NOT NULL DEFAULT 'system',  -- 'system' / 'dashboard'(操作者管理が別途無いため最低限これを記録)
  created_at    TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES seo_keyword_candidates(id)
);
CREATE INDEX IF NOT EXISTS idx_seo_candidate_status_history_candidate_id ON seo_candidate_status_history(candidate_id);

-- 週次バッチの実行履歴(二重起動防止・結果サマリー表示に使う)。
CREATE TABLE IF NOT EXISTS seo_analysis_runs (
  id                        TEXT PRIMARY KEY,   -- 実行ID(例: 2026-07-13T05:00:00Z由来の文字列)
  started_at                TEXT NOT NULL,
  finished_at               TEXT,
  status                    TEXT NOT NULL,      -- running/completed/failed
  competitor_count          INTEGER,
  pages_fetched             INTEGER,
  pages_new                 INTEGER,
  pages_updated             INTEGER,
  pages_unchanged           INTEGER,
  pages_skipped             INTEGER,
  robots_disallowed_count   INTEGER,
  error_count               INTEGER,
  topics_extracted          INTEGER,
  candidates_created        INTEGER,
  candidates_updated        INTEGER,
  gsc_rows_fetched          INTEGER,
  csv_rows_imported         INTEGER,
  duration_ms               INTEGER,
  summary                   TEXT,   -- JSON(実行結果の要約)
  created_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seo_analysis_runs_status ON seo_analysis_runs(status);

-- CSV取込(キーワードプランナー/順位)の実行履歴。
CREATE TABLE IF NOT EXISTS seo_import_jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type        TEXT NOT NULL,    -- keyword_metrics/serp
  source_file     TEXT,
  status          TEXT NOT NULL,    -- pending/completed/failed
  rows_total      INTEGER,
  rows_imported   INTEGER,
  rows_updated    INTEGER,
  rows_skipped    INTEGER,
  rows_error      INTEGER,
  error_message   TEXT,
  dry_run         INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seo_import_jobs_job_type ON seo_import_jobs(job_type);
