// 同期する対象の種類と、端末の表の対応（docs/sync-design.md の「対象」）。
// サーバーの筋トレの種類（services/training/training/infrastructure/sync_entities.py）と同じ項目・必須の項目にする。
// 食事の種類（meal など）は、食事タブの段階で足す。それまでは受け取っても当てはめない（docs/sync-design.md）
import type { Bind } from './types';

/** 列の型。bool は SQLite では 0/1、API では true/false */
export type Kind = 'text' | 'int' | 'real' | 'bool';

export type SyncType = 'body_part' | 'exercise' | 'workout_entry' | 'workout_set' | 'body_record' | 'setting';

export type EntitySpec = {
  type: SyncType;
  table: string;
  /** 項目（API の fields の名前）。端末の列の名前と同じ */
  columns: Record<string, Kind>;
  /** create に要る項目。端末に行がないとき、これがそろうまで当てはめない */
  required: string[];
  /** ほかの表を指す項目（その行が端末にないうちは当てはめない。外部キーがあるため） */
  refs?: Record<string, string>;
};

export const ENTITIES: EntitySpec[] = [
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

export const SPEC_BY_TYPE = new Map(ENTITIES.map((s) => [s.type, s]));

/** SQLite の値（真偽値は 0/1）を API の値にする */
export function toApiFields(spec: EntitySpec, fields: Record<string, Bind>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = spec.columns[k] === 'bool' && v != null ? v === 1 : v;
  return out;
}

/** API の値を SQLite の値にする。知らない項目は捨てる */
export function toDbFields(spec: EntitySpec, fields: Record<string, unknown>): Record<string, Bind> {
  const out: Record<string, Bind> = {};
  for (const [k, v] of Object.entries(fields)) {
    const kind = spec.columns[k];
    if (!kind) continue;
    out[k] = kind === 'bool' ? (v ? 1 : 0) : (v as Bind);
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
  const insert = `INSERT INTO sync_outbox (change_id, entity_type, entity_id, op, fields, changed_at)`;
  const allFields = `json_object(${cols.map((c) => `'${c}', NEW.${c}`).join(', ')})`;
  const changed = cols.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');
  const diff = `(SELECT json_group_object(k, v) FROM (${cols
    .map((c) => `SELECT '${c}' AS k, NEW.${c} AS v WHERE OLD.${c} IS NOT NEW.${c}`).join(' UNION ALL ')}))`;
  return `
CREATE TRIGGER sync_${spec.table}_insert AFTER INSERT ON ${spec.table} WHEN ${notApplying}
BEGIN
  ${insert} VALUES (${SQL_UUID}, ${t}, NEW.id, 'create', ${allFields}, NEW.updated_at);
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, 'delete', NULL, NEW.deleted_at WHERE NEW.deleted_at IS NOT NULL;
END;
CREATE TRIGGER sync_${spec.table}_update AFTER UPDATE ON ${spec.table} WHEN ${notApplying}
BEGIN
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, 'restore', NULL, NEW.updated_at
    WHERE OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL;
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, 'update', ${diff}, NEW.updated_at WHERE ${changed};
  ${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, 'delete', NULL, NEW.deleted_at
    WHERE OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL;
END;`;
}
