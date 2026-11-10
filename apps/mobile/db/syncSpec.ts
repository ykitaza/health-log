// 同期する対象の種類と、端末の表の対応（docs/sync-design.md の「対象」）。
// サーバーの筋トレの種類（services/training/training/infrastructure/sync_entities.py）と、
// 食事の種類（services/meals/meals/infrastructure/sync_entities.py）と同じ項目・必須の項目にする
import type { Bind } from './types';

/**
 * 列の型。bool は SQLite では 0/1、API では true/false。
 * json は SQLite では JSON の文字列、API ではその値（いつものの品目の一覧、目標の targets）
 */
export type Kind = 'text' | 'int' | 'real' | 'bool' | 'json';

export type SyncType = 'body_part' | 'exercise' | 'workout_entry' | 'workout_set' | 'body_record' | 'setting'
  | 'meal' | 'meal_item' | 'meal_template' | 'nutrition_goal' | 'day_type' | 'sleep_session' | 'heart_rate_day' | 'report';

export type EntitySpec = {
  type: SyncType;
  table: string;
  /** 項目（API の fields の名前）。端末の列の名前と同じ */
  columns: Record<string, Kind>;
  /** create に要る項目。端末に行がないとき、これがそろうまで当てはめない */
  required: string[];
  /** ほかの表を指す項目（その行が端末にないうちは当てはめない。外部キーがあるため） */
  refs?: Record<string, string>;
  /**
   * 親の中でだけ一意な種類（食事の品目）。親の ID を入れる列と、親の表。
   * 端末の行は (親の列, id) で指し、変更には parent_id を付ける。親が端末にないうちは当てはめない
   */
  parent?: { column: string; table: string };
  /**
   * Health Connect から取り込む行の見分け方（ログインの前の記録を outbox に積むときに、origin を 'import' にする）。
   * column の値が equals の行が取り込み。'always' はどの行も取り込み
   */
  imported?: { column: string; equals: string } | 'always';
  /**
   * サーバー（MCP）だけが書く種類（レポート）。アプリからは消すのだけで、サーバーも delete 以外を断る。
   * ログインの前の記録・アカウントを変えたときに outbox に積み直さない（backfillOutbox）
   */
  readOnly?: true;
};

/** 筋トレ・体組成・設定（版2のマイグレーションで、トリガーを作った種類）。版2・版4のマイグレーションは、この形でトリガーを作る */
export const TRAINING_ENTITIES_V2: EntitySpec[] = [
  {
    type: 'body_part', table: 'body_parts',
    columns: { name: 'text', sort_order: 'int', hidden: 'bool' },
    required: ['name', 'sort_order', 'hidden'],
  },
  {
    type: 'exercise', table: 'exercises',
    columns: { body_part_id: 'text', name: 'text', record_type: 'text', sort_order: 'int', hidden: 'bool' },
    required: ['body_part_id', 'name', 'record_type', 'sort_order', 'hidden'],
    refs: { body_part_id: 'body_parts' },
  },
  {
    type: 'workout_entry', table: 'workout_entries',
    columns: { date: 'text', exercise_id: 'text', sort_order: 'int' },
    required: ['date', 'exercise_id', 'sort_order'],
    refs: { exercise_id: 'exercises' },
  },
  {
    type: 'workout_set', table: 'workout_sets',
    columns: { entry_id: 'text', set_index: 'int', weight_kg: 'real', reps: 'int', memo: 'text', done: 'bool' },
    required: ['entry_id', 'set_index', 'reps'],
    refs: { entry_id: 'workout_entries' },
  },
  {
    type: 'body_record', table: 'body_records',
    columns: {
      date: 'text', measured_at: 'text', weight_kg: 'real', body_fat_pct: 'real', muscle_pct: 'real',
      lean_mass_kg: 'real', waist_cm: 'real', memo: 'text', source: 'text', external_id: 'text', origin_package: 'text',
    },
    required: ['date', 'measured_at', 'source'],
    imported: { column: 'source', equals: 'health_connect' },
  },
  {
    type: 'setting', table: 'settings',
    columns: { value: 'text' },
    required: ['value'],
  },
];

/** 食事（版3のマイグレーションで、表とトリガーを作った種類）。版3・版4のマイグレーションは、この形でトリガーを作る */
export const MEAL_ENTITIES_V3: EntitySpec[] = [
  {
    type: 'meal', table: 'meals',
    columns: { date: 'text', slot: 'text', time: 'text', description: 'text', source: 'text' },
    required: ['date', 'slot', 'description', 'source'],
  },
  {
    type: 'meal_item', table: 'meal_items',
    columns: {
      name: 'text', amount: 'real', unit: 'text', kcal: 'real', protein_g: 'real', fat_g: 'real', carbs_g: 'real',
      confidence: 'text', sort_order: 'int',
    },
    required: ['name', 'amount', 'unit', 'kcal', 'protein_g', 'fat_g', 'carbs_g', 'confidence', 'sort_order'],
    parent: { column: 'meal_id', table: 'meals' },
  },
  {
    type: 'meal_template', table: 'meal_templates',
    columns: { name: 'text', items: 'json' },
    required: ['name', 'items'],
  },
  {
    type: 'nutrition_goal', table: 'nutrition_goals',
    columns: {
      policy: 'text', body_weight_kg: 'real', protein_per_kg: 'real', targets: 'json', eating_style: 'text', target_weight_kg: 'real',
    },
    required: ['policy'],
  },
  {
    type: 'day_type', table: 'day_types',
    columns: { day_type: 'text' },
    required: ['day_type'],
  },
];

/**
 * Health Connect から取り込むもの（版5で睡眠、版6で心拍の日のまとめ）。サーバーの筋トレの種類（training.*）として同期する。
 * どれも取り込みだけで作る（手入力はない）
 */
export const HEALTH_ENTITIES: EntitySpec[] = [
  {
    type: 'sleep_session', table: 'sleep_sessions',
    columns: {
      date: 'text', start_at: 'text', end_at: 'text', asleep_min: 'int', awake_min: 'int',
      source: 'text', external_id: 'text', origin_package: 'text',
    },
    required: ['date', 'start_at', 'end_at', 'asleep_min', 'awake_min', 'source'],
    imported: { column: 'source', equals: 'health_connect' },
  },
  {
    // 心拍の1日のまとめ（版6）。source の列はなく、どの行も取り込み
    type: 'heart_rate_day', table: 'heart_rate_days',
    columns: { date: 'text', resting_bpm: 'real', avg_bpm: 'real', min_bpm: 'real', max_bpm: 'real', samples: 'int' },
    required: ['date', 'samples'],
    imported: 'always',
  },
];

/** 版8の形。種目に体重に対する割合（bodyweight_ratio。回数だけの種目の自重の負荷量に使う）を足した。版8のマイグレーションは、この形でトリガーを作る */
export const TRAINING_ENTITIES_V8: EntitySpec[] = TRAINING_ENTITIES_V2.map((s) =>
  s.type === 'exercise' ? { ...s, columns: { ...s.columns, bodyweight_ratio: 'real' } } : s);

/** 筋トレの今の形。版9で、種目に BIG3 の役（big3）とフォームの動画のリンク（form_video_url）を足した */
export const TRAINING_ENTITIES: EntitySpec[] = TRAINING_ENTITIES_V8.map((s) =>
  s.type === 'exercise' ? { ...s, columns: { ...s.columns, big3: 'text', form_video_url: 'text' } } : s);

/** 食事の今の形。版7で、食事に推定の根拠（basis。MCP が書く。アプリの食事は null）を足した */
export const MEAL_ENTITIES: EntitySpec[] = MEAL_ENTITIES_V3.map((s) =>
  s.type === 'meal' ? { ...s, columns: { ...s.columns, basis: 'text' } } : s);

/** レポート（版7）。MCP の save_report だけが作る。highlights と next_steps は SQLite では JSON の文字列 */
export const REPORT_ENTITIES: EntitySpec[] = [
  {
    type: 'report', table: 'reports',
    columns: {
      title: 'text', body: 'text', kind: 'text', period_start: 'text', period_end: 'text',
      overall_tone: 'text', headline: 'text', highlights: 'json', next_steps: 'json',
    },
    required: ['title', 'body', 'kind'],
    readOnly: true,
  },
];

export const ENTITIES: EntitySpec[] = [...TRAINING_ENTITIES, ...MEAL_ENTITIES, ...HEALTH_ENTITIES, ...REPORT_ENTITIES];

export const SPEC_BY_TYPE = new Map(ENTITIES.map((s) => [s.type, s]));

/** SQLite の値（真偽値は 0/1、json は文字列）を API の値にする */
export function toApiFields(spec: EntitySpec, fields: Record<string, Bind>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    const kind = spec.columns[k];
    out[k] = v == null ? v : kind === 'bool' ? v === 1 : kind === 'json' ? JSON.parse(String(v)) : v;
  }
  return out;
}

/** API の値を SQLite の値にする。知らない項目は捨てる */
export function toDbFields(spec: EntitySpec, fields: Record<string, unknown>): Record<string, Bind> {
  const out: Record<string, Bind> = {};
  for (const [k, v] of Object.entries(fields)) {
    const kind = spec.columns[k];
    if (!kind) continue;
    out[k] = kind === 'bool' ? (v ? 1 : 0) : kind === 'json' ? (v == null ? null : JSON.stringify(v)) : (v as Bind);
  }
  return out;
}

/** SQLite で UUID（v4 の形）を作る式。トリガーの中で使う */
export const SQL_UUID = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89AB', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/** 取り込みが書いているあいだは 'import'、ほかは 'app'（トリガーと backfillOutbox で使う） */
export const SQL_ORIGIN = `CASE WHEN EXISTS (SELECT 1 FROM sync_meta WHERE key = 'importing') THEN 'import' ELSE 'app' END`;

/**
 * 表を変えるたびに、変更を outbox に積むトリガー。項目ごとに、変わったものだけを積む。
 * changed_at は行の updated_at（削除は deleted_at）。サーバーから受け取った状態を当てはめるあいだ
 * （sync_meta に applying があるあいだ）は積まない。
 * origin（版4で outbox に足した）は、Health Connect の取り込みが書くあいだ（sync_meta に importing があるあいだ）は
 * 'import'、ほかは 'app'。版3までのマイグレーションは、その版の形（withOrigin = false）で作る
 */
export function triggerSql(spec: EntitySpec, withOrigin = true): string {
  const cols = Object.keys(spec.columns);
  const t = `'${spec.type}'`;
  const notApplying = `NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'applying')`;
  // 親の中でだけ一意な種類（食事の品目）は、親の ID も積む（版3で outbox に parent_id を足した。版2の種類は今のまま）
  const parent = spec.parent ? `NEW.${spec.parent.column}, ` : '';
  const insert = `INSERT INTO sync_outbox (change_id, entity_type, entity_id, ${spec.parent ? 'parent_id, ' : ''}op, fields, changed_at${withOrigin ? ', origin' : ''})`;
  const origin = withOrigin ? `, ${SQL_ORIGIN}` : '';
  const allFields = `json_object(${cols.map((c) => `'${c}', NEW.${c}`).join(', ')})`;
  const changed = cols.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');
  const diff = `(SELECT json_group_object(k, v) FROM (${cols
    .map((c) => `SELECT '${c}' AS k, NEW.${c} AS v WHERE OLD.${c} IS NOT NEW.${c}`).join(' UNION ALL ')}))`;
  return `
CREATE TRIGGER sync_${spec.table}_insert AFTER INSERT ON ${spec.table} WHEN ${notApplying}
BEGIN
  ${insert} VALUES (${SQL_UUID}, ${t}, NEW.id, ${parent}'create', ${allFields}, NEW.updated_at${origin});
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, ${parent}'delete', NULL, NEW.deleted_at${origin} WHERE NEW.deleted_at IS NOT NULL;
END;
CREATE TRIGGER sync_${spec.table}_update AFTER UPDATE ON ${spec.table} WHEN ${notApplying}
BEGIN
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, ${parent}'restore', NULL, NEW.updated_at${origin}
    WHERE OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL;
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, ${parent}'update', ${diff}, NEW.updated_at${origin} WHERE ${changed};
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, ${parent}'delete', NULL, NEW.deleted_at${origin}
    WHERE OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL;
END;`;
}
