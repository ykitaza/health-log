// 同期する対象の種類と、端末の表の対応（docs/words-design.md の「データ」と「同期」、docs/api/words-app-api.yaml）。
// KARADA の db/syncSpec.ts を写し、ことばの種類だけにした。サーバーの services/words/words/infrastructure/sync_entities.py と同じ項目にする。
import type { Bind } from './types';

/** 列の型。bool は SQLite では 0/1、API では true/false。json は SQLite では JSON の文字列、API ではその値 */
export type Kind = 'text' | 'int' | 'real' | 'bool' | 'json';

export type SyncType = 'source' | 'tag' | 'expression' | 'expression_tag' | 'encounter' | 'usage' | 'listen_session';

export type EntitySpec = {
  type: SyncType;
  table: string;
  /** 項目（API の fields の名前）。端末の列の名前と同じ。受け取った状態は、ここにある項目を当てはめる */
  columns: Record<string, Kind>;
  /**
   * アプリから送る項目（サーバーの EntitySpec.app_fields）。ない種類は columns の全部。
   * 表現の補う項目（意味・ニュアンス・言い換え・役立ち度）は Claude だけが書くので、アプリは送らない（サーバーも断る）
   */
  sendable?: string[];
  /** create に要る項目。端末に行がないとき、これがそろうまで当てはめない（サーバーの REQUIRED と同じ） */
  required: string[];
  /** ほかの表を指す項目（その行が端末にないうちは当てはめない。外部キーがあるため） */
  refs?: Record<string, string>;
  /** いっしょに送る項目の組（組のどれかが変わったら、組の全部を update に入れる。サーバーは項目ごとの後勝ちのため） */
  together?: string[][];
  /** アプリから送れる op（source・tag は消さずに隠す。usage・listen_session は追記だけ） */
  ops?: ('create' | 'update' | 'delete' | 'restore')[];
};

/** 間隔の項目（聞いた・使えたで一緒に変わるので、組で送る。サーバーの SCHEDULE_FIELDS） */
export const SCHEDULE_FIELDS = ['stage', 'interval_days', 'due_on', 'listened_at', 'listen_count', 'use_count', 'last_used_on'];

/** 表現の、Claude だけが書く項目（補う・振り返り。例文は本人も書くので入れない。サーバーの ENRICH_FIELDS） */
export const ENRICH_FIELDS = ['meaning', 'nuance', 'similar', 'usefulness', 'usefulness_reason', 'usefulness_until', 'enriched_at'];

const EXPRESSION_COLUMNS: Record<string, Kind> = {
  text: 'text', source_id: 'text', normalized_key: 'text', scene: 'text', note: 'text', star: 'bool',
  place: 'text', stage: 'text', moved_at: 'text', hand_since: 'text',
  interval_days: 'int', due_on: 'text', listened_at: 'text', listen_count: 'int', use_count: 'int', last_used_on: 'text',
  reading: 'text', use_note: 'text', meaning: 'text', nuance: 'text', register: 'text', register_by: 'text',
  examples: 'json', similar: 'json', usefulness: 'int', usefulness_reason: 'text', usefulness_until: 'text', enriched_at: 'text',
};

/** 親が先の順（当てはめと、端末の記録を消すときの順） */
export const ENTITIES: EntitySpec[] = [
  {
    type: 'source', table: 'sources',
    columns: { name: 'text', icon_key: 'text', sort_order: 'int', hidden: 'bool' },
    required: ['name', 'icon_key', 'sort_order', 'hidden'],
    ops: ['create', 'update', 'restore'],
  },
  {
    type: 'tag', table: 'tags',
    columns: { kind: 'text', name: 'text', sort_order: 'int', hidden: 'bool', created_by: 'text' },
    required: ['kind', 'name', 'sort_order', 'hidden'],
    ops: ['create', 'update', 'restore'],
  },
  {
    type: 'expression', table: 'expressions',
    columns: EXPRESSION_COLUMNS,
    sendable: Object.keys(EXPRESSION_COLUMNS).filter((c) => !ENRICH_FIELDS.includes(c)),
    required: ['text', 'normalized_key', 'place'],
    refs: { source_id: 'sources' },
    together: [SCHEDULE_FIELDS, ['place', 'moved_at', 'hand_since', 'stage'], ['register', 'register_by']],
  },
  {
    type: 'expression_tag', table: 'expression_tags',
    columns: { expression_id: 'text', tag_id: 'text', added_by: 'text', status: 'text', confirmed_at: 'text' },
    required: ['expression_id', 'tag_id', 'added_by', 'status'],
    refs: { expression_id: 'expressions', tag_id: 'tags' },
    together: [['added_by', 'status', 'confirmed_at']],
  },
  {
    type: 'encounter', table: 'encounters',
    columns: {
      expression_id: 'text', source_id: 'text', title: 'text', locator: 'text', met_on: 'text', time_hint: 'text',
      scene: 'text', surrounding_text: 'text', wording: 'text', captured_via: 'text', note: 'text',
    },
    required: ['expression_id'],
    refs: { expression_id: 'expressions', source_id: 'sources' },
  },
  {
    // 使えたの記録（追記だけ）
    type: 'usage', table: 'usages',
    columns: { expression_id: 'text', used_on: 'text', scene: 'text', note: 'text' },
    required: ['expression_id', 'used_on'],
    refs: { expression_id: 'expressions' },
    ops: ['create', 'delete'],
  },
  {
    // 聞いた1回（アプリだけが書く。追記だけ。活動の記録に使う）
    type: 'listen_session', table: 'listen_sessions',
    columns: { started_at: 'text', listened_on: 'text', seconds: 'int', items: 'int' },
    required: ['started_at', 'listened_on', 'seconds', 'items'],
    ops: ['create', 'delete'],
  },
];

export const SPEC_BY_TYPE = new Map(ENTITIES.map((s) => [s.type, s]));

/** アプリから送る項目 */
export const sendableOf = (spec: EntitySpec) => spec.sendable ?? Object.keys(spec.columns);

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

/** 列の名前を SQL に書く形（"trigger" のような予約語もそのまま使えるよう、いつも引用符で囲む） */
export const q = (c: string) => `"${c}"`;

/**
 * 表を変えるたびに、変更を outbox に積むトリガー（KARADA と同じ作り）。項目ごとに、変わったものだけを積む。
 * 積むのはアプリから送る項目（sendable）だけ。アプリから送れない op（ops にないもの）は積まない。
 * サーバーから受け取った状態を当てはめるあいだ（sync_meta に applying があるあいだ）は積まない
 */
export function triggerSql(spec: EntitySpec): string {
  const cols = sendableOf(spec);
  const ops = spec.ops ?? ['create', 'update', 'delete', 'restore'];
  const t = `'${spec.type}'`;
  const notApplying = `NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'applying')`;
  const insert = `INSERT INTO sync_outbox (change_id, entity_type, entity_id, op, fields, changed_at, origin)`;
  const allFields = `json_object(${cols.map((c) => `'${c}', NEW.${q(c)}`).join(', ')})`;
  const changed = cols.map((c) => `OLD.${q(c)} IS NOT NEW.${q(c)}`).join(' OR ');
  const changedOf = (c: string) => (spec.together?.find((g) => g.includes(c)) ?? [c]).map((x) => `OLD.${q(x)} IS NOT NEW.${q(x)}`).join(' OR ');
  const diff = `(SELECT json_group_object(k, v) FROM (${cols
    .map((c) => `SELECT '${c}' AS k, NEW.${q(c)} AS v WHERE ${changedOf(c)}`).join(' UNION ALL ')}))`;
  const has = (op: string) => ops.includes(op as never);
  const lines = (stmts: string[]) => stmts.filter(Boolean).join('\n  ');
  return `
CREATE TRIGGER sync_${spec.table}_insert AFTER INSERT ON ${spec.table} WHEN ${notApplying}
BEGIN
  ${lines([
    `${insert} VALUES (${SQL_UUID}, ${t}, NEW.id, 'create', ${allFields}, NEW.updated_at, 'app');`,
    has('delete') ? `${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, 'delete', NULL, NEW.deleted_at, 'app' WHERE NEW.deleted_at IS NOT NULL;` : '',
  ])}
END;
CREATE TRIGGER sync_${spec.table}_update AFTER UPDATE ON ${spec.table} WHEN ${notApplying}
BEGIN
  ${lines([
    has('restore') ? `${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, 'restore', NULL, NEW.updated_at, 'app'
    WHERE OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL;` : '',
    has('update') ? `${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, 'update', ${diff}, NEW.updated_at, 'app' WHERE ${changed};` : '',
    has('delete') ? `${insert} SELECT ${SQL_UUID}, ${t}, NEW.id, 'delete', NULL, NEW.deleted_at, 'app'
    WHERE OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL;` : '',
  ])}
END;`;
}
