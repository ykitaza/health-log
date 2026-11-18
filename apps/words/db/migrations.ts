// マイグレーション。PRAGMA user_version に、当てた最後の版を持つ。
// 版を足すときは、MIGRATIONS の末尾に足す（すでに当てたものは変えない）。
//
// 同期する表は、次の列を持つ（KARADA と同じ）。
//   id（UUID）、created_at・updated_at（ISO 8601、UTC）、deleted_at（論理削除。NULL なら生きている）
// 文字の項目は NULL も受ける（サーバーから NULL が届いても当てはめが止まらないように。読むときに '' にする）
import { SEED_SOURCES, SEED_TAGS } from './seed';
import { ENTITIES, EntitySpec, q, sendableOf, SQL_UUID, triggerSql } from './syncSpec';
import type { Bind, Db } from './types';

export type Migration = { version: number; up: (db: Db, nowIso: string) => Promise<void> };

const SYNC_COLUMNS = `
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: async (db, now) => {
      await db.execAsync(`
CREATE TABLE sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  icon_key TEXT NOT NULL DEFAULT 'other',
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,${SYNC_COLUMNS}
);
CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'user',${SYNC_COLUMNS}
);
-- 表現。search_key は同期しない列（端末で文字で探すため。表現・出会い・タグを書いたときと、同期で受け取ったときに作り直す）
CREATE TABLE expressions (
  id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  source_id TEXT REFERENCES sources(id),
  normalized_key TEXT NOT NULL,
  scene TEXT,
  note TEXT,
  star INTEGER NOT NULL DEFAULT 0,
  place TEXT NOT NULL DEFAULT 'collected',
  stage TEXT,
  moved_at TEXT NOT NULL,
  hand_since TEXT,
  interval_days INTEGER NOT NULL DEFAULT 1,
  due_on TEXT,
  listened_at TEXT,
  listen_count INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_on TEXT,
  reading TEXT,
  use_note TEXT,
  register TEXT,
  register_by TEXT,
  meaning TEXT,
  nuance TEXT,
  examples TEXT,
  similar TEXT,
  usefulness INTEGER,
  usefulness_reason TEXT,
  usefulness_until TEXT,
  enriched_at TEXT,
  search_key TEXT NOT NULL DEFAULT '',${SYNC_COLUMNS}
);
CREATE INDEX expressions_key ON expressions (normalized_key);
CREATE INDEX expressions_place ON expressions (place);
CREATE TABLE expression_tags (
  id TEXT PRIMARY KEY NOT NULL,
  expression_id TEXT NOT NULL REFERENCES expressions(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  added_by TEXT NOT NULL,
  status TEXT NOT NULL,
  confirmed_at TEXT,${SYNC_COLUMNS}
);
CREATE INDEX expression_tags_expression ON expression_tags (expression_id);
CREATE TABLE encounters (
  id TEXT PRIMARY KEY NOT NULL,
  expression_id TEXT NOT NULL REFERENCES expressions(id),
  source_id TEXT REFERENCES sources(id),
  title TEXT,
  locator TEXT,
  met_on TEXT,
  time_hint TEXT,
  scene TEXT,
  surrounding_text TEXT,
  wording TEXT,
  captured_via TEXT NOT NULL DEFAULT 'app',
  note TEXT,${SYNC_COLUMNS}
);
CREATE INDEX encounters_expression ON encounters (expression_id);
-- 使えたの記録（追記だけ）
CREATE TABLE usages (
  id TEXT PRIMARY KEY NOT NULL,
  expression_id TEXT NOT NULL REFERENCES expressions(id),
  used_on TEXT NOT NULL,
  scene TEXT,
  note TEXT,${SYNC_COLUMNS}
);
CREATE INDEX usages_expression ON usages (expression_id);
-- 聞いた1回（追記だけ）
CREATE TABLE listen_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  listened_on TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  items INTEGER NOT NULL,${SYNC_COLUMNS}
);

-- 同期（KARADA と同じ作り。docs/sync-design.md の「アプリの同期」）
CREATE TABLE sync_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  parent_id TEXT,
  op TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete', 'restore')),
  fields TEXT,
  changed_at TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'import')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rejected')),
  error_code TEXT
);
CREATE INDEX sync_outbox_entity ON sync_outbox (entity_type, entity_id);
CREATE TABLE sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
CREATE TABLE sync_seen (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE TABLE sync_held (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
INSERT INTO sync_meta (key, value) VALUES ('device_id', ${SQL_UUID});

-- 端末だけのもの（同期しない）：アプリを前面にした時刻（通知の時刻を決める）と、通知を送った時刻
CREATE TABLE local_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('open', 'notified')),
  at TEXT NOT NULL
);
CREATE INDEX local_events_kind ON local_events (kind, at);
`);
      for (const spec of ENTITIES) await db.execAsync(triggerSql(spec));
      await insertSeeds(db, now);
    },
  },
];

/**
 * 初期の場所とタグを入れる（入れたばかりの端末と同じにする。端末の記録を消して受け取り直すときにも使う）。
 * 初期の行は同期で送らないので、applying を置いてトリガーに積ませない
 */
export async function insertSeeds(db: Db, now: string) {
  const applying = (await db.getFirstAsync<{ key: string }>(`SELECT key FROM sync_meta WHERE key = 'applying'`, [])) != null;
  if (!applying) await db.runAsync(`INSERT INTO sync_meta (key, value) VALUES ('applying', '1')`, []);
  try {
    for (const [i, s] of SEED_SOURCES.entries()) {
      await db.runAsync(
        'INSERT INTO sources (id, name, icon_key, sort_order, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
        [s.id, s.name, s.icon_key, i, now, now],
      );
    }
    for (const t of SEED_TAGS) {
      await db.runAsync(
        `INSERT INTO tags (id, kind, name, sort_order, hidden, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'seed', ?, ?)`,
        [t.id, t.kind, t.name, t.sort_order, now, now],
      );
    }
  } finally {
    if (!applying) await db.runAsync(`DELETE FROM sync_meta WHERE key = 'applying'`, []);
  }
}

/**
 * 端末の今の記録を outbox に積み直す（別のアカウントに送るとき。KARADA の backfillOutbox と同じ決まり）。
 * - 初期の場所とタグは、初期の値から変えた項目だけを update で積む
 * - それ以外は、今の値を create で積む（消した行は積まない）
 */
export async function backfillOutbox(db: Db, specs: EntitySpec[] = ENTITIES) {
  const seeds: Record<string, Map<string, Record<string, Bind>>> = {
    sources: new Map(SEED_SOURCES.map((s, i) => [s.id, { name: s.name, icon_key: s.icon_key, sort_order: i, hidden: 0 }])),
    tags: new Map(SEED_TAGS.map((t) => [t.id, { kind: t.kind, name: t.name, sort_order: t.sort_order, hidden: 0, created_by: 'seed' }])),
  };
  const add = (type: string, id: string, op: string, fields: Record<string, Bind> | null, at: string) => db.runAsync(
    `INSERT INTO sync_outbox (change_id, entity_type, entity_id, op, fields, changed_at, origin) VALUES (${SQL_UUID}, ?, ?, ?, ?, ?, 'app')`,
    [type, id, op, fields ? JSON.stringify(fields) : null, at],
  );
  for (const spec of specs) {
    const cols = sendableOf(spec);
    const rows = await db.getAllAsync<Record<string, Bind>>(
      `SELECT id, updated_at, deleted_at, ${cols.map(q).join(', ')} FROM ${spec.table} ORDER BY created_at, id`, [],
    );
    for (const row of rows) {
      const id = row.id as string;
      const values = Object.fromEntries(cols.map((c) => [c, row[c]]));
      const seed = seeds[spec.table]?.get(id);
      if (seed) {
        const changed = Object.fromEntries(cols.filter((c) => seed[c] !== values[c]).map((c) => [c, values[c]]));
        if (Object.keys(changed).length > 0) await add(spec.type, id, 'update', changed, row.updated_at as string);
      } else if (!row.deleted_at) {
        await add(spec.type, id, 'create', values, row.updated_at as string);
      }
    }
  }
}

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** まだ当てていないマイグレーションを、版ごとにトランザクションで当てる */
export async function migrate(db: Db, now: () => Date = () => new Date()): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let current = row?.user_version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.withTransactionAsync(async () => {
      await m.up(db, now().toISOString());
      await db.execAsync(`PRAGMA user_version = ${m.version}`);
    });
    current = m.version;
  }
  return current;
}
