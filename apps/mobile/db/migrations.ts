// マイグレーション。PRAGMA user_version に、当てた最後の版を持つ。
// 版を足すときは、MIGRATIONS の末尾に足す（すでに当てたものは変えない）。
//
// どの表も、のちにサーバーと同期できるように、次の列を持つ。
//   id（UUID）、created_at・updated_at（ISO 8601、UTC）、deleted_at（論理削除。NULL なら生きている）
import { SEED_BODY_PARTS, SEED_EXERCISES } from './seed';
import {
  ENTITIES, EntitySpec, HEALTH_ENTITIES, INJURY_ENTITIES, MEAL_ENTITIES, MEAL_ENTITIES_V3, PHASE_ENTITIES, REPORT_ENTITIES, REPORT_ENTITIES_V7, REPORT_ENTITIES_V9, SQL_UUID, TRAINING_ENTITIES,
  TRAINING_ENTITIES_V10, TRAINING_ENTITIES_V2, TRAINING_ENTITIES_V8, triggerSql,
} from './syncSpec';
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
      await insertSeeds(db, now);
    },
  },
  {
    // 同期（docs/sync-design.md の「アプリの同期」）。
    // sync_outbox：送っていない変更（トリガーが積む）。断られたものは status = 'rejected' で残し、送り直さない
    // sync_meta：端末の ID、受け取りの位置（cursor）、最後に同期した時刻など
    // sync_seen：対象ごとに、当てはめた状態の seq（古い状態で上書きしないため）
    // sync_held：端末にまだ行がなく、項目か親がそろっていない状態（そろったら当てはめる）
    version: 2,
    up: async (db) => {
      await db.execAsync(`
CREATE TABLE sync_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete', 'restore')),
  fields TEXT,
  changed_at TEXT NOT NULL,
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
`);
      await backfillOutbox(db, TRAINING_ENTITIES_V2, false);
      for (const spec of TRAINING_ENTITIES_V2) await db.execAsync(triggerSql(spec, false));
    },
  },
  {
    // 食事（docs/meals-design.md）。列の名前は同期の項目（services/meals/meals/infrastructure/sync_entities.py）と同じ。
    // meal_items：品目の ID は食事の中でだけ一意（MCP の複製といつものは、元の品目の ID をそのまま使う）。そこで (meal_id, id) を主キーにする
    // meal_templates：いつもの。id は名前から決める（lib/meals.ts の templateId）。items は品目の一覧の JSON（一覧ごと置き換える）
    // nutrition_goals：目標。id は 'current' だけ。targets は筋トレの日と休みの日の目標の JSON（両方あるか、NULL）
    // day_types：本人が決めた日の種類。id は日付
    // 同期：outbox に親の ID（parent_id。品目の変更に付ける）を足し、食事の表にトリガーを作る。
    // 版2までの端末は、受け取った食事の状態を当てはめずに受け取りの位置（cursor）だけ進めていたので、
    // 位置を消して、次の同期でスナップショットを1回取り直す（サーバーが正本で、消えたものも含めて全部返る。
    // 筋トレなどは、当てはめた seq（sync_seen）より古い状態では上書きしない）
    version: 3,
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
ALTER TABLE sync_outbox ADD COLUMN parent_id TEXT;
DELETE FROM sync_meta WHERE key = 'cursor';
`);
      for (const spec of MEAL_ENTITIES_V3) await db.execAsync(triggerSql(spec, false));
    },
  },
  {
    // Health Connect の取り込み（docs/sync-design.md の「Health Connect の取り込み」）。
    // outbox に origin（'app' か 'import'）を足し、トリガーを作り直す。取り込みが書くあいだ（sync_meta に importing があるあいだ）に
    // 積んだ変更は 'import' になり、サーバーで手入力より弱く当てはめられる。今まで積んだものは、どれも手入力（'app'）
    version: 4,
    up: async (db) => {
      await db.execAsync(`ALTER TABLE sync_outbox ADD COLUMN origin TEXT NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'import'));`);
      for (const spec of [...TRAINING_ENTITIES_V2, ...MEAL_ENTITIES_V3]) {
        await db.execAsync(`DROP TRIGGER sync_${spec.table}_insert; DROP TRIGGER sync_${spec.table}_update;`);
        await db.execAsync(triggerSql(spec));
      }
    },
  },
  {
    // 睡眠（Health Connect の SleepSession の1件を1行に）。date は起きた日（その土地の日付）。
    // asleep_min は眠っていた分（全体から、段階の「起きていた・ベッドの外」を引いたもの）、awake_min はその引いた分。段階の詳細は持たない。
    // 同じ source と external_id の組は1行だけ（消した行も含め、取り込み直しで消した記録が戻らないように）
    version: 5,
    up: async (db) => {
      await db.execAsync(`
CREATE TABLE sleep_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  asleep_min INTEGER NOT NULL,
  awake_min INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'health_connect' CHECK (source IN ('health_connect')),
  external_id TEXT,
  origin_package TEXT,${SYNC_COLUMNS},
  UNIQUE (source, external_id)
);
CREATE INDEX sleep_sessions_date ON sleep_sessions (date);
`);
      for (const spec of HEALTH_ENTITIES.filter((s) => s.table === 'sleep_sessions')) await db.execAsync(triggerSql(spec));
    },
  },
  {
    // 心拍の1日のまとめ（Health Connect の HeartRate と RestingHeartRate を、その日について集計したもの）。サンプルは持たない。
    // id は日付から決める（lib/healthConnect/importer.ts の heartRateDayId）。date は端末の暦の日付。
    // samples はその日のサンプルの数。安静時心拍しかない日は、avg・min・max が NULL で samples が 0
    version: 6,
    up: async (db) => {
      await db.execAsync(`
CREATE TABLE heart_rate_days (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  resting_bpm REAL,
  avg_bpm REAL,
  min_bpm REAL,
  max_bpm REAL,
  samples INTEGER NOT NULL,${SYNC_COLUMNS}
);
CREATE INDEX heart_rate_days_date ON heart_rate_days (date);
`);
      for (const spec of HEALTH_ENTITIES.filter((s) => s.table === 'heart_rate_days')) await db.execAsync(triggerSql(spec));
    },
  },
  {
    // レポート（Claude・ChatGPT が MCP の save_report で書いたまとめ。docs/sync-design.md の「レポート」）と、食事の推定の根拠。
    // reports は受け取って当てはめるだけで、アプリは deleted_at を入れる（消す）ことしかしない。トリガーは同じ作り方なので、
    // 消すと delete だけが積まれる。値の確かめはサーバーと lib/reports.ts（読むとき）で行い、表には CHECK を付けない
    // （知らない値でも当てはめを止めないため）。highlights・next_steps は JSON の文字列。
    // meals.basis は kcal と PFC を推定した根拠（MCP が書く）。列を足し、食事のトリガーを作り直す（create で basis も積む）。
    // 版6までの端末は、知らない種類（report）を飛ばして受け取りの位置だけ進めていたので、位置を消して、次の同期で
    // スナップショットを1回取り直す（版3と同じ。当てはめた seq より古い状態では上書きしない）
    version: 7,
    up: async (db) => {
      await db.execAsync(`
CREATE TABLE reports (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  overall_tone TEXT,
  headline TEXT,
  highlights TEXT,
  next_steps TEXT,${SYNC_COLUMNS}
);
CREATE INDEX reports_created_at ON reports (created_at);
ALTER TABLE meals ADD COLUMN basis TEXT;
DROP TRIGGER sync_meals_insert;
DROP TRIGGER sync_meals_update;
DELETE FROM sync_meta WHERE key = 'cursor';
`);
      for (const spec of [...MEAL_ENTITIES.filter((s) => s.table === 'meals'), ...REPORT_ENTITIES_V7]) await db.execAsync(triggerSql(spec));
    },
  },
  {
    // 自重の種目（回数だけ）の負荷量に使う、種目の体重に対する割合（0〜1。lib/bodyweight.ts）。重量×回数の種目は NULL。
    // 列を足して種目のトリガーを作り直す（割合を変えると outbox に積んで送る）。今までの種目は NULL のままにし、
    // 読むときに名前から決める（ratioOf）。サーバーも割合のない種目は同じ決まりで名前から決めるので、両方で同じ値になる。
    // ここで値を書き込むと、入れたばかりの端末が初期の種目の変更を送ることになり、送らないと名前を変えたときに食い違うため。
    // 範囲（0〜1）はサーバーと画面で確かめ、表には CHECK を付けない（受け取った値の当てはめを止めないため）
    version: 8,
    up: async (db) => {
      await db.execAsync(`
ALTER TABLE exercises ADD COLUMN bodyweight_ratio REAL;
DROP TRIGGER sync_exercises_insert;
DROP TRIGGER sync_exercises_update;
`);
      for (const spec of TRAINING_ENTITIES_V8.filter((s) => s.table === 'exercises')) await db.execAsync(triggerSql(spec));
    },
  },
  {
    // レポートのつながり（links）と目標の見直し（review）。どちらも JSON の文字列で、ないレポートは NULL。列を足してトリガーを作り直す
    // （アプリはレポートを消すだけなので、積むものは変わらない。トリガーの項目を表の列とそろえておく）。
    // 版8までの端末は、受け取ったレポートの知らない項目（links・review）を捨てていた。受け取りの位置を消してスナップショットを
    // 取り直し、レポートの当てはめた印（sync_seen）も消して、受け取り済みのレポートにも当てはめ直す（同じ ID の行を上書きするので
    // 重ならない。消したものはサーバーでも消えているか、まだ送っていない delete が outbox にあって端末の削除が残る）。
    // ほかの種類は当てはめた印が残るので、スナップショットでは上書きしない（版3・版7と同じ）
    version: 9,
    up: async (db) => {
      await db.execAsync(`
ALTER TABLE reports ADD COLUMN links TEXT;
ALTER TABLE reports ADD COLUMN review TEXT;
DROP TRIGGER sync_reports_insert;
DROP TRIGGER sync_reports_update;
DELETE FROM sync_meta WHERE key = 'cursor';
DELETE FROM sync_seen WHERE entity_type = 'report';
DELETE FROM sync_held WHERE entity_type = 'report';
`);
      for (const spec of REPORT_ENTITIES_V9) await db.execAsync(triggerSql(spec));
    },
  },
  {
    // 種目の BIG3 の役（big3：bench・squat・deadlift。NULL は割り当てなし）と、フォームの動画のリンク（form_video_url）。
    // 列を足して種目のトリガーを作り直す。今までの種目は NULL のまま（版8と同じく、ここで値を書くと初期の種目の変更を送ることになる）。
    // どの種目にも役がないあいだは、読むときに名前で決める（lib/exercises.ts の big3Assignments。サーバーも同じ決まり）。
    // 値の確かめ（役の3つ、https:// のリンク）はサーバーと画面で行い、表には CHECK を付けない（受け取った値の当てはめを止めないため）
    version: 10,
    up: async (db) => {
      await db.execAsync(`
ALTER TABLE exercises ADD COLUMN big3 TEXT;
ALTER TABLE exercises ADD COLUMN form_video_url TEXT;
DROP TRIGGER sync_exercises_insert;
DROP TRIGGER sync_exercises_update;
`);
      for (const spec of TRAINING_ENTITIES_V10.filter((s) => s.table === 'exercises')) await db.execAsync(triggerSql(spec));
    },
  },
  {
    // 歩数の1日の合計（Health Connect の Steps を、その日について集計したもの。版6の心拍の日のまとめと同じ作り）。1件ごとの記録は持たない。
    // id は日付から決める（lib/healthConnect/importer.ts の stepDayId）。date は端末の暦の日付。記録がない日は行を作らない（消す）。
    // 新しい種類だが、受け取りの位置は消さない（版7・版9と違う）：歩数はこの版の端末の取り込みだけが作り、前の版の端末が
    // 飛ばした step_day はサーバーにないため
    version: 11,
    up: async (db) => {
      await db.execAsync(`
CREATE TABLE step_days (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  steps INTEGER NOT NULL,${SYNC_COLUMNS}
);
CREATE INDEX step_days_date ON step_days (date);
`);
      for (const spec of HEALTH_ENTITIES.filter((s) => s.table === 'step_days')) await db.execAsync(triggerSql(spec));
    },
  },
  {
    // 次の一歩のチェック（レポートの next_steps_done。済んだ番号の JSON。docs/sync-design.md の「レポート」）。今までは端末だけ
    // （sync_meta の home.weekly_todo）に置いていたものを、レポートの項目にしてサーバーに送る（次の週のまとめで Claude・ChatGPT が読む）。
    // 列を足してトリガーを作り直し、sync_meta の値を一度だけ移す（トリガーが update を積み、次の同期で送る）。
    // ほかの端末が送ったチェックは、版11までの端末では知らない項目として捨てていたので、版9と同じく受け取りの位置と
    // レポートの当てはめた印を消して、スナップショットで取り直す（移したチェックは outbox にあるので、端末の値が残る）
    version: 12,
    up: async (db, now) => {
      await db.execAsync(`
ALTER TABLE reports ADD COLUMN next_steps_done TEXT;
DROP TRIGGER sync_reports_insert;
DROP TRIGGER sync_reports_update;
DELETE FROM sync_meta WHERE key = 'cursor';
DELETE FROM sync_seen WHERE entity_type = 'report';
DELETE FROM sync_held WHERE entity_type = 'report';
`);
      for (const spec of REPORT_ENTITIES) await db.execAsync(triggerSql(spec));
      const old = await db.getFirstAsync<{ value: string | null }>(`SELECT value FROM sync_meta WHERE key = 'home.weekly_todo'`, []);
      const moved = old?.value ? oldTodoChecks(old.value) : null;
      if (moved) {
        const row = await db.getFirstAsync<{ next_steps: string | null }>(
          'SELECT next_steps FROM reports WHERE id = ? AND deleted_at IS NULL', [moved.reportId]);
        let count = 0;
        try { count = row?.next_steps ? (JSON.parse(row.next_steps) as unknown[]).length : 0; } catch { count = 0; }
        const done = moved.done.filter((n) => n < count);
        if (done.length > 0) {
          await db.runAsync('UPDATE reports SET next_steps_done = ?, updated_at = ? WHERE id = ?', [JSON.stringify(done), now, moved.reportId]);
        }
      }
      await db.execAsync(`DELETE FROM sync_meta WHERE key = 'home.weekly_todo';`);
    },
  },
  {
    // ケガの記録（injuries）と、その後の振り返り（injury_reviews）。docs/sync-design.md の「対象」の注。
    // 列の名前は同期の項目（services/training/training/infrastructure/sync_entities.py）と同じ。値の確かめ（部位のコード・状態・結果）は
    // サーバーと lib/injuries.ts で行い、表には CHECK を付けない（MCP が書いた値でも当てはめを止めないため。版7と同じ）。
    // 文字の項目は NOT NULL DEFAULT ''（受け取った create は、要る項目の occurred_on・site・status だけのこともある）。
    // 版12までの端末は、知らない種類（injury・injury_review）を飛ばして受け取りの位置だけ進めていたので、位置を消して、
    // 次の同期でスナップショットを1回取り直す（版7と同じ。飛ばしたものは sync_seen・sync_held に残っていない）
    version: 13,
    up: async (db) => {
      await db.execAsync(`
CREATE TABLE injuries (
  id TEXT PRIMARY KEY NOT NULL,
  occurred_on TEXT NOT NULL,
  site TEXT NOT NULL,
  side TEXT,
  exercise_id TEXT REFERENCES exercises(id),
  phase TEXT NOT NULL DEFAULT '',
  symptom TEXT NOT NULL DEFAULT '',
  cause TEXT NOT NULL DEFAULT '',
  fix TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  fixed_on TEXT,${SYNC_COLUMNS}
);
CREATE TABLE injury_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  injury_id TEXT NOT NULL REFERENCES injuries(id),
  date TEXT NOT NULL,
  result TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  exercise_id TEXT REFERENCES exercises(id),${SYNC_COLUMNS}
);
CREATE INDEX injury_reviews_injury ON injury_reviews (injury_id);
DELETE FROM sync_meta WHERE key = 'cursor';
`);
      for (const spec of INJURY_ENTITIES) await db.execAsync(triggerSql(spec));
    },
  },
  {
    // 体組成から筋肉率（muscle_pct）とウエスト（waist_cm）を外す（画面からは先に外した。値も残さない）。
    // 1. 手入力の行で、その2つのどちらかに値があり、ほかの値（体重・体脂肪率・除脂肪体重・メモ）がない行は、列を消すと空になるので消す
    //    （saveManual が空の行を作らないのと同じ）。今のトリガーのうちに消すので、delete が積まれ、サーバーの記録も消える
    // 2. まだ送っていない変更・当てはめを待つ状態から2つの項目を取り除く（項目がなくなった update は捨てる）
    // 3. 列を参照するトリガーを消してから列を消し、トリガーを今の形で作り直す
    version: 14,
    up: async (db, now) => {
      await db.runAsync(
        `UPDATE body_records SET deleted_at = ?, updated_at = ?
         WHERE deleted_at IS NULL AND source = 'manual' AND (muscle_pct IS NOT NULL OR waist_cm IS NOT NULL)
           AND weight_kg IS NULL AND body_fat_pct IS NULL AND lean_mass_kg IS NULL AND memo = ''`, [now, now],
      );
      await db.execAsync(`
UPDATE sync_outbox SET fields = json_remove(fields, '$.muscle_pct', '$.waist_cm') WHERE entity_type = 'body_record' AND fields IS NOT NULL;
DELETE FROM sync_outbox WHERE entity_type = 'body_record' AND op = 'update' AND fields = '{}';
UPDATE sync_held SET state = json_remove(state, '$.fields.muscle_pct', '$.fields.waist_cm') WHERE entity_type = 'body_record';
DROP TRIGGER sync_body_records_insert;
DROP TRIGGER sync_body_records_update;
ALTER TABLE body_records DROP COLUMN muscle_pct;
ALTER TABLE body_records DROP COLUMN waist_cm;
`);
      for (const spec of TRAINING_ENTITIES.filter((s) => s.table === 'body_records')) await db.execAsync(triggerSql(spec));
    },
  },
  {
    // フェーズ（増量・減量・維持と療養の期間）。表とトリガーを作る。版14までの端末は phase を知らない種類として飛ばし、受け取りの
    // 位置だけ進めていたので、版13と同じく受け取りの位置を消して取り直す（ほかの端末で始めたフェーズを受け取るため）。
    // 文字・履歴の列は NULL にしない（サーバーは str・list で、null を断る）
    version: 15,
    up: async (db) => {
      await db.execAsync(`
CREATE TABLE phases (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  direction TEXT,
  name TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT,
  target_weight_kg REAL,
  meal_targets TEXT,
  snapshot TEXT,
  status TEXT NOT NULL,
  paused_phase_id TEXT,
  target_history TEXT NOT NULL DEFAULT '[]',
  ended_on TEXT,${SYNC_COLUMNS}
);
DELETE FROM sync_meta WHERE key = 'cursor';
`);
      for (const spec of PHASE_ENTITIES) await db.execAsync(triggerSql(spec));
    },
  },
];

/** 版11までの今週やることのチェック（sync_meta の home.weekly_todo。{ reportId, done }）。壊れた値なら null。番号は小さい順で重ならない */
function oldTodoChecks(raw: string): { reportId: string; done: number[] } | null {
  try {
    const v = JSON.parse(raw) as { reportId?: unknown; done?: unknown };
    if (typeof v?.reportId !== 'string' || !Array.isArray(v.done)) return null;
    const done = [...new Set(v.done.filter((n): n is number => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
    return { reportId: v.reportId, done };
  } catch {
    return null;
  }
}

/** 初期の部位と種目を入れる（入れたばかりの端末と同じにする。端末の記録を消して受け取り直すときにも使う） */
export async function insertSeeds(db: Db, now: string) {
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
}

/**
 * ログインの前に端末で作った記録を、最初の同期で送れるように outbox に積む（別のアカウントに送り直すときにも使う）。
 * - 初期の部位と種目は、初期の値から変えた項目だけを update で積む（変えていないものを送ると、
 *   ほかの端末や MCP で変えた値を、この端末を入れた時刻で上書きしてしまうため）
 * - それ以外は、今の値を create で積む。時刻は行の updated_at
 * - 消した行は積まない（同期の前に消したものは、サーバーが知らないので）。初期のものを消していたら delete を積む
 * - 食事の品目は、親の食事の ID（parent_id）を付けて積む。消した食事の品目は積まない
 * - Health Connect から取り込んだ行（EntitySpec の imported）は、origin を 'import' で積む（手入力より弱くする）
 * - サーバーだけが書く種類（EntitySpec の readOnly。レポート）は積まない（サーバーが delete 以外を断るため）
 * specs は積む種類。版2のマイグレーションは筋トレの種類だけ（食事の表は版3で作るので、まだない）。
 * withOrigin は outbox に origin があるか（版4で足した。版2のマイグレーションは false）
 */
export async function backfillOutbox(db: Db, specs: EntitySpec[] = ENTITIES, withOrigin = true) {
  const seeds: Record<string, Map<string, Record<string, Bind>>> = {
    body_parts: new Map(SEED_BODY_PARTS.map((p, i) => [p.id, { name: p.name, sort_order: i, hidden: 0 }])),
    exercises: new Map(SEED_EXERCISES.map((e, i) => [e.id, {
      body_part_id: e.bodyPartId, name: e.name, record_type: e.recordType, sort_order: i, hidden: 0,
      // 割合（版8）は、初期の値を持たない（NULL は名前から決める）。画面で決めた割合は、変えた項目として送る
      bodyweight_ratio: null,
      // BIG3 の役とフォームの動画（版10）も、初期の値を持たない（役は、どれにもなければ名前で決める）
      big3: null, form_video_url: null,
    }])),
  };
  const add = (type: string, id: string, op: string, fields: Record<string, Bind> | null, at: string, parentId: string | null = null,
    origin: 'app' | 'import' = 'app') => {
    const cols = ['entity_type', 'entity_id', ...(parentId == null ? [] : ['parent_id']), 'op', 'fields', 'changed_at', ...(withOrigin ? ['origin'] : [])];
    const values = [type, id, ...(parentId == null ? [] : [parentId]), op, fields ? JSON.stringify(fields) : null, at, ...(withOrigin ? [origin] : [])];
    return db.runAsync(
      `INSERT INTO sync_outbox (change_id, ${cols.join(', ')}) VALUES (${SQL_UUID}, ${cols.map(() => '?').join(', ')})`, values,
    );
  };
  for (const spec of specs) {
    if (spec.readOnly) continue;
    const cols = Object.keys(spec.columns);
    const parent = spec.parent;
    const rows = await db.getAllAsync<Record<string, Bind>>(
      parent
        ? `SELECT c.id, c.${parent.column} AS parent_id, c.updated_at, c.deleted_at, ${cols.map((x) => `c.${x}`).join(', ')}
           FROM ${spec.table} c JOIN ${parent.table} p ON p.id = c.${parent.column}
           WHERE p.deleted_at IS NULL ORDER BY c.created_at, c.${parent.column}, c.id`
        : `SELECT id, updated_at, deleted_at, ${cols.join(', ')} FROM ${spec.table} ORDER BY created_at, id`, [],
    );
    for (const row of rows) {
      const id = row.id as string;
      const values = Object.fromEntries(cols.map((c) => [c, row[c]]));
      const seed = seeds[spec.table]?.get(id);
      if (seed) {
        const changed = Object.fromEntries(cols.filter((c) => seed[c] !== values[c]).map((c) => [c, values[c]]));
        if (Object.keys(changed).length > 0) await add(spec.type, id, 'update', changed, row.updated_at as string);
        if (row.deleted_at) await add(spec.type, id, 'delete', null, row.deleted_at as string);
      } else if (!row.deleted_at) {
        const imported = spec.imported === 'always' || (spec.imported && values[spec.imported.column] === spec.imported.equals);
        await add(spec.type, id, 'create', values, row.updated_at as string, (row.parent_id as string | undefined) ?? null,
          imported ? 'import' : 'app');
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
