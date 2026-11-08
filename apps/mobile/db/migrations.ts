// マイグレーション。PRAGMA user_version に、当てた最後の版を持つ。
// 版を足すときは、MIGRATIONS の末尾に足す（すでに当てたものは変えない）。
//
// どの表も、のちにサーバーと同期できるように、次の列を持つ。
//   id（UUID）、created_at・updated_at（ISO 8601、UTC）、deleted_at（論理削除。NULL なら生きている）
import { SEED_BODY_PARTS, SEED_EXERCISES } from './seed';
import type { Db } from './types';

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
CREATE TABLE body_parts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,${SYNC_COLUMNS}
);
CREATE TABLE exercises (
  id TEXT PRIMARY KEY NOT NULL,
  body_part_id TEXT NOT NULL REFERENCES body_parts(id),
  name TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('weight_reps', 'reps_only')),
  sort_order INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,${SYNC_COLUMNS}
);
-- 1日の1種目ぶん。sort_order はその日に実施した順
CREATE TABLE workout_entries (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  sort_order INTEGER NOT NULL,${SYNC_COLUMNS}
);
CREATE INDEX workout_entries_date ON workout_entries (date);
-- 重さはいつも kg で持つ（表示の単位は設定で変える）。回数だけの種目は weight_kg が NULL
CREATE TABLE workout_sets (
  id TEXT PRIMARY KEY NOT NULL,
  entry_id TEXT NOT NULL REFERENCES workout_entries(id),
  set_index INTEGER NOT NULL,
  weight_kg REAL,
  reps INTEGER NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,${SYNC_COLUMNS}
);
CREATE INDEX workout_sets_entry ON workout_sets (entry_id);
-- 体組成。1日に複数の記録があり得る（体重計で朝夕に測る、取り込みと手入力が両方ある、など）。
-- source：'manual'（手入力）か 'health_connect'（第2段階で取り込む）
-- external_id：取り込み元の記録の ID（手入力は NULL）。origin_package：元のアプリ（NULL 可）
-- 同じ source と external_id の組は1行だけ（取り込みを何度やっても重複しない）。
-- 消した行も一意の対象に含め、取り込み直しで消した記録が戻らないようにする。
CREATE TABLE body_records (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  weight_kg REAL,
  body_fat_pct REAL,
  muscle_pct REAL,
  lean_mass_kg REAL,
  waist_cm REAL,
  memo TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'health_connect')),
  external_id TEXT,
  origin_package TEXT,${SYNC_COLUMNS},
  UNIQUE (source, external_id)
);
CREATE INDEX body_records_date ON body_records (date);
-- 設定。id がキー（weight_unit など）
CREATE TABLE settings (
  id TEXT PRIMARY KEY NOT NULL,
  value TEXT,${SYNC_COLUMNS}
);
`);
      for (const [i, p] of SEED_BODY_PARTS.entries()) {
        await db.runAsync(
          'INSERT INTO body_parts (id, name, sort_order, hidden, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
          [p.id, p.name, i, now, now],
        );
      }
      for (const [i, e] of SEED_EXERCISES.entries()) {
        await db.runAsync(
          'INSERT INTO exercises (id, body_part_id, name, record_type, sort_order, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
          [e.id, e.bodyPartId, e.name, e.recordType, i, now, now],
        );
      }
    },
  },
  {
    // 食事（docs/meals-design.md）。列の名前は同期の項目（services/meals/meals/infrastructure/sync_entities.py）と同じ。
    // meal_items：品目の ID は食事の中でだけ一意（MCP の複製といつものは、元の品目の ID をそのまま使う）。そこで (meal_id, id) を主キーにする
    // meal_templates：いつもの。id は名前から決める（lib/meals.ts の templateId）。items は品目の一覧の JSON（一覧ごと置き換える）
    // nutrition_goals：目標。id は 'current' だけ。targets は筋トレの日と休みの日の目標の JSON（両方あるか、NULL）
    // day_types：本人が決めた日の種類。id は日付
    version: 2,
    up: async (db) => {
      await db.execAsync(`
CREATE TABLE meals (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  time TEXT,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('photo', 'text', 'numbers', 'copy', 'template')),${SYNC_COLUMNS}
);
CREATE INDEX meals_date ON meals (date);
CREATE TABLE meal_items (
  meal_id TEXT NOT NULL REFERENCES meals(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', '個', '杯')),
  kcal REAL NOT NULL,
  protein_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  sort_order INTEGER NOT NULL,${SYNC_COLUMNS},
  PRIMARY KEY (meal_id, id)
);
CREATE TABLE meal_templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  items TEXT NOT NULL,${SYNC_COLUMNS}
);
CREATE TABLE nutrition_goals (
  id TEXT PRIMARY KEY NOT NULL,
  policy TEXT NOT NULL CHECK (policy IN ('bulk', 'maintain', 'cut')),
  body_weight_kg REAL,
  protein_per_kg REAL,
  targets TEXT,
  eating_style TEXT,
  target_weight_kg REAL,${SYNC_COLUMNS}
);
CREATE TABLE day_types (
  id TEXT PRIMARY KEY NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN ('training', 'rest')),${SYNC_COLUMNS}
);
`);
    },
  },
];

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
