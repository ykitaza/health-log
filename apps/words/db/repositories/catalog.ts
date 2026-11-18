// 出会った場所（source）とタグ（tag）の一覧。本人が足す・名前を変える・並べ替える・隠す（消すのは隠すこと）
import { searchKey } from '@/lib/normalize';
import type { Source, Tag, TagKind } from '@/lib/types';
import { iconKeyOf, LIMITS } from '../seed';
import { serializeWrites } from '../serial';
import type { Bind, Db, Deps } from '../types';
import { rebuildSearchKeys } from './searchKeys';

type Row = Record<string, Bind>;

const toSource = (r: Row): Source => ({
  id: String(r.id), name: String(r.name ?? ''), icon_key: iconKeyOf(String(r.icon_key ?? 'other')), sort_order: Number(r.sort_order ?? 0), hidden: r.hidden === 1,
});
const toTag = (r: Row): Tag => ({
  id: String(r.id), kind: String(r.kind) as TagKind, name: String(r.name ?? ''), sort_order: Number(r.sort_order ?? 0),
  hidden: r.hidden === 1, created_by: (String(r.created_by ?? 'user')) as Tag['created_by'],
});

/** 名前を比べる形（NFKC、大文字小文字・空白を同じに扱う） */
export const nameKey = (name: string) => searchKey(name) || name.trim();

export class NameTakenError extends Error {
  constructor() { super('同じ名前があります'); this.name = 'NameTakenError'; }
}
export class LimitError extends Error {
  constructor(message: string) { super(message); this.name = 'LimitError'; }
}

export function catalogRepository(db: Db, deps: Deps) {
  const nowIso = () => deps.now().toISOString();

  // 同期で同じ名前が2つになったら、並び順・ID の小さいほうを先に出す
  const sources = async () => (await db.getAllAsync<Row>(
    'SELECT * FROM sources WHERE deleted_at IS NULL ORDER BY sort_order, id', [],
  )).map(toSource);
  const tags = async () => (await db.getAllAsync<Row>(
    'SELECT * FROM tags WHERE deleted_at IS NULL ORDER BY sort_order, id', [],
  )).map(toTag);

  const repo = {
    async addSource(name: string, iconKey: string): Promise<Source> {
      const n = name.trim().slice(0, 40);
      if (!n) throw new Error('名前が空です');
      const all = await sources();
      if (all.some((s) => nameKey(s.name) === nameKey(n))) throw new NameTakenError();
      if (all.length >= LIMITS.sources) throw new LimitError('出会った場所は50件までです');
      const id = deps.newId();
      const now = nowIso();
      const sort = all.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1;
      await db.runAsync('INSERT INTO sources (id, name, icon_key, sort_order, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
        [id, n, iconKeyOf(iconKey), sort, now, now]);
      return { id, name: n, icon_key: iconKeyOf(iconKey), sort_order: sort, hidden: false };
    },

    async updateSource(id: string, f: { name?: string; icon_key?: string; hidden?: boolean }) {
      const values: Record<string, Bind> = {};
      if (f.name !== undefined) {
        const n = f.name.trim().slice(0, 40);
        if (!n) throw new Error('名前が空です');
        if ((await sources()).some((s) => s.id !== id && nameKey(s.name) === nameKey(n))) throw new NameTakenError();
        values.name = n;
      }
      if (f.icon_key !== undefined) values.icon_key = iconKeyOf(f.icon_key);
      if (f.hidden !== undefined) values.hidden = f.hidden ? 1 : 0;
      const cols = Object.keys(values);
      if (cols.length === 0) return;
      await db.runAsync(`UPDATE sources SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...cols.map((c) => values[c]), nowIso(), id]);
    },

    /** 並べ替える（ids の順に sort_order を振り直す。変わった行だけ書く） */
    async reorderSources(ids: string[]) {
      const now = nowIso();
      const current = new Map((await sources()).map((s) => [s.id, s.sort_order]));
      for (const [i, id] of ids.entries()) {
        if (current.get(id) !== i) await db.runAsync('UPDATE sources SET sort_order = ?, updated_at = ? WHERE id = ?', [i, now, id]);
      }
    },

    async addTag(kind: TagKind, name: string): Promise<Tag> {
      const n = name.trim().slice(0, 20);
      if (!n) throw new Error('名前が空です');
      const all = await tags();
      if (all.some((t) => t.kind === kind && nameKey(t.name) === nameKey(n))) throw new NameTakenError();
      if (all.length >= LIMITS.tags) throw new LimitError('タグは200件までです');
      const id = deps.newId();
      const now = nowIso();
      const sort = all.reduce((m, t) => Math.max(m, t.sort_order), -1) + 1;
      await db.runAsync(`INSERT INTO tags (id, kind, name, sort_order, hidden, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'user', ?, ?)`,
        [id, kind, n, sort, now, now]);
      return { id, kind, name: n, sort_order: sort, hidden: false, created_by: 'user' };
    },

    async updateTag(id: string, f: { name?: string; hidden?: boolean }) {
      const values: Record<string, Bind> = {};
      if (f.name !== undefined) {
        const n = f.name.trim().slice(0, 20);
        if (!n) throw new Error('名前が空です');
        const self = (await tags()).find((t) => t.id === id);
        if ((await tags()).some((t) => t.id !== id && t.kind === self?.kind && nameKey(t.name) === nameKey(n))) throw new NameTakenError();
        values.name = n;
      }
      if (f.hidden !== undefined) values.hidden = f.hidden ? 1 : 0;
      const cols = Object.keys(values);
      if (cols.length === 0) return;
      await db.runAsync(`UPDATE tags SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...cols.map((c) => values[c]), nowIso(), id]);
      // 名前を変えたら、そのタグの付いた表現の探す文字を作り直す
      if (values.name !== undefined) {
        const ids = (await db.getAllAsync<{ expression_id: string }>(
          'SELECT expression_id FROM expression_tags WHERE tag_id = ? AND deleted_at IS NULL', [id],
        )).map((r) => r.expression_id);
        await rebuildSearchKeys(db, ids);
      }
    },
  };

  return {
    ...serializeWrites(db, repo, ['addSource', 'updateSource', 'reorderSources', 'addTag', 'updateTag']),
    sources,
    tags,
    /** 場所ごとの表現の数（隠した場所の「過去の 3 件には残っています」） */
    async sourceCounts(): Promise<Map<string, number>> {
      const rows = await db.getAllAsync<{ source_id: string; n: number }>(
        'SELECT source_id, COUNT(DISTINCT expression_id) AS n FROM encounters WHERE deleted_at IS NULL AND source_id IS NOT NULL GROUP BY source_id', [],
      );
      return new Map(rows.map((r) => [r.source_id, r.n]));
    },
  };
}

export type CatalogRepository = ReturnType<typeof catalogRepository>;
