/**
 * サーバー（services/words の tests/test_shared_testdata.py）と同じテストのデータ（testdata/words）で、
 * 正規化・似た表現・間隔・聞く順・読み上げの台本・活動の記録・初期の行を確かめる
 */
import * as fs from 'fs';
import * as path from 'path';
import { expressionTagId } from '@/db/repositories/words';
import { SEED_SOURCES, SEED_TAGS, WORDS_NAMESPACE } from '@/db/seed';
import { bigramJaccard, isSimilarKey, SIMILAR_THRESHOLD, searchKey } from '../normalize';
import { applyListen, applyUse, businessDay, EMPTY_SCHEDULE, enterHand, listenQueue, priority, risk, usefulnessOf } from '../schedule';
import { ListenPause, SECTION_GAP_MS } from '../listen/pace';
import { buildScript } from '../speech';
import { activityStats } from '../stats';
import type { Expression, Place } from '../types';

const load = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'testdata', 'words', name), 'utf8'));

describe('正規化（search_key.json）', () => {
  const data = load('search_key.json') as { cases: { input: string; expected: string }[] };
  it.each(data.cases.map((c) => [c.input, c.expected]))('%j → %j', (input, expected) => {
    expect(searchKey(input)).toBe(expected);
  });
});

describe('似た表現（similarity.json）', () => {
  const data = load('similarity.json') as { threshold: number; cases: { a: string; b: string; jaccard: number; similar: boolean }[] };
  it('しきい値', () => expect(SIMILAR_THRESHOLD).toBe(data.threshold));
  it.each(data.cases.map((c) => [c.a, c.b, c]))('%s / %s', (_a, _b, c) => {
    const a = searchKey(c.a);
    const b = searchKey(c.b);
    expect(Math.round(bigramJaccard(a, b) * 1e6) / 1e6).toBe(c.jaccard);
    expect(isSimilarKey(a, b)).toBe(c.similar);
  });
});

describe('間隔（schedule.json）', () => {
  const data = load('schedule.json') as {
    cases: { name: string; start: string; steps: { event: 'listen' | 'use'; at?: string; day?: string; expected: Record<string, unknown> }[] }[];
    business_day: { at: string; expected: string }[];
  };
  it.each(data.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    let s = enterHand(EMPTY_SCHEDULE, c.start);
    for (const step of c.steps) {
      s = step.event === 'use' ? applyUse(s, step.day!) : applyListen(s, step.at!);
      expect(s).toEqual(step.expected);
    }
  });
  it.each(data.business_day.map((c) => [c.at, c.expected]))('日の区切りは午前4時：%s → %s', (at, expected) => {
    expect(businessDay(new Date(at))).toBe(expected);
  });
});

describe('優先度と聞く順（listen_queue.json）', () => {
  const data = load('listen_queue.json') as {
    today: string;
    expressions: Record<string, unknown>[];
    expected_each: { id: string; risk: number; usefulness: number; priority: number }[];
    cases: { limit: number; expected: { id: string; group: string; priority: number }[] }[];
  };
  const items = data.expressions.map((r) => ({
    id: r.id as string, place: (r.place ?? 'hand') as Place, interval_days: (r.interval_days as number) ?? 1, due_on: (r.due_on as string) ?? null,
    listened_at: (r.listened_at as string) ?? null, hand_since: (r.hand_since as string) ?? null, star: !!r.star,
    usefulness: (r.usefulness as number) ?? null, usefulness_until: (r.usefulness_until as string) ?? null,
    created_at: (r.created_at as string) ?? '2026-10-01T00:00:00.000Z',
  }));
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

  it('1つずつの risk・役立ち度・優先度', () => {
    const hand = items.filter((e) => e.place === 'hand');
    expect(hand.map((e) => ({ id: e.id, risk: round6(risk(e, data.today)), usefulness: usefulnessOf(e, data.today), priority: round6(priority(e, data.today)) })))
      .toEqual(data.expected_each);
  });
  it.each(data.cases.map((c) => [c.limit, c]))('limit %i', (_limit, c) => {
    expect(listenQueue(items, data.today, c.limit).map((q) => ({ id: q.expression.id, group: q.group, priority: q.priority }))).toEqual(c.expected);
  });
});

describe('読み上げの台本（speech.json）', () => {
  const data = load('speech.json') as {
    cases: { name: string; expression: Partial<Expression> & { examples?: { text: string; origin: 'user' | 'claude'; confirmed: boolean }[] };
      tags: { kind: 'situation' | 'feeling'; name: string; status: 'confirmed' | 'proposed' | 'rejected' }[]; sections: [string, string][]; ssml: string; pause?: ListenPause }[];
    pause_ms: Record<ListenPause, number>;
  };
  it.each(data.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    const e = { text: '', reading: '', meaning: '', nuance: '', use_note: '', ...c.expression, examples: c.expression.examples ?? [] };
    const script = buildScript(e as Parameters<typeof buildScript>[0], c.tags, c.pause);
    expect(script.sections).toEqual(c.sections);
    expect(script.ssml).toBe(c.ssml);
  });
  it('区切りのあいだの間は、サーバーの break と同じ長さ（pause_ms）', () => {
    expect(SECTION_GAP_MS).toEqual(data.pause_ms);
  });
});

describe('活動の記録（stats.json）', () => {
  const data = load('stats.json');
  it.each((data.cases as { unit: 'week' | 'month'; count: number; expected: unknown }[]).map((c) => [c.unit, c]))('%s', (_unit, c) => {
    const expressions = (data.expressions as Record<string, string | null>[]).map((r) => ({
      id: r.id!, source_id: r.source_id ?? null, place: r.place as Place, created_at: r.created_at!, hand_since: r.hand_since ?? null, moved_at: r.moved_at ?? null,
    }));
    expect(activityStats(expressions, data.encounters, data.usages, data.listen_sessions, data.sources, data.today, c.unit, c.count)).toEqual(c.expected);
  });
});

describe('初期の行と ID（catalog.json）', () => {
  const data = load('catalog.json');
  it('名前空間・初期の場所とタグ（ID・名前・並び）がサーバーと同じ', () => {
    expect(WORDS_NAMESPACE).toBe(data.namespace);
    expect(SEED_SOURCES).toEqual((data.sources as Record<string, unknown>[]).map(({ key: _k, ...rest }) => rest));
    expect(SEED_TAGS).toEqual((data.tags as Record<string, unknown>[]).map(({ key: _k, ...rest }) => rest));
  });
  it('表現とタグのつながりの ID（uuid5。ID は小文字にそろえる）', () => {
    for (const c of data.expression_tag_ids) expect(expressionTagId(c.expression_id, c.tag_id)).toBe(c.expected);
  });
});
