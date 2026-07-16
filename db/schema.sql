-- posts テーブル: フェーズ2(WordPress REST API投稿)を見据えたスキーマ
CREATE TABLE IF NOT EXISTS posts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id          INTEGER,                      -- 複数校舎管理(branches.id)。全校舎が同一WordPress
                                                     -- サイトへ投稿するため、slugのUNIQUE制約はグローバルの
                                                     -- まま維持する(branch_idはフィルタ用の付加情報)。
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
-- 複数校舎管理: 「1競合は1校舎に紐づく」という単純化(校舎をまたいで同一競合を複数校舎が
-- 参照する多対多構造は今回のスコープ外)。UNIQUE(domain)はUNIQUE(domain, branch_id)へ変更し、
-- 異なる校舎が同一ドメインを別々に登録できるようにする。
CREATE TABLE IF NOT EXISTS seo_competitors (
  id                  TEXT PRIMARY KEY,       -- config/seo_competitors.yamlのid
  branch_id           INTEGER,                -- 複数校舎管理(branches.id)
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
  UNIQUE (domain, branch_id)
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
  branch_id            INTEGER,            -- 複数校舎管理(branches.id)
  raw_keyword          TEXT NOT NULL,
  normalized_keyword   TEXT NOT NULL,
  normalization_rule   TEXT,               -- 適用した正規化ルール名(無ければNULL=そのまま)
  target_area          TEXT,
  target_school        TEXT,
  target_grade         TEXT,
  target_subject       TEXT,
  created_at           TEXT NOT NULL,
  UNIQUE (normalized_keyword, target_area, target_school, target_grade, target_subject, branch_id)
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
-- 複数校舎管理: branch_idをUNIQUE制約に含め、異なる校舎が同じキーワード/地域の組み合わせを
-- 独立して保持できるようにする。
CREATE TABLE IF NOT EXISTS seo_keyword_candidates (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id            INTEGER,          -- 複数校舎管理(branches.id)
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
  UNIQUE (normalized_keyword, target_area, target_school, target_grade, target_subject, branch_id)
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

-- 複合キーワード(「地域×塾」等のテンプレートで組み立てたキーワード)の辞書。
-- seo_topics/seo_page_topics(単語単位)とは別に、テンプレートマッチ結果を保持する。
CREATE TABLE IF NOT EXISTS seo_compound_keywords (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id           INTEGER,         -- 複数校舎管理(branches.id)
  compound_keyword    TEXT NOT NULL,
  template_type       TEXT NOT NULL,   -- area_juku/area_grade_juku/area_teaching_style/...
  keyword_components  TEXT NOT NULL,   -- JSON: {area, school, grade, subject, teaching_style, service, exam}
  target_area         TEXT,
  target_school       TEXT,
  target_grade        TEXT,
  target_subject      TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (compound_keyword, template_type, target_area, target_school, target_grade, target_subject, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_seo_compound_keywords_compound_keyword ON seo_compound_keywords(compound_keyword);
CREATE INDEX IF NOT EXISTS idx_seo_compound_keywords_template_type ON seo_compound_keywords(template_type);

-- どの競合ページで複合キーワードが検出されたか(共起の強さ・ゾーンを記録)。
CREATE TABLE IF NOT EXISTS seo_page_compound_keywords (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id              INTEGER NOT NULL,
  compound_keyword_id  INTEGER NOT NULL,
  cooccurrence_score   REAL,            -- 1.0=同一ゾーン共起、0.7=ページ内別ゾーン共起
  same_zone            TEXT,            -- 'title'/'h1'/'h2'、別ゾーンのみならNULL
  created_at           TEXT NOT NULL,
  FOREIGN KEY (page_id) REFERENCES seo_competitor_pages(id),
  FOREIGN KEY (compound_keyword_id) REFERENCES seo_compound_keywords(id),
  UNIQUE (page_id, compound_keyword_id)
);
CREATE INDEX IF NOT EXISTS idx_seo_page_compound_keywords_compound_keyword_id ON seo_page_compound_keywords(compound_keyword_id);

-- AI Growth Director(features.growth_director)専用テーブル。
-- seo_keyword_candidates(キーワードギャップの発見)とは別の概念で、
-- 「次に何をすべきか」という実行可能な改善作業単位(Task)を保持する。
-- Sprint 1では提案(proposed)・承認(approved)・除外(rejected)のみを扱い、
-- 実行(in_progress/done)の自動化は行わない。
CREATE TABLE IF NOT EXISTS seo_tasks (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id                 INTEGER,         -- 複数校舎管理(branches.id)
  task_type                 TEXT NOT NULL,   -- create_article/improve_existing_article/improve_school_page/add_internal_links/add_faq/monitor/exclude
  target_url                TEXT,            -- 対象URL(既存記事・校舎ページ等。新規作成なら NULL)
  target_post_id            INTEGER,         -- 対象postsレコード(あれば)
  target_page_type          TEXT,            -- config/school_pages.yaml由来。現状"school_page"のみ使用(該当なしはNULL)
  target_page_id            TEXT,            -- config/school_pages.yamlのid(あれば)
  target_page_name          TEXT,            -- 表示用の校舎ページ名(あれば)
  target_keyword            TEXT NOT NULL,   -- 対象キーワード(複合キーワード文字列)
  source_candidate_id       INTEGER,         -- 由来のseo_keyword_candidates.id
  priority_score            INTEGER,         -- 元候補のpriority_score(参考値としてコピー)
  opportunity_score         INTEGER NOT NULL,-- 0-100。priority_scoreとは独立
  opportunity_breakdown     TEXT,            -- JSON(内訳)
  estimated_effort_minutes  INTEGER,
  recommended_action        TEXT NOT NULL,   -- URL Allocatorが決定したtask_typeと同義
  reason                    TEXT,            -- JSON配列(表示用の理由サマリー)
  status                    TEXT NOT NULL DEFAULT 'proposed', -- proposed/approved/rejected
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  FOREIGN KEY (source_candidate_id) REFERENCES seo_keyword_candidates(id),
  FOREIGN KEY (target_post_id) REFERENCES posts(id),
  UNIQUE (target_keyword, task_type, source_candidate_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_seo_tasks_status ON seo_tasks(status);
CREATE INDEX IF NOT EXISTS idx_seo_tasks_opportunity_score ON seo_tasks(opportunity_score);

-- Sprint 3.4: AI Growth Director専用テーブル。seo_tasks(キーワード単位の分析結果)とは
-- 別概念の「ページ単位の改善計画」を保持する。scripts/lib/seo/page_task_grouper.js
-- (Primary/Supporting/Excluded分類)+scripts/lib/seo/supporting_task_fact_checker.js
-- (ページ本文による事実確認)の結果を、DB保存可能な形にまとめたもの。
-- 保存してもseo_tasks側のstatusは一切変更しない(Task自体は削除・書き換えしない)。
-- 統合Draftの生成・保存(seo_task_drafts相当)は未実装(将来Sprint)。
CREATE TABLE IF NOT EXISTS seo_page_plans (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id                 INTEGER,         -- 複数校舎管理(branches.id)

  group_key                 TEXT NOT NULL,   -- target_page_type + ":" + target_page_id と同一(表示・監査用)
  target_page_type          TEXT NOT NULL,
  target_page_id            TEXT NOT NULL,
  target_page_name          TEXT,
  target_url                TEXT,            -- 参考値(表示用。target_url不一致検出時はNULLの場合あり)

  primary_task_id           INTEGER NOT NULL,
  primary_keyword           TEXT NOT NULL,

  supporting_task_ids       TEXT NOT NULL DEFAULT '[]', -- JSON配列(例: [64])
  supporting_keywords       TEXT NOT NULL DEFAULT '[]', -- JSON配列(例: ["守山区 個別指導"])

  excluded_tasks            TEXT NOT NULL DEFAULT '[]', -- JSON配列({taskId,targetKeyword,reason,duplicateOf?,factStatus?,factEvidence?})

  combined_search_intents   TEXT NOT NULL DEFAULT '[]', -- JSON配列(Primary+Supportingのsearch_intent一覧)

  selection_breakdown       TEXT,            -- JSON(Primary選定根拠。searchIntentPriority/dataConfidence/gscImpressions/gapTypePriority/opportunityScore/taskId)
  fact_check_summary        TEXT,            -- JSON({verified:[],unverified:[],conflicting:[]})。GSC実績は含めない
  warnings                  TEXT NOT NULL DEFAULT '[]', -- JSON配列

  source_content_hash       TEXT,            -- pageContext.contentHash(本文全文は保存しない。未取得ならNULL)
  prompt_version            TEXT,            -- 将来Draft生成時に使うPromptVersionの参考記録(今回は未使用のためNULL)

  status                    TEXT NOT NULL DEFAULT 'proposed', -- proposed/reviewing/approved/rejected(Task statusとは完全に別軸)

  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,

  UNIQUE (target_page_type, target_page_id, branch_id),
  FOREIGN KEY (primary_task_id) REFERENCES seo_tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_seo_page_plans_status ON seo_page_plans(status);

-- Sprint 3.5: Page Planの人間レビュー履歴(監査ログ)。status変更のたびに1行追加し、
-- 過去の変更履歴は上書き・削除しない(seo_page_plans.status自体は現在値のみを保持する)。
-- 許可されるstatus遷移・source値はアプリ層(scripts/lib/seo/page_plan_review.js)で検証する
-- (このリポジトリの既存方針としてSQLのCHECK制約は使わない)。
CREATE TABLE IF NOT EXISTS seo_page_plan_reviews (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  page_plan_id      INTEGER NOT NULL,

  from_status       TEXT NOT NULL,
  to_status         TEXT NOT NULL,

  actor             TEXT NOT NULL,
  reason            TEXT,

  source            TEXT NOT NULL DEFAULT 'manual', -- cli/api/dashboard/system(アプリ層で検証)
  metadata          TEXT NOT NULL DEFAULT '{}',      -- JSON。個人情報・秘密情報は保存しない

  created_at        TEXT NOT NULL,

  FOREIGN KEY (page_plan_id) REFERENCES seo_page_plans(id)
);
CREATE INDEX IF NOT EXISTS idx_seo_page_plan_reviews_plan_id ON seo_page_plan_reviews(page_plan_id);

-- Sprint 3.6: 承認済み(approved)Page Planから生成した「1ページ分の統合改善文章」の履歴。
-- 1つのPage Planに対して複数世代のDraftを保持できるよう、upsertではなく常にINSERTする
-- (draft_versionをPage Planごとに1から連番)。過去Draftは上書き・削除しない。
-- ページ本文全文は保存せず、生成時点のsource_content_hashのみを保存する。
-- 保存してもseo_page_plans/seo_tasksのstatusは一切変更しない。
CREATE TABLE IF NOT EXISTS seo_page_drafts (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,

  page_plan_id            INTEGER NOT NULL,

  draft_version           INTEGER NOT NULL, -- Page Planごとに1から連番

  draft_type              TEXT NOT NULL DEFAULT 'page_improvement',

  summary                 TEXT NOT NULL,
  suggested_location      TEXT NOT NULL,
  generated_text          TEXT NOT NULL,
  change_reason           TEXT NOT NULL,
  search_intent_alignment TEXT NOT NULL,

  covered_task_ids        TEXT NOT NULL DEFAULT '[]', -- JSON配列。Primary+実際に文章へ反映したSupporting
  covered_keywords        TEXT NOT NULL DEFAULT '[]',
  excluded_task_ids       TEXT NOT NULL DEFAULT '[]', -- JSON配列。文章へ含めなかったTask ID
  excluded_intents        TEXT NOT NULL DEFAULT '[]',

  warnings                TEXT NOT NULL DEFAULT '[]',

  prompt_snapshot         TEXT NOT NULL, -- 実際に使ったPrompt全文(監査用。本文全文とは別)
  prompt_version          TEXT NOT NULL, -- 'page-draft-v1'(Task単位Draft v3とは別管理)
  generator               TEXT NOT NULL, -- 'claude-code-subagent'等
  model                   TEXT,          -- 参考記録(例: 'sonnet')。未取得ならNULL

  source_content_hash     TEXT,          -- 生成時点のpageContext.contentHash(本文全文は保存しない)
  page_plan_updated_at    TEXT NOT NULL, -- 生成開始時点で読み取ったPage Plan.updated_at(競合検知用)

  validation_result       TEXT NOT NULL, -- JSON({valid,errors,warnings})
  validation_status       TEXT NOT NULL, -- 'valid'/'invalid'

  status                  TEXT NOT NULL DEFAULT 'generated', -- generated/reviewing/approved/rejected

  edited_text             TEXT, -- 人間編集用(今回は常にNULL。編集UIは未実装)

  generated_at            TEXT NOT NULL,
  updated_at              TEXT NOT NULL,

  UNIQUE (page_plan_id, draft_version),
  FOREIGN KEY (page_plan_id) REFERENCES seo_page_plans(id)
);
CREATE INDEX IF NOT EXISTS idx_seo_page_drafts_page_plan_id ON seo_page_drafts(page_plan_id);

-- Sprint 3.9: AI Weekly Director。毎週の月曜日(batch_date)ごとに、その週に着手すべき
-- として選定されたTask(3〜5件)と、各Taskに対して事前生成したDraft Prompt(ファイル
-- パスのみ、本文はdata/seo_drafts/配下のファイルに保存)への参照をまとめて保持する。
-- seo_tasks本体・seo_page_plans・seo_page_draftsのいずれも変更しない(別概念として
-- 独立したテーブルにする、既存のPage Plan/Page Draftと同じ設計方針)。
CREATE TABLE IF NOT EXISTS seo_weekly_recommendations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id             INTEGER,                            -- 複数校舎管理(branches.id)
  batch_date            TEXT NOT NULL,                      -- その週の月曜日(YYYY-MM-DD形式)
  status                TEXT NOT NULL DEFAULT 'proposed',   -- proposed/approved/archived
  task_ids              TEXT NOT NULL DEFAULT '[]',         -- JSON配列: [61, 64, ...]
  items                 TEXT NOT NULL DEFAULT '[]',         -- JSON配列(タスク詳細・draftStatus・Promptファイルパス等)
  total_expected_cv     REAL,                               -- 選定タスクの期待CV増の合計
  total_effort_minutes  INTEGER,                            -- 選定タスクの工数(分)の合計
  task_type_breakdown   TEXT,                               -- JSONオブジェクト: {"create_article":2,...}
  curation_tier         TEXT,                               -- strict/relaxed_diversity/fallback_pool_used
  curation_params       TEXT,                               -- JSON(実行時のパラメータ。budget等、監査用)
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (batch_date, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_seo_weekly_recommendations_batch_date ON seo_weekly_recommendations(batch_date);

-- 複数校舎管理(プランA: データベース化)。校舎ごとにWordPress投稿の著者アカウントが
-- 異なるため、config/juku.yamlの静的なwordpress.author_id/author_display_nameに代わり、
-- このテーブルの「現在アクティブな校舎」(is_active=1、常に1件のみ)からWordPress投稿者
-- 検証(scripts/lib/wordpress_validation.js)の期待値を取得する。wordpress_api_tokenは
-- 校舎ごとに異なるWordPressアカウントのアプリケーションパスワードを想定した保存領域だが、
-- 実際のBasic認証ヘッダーへの組み込みは今回未実装(校舎ごとのユーザー名を保持する
-- カラムが無いため、別途設計が必要な今後の課題とする)。category_idは今回の対象外の
-- ため、引き続きconfig/juku.yamlの値を全校舎共通で使用する。
CREATE TABLE IF NOT EXISTS branches (
  id                              INTEGER PRIMARY KEY AUTOINCREMENT,
  name                            TEXT NOT NULL,
  target_area                     TEXT,
  wordpress_author_id             INTEGER,
  wordpress_author_display_name   TEXT,
  wordpress_api_token              TEXT,
  is_active                       INTEGER NOT NULL DEFAULT 0,
  created_at                      TEXT NOT NULL,
  updated_at                      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branches_is_active ON branches(is_active);
