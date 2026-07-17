'use strict';

// 2026-07-17判明: 一部の既存DB(本番含む)で、seo_competitor_pages等のFOREIGN KEY定義が
// 実在しない一時テーブル名(<table>_pre_branch_id)を指したまま固定されてしまっていた
// (branch_id移行がensureBranchIdRebuild()の現行の安全な形になる前の、いずれかの過去の
// タイミングで発生したと推測される)。schema.sqlのCREATE TABLE IF NOT EXISTSは既存テーブルの
// 定義を書き換えないため、このバグを抱えたまま作成された既存DBファイルは、そのINSERT時に
// 初めて「no such table: main.<table>_pre_branch_id」として表面化する。
// scripts/lib/db.jsのensureNoStaleForeignKeyReferences()がgetDb()内で自動的にこれを
// 検知・修復することを検証する。
//
// さらに、修復の初回実装には二次被害バグがあった: 対象テーブルをリネームすると、node:sqliteは
// PRAGMA foreign_keys=OFFやlegacy_alter_table設定に関わらず、そのテーブルを正しく参照している
// 「別の」テーブルのFOREIGN KEY定義まで一時テーブル名へ書き換えてしまう(実機検証済み)。
// これを防ぐ安全な再構築順序(新テーブルを別名で作成→データコピー→対象テーブルをDROP→
// 新テーブルを対象テーブル名へリネーム。対象テーブル自体は一度もリネームしない)への
// 修正も合わせて検証する。
//
// 各テストは専用の一時DBファイルを使う(Windowsでは例外発生時にファイルハンドルが
// 残ることがあり、同一ファイルの使い回しは前のテストの失敗に引きずられて不安定になるため)。

const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const tmpFiles = [];
function tmpDbPath(label) {
  const p = path.join(os.tmpdir(), `juku_blog_db_fk_repair_test_${process.pid}_${label}.sqlite`);
  tmpFiles.push(p);
  return p;
}

after(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      // 既に無ければ無視
    }
  }
});

function withFreshDb(filePath, fn) {
  process.env.JUKU_BLOG_DB_PATH = filePath;
  delete require.cache[require.resolve('../scripts/lib/db')];
  const dbModule = require('../scripts/lib/db');
  try {
    return fn(dbModule);
  } finally {
    dbModule.closeDb();
    delete process.env.JUKU_BLOG_DB_PATH;
  }
}

// 本番で実際に発生していたのと同じ壊れ方(FOREIGN KEYが実在しない一時テーブル名を指す)を
// 直接再現する。これはensureBranchIdRebuild()自体のバグではなく、その安全な現行実装が
// できる前の過去のいずれかの移行タイミングで発生したと推測される既存DBの状態を模している。
function seedCorruptedDb(filePath) {
  const conn = new DatabaseSync(filePath);
  conn.exec(`
    CREATE TABLE seo_competitors (
      id TEXT PRIMARY KEY,
      branch_id INTEGER,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      crawl_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  conn
    .prepare(
      'INSERT INTO seo_competitors (id, branch_id, name, domain, crawl_enabled, created_at, updated_at) VALUES (:id, :branch_id, :name, :domain, 1, :now, :now)'
    )
    .run({ id: 'itto.jp', branch_id: 2, name: 'ITTO個別指導学院 あま美和校', domain: 'www.itto.jp', now: '2026-07-16T00:00:00.000Z' });

  // seo_competitor_pagesのFOREIGN KEYを、実在しない"_pre_branch_id"付きテーブル名で
  // 意図的に壊した状態で作成する(本番で実際に見つかった状態そのもの)。
  conn.exec(`
    CREATE TABLE seo_competitor_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_id TEXT NOT NULL,
      url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      content_hash TEXT,
      last_analyzed_at TEXT,
      fetched_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (competitor_id) REFERENCES "seo_competitors_pre_branch_id"(id),
      UNIQUE (competitor_id, canonical_url)
    );
  `);
  // 修復前から既に存在していた実データ(壊れる前のクロール結果)を1件入れておく。
  // 修復後もこの行が消えずに残ることを確認する。
  // (この行自体は本来FKが壊れる前に挿入されていたはずのデータを模しているため、
  // フィクスチャ構築時のみforeign_keysをOFFにして矛盾なく挿入する)
  conn.exec('PRAGMA foreign_keys = OFF');
  conn
    .prepare(
      `INSERT INTO seo_competitor_pages (competitor_id, url, canonical_url, content_hash, fetched_at, created_at, updated_at)
       VALUES (:cid, :url, :url, 'hash1', :now, :now, :now)`
    )
    .run({ cid: 'itto.jp', url: 'https://www.itto.jp/school/amamiwa/', now: '2026-07-16T00:00:00.000Z' });
  conn.exec('PRAGMA foreign_keys = ON');

  conn.close();
}

test('getDb(): 既存テーブルのFOREIGN KEYが実在しない_pre_branch_id名を指している場合、自動的に正しい参照へ修復する', () => {
  const dbPath = tmpDbPath('basic');
  seedCorruptedDb(dbPath);

  withFreshDb(dbPath, ({ getDb }) => {
    const db = getDb();

    const tableDef = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'seo_competitor_pages'").get();
    assert.ok(!tableDef.sql.includes('pre_branch_id'), '修復後はFOREIGN KEY定義にpre_branch_idが残っていないこと');
    assert.match(tableDef.sql, /REFERENCES seo_competitors\(id\)/, '正しいテーブル名(seo_competitors)を参照していること');

    // 修復前から存在していたデータが消えずに残っていること
    const existing = db.prepare("SELECT * FROM seo_competitor_pages WHERE canonical_url = 'https://www.itto.jp/school/amamiwa/'").get();
    assert.ok(existing, '修復前から存在していたページデータが保持されていること');
    assert.equal(existing.content_hash, 'hash1');

    // 修復後、実際にクロールが行うのと同じ新規INSERTが成功すること
    // (修復前はここで「no such table: main.seo_competitors_pre_branch_id」になっていた)
    assert.doesNotThrow(() => {
      db.prepare(
        `INSERT INTO seo_competitor_pages (competitor_id, url, canonical_url, content_hash, fetched_at, created_at, updated_at)
         VALUES ('itto.jp', 'https://www.itto.jp/', 'https://www.itto.jp/', 'hash2', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z')`
      ).run();
    });
  });
});

test('getDb(): 修復対象テーブルを参照する別の(壊れていない)テーブルのFOREIGN KEY定義を破壊しない', () => {
  // 2026-07-17に実際に発生した二次被害の再現テスト:
  // seo_competitor_pagesの壊れたFKを修復する際、seo_competitor_pagesを正しく参照している
  // 「別の」テーブル(seo_page_headings相当)のFK定義まで、リネームの一時テーブル名へ
  // 巻き込んで書き換えてしまっていた(最初のensureNoStaleForeignKeyReferences実装のバグ)。
  const dbPath = tmpDbPath('sibling_pages');
  seedCorruptedDb(dbPath);

  const conn = new DatabaseSync(dbPath);
  // seo_competitor_pagesを正しく参照する、壊れていないテーブルを追加する
  conn.exec(`
    CREATE TABLE seo_page_headings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY (page_id) REFERENCES seo_competitor_pages(id)
    );
  `);
  conn.exec('PRAGMA foreign_keys = OFF');
  conn.prepare("INSERT INTO seo_page_headings (page_id, text) VALUES (1, '既存の見出し')").run();
  conn.exec('PRAGMA foreign_keys = ON');
  conn.close();

  withFreshDb(dbPath, ({ getDb }) => {
    const db = getDb();

    const headingsDef = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'seo_page_headings'").get();
    assert.match(
      headingsDef.sql,
      /REFERENCES seo_competitor_pages\(id\)/,
      'seo_competitor_pagesの修復によって、それを参照するseo_page_headingsのFK定義が巻き込まれて壊れていないこと'
    );
    assert.ok(!headingsDef.sql.includes('__rebuild_tmp'), '修復中に使う一時テーブル名が残留していないこと');

    const existingHeading = db.prepare("SELECT * FROM seo_page_headings WHERE text = '既存の見出し'").get();
    assert.ok(existingHeading, 'seo_page_headings側の既存データも保持されていること');

    // seo_page_headings側への新規INSERTも問題なく成功すること
    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO seo_page_headings (page_id, text) VALUES (1, '新規の見出し')").run();
    });
  });
});

test('ensureBranchIdRebuild経由のテーブル再構築後も、そのテーブルを参照する別テーブルのFOREIGN KEY定義が保たれる', () => {
  // ensureBranchIdRebuild()単体を、schema.sqlが管理する実テーブルとは無関係な架空の
  // テーブル名で直接検証する(実テーブル名を使うとdb.exec(schema)自体が要求する
  // 他のカラム・インデックス定義と衝突し、この単体テストの本来の検証対象(FK保持)とは
  // 無関係な理由で失敗してしまうため)。
  const dbPath = tmpDbPath('branch_id_rebuild');
  const conn = new DatabaseSync(dbPath);

  // branch_id移行前のfake_candidates(既存のUNIQUE制約にbranch_idが含まれない形)
  conn.exec(`
    CREATE TABLE fake_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_keyword TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  conn.prepare("INSERT INTO fake_candidates (normalized_keyword, created_at) VALUES ('あま市 塾', '2026-07-16T00:00:00.000Z')").run();
  // fake_candidatesを正しく参照する、壊れていないテーブル(seo_candidate_evidence相当)
  conn.exec(`
    CREATE TABLE fake_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES fake_candidates(id)
    );
  `);
  conn.prepare("INSERT INTO fake_evidence (candidate_id, created_at) VALUES (1, '2026-07-16T00:00:00.000Z')").run();

  const { ensureBranchIdRebuild } = require('../scripts/lib/db');
  ensureBranchIdRebuild(
    conn,
    'fake_candidates',
    `CREATE TABLE fake_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER,
      normalized_keyword TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (normalized_keyword, branch_id)
    )`,
    42
  );

  const candidatesDef = conn.prepare("SELECT sql FROM sqlite_master WHERE name = 'fake_candidates'").get();
  assert.match(candidatesDef.sql, /branch_id\s+INTEGER/, 'branch_id列が追加されていること');
  const candidateRow = conn.prepare('SELECT * FROM fake_candidates WHERE id = 1').get();
  assert.equal(candidateRow.branch_id, 42, '既存行にbackfillBranchIdが設定されていること');

  const evidenceDef = conn.prepare("SELECT sql FROM sqlite_master WHERE name = 'fake_evidence'").get();
  assert.match(
    evidenceDef.sql,
    /REFERENCES fake_candidates\(id\)/,
    'fake_candidatesのbranch_id移行によって、それを参照するfake_evidenceのFK定義が壊れていないこと'
  );

  const existingEvidence = conn.prepare('SELECT * FROM fake_evidence WHERE candidate_id = 1').get();
  assert.ok(existingEvidence, '移行前から存在していたevidenceデータが保持されていること');

  assert.doesNotThrow(() => {
    conn.prepare("INSERT INTO fake_evidence (candidate_id, created_at) VALUES (1, '2026-07-17T00:00:00.000Z')").run();
  });

  conn.close();
});

test('getDb(): 破損が無い正常なDBに対しては何もしない(冪等・無害)', () => {
  const dbPath = tmpDbPath('healthy');

  withFreshDb(dbPath, ({ getDb }) => {
    assert.doesNotThrow(() => getDb());
    const db = getDb();
    const broken = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%pre_branch_id%'").all();
    assert.equal(broken.length, 0);
  });
});
