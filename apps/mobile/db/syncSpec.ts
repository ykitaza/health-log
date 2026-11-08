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
  | 'meal' | 'meal_item' | 'meal_template' | 'nutrition_goal' | 'day_type';

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
};

/** 筋トレ・体組成・設定（版2のマイグレーションで、トリガーを作った種類） */
export const TRAINING_ENTITIES: EntitySpec[] = [
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
  },
  {
    type: 'setting', table: 'settings',
    columns: { value: 'text' },
    required: ['value'],
  },
];

/** 食事（版3のマイグレーションで、表とトリガーを作った種類） */
export const MEAL_ENTITIES: EntitySpec[] = [
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

export const ENTITIES: EntitySpec[] = [...TRAINING_ENTITIES, ...MEAL_ENTITIES];

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

/**
 * 表を変えるたびに、変更を outbox に積むトリガー。項目ごとに、変わったものだけを積む。
 * changed_at は行の updated_at（削除は deleted_at）。サーバーから受け取った状態を当てはめるあいだ
 * （sync_meta に applying があるあいだ）は積まない
 */
export function triggerSql(spec: EntitySpec): string {
  const cols = Object.keys(spec.columns);
  const t = `'${spec.type}'`;
  const notApplying = `NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'applying')`;
  // 親の中でだけ一意な種類（食事の品目）は、親の ID も積む（版3で outbox に parent_id を足した。版2の種類は今のまま）
  const parent = spec.parent ? `NEW.${spec.parent.column}, ` : '';
  const insert = `INSERT INTO sync_outbox (change_id, entity_type, entity_id, ${spec.parent ? 'parent_id, ' : ''}op, fields, changed_at)`;
  const allFields = `json_object(${cols.map((c) => `'${c}', NEW.${c}`).join(', ')})`;
  const changed = cols.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');
  const diff = `(SELECT json_group_object(k, v) FROM (${cols
    .map((c) => `SELECT '${c}' AS k, NEW.${c} AS v WHERE OLD.${c} IS NOT NEW.${c}`).join(' UNION ALL ')}))`;
  return `
CREATE TRIGGER sync_${spec.table}_insert AFTER INSERT ON ${spec.table} WHEN ${notApplying}
BEGIN
  ${insert} VALUES (${SQL_UUID}, ${t}, NEW.id, ${parent}'create', ${allFields}, NEW.updated_at);
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, ${parent}'delete', NULL, NEW.deleted_at WHERE NEW.deleted_at IS NOT NULL;
END;
CREATE TRIGGER sync_${spec.table}_update AFTER UPDATE ON ${spec.table} WHEN ${notApplying}
BEGIN
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, ${parent}'restore', NULL, NEW.updated_at
    WHERE OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL;
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, ${parent}'update', ${diff}, NEW.updated_at WHERE ${changed};
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, ${parent}'delete', NULL, NEW.deleted_at
    WHERE OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL;
END;`;
}
