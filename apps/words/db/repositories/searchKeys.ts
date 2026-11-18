// 表現の search_key（端末だけの列）を作り直す。表現・出会い・タグを書いたときと、同期で受け取ったときに呼ぶ。
// search_key は同期の項目ではないので、変えても outbox に積まれない（トリガーは同期の項目だけを見る）
import { parseExamples } from '@/lib/examples';
import { buildSearchKey } from '@/lib/search';
import type { Register } from '@/lib/types';
import type { Db } from '../types';

type Row = {
  id: string; text: string; reading: string | null; meaning: string | null; nuance: string | null; register: string | null;
  use_note: string | null; scene: string | null; note: string | null; examples: string | null;
};

export async function rebuildSearchKeys(db: Db, ids?: string[]): Promise<void> {
  if (ids && ids.length === 0) return;
  const where = ids ? `WHERE id IN (${ids.map(() => '?').join(', ')})` : '';
  const rows = await db.getAllAsync<Row>(
    `SELECT id, text, reading, meaning, nuance, register, use_note, scene, note, examples FROM expressions ${where}`, ids ?? [],
  );
  if (rows.length === 0) return;
  const idList = rows.map((r) => r.id);
  const marks = idList.map(() => '?').join(', ');
  const tags = await db.getAllAsync<{ expression_id: string; kind: string; name: string }>(
    `SELECT et.expression_id, t.kind, t.name FROM expression_tags et JOIN tags t ON t.id = et.tag_id
     WHERE et.deleted_at IS NULL AND et.status != 'rejected' AND et.expression_id IN (${marks}) ORDER BY t.sort_order, t.name`, idList,
  );
  const encounters = await db.getAllAsync<{ expression_id: string; scene: string | null; title: string | null; surrounding_text: string | null }>(
    `SELECT expression_id, scene, title, surrounding_text FROM encounters
     WHERE deleted_at IS NULL AND expression_id IN (${marks}) ORDER BY created_at DESC`, idList,
  );
  for (const r of rows) {
    const mine = tags.filter((t) => t.expression_id === r.id);
    // 出会いの場面は、新しい5件まで（探すための文と同じ）。前後の文と題は全部
    const enc = encounters.filter((e) => e.expression_id === r.id);
    const key = buildSearchKey({
      text: r.text, reading: r.reading ?? '', meaning: r.meaning ?? '', nuance: r.nuance ?? '',
      register: (r.register as Register | null) ?? null, use_note: r.use_note ?? '', scene: r.scene ?? '', note: r.note ?? '',
      examples: parseExamples(r.examples).map((x) => x.text),
      situations: mine.filter((t) => t.kind === 'situation').map((t) => t.name),
      feelings: mine.filter((t) => t.kind === 'feeling').map((t) => t.name),
      encounters: enc.map((e, i) => ({ scene: i < 5 ? e.scene ?? '' : '', title: e.title ?? '', surrounding_text: e.surrounding_text ?? '' })),
    });
    await db.runAsync('UPDATE expressions SET search_key = ? WHERE id = ?', [key, r.id]);
  }
}

