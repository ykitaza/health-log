// 表現・出会い・タグのつながり・使えた・聞いたの記録を読み書きする。
// 書き込みは serializeWrites で1つずつ順に行い、書いたら同期を頼む（KARADA のリポジトリと同じ作り）
import { reviewDay } from '@/lib/date';
import { addUserExamples, confirmExample, parseExamples, removeExample } from '@/lib/examples';
import { isSimilarKey, normalizedKey } from '@/lib/normalize';
import { applyListen, applyUse, EMPTY_SCHEDULE, enterHand, leaveHand } from '@/lib/schedule';
import {
  Author, Encounter, Example, Expression, ExpressionTag, HAND_LIMIT, ListenSession, Place, Register, Schedule, TagStatus, Usage,
} from '@/lib/types';
import { uuid5 } from '@/lib/uuid5';
import { LIMITS, WORDS_NAMESPACE } from '../seed';
import { serializeWrites } from '../serial';
import type { Bind, Db, Deps } from '../types';
import { rebuildSearchKeys } from './searchKeys';

type Row = Record<string, Bind>;
const str = (v: Bind) => (v == null ? '' : String(v));
const strOrNull = (v: Bind) => (v == null || v === '' ? null : String(v));
const num = (v: Bind, d = 0) => (v == null ? d : Number(v));
const list = (v: Bind): string[] => {
  if (v == null) return [];
  try {
    const a = JSON.parse(String(v));
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export function toExpression(r: Row): Expression {
  return {
    id: String(r.id), text: str(r.text), source_id: strOrNull(r.source_id), normalized_key: str(r.normalized_key),
    scene: str(r.scene), note: str(r.note), star: r.star === 1, place: (str(r.place) || 'collected') as Place,
    stage: strOrNull(r.stage) as Expression['stage'], moved_at: str(r.moved_at), hand_since: strOrNull(r.hand_since),
    interval_days: num(r.interval_days, 1), due_on: strOrNull(r.due_on), listened_at: strOrNull(r.listened_at),
    listen_count: num(r.listen_count), use_count: num(r.use_count), last_used_on: strOrNull(r.last_used_on),
    reading: str(r.reading), use_note: str(r.use_note), meaning: str(r.meaning), nuance: str(r.nuance),
    register: strOrNull(r.register) as Register | null, register_by: strOrNull(r.register_by) as Author | null,
    examples: parseExamples(r.examples), similar: list(r.similar),
    usefulness: r.usefulness == null ? null : Number(r.usefulness), usefulness_reason: str(r.usefulness_reason),
    usefulness_until: strOrNull(r.usefulness_until), enriched_at: strOrNull(r.enriched_at),
    created_at: str(r.created_at), updated_at: str(r.updated_at),
  };
}

export function toEncounter(r: Row): Encounter {
  return {
    id: String(r.id), expression_id: String(r.expression_id), source_id: strOrNull(r.source_id), title: str(r.title),
    locator: str(r.locator), met_on: strOrNull(r.met_on), time_hint: str(r.time_hint), scene: str(r.scene),
    surrounding_text: str(r.surrounding_text), wording: str(r.wording),
    captured_via: (str(r.captured_via) || 'app') as Encounter['captured_via'], note: str(r.note), created_at: str(r.created_at),
  };
}

/** 一覧の1行（表現と、最初の出会い・出会いの数） */
export type ListItem = Expression & {
  encounterCount: number;
  firstTitle: string;
  firstSourceId: string | null;
  firstVia: 'mcp' | 'app';
  firstMetOn: string | null;
  firstLocator: string;
};

export type TagLink = ExpressionTag & { name: string; kind: 'situation' | 'feeling'; hidden: boolean };

export type CaptureInput = {
  text: string;
  sourceId: string | null;
  title?: string;
  locator?: string;
  scene?: string;
  useNote?: string;
  register?: Register | null;
  /** 本人が選んだタグ（confirmed で付ける） */
  tagIds?: string[];
  /** 本人が書いた例文（なくてもよい） */
  examples?: string[];
  wantToUse?: boolean;
};

export type CaptureResult = {
  id: string;
  outcome: 'created' | 'reencountered' | 'promoted';
  /** 使いたい・また出会ったで手札に入れたかったが、いっぱいだった */
  handFull: boolean;
  place: Place;
};

export type MoveResult = { ok: true } | { ok: false; reason: 'hand_full' };

const SELECT_LIST = `SELECT e.*,
  (SELECT COUNT(*) FROM encounters x WHERE x.expression_id = e.id AND x.deleted_at IS NULL) AS encounter_count,
  (SELECT x.title FROM encounters x WHERE x.expression_id = e.id AND x.deleted_at IS NULL ORDER BY x.created_at, x.id LIMIT 1) AS first_title,
  (SELECT x.source_id FROM encounters x WHERE x.expression_id = e.id AND x.deleted_at IS NULL ORDER BY x.created_at, x.id LIMIT 1) AS first_source_id,
  (SELECT x.captured_via FROM encounters x WHERE x.expression_id = e.id AND x.deleted_at IS NULL ORDER BY x.created_at, x.id LIMIT 1) AS first_via,
  (SELECT x.met_on FROM encounters x WHERE x.expression_id = e.id AND x.deleted_at IS NULL ORDER BY x.created_at, x.id LIMIT 1) AS first_met_on,
  (SELECT x.locator FROM encounters x WHERE x.expression_id = e.id AND x.deleted_at IS NULL ORDER BY x.created_at, x.id LIMIT 1) AS first_locator
  FROM expressions e`;

export function toListItem(r: Row): ListItem {
  return {
    ...toExpression(r), encounterCount: num(r.encounter_count), firstTitle: str(r.first_title), firstSourceId: strOrNull(r.first_source_id) ?? strOrNull(r.source_id),
    firstVia: str(r.first_via) === 'mcp' ? 'mcp' : 'app', firstMetOn: strOrNull(r.first_met_on), firstLocator: str(r.first_locator),
  };
}

/** 表現とタグのつながりの ID（2つの端末や MCP が同じタグを付けても1つになる。ID は小文字にそろえてから決める） */
export const expressionTagId = (expressionId: string, tagId: string) =>
  uuid5(WORDS_NAMESPACE, `${expressionId.toLowerCase()}:${tagId.toLowerCase()}`);

const SCHEDULE_COLS = ['stage', 'interval_days', 'due_on', 'listened_at', 'listen_count', 'use_count', 'last_used_on'] as const;

export function wordsRepository(db: Db, deps: Deps) {
  const nowIso = () => deps.now().toISOString();
  const today = () => reviewDay(deps.now());

  const getRow = (id: string) => db.getFirstAsync<Row>('SELECT * FROM expressions WHERE id = ? AND deleted_at IS NULL', [id]);

  const handCount = async () =>
    (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM expressions WHERE place = 'hand' AND deleted_at IS NULL`, []))?.n ?? 0;

  const writeSchedule = (id: string, s: Schedule, extra: Record<string, Bind> = {}) => {
    const values: Record<string, Bind> = { ...Object.fromEntries(SCHEDULE_COLS.map((c) => [c, s[c] as Bind])), ...extra };
    const cols = Object.keys(values);
    return db.runAsync(`UPDATE expressions SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...cols.map((c) => values[c]), nowIso(), id]);
  };

  /** 置き場所を変える（手札に入れるときは間隔1日・意味がわかるから始める）。手札がいっぱいなら断る */
  async function move(id: string, to: Place): Promise<MoveResult> {
    const row = await getRow(id);
    if (!row) return { ok: true };
    const e = toExpression(row);
    if (e.place === to) return { ok: true };
    const now = nowIso();
    if (to === 'hand') {
      if ((await handCount()) >= HAND_LIMIT) return { ok: false, reason: 'hand_full' };
      await writeSchedule(id, enterHand(e, today()), { place: 'hand', moved_at: now, hand_since: today() });
    } else {
      await writeSchedule(id, leaveHand(e), { place: to, moved_at: now, hand_since: null });
    }
    return { ok: true };
  }

  async function addEncounter(expressionId: string, input: CaptureInput, wording = ''): Promise<string> {
    const id = deps.newId();
    const now = nowIso();
    await db.runAsync(
      `INSERT INTO encounters (id, expression_id, source_id, title, locator, met_on, time_hint, scene, surrounding_text, wording, captured_via, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, '', ?, ?, '', ?, ?)`,
      [id, expressionId, input.sourceId, input.title?.trim() ?? '', input.locator?.trim() ?? '', reviewDay(deps.now()), input.scene?.trim() ?? '',
        wording, 'app', now, now],
    );
    return id;
  }

  async function linkTag(expressionId: string, tagId: string, by: Author) {
    const id = expressionTagId(expressionId, tagId);
    const now = nowIso();
    const status: TagStatus = by === 'user' ? 'confirmed' : 'proposed';
    const existing = await db.getFirstAsync<Row>('SELECT * FROM expression_tags WHERE id = ?', [id]);
    if (!existing) {
      await db.runAsync(
        `INSERT INTO expression_tags (id, expression_id, tag_id, added_by, status, confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, expressionId, tagId, by, status, by === 'user' ? now : null, now, now],
      );
    } else {
      // 外したもの・断ったものに本人が付け直したら、本人が確かめたものにする
      await db.runAsync(
        `UPDATE expression_tags SET added_by = ?, status = 'confirmed', confirmed_at = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`,
        [by, now, now, id],
      );
    }
  }

  /** 拾う。同じ表現（normalized_key）があれば、また出会ったとして出会いを足す */
  async function capture(input: CaptureInput): Promise<CaptureResult> {
    const text = input.text.replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('表現が空です');
    const key = normalizedKey(text);
    const same = await db.getFirstAsync<Row>(
      'SELECT * FROM expressions WHERE normalized_key = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [key],
    );
    if (same) return reencounterIn(String(same.id), input);
    const total = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM expressions WHERE deleted_at IS NULL', []))?.n ?? 0;
    if (total >= LIMITS.expressions) throw new Error('表現は5,000件までです');
    const id = deps.newId();
    const now = nowIso();
    const full = !!input.wantToUse && (await handCount()) >= HAND_LIMIT;
    const toHand = !!input.wantToUse && !full;
    const t = today();
    const examples = addUserExamples([], input.examples ?? [], now);
    await db.runAsync(
      `INSERT INTO expressions (id, text, source_id, normalized_key, scene, note, star, place, stage, moved_at, hand_since,
        interval_days, due_on, use_note, reading, register, register_by, examples, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 0, ?, ?, ?, ?, 1, ?, ?, '', ?, ?, ?, ?, ?)`,
      [id, text, input.sourceId, key, input.scene?.trim() ?? '', toHand ? 'hand' : 'collected', toHand ? 'understood' : null, now,
        toHand ? t : null, toHand ? enterHand(EMPTY_SCHEDULE, t).due_on : null, input.useNote?.trim() ?? '',
        input.register ?? null, input.register ? 'user' : null, JSON.stringify(examples), now, now],
    );
    await addEncounter(id, input);
    for (const tagId of input.tagIds ?? []) await linkTag(id, tagId, 'user');
    await rebuildSearchKeys(db, [id]);
    return { id, outcome: 'created', handFull: full, place: toHand ? 'hand' : 'collected' };
  }

  /** また出会った：出会いを足し、拾ったにあって手札に空きがあれば手札に入れる */
  async function reencounterIn(id: string, input: CaptureInput): Promise<CaptureResult> {
    const row = await getRow(id);
    if (!row) throw new Error('表現がありません');
    const n = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM encounters WHERE expression_id = ? AND deleted_at IS NULL', [id]))?.n ?? 0;
    const e = toExpression(row);
    // その出会いでの言い回し（表現と少し違うときだけ）
    const wording = input.text.trim() !== e.text ? input.text.trim() : '';
    if (n < LIMITS.encountersPerExpression) await addEncounter(id, input, wording);
    for (const tagId of input.tagIds ?? []) await linkTag(id, tagId, 'user');
    if ((input.examples ?? []).some((x) => x.trim() !== '')) await writeExamples(id, addUserExamples(e.examples, input.examples ?? [], nowIso()));
    let outcome: CaptureResult['outcome'] = 'reencountered';
    let handFull = false;
    let place = e.place;
    if (e.place === 'collected') {
      const r = await move(id, 'hand');
      if (r.ok) { outcome = 'promoted'; place = 'hand'; } else handFull = true;
    }
    await rebuildSearchKeys(db, [id]);
    return { id, outcome, handFull, place };
  }

  /** 例文の一覧を書く（一覧ごと置き換える） */
  async function writeExamples(id: string, examples: Example[]) {
    await db.runAsync('UPDATE expressions SET examples = ?, updated_at = ? WHERE id = ?', [JSON.stringify(examples), nowIso(), id]);
  }

  async function changeExamples(id: string, change: (list: Example[], now: string) => Example[]) {
    const row = await getRow(id);
    if (!row) return;
    await writeExamples(id, change(toExpression(row).examples, nowIso()));
    await rebuildSearchKeys(db, [id]);
  }

  /** 使えた：使えたの記録（usage）を足し、間隔を計算し直す（手札でなければ回数と日だけ） */
  async function recordUse(id: string, opts: { scene?: string; note?: string } = {}) {
    const row = await getRow(id);
    if (!row) return null;
    const e = toExpression(row);
    const n = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM usages WHERE expression_id = ? AND deleted_at IS NULL', [id]))?.n ?? 0;
    if (n >= LIMITS.usagesPerExpression) return null;
    const day = today();
    const next = applyUse(e, day, e.place === 'hand');
    await writeSchedule(id, next);
    const now = nowIso();
    await db.runAsync(
      'INSERT INTO usages (id, expression_id, used_on, scene, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [deps.newId(), id, day, opts.scene?.trim() ?? '', opts.note?.trim() ?? '', now, now],
    );
    return { before: e, after: { ...e, ...next } };
  }

  /** 聞いた（1つ流し終えた）：回数と時刻を残し、手札ならその日の最初の1回だけ間隔を延ばす */
  async function recordListen(id: string) {
    const row = await getRow(id);
    if (!row) return;
    const e = toExpression(row);
    await writeSchedule(id, applyListen(e, nowIso(), e.place === 'hand'));
  }

  /** 聞いた1回（流した時間と、流し終えた数）を残す。活動の記録に使う */
  async function recordListenSession(startedAt: Date, seconds: number, items: number) {
    if (seconds <= 0 && items <= 0) return;
    const now = nowIso();
    await db.runAsync(
      'INSERT INTO listen_sessions (id, started_at, listened_on, seconds, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [deps.newId(), startedAt.toISOString(), reviewDay(startedAt), Math.min(Math.round(seconds), 24 * 3600), Math.min(items, 1000), now, now],
    );
  }

  const repo = {
    capture,
    reencounter: reencounterIn,
    move,
    recordUse,
    recordListen,
    recordListenSession,

    async setStar(id: string, star: boolean) {
      await db.runAsync('UPDATE expressions SET star = ?, updated_at = ? WHERE id = ?', [star ? 1 : 0, nowIso(), id]);
    },

    /** 本人の項目を直す（表現を変えたら normalized_key も作り直す） */
    async updateUserFields(id: string, f: Partial<Pick<Expression, 'text' | 'reading' | 'scene' | 'note' | 'use_note'>>) {
      const values: Record<string, Bind> = {};
      for (const [k, v] of Object.entries(f)) if (v !== undefined) values[k] = v.trim();
      if (values.text === '') delete values.text;
      if (typeof values.text === 'string') values.normalized_key = normalizedKey(values.text);
      const cols = Object.keys(values);
      if (cols.length === 0) return;
      await db.runAsync(`UPDATE expressions SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...cols.map((c) => values[c]), nowIso(), id]);
      await rebuildSearchKeys(db, [id]);
    },

    /** 硬さを本人が決める（Claude は補うときに変えない） */
    async setRegister(id: string, register: Register | null) {
      await db.runAsync('UPDATE expressions SET register = ?, register_by = ?, updated_at = ? WHERE id = ?',
        [register, register ? 'user' : null, nowIso(), id]);
      await rebuildSearchKeys(db, [id]);
    },

    /** 消す（論理削除）。出会い・振り返り・タグのつながりも端末では消す（サーバーは表現と一緒に消すので、送らない） */
    async remove(id: string) {
      const now = nowIso();
      await db.runAsync('UPDATE expressions SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
      await db.runAsync(`INSERT INTO sync_meta (key, value) VALUES ('applying', '1') ON CONFLICT (key) DO NOTHING`, []);
      try {
        for (const t of ['encounters', 'usages', 'expression_tags']) {
          await db.runAsync(`UPDATE ${t} SET deleted_at = ?, updated_at = ? WHERE expression_id = ? AND deleted_at IS NULL`, [now, now, id]);
        }
      } finally {
        await db.runAsync(`DELETE FROM sync_meta WHERE key = 'applying'`, []);
      }
    },

    /** 本人がタグを付ける（確かめたもの） */
    async addTag(expressionId: string, tagId: string) {
      await linkTag(expressionId, tagId, 'user');
      await rebuildSearchKeys(db, [expressionId]);
    },

    /** Claude の案を確かめる（ワンタップ） */
    async confirmTag(linkId: string) {
      const now = nowIso();
      await db.runAsync(`UPDATE expression_tags SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?`, [now, now, linkId]);
    },

    /** 外す：本人が付けたものは論理削除、Claude の案は rejected にして残す（同じ案をくり返さないため） */
    async removeTag(linkId: string) {
      const link = await db.getFirstAsync<Row>('SELECT * FROM expression_tags WHERE id = ?', [linkId]);
      if (!link) return;
      const now = nowIso();
      if (link.added_by === 'claude') {
        await db.runAsync(`UPDATE expression_tags SET status = 'rejected', confirmed_at = ?, updated_at = ? WHERE id = ?`, [now, now, linkId]);
      } else {
        await db.runAsync('UPDATE expression_tags SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, linkId]);
      }
      await rebuildSearchKeys(db, [String(link.expression_id)]);
    },

    async updateEncounter(id: string, f: Partial<Omit<Encounter, 'id' | 'expression_id' | 'captured_via' | 'created_at'>>) {
      const values: Record<string, Bind> = {};
      for (const [k, v] of Object.entries(f)) if (v !== undefined) values[k] = typeof v === 'string' ? v.trim() : v;
      const cols = Object.keys(values);
      if (cols.length === 0) return;
      await db.runAsync(`UPDATE encounters SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...cols.map((c) => values[c]), nowIso(), id]);
      const row = await db.getFirstAsync<{ expression_id: string }>('SELECT expression_id FROM encounters WHERE id = ?', [id]);
      if (row) await rebuildSearchKeys(db, [row.expression_id]);
    },

    /** 本人が例文を足す */
    async addExample(expressionId: string, text: string) {
      await changeExamples(expressionId, (list, now) => addUserExamples(list, [text], now));
    },

    /** Claude の例文を確かめる（ワンタップ） */
    async confirmExample(expressionId: string, text: string) {
      await changeExamples(expressionId, (list, now) => confirmExample(list, text, now));
    },

    /** 例文を外す（一覧から消す） */
    async removeExample(expressionId: string, text: string) {
      await changeExamples(expressionId, (list) => removeExample(list, text));
    },

    async removeEncounter(id: string) {
      const now = nowIso();
      await db.runAsync('UPDATE encounters SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
      const row = await db.getFirstAsync<{ expression_id: string }>('SELECT expression_id FROM encounters WHERE id = ?', [id]);
      if (row) await rebuildSearchKeys(db, [row.expression_id]);
    },
  };

  const writes = serializeWrites(db, repo, [
    'capture', 'reencounter', 'move', 'setStar', 'updateUserFields', 'setRegister', 'remove',
    'addTag', 'confirmTag', 'removeTag', 'updateEncounter', 'removeEncounter', 'addExample', 'confirmExample', 'removeExample',
    'recordUse', 'recordListen', 'recordListenSession',
  ]);

  return {
    ...writes,

    async get(id: string): Promise<Expression | null> {
      const r = await getRow(id);
      return r ? toExpression(r) : null;
    },

    async listAll(): Promise<ListItem[]> {
      return (await db.getAllAsync<Row>(`${SELECT_LIST} WHERE e.deleted_at IS NULL ORDER BY e.created_at DESC, e.id`, [])).map(toListItem);
    },

    async listByIds(ids: string[]): Promise<ListItem[]> {
      if (ids.length === 0) return [];
      return (await db.getAllAsync<Row>(
        `${SELECT_LIST} WHERE e.deleted_at IS NULL AND e.id IN (${ids.map(() => '?').join(', ')})`, ids,
      )).map(toListItem);
    },

    async recent(limit = 3): Promise<ListItem[]> {
      return (await db.getAllAsync<Row>(`${SELECT_LIST} WHERE e.deleted_at IS NULL ORDER BY e.created_at DESC, e.id LIMIT ?`, [limit])).map(toListItem);
    },

    async hand(): Promise<ListItem[]> {
      return (await db.getAllAsync<Row>(
        `${SELECT_LIST} WHERE e.deleted_at IS NULL AND e.place = 'hand' ORDER BY e.moved_at, e.id`, [],
      )).map(toListItem);
    },

    handCount,

    async placeCounts(): Promise<Record<Place, number>> {
      const rows = await db.getAllAsync<{ place: string; n: number }>(
        'SELECT place, COUNT(*) AS n FROM expressions WHERE deleted_at IS NULL GROUP BY place', [],
      );
      const n = (p: Place) => rows.find((r) => r.place === p)?.n ?? 0;
      return { collected: n('collected'), hand: n('hand'), own: n('own') };
    },

    /** 入力中の表現と同じ・似た表現（書き留めるの下に出す） */
    async matches(text: string): Promise<{ same: Expression | null; similar: Expression[] }> {
      const key = normalizedKey(text);
      if (!key) return { same: null, similar: [] };
      const rows = (await db.getAllAsync<Row>('SELECT * FROM expressions WHERE deleted_at IS NULL', [])).map(toExpression);
      const same = rows.find((e) => e.normalized_key === key) ?? null;
      const similar = rows.filter((e) => e.id !== same?.id && isSimilarKey(key, e.normalized_key)).slice(0, 3);
      return { same, similar };
    },

    async encounters(expressionId: string): Promise<Encounter[]> {
      return (await db.getAllAsync<Row>(
        'SELECT * FROM encounters WHERE expression_id = ? AND deleted_at IS NULL ORDER BY created_at, id', [expressionId],
      )).map(toEncounter);
    },

    async encounter(id: string): Promise<Encounter | null> {
      const r = await db.getFirstAsync<Row>('SELECT * FROM encounters WHERE id = ? AND deleted_at IS NULL', [id]);
      return r ? toEncounter(r) : null;
    },

    /** 最後に使った題（書き留めるの「前回と同じ」） */
    async lastTitle(): Promise<string | null> {
      const r = await db.getFirstAsync<{ title: string }>(
        `SELECT title FROM encounters WHERE deleted_at IS NULL AND captured_via = 'app' AND title IS NOT NULL AND title != '' ORDER BY created_at DESC LIMIT 1`, [],
      );
      return r?.title ?? null;
    },

    async tagsOf(expressionId: string): Promise<TagLink[]> {
      const rows = await db.getAllAsync<Row>(
        `SELECT et.*, t.name AS tag_name, t.kind AS tag_kind, t.hidden AS tag_hidden FROM expression_tags et JOIN tags t ON t.id = et.tag_id
         WHERE et.expression_id = ? AND et.deleted_at IS NULL ORDER BY t.sort_order, t.name`, [expressionId],
      );
      return rows.map((r) => ({
        id: String(r.id), expression_id: String(r.expression_id), tag_id: String(r.tag_id), added_by: str(r.added_by) as Author,
        status: str(r.status) as TagStatus, confirmed_at: strOrNull(r.confirmed_at), name: str(r.tag_name),
        kind: str(r.tag_kind) as TagLink['kind'], hidden: r.tag_hidden === 1,
      }));
    },

    /** タグのつながりを全部（探すの絞り込みと件数） */
    async allTagLinks(): Promise<{ expression_id: string; tag_id: string; status: TagStatus }[]> {
      return db.getAllAsync(
        `SELECT et.expression_id, et.tag_id, et.status FROM expression_tags et JOIN expressions e ON e.id = et.expression_id
         WHERE et.deleted_at IS NULL AND e.deleted_at IS NULL AND et.status != 'rejected'`, [],
      );
    },

    /** 聞いた記録（listen_session。同期したもの） */
    async listenSessions(sinceIso = '1970-01-01T00:00:00.000Z'): Promise<ListenSession[]> {
      const rows = await db.getAllAsync<Row>('SELECT * FROM listen_sessions WHERE deleted_at IS NULL AND started_at >= ? ORDER BY started_at', [sinceIso]);
      return rows.map((r) => ({ id: String(r.id), started_at: str(r.started_at), listened_on: str(r.listened_on), seconds: num(r.seconds), items: num(r.items) }));
    },

    /** 使えたの記録（全部、または1つの表現の分） */
    async usages(expressionId?: string): Promise<Usage[]> {
      const rows = await db.getAllAsync<Row>(
        `SELECT * FROM usages WHERE deleted_at IS NULL${expressionId ? ' AND expression_id = ?' : ''} ORDER BY used_on`, expressionId ? [expressionId] : [],
      );
      return rows.map((r) => ({ id: String(r.id), expression_id: String(r.expression_id), used_on: str(r.used_on), scene: str(r.scene), note: str(r.note) }));
    },

    /** 出会いを全部（活動の記録の「また出会った」） */
    async allEncounters(): Promise<{ expression_id: string; created_at: string }[]> {
      return db.getAllAsync('SELECT expression_id, created_at FROM encounters WHERE deleted_at IS NULL', []);
    },

    /** 出会いの場所と題を全部（探すの「出会った場所・本」） */
    async encounterFacets(): Promise<{ expression_id: string; source_id: string | null; title: string }[]> {
      const rows = await db.getAllAsync<{ expression_id: string; source_id: string | null; title: string | null }>(
        `SELECT x.expression_id, x.source_id, x.title FROM encounters x JOIN expressions e ON e.id = x.expression_id
         WHERE x.deleted_at IS NULL AND e.deleted_at IS NULL`, [],
      );
      return rows.map((r) => ({ ...r, title: r.title ?? '' }));
    },

    /** 文字で探す（search_key に全部の言葉を含むもの） */
    async searchIds(likes: string[]): Promise<string[]> {
      const where = likes.map(() => `search_key LIKE ? ESCAPE '\\'`).join(' AND ');
      const rows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM expressions WHERE deleted_at IS NULL${likes.length ? ` AND ${where}` : ''}`, likes,
      );
      return rows.map((r) => r.id);
    },

    /** 使えた日（違う日に2回で、自分の言葉にするかを聞く） */
    async useDays(expressionId: string): Promise<string[]> {
      return (await db.getAllAsync<{ used_on: string }>(
        'SELECT used_on FROM usages WHERE expression_id = ? AND deleted_at IS NULL', [expressionId],
      )).map((r) => r.used_on);
    },
  };
}


export type WordsRepository = ReturnType<typeof wordsRepository>;
