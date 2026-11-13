// フェーズ（版15）：トリガーが積む変更（状態と終えた日、目標と終了日と履歴は同じ変更）、療養で止める・戻す、
// 同期で受け取る（食い違った値も読む）、版14の端末
import { LATEST_VERSION, migrate, MIGRATIONS } from '../migrations';
import { cleanSnapshot, PhaseError, PhaseInput } from '../repositories/phases';
import { SPEC_BY_TYPE, SyncType, toApiFields } from '../syncSpec';
import { PHASE_LIMITS, planValue } from '@/lib/phases';
import { createFakeSyncServer } from '@/test-utils/fakeSyncServer';
import { memoryDb, testDeps } from '@/test-utils/nodeDb';
import { device, Device } from '@/test-utils/syncHarness';

const DAY = 86400_000;
const INPUT: PhaseInput = {
  direction: 'bulk', name: ' ', startDate: '2026-11-02', weeks: 16, targetWeightKg: 80,
  mealTargets: { training_day: { kcal: 3000, protein_g: 150 }, rest_day: { kcal: 2600, protein_g: 150 } },
  snapshot: { weight_kg: 72.4, body_fat_pct: 15.2, big3: { bench: 100, squat: null, deadlift: 140 }, growth_score: 62 },
};

// 送るときの形（json の列は値に、真偽値は true/false に）
const outbox = (d: Device) => d.outbox().map((r) => [r.entity_type, r.op,
  r.fields == null ? null : toApiFields(SPEC_BY_TYPE.get(r.entity_type as SyncType)!, JSON.parse(String(r.fields)))]);

describe('フェーズ', () => {
  test('始めると create を積み、サーバーに届く。終了日は週数から、履歴の最初の1件は開始日', async () => {
    const d = await device();
    const id = await d.r.phases.start(INPUT);
    expect(outbox(d)).toEqual([['phase', 'create', {
      kind: 'normal', direction: 'bulk', name: '', start_date: '2026-11-02', end_date: '2027-02-21', target_weight_kg: 80,
      meal_targets: INPUT.mealTargets, snapshot: INPUT.snapshot, status: 'active', paused_phase_id: null,
      target_history: [{ date: '2026-11-02', target_weight_kg: 80, end_date: '2027-02-21', weight_kg: 72.4 }], ended_on: null,
    }]]);
    expect(await d.r.phases.current()).toMatchObject({ current: { id, direction: 'bulk', endDate: '2027-02-21' }, paused: null });
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 1, rejected: 0 });
    expect(d.server.state('phase', id)!.fields).toMatchObject({ kind: 'normal', status: 'active', snapshot: INPUT.snapshot });
  });

  test('実施中があれば、新しく始められない。終えたら始められる。終えると状態と終えた日を1つの update で送る', async () => {
    const d = await device();
    const id = await d.r.phases.start(INPUT);
    await expect(d.r.phases.start(INPUT)).rejects.toThrow('実施中のフェーズがあります');
    await d.engine.run();
    await d.r.phases.end(id);
    expect(outbox(d)).toEqual([['phase', 'update', { status: 'ended', ended_on: '2026-11-08' }]]);
    const next = await d.r.phases.start({ ...INPUT, direction: 'maintain', startDate: '2026-11-08', weeks: 4, targetWeightKg: 72 });
    await d.r.phases.abort(next);
    expect((await d.r.phases.list()).map((p) => [p.id, p.status, p.endedOn])).toEqual([[next, 'aborted', '2026-11-08'], [id, 'ended', '2026-11-08']]);
    expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
  });

  test('目標を変える・延長すると、目標と終了日と履歴を1つの update で送る（同じ日にもう一度変えたら置き換える）', async () => {
    const d = await device();
    const id = await d.r.phases.start(INPUT);
    await d.engine.run();
    await d.r.phases.changeTarget(id, 78, 73.1);
    await d.r.phases.changeTarget(id, 77, 73.1);
    d.deps.advance(DAY);
    await d.r.phases.extend(id, 4);
    const first = { date: '2026-11-02', target_weight_kg: 80, end_date: '2027-02-21', weight_kg: 72.4 };
    expect(outbox(d)).toEqual([
      ['phase', 'update', { target_weight_kg: 78, end_date: '2027-02-21', target_history: [first, { date: '2026-11-08', target_weight_kg: 78, end_date: '2027-02-21', weight_kg: 73.1 }] }],
      ['phase', 'update', { target_weight_kg: 77, end_date: '2027-02-21', target_history: [first, { date: '2026-11-08', target_weight_kg: 77, end_date: '2027-02-21', weight_kg: 73.1 }] }],
      ['phase', 'update', { target_weight_kg: 77, end_date: '2027-03-21', target_history: [
        first, { date: '2026-11-08', target_weight_kg: 77, end_date: '2027-02-21', weight_kg: 73.1 },
        { date: '2026-11-09', target_weight_kg: 77, end_date: '2027-03-21', weight_kg: null },
      ] }],
    ]);
    expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
  });

  test('開始日に延長・目標を変えても、最初の線の始まりは開始時の体重のまま（予定の線が消えない）', async () => {
    const d = await device();
    const id = await d.r.phases.start({ ...INPUT, startDate: '2026-11-08' });
    await d.r.phases.extend(id, 4);
    await d.r.phases.changeTarget(id, 79, null);
    const p = (await d.r.phases.get(id))!;
    expect(p.targetHistory).toEqual([{ date: '2026-11-08', target_weight_kg: 79, end_date: '2027-03-27', weight_kg: 72.4 }]);
    expect(planValue(p, [], '2026-11-08')).toBe(72.4);
  });

  test('療養に入ると、実施中の通常のフェーズを止める（通常のフェーズの行は変えない）。戻ると続き、戻らなければ両方終える', async () => {
    const d = await device();
    const normal = await d.r.phases.start(INPUT);
    await d.engine.run();
    const rehab = await d.r.phases.startRehab({ name: '肘', startDate: '2026-11-08', snapshot: null });
    expect(outbox(d)).toEqual([['phase', 'create', {
      kind: 'rehab', direction: null, name: '肘', start_date: '2026-11-08', end_date: null, target_weight_kg: null, meal_targets: null,
      snapshot: null, status: 'active', paused_phase_id: normal, target_history: [], ended_on: null,
    }]]);
    await expect(d.r.phases.startRehab({ name: '', startDate: '2026-11-08', snapshot: null })).rejects.toThrow('療養はもう始めています');
    expect(await d.r.phases.current()).toMatchObject({ current: { id: rehab }, paused: { id: normal } });
    expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
    d.deps.advance(3 * DAY);
    await d.r.phases.endRehab(rehab, { resume: true });
    expect(outbox(d)).toEqual([['phase', 'update', { status: 'ended', ended_on: '2026-11-11' }]]);
    expect(await d.r.phases.current()).toMatchObject({ current: { id: normal, status: 'active' }, paused: null });
    // もう一度療養に入り、戻らずに終える
    await d.engine.run();
    const rehab2 = await d.r.phases.startRehab({ name: '', startDate: '2026-11-11', snapshot: null });
    await d.r.phases.endRehab(rehab2, { resume: false });
    expect((await d.r.phases.list()).map((p) => [p.kind, p.status, p.endedOn])).toEqual([
      ['rehab', 'ended', '2026-11-11'], ['rehab', 'ended', '2026-11-11'], ['normal', 'ended', '2026-11-11']]);
    expect(await d.r.phases.current()).toEqual({ current: null, paused: null });
    expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
  });

  test('確かめ：向き・開始日・週数・目標体重・名前の長さ・件数', async () => {
    const d = await device();
    await expect(d.r.phases.start({ ...INPUT, weeks: 0 })).rejects.toThrow('期間は1〜104週');
    await expect(d.r.phases.start({ ...INPUT, weeks: 105 })).rejects.toThrow(PhaseError);
    await expect(d.r.phases.start({ ...INPUT, targetWeightKg: 20 })).rejects.toThrow('目標体重は30〜300kg');
    await expect(d.r.phases.start({ ...INPUT, startDate: '11/02' })).rejects.toThrow('開始日を選んでください');
    await expect(d.r.phases.start({ ...INPUT, direction: 'up' as never })).rejects.toThrow('向きを選んでください');
    await expect(d.r.phases.start({ ...INPUT, name: '😀'.repeat(41) })).rejects.toThrow('名前は40文字まで');
    expect(await d.r.phases.start({ ...INPUT, name: '😀'.repeat(40) })).toBeTruthy();
    await expect(d.r.phases.start({ ...INPUT, mealTargets: { training_day: { kcal: 20001, protein_g: 150 }, rest_day: { kcal: 2600, protein_g: 150 } } }))
      .rejects.toThrow('kcal は0〜20000');
    const insert = d.db.raw.prepare(`INSERT INTO phases (id, kind, start_date, status, created_at, updated_at) VALUES (?, 'rehab', '2026-01-01', 'ended', 'x', 'x')`);
    for (let i = 1; i < PHASE_LIMITS.phases; i++) insert.run(`x${i}`);
    await expect(d.r.phases.startRehab({ name: '', startDate: '2026-11-08', snapshot: null })).rejects.toThrow('200件まで');
  });

  test('ほかの端末のフェーズを受け取る。療養に残った向き・終えた日のない終了など、食い違った値も読める', async () => {
    const server = createFakeSyncServer({ clock: () => '2026-11-08T01:00:00.000Z' });
    const app = { parent_id: null, changed_at: '2026-11-08T01:00:00.000Z', origin: 'app' as const, device_id: 'other' };
    const P = 'aaaaaaaa-0000-4000-8000-000000000001';
    const R = 'aaaaaaaa-0000-4000-8000-000000000002';
    server.append([
      { ...app, change_id: crypto.randomUUID(), entity_type: 'phase', entity_id: P, op: 'create',
        fields: { kind: 'normal', direction: 'cut', start_date: '2026-11-01', end_date: '2026-12-26', target_weight_kg: 68, status: 'active' } },
      // 止めたフェーズを指す療養が先に届いても、そのまま当てはめる（refs にしない）
      { ...app, change_id: crypto.randomUUID(), entity_type: 'phase', entity_id: R, op: 'create',
        fields: { kind: 'rehab', direction: 'cut', start_date: '2026-11-05', status: 'ended', paused_phase_id: P } },
    ]);
    const d = await device(server);
    expect(await d.engine.run()).toMatchObject({ ok: true });
    const [rehab, normal] = await d.r.phases.list();
    expect(rehab).toMatchObject({ id: R, kind: 'rehab', direction: null, pausedPhaseId: P, endedOn: null, name: '', targetHistory: [] });
    expect(normal).toMatchObject({ id: P, direction: 'cut', targetWeightKg: 68, snapshot: null, mealTargets: null, targetHistory: [] });
    expect(await d.r.phases.current('2026-11-08')).toMatchObject({ current: { id: P }, paused: null });
    expect(d.outbox()).toEqual([]);
  });

  test('ログインの前の記録は、アカウントにつないだときに積み直す', async () => {
    const d = await device();
    await d.r.phases.start(INPUT);
    await d.store.switchAccount('user-b', 'send', '2026-11-08T00:00:00.000Z');
    expect(outbox(d).map(([t, op]) => [t, op])).toEqual([['phase', 'create']]);
  });
});

test('開始時の記録は、サーバーの範囲の外の値を null にする（成長スコアは整数に）', () => {
  expect(cleanSnapshot({ weight_kg: 20, body_fat_pct: 120, big3: { bench: 0, squat: 1200, deadlift: 150 }, growth_score: 61.6 })).toEqual({
    weight_kg: null, body_fat_pct: null, big3: { bench: null, squat: null, deadlift: 150 }, growth_score: 62,
  });
  expect(cleanSnapshot(null)).toBeNull();
});

describe('版15のマイグレーション', () => {
  test('版14の端末：表とトリガーを作り、受け取りの位置を消してスナップショットを取り直す', async () => {
    const db = memoryDb();
    const deps = testDeps();
    const v15 = MIGRATIONS.splice(14);
    try {
      await migrate(db, deps.now);
    } finally {
      MIGRATIONS.push(...v15);
    }
    db.raw.prepare(`INSERT INTO sync_meta (key, value) VALUES ('cursor', '42')`).run();
    expect(await migrate(db, deps.now)).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(15);
    expect(db.raw.prepare(`SELECT value FROM sync_meta WHERE key = 'cursor'`).get()).toBeUndefined();
    db.raw.prepare(`INSERT INTO phases (id, kind, start_date, status, created_at, updated_at) VALUES ('p1', 'rehab', '2026-11-01', 'active', 'x', 'x')`).run();
    const row = db.raw.prepare('SELECT entity_type, op, fields FROM sync_outbox').get() as { entity_type: string; op: string; fields: string };
    expect([row.entity_type, row.op]).toEqual(['phase', 'create']);
    expect(JSON.parse(row.fields)).toMatchObject({ kind: 'rehab', name: '', target_history: '[]' });
  });
});
