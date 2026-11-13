// ケガの記録（版13）：トリガーが積む変更（部位と左右・状態と直せた日は同じ変更）、refs の保留、消すと振り返りも消える、版12の端末
import { LATEST_VERSION, migrate, MIGRATIONS } from '../migrations';
import { InjuryError } from '../repositories/injuries';
import type { InjuryInput } from '@/lib/injuries';
import { INJURY_LIMITS } from '@/lib/limits';
import { createFakeSyncServer } from '@/test-utils/fakeSyncServer';
import { memoryDb, testDeps } from '@/test-utils/nodeDb';
import { device, Device } from '@/test-utils/syncHarness';

const BENCH = 'd41c7096-c246-4dfa-945a-e1cb329977a6'; // 初期の種目のベンチプレス（db/seed.ts）
const INPUT: InjuryInput = {
  occurredOn: '2026-11-06', site: 'shoulder_front', side: 'right', exerciseId: BENCH, phase: 'ラックアップ',
  symptom: '前側にピリッとした痛み', cause: '肩でバーベルを持ち上げてしまっている', fix: '肩甲骨を寄せてから、腕を伸ばして外す',
};

const outbox = (d: Device) => d.outbox().map((r) => [r.entity_type, r.op, r.fields == null ? null : JSON.parse(String(r.fields))]);

describe('ケガの記録', () => {
  test('記録すると、直している途中の create を積む。一覧と1件で読め、種目の名前も出る', async () => {
    const d = await device();
    const id = await d.r.injuries.create({ ...INPUT, phase: ' ラックアップ ' });
    expect(outbox(d)).toEqual([['injury', 'create', {
      occurred_on: '2026-11-06', site: 'shoulder_front', side: 'right', exercise_id: BENCH, phase: 'ラックアップ',
      symptom: INPUT.symptom, cause: INPUT.cause, fix: INPUT.fix, status: 'fixing', fixed_on: null,
    }]]);
    expect(await d.r.injuries.get(id)).toMatchObject({
      site: 'shoulder_front', side: 'right', exerciseName: 'ベンチプレス', status: 'fixing', fixedOn: null, reviewCount: 0, lastReview: null,
    });
    expect((await d.r.injuries.list()).map((i) => i.id)).toEqual([id]);
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 1, rejected: 0 });
    expect(d.server.state('injury', id)!.fields).toMatchObject({ site: 'shoulder_front', status: 'fixing' });
  });

  test('直せたにする・途中に戻すは、状態と直せた日を1つの update で送る', async () => {
    const d = await device();
    const id = await d.r.injuries.create(INPUT);
    await d.engine.run();
    await d.r.injuries.setStatus(id, 'fixed');
    await d.r.injuries.setStatus(id, 'fixing');
    expect(outbox(d)).toEqual([
      ['injury', 'update', { status: 'fixed', fixed_on: '2026-11-08' }],
      ['injury', 'update', { status: 'fixing', fixed_on: null }],
    ]);
  });

  test('部位を変えると、左右が同じでも部位と左右を一緒に送る。左右のない部位にすると左右は null', async () => {
    const d = await device();
    const id = await d.r.injuries.create(INPUT);
    await d.engine.run();
    await d.r.injuries.update(id, { ...INPUT, site: 'elbow' });
    await d.r.injuries.update(id, { ...INPUT, site: 'waist', side: null });
    await d.r.injuries.update(id, { ...INPUT, site: 'waist', side: null, cause: '腰が丸まった' });
    expect(outbox(d)).toEqual([
      ['injury', 'update', { site: 'elbow', side: 'right' }],
      ['injury', 'update', { site: 'waist', side: null }],
      ['injury', 'update', { cause: '腰が丸まった' }],
    ]);
  });

  test('確かめ：部位・左右・未来の日・長さ・直せた日より後の痛めた日', async () => {
    const d = await device();
    await expect(d.r.injuries.create({ ...INPUT, site: '' })).rejects.toThrow('痛めた部位を選んでください');
    await expect(d.r.injuries.create({ ...INPUT, site: 'abs', side: 'left' })).rejects.toThrow('腹筋には左右がありません');
    await expect(d.r.injuries.create({ ...INPUT, occurredOn: '2026-11-09' })).rejects.toThrow('未来の日には記録できません');
    await expect(d.r.injuries.create({ ...INPUT, fix: '😀'.repeat(501) })).rejects.toThrow('次の直し方は500文字以内');
    await expect(d.r.injuries.create({ ...INPUT, phase: 'あ'.repeat(101) })).rejects.toThrow(InjuryError);
    expect(await d.r.injuries.create({ ...INPUT, fix: '😀'.repeat(500) })).toBeTruthy();
    const id = await d.r.injuries.create({ ...INPUT, occurredOn: '2026-11-01' });
    d.deps.advance(-3 * 86400_000); // 11/5 に直せたにする
    await d.r.injuries.setStatus(id, 'fixed');
    d.deps.advance(3 * 86400_000);
    expect((await d.r.injuries.get(id))!.fixedOn).toBe('2026-11-05');
    await expect(d.r.injuries.update(id, { ...INPUT, occurredOn: '2026-11-06' })).rejects.toThrow('直せた日と同じか前の日');
  });

  test('件数の上限：ケガは200件、振り返りはケガ1件に100件まで（消したものは数えない）', async () => {
    const d = await device();
    const insert = d.db.raw.prepare(`INSERT INTO injuries (id, occurred_on, site, status, created_at, updated_at) VALUES (?, '2026-11-01', 'knee', 'fixing', 'x', 'x')`);
    for (let i = 0; i < INJURY_LIMITS.injuries; i++) insert.run(`i${i}`);
    await expect(d.r.injuries.create(INPUT)).rejects.toThrow('200件まで');
    await d.r.injuries.remove('i0');
    const id = await d.r.injuries.create(INPUT);
    const review = d.db.raw.prepare(`INSERT INTO injury_reviews (id, injury_id, date, result, created_at, updated_at) VALUES (?, ?, '2026-11-07', 'not_yet', 'x', 'x')`);
    for (let i = 0; i < INJURY_LIMITS.reviewsPerInjury; i++) review.run(`r${i}`, id);
    await expect(d.r.injuries.addReview(id, { date: '2026-11-07', result: 'fixed', note: '', exerciseId: null })).rejects.toThrow('100件まで');
  });

  test('振り返り：足すと create を積み、古い順に読める。最後の振り返りと回数が一覧に出る。自動では直せたにしない', async () => {
    const d = await device();
    const id = await d.r.injuries.create(INPUT);
    await d.r.injuries.addReview(id, { date: '2026-11-08', result: 'fixed', note: '寄せてから外せた', exerciseId: BENCH });
    await d.r.injuries.addReview(id, { date: '2026-11-07', result: 'not_yet', note: ' まだ肩が前に出る ', exerciseId: null });
    expect((await d.r.injuries.reviews(id)).map((r) => [r.date, r.result, r.note, r.exerciseName])).toEqual([
      ['2026-11-07', 'not_yet', 'まだ肩が前に出る', null],
      ['2026-11-08', 'fixed', '寄せてから外せた', 'ベンチプレス'],
    ]);
    expect(await d.r.injuries.get(id)).toMatchObject({ status: 'fixing', reviewCount: 2, lastReview: { date: '2026-11-08', result: 'fixed' } });
    expect(outbox(d).map(([t, op]) => [t, op])).toEqual([['injury', 'create'], ['injury_review', 'create'], ['injury_review', 'create']]);
    await expect(d.r.injuries.addReview(id, { date: '2026-11-09', result: 'fixed', note: '', exerciseId: null })).rejects.toThrow('未来の日');
  });

  test('消すと、ケガ → 振り返りの順に delete を積み、一覧から消える。サーバーでも両方消える', async () => {
    const d = await device();
    const id = await d.r.injuries.create(INPUT);
    const r1 = await d.r.injuries.addReview(id, { date: '2026-11-07', result: 'pain', note: '', exerciseId: null });
    await d.engine.run();
    await d.r.injuries.remove(id);
    expect(outbox(d)).toEqual([['injury', 'delete', null], ['injury_review', 'delete', null]]);
    expect(await d.r.injuries.list()).toEqual([]);
    expect(await d.r.injuries.get(id)).toBeNull();
    expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
    expect(d.server.state('injury', id)!.deleted).toBe(true);
    expect(d.server.state('injury_review', r1)!.deleted).toBe(true);
  });

  test('MCP が書いたもの：種目がまだ端末にない振り返りは保留し、そろったら当てはめる。食い違った値も読める', async () => {
    const server = createFakeSyncServer({ clock: () => '2026-11-08T01:00:00.000Z' });
    const mcp = { parent_id: null, changed_at: '2026-11-08T01:00:00.000Z', origin: 'mcp' as const, device_id: null };
    const EX = 'eeeeeeee-0000-4000-8000-000000000001';
    const INJ = 'aaaaaaaa-0000-4000-8000-000000000001';
    const REV = 'bbbbbbbb-0000-4000-8000-000000000001';
    // 振り返りが先、ケガ、種目の順に届く。ケガは左右のない部位に左右・直せたで直せた日なし（MCP が状態だけを直したもの）
    server.append([
      { ...mcp, change_id: crypto.randomUUID(), entity_type: 'injury_review', entity_id: REV, op: 'create',
        fields: { injury_id: INJ, date: '2026-11-07', result: 'fixed', exercise_id: EX } },
      { ...mcp, change_id: crypto.randomUUID(), entity_type: 'injury', entity_id: INJ, op: 'create',
        fields: { occurred_on: '2026-11-01', site: 'waist', side: 'left', status: 'fixed', exercise_id: EX } },
    ]);
    const d = await device(server);
    expect(await d.engine.run()).toMatchObject({ ok: true });
    expect(await d.r.injuries.list()).toEqual([]);
    expect(d.db.raw.prepare('SELECT entity_type FROM sync_held ORDER BY seq').all()).toEqual([{ entity_type: 'injury_review' }, { entity_type: 'injury' }]);
    const bp = d.db.raw.prepare('SELECT id FROM body_parts LIMIT 1').get() as { id: string };
    server.append([{ ...mcp, change_id: crypto.randomUUID(), entity_type: 'exercise', entity_id: EX, op: 'create',
      fields: { body_part_id: bp.id, name: 'ルーマニアンデッドリフト', record_type: 'weight_reps', sort_order: 99, hidden: false } }]);
    expect(await d.engine.run()).toMatchObject({ ok: true });
    expect(await d.r.injuries.get(INJ)).toMatchObject({
      site: 'waist', side: null, status: 'fixed', fixedOn: null, phase: '', cause: '', fix: '', exerciseName: 'ルーマニアンデッドリフト',
      reviewCount: 1, lastReview: { date: '2026-11-07', result: 'fixed' },
    });
    expect(d.outbox()).toEqual([]);
  });

  test('ログインの前の記録は、アカウントにつないだときに積み直す（ケガ → 振り返りの順）', async () => {
    const d = await device();
    const id = await d.r.injuries.create(INPUT);
    await d.r.injuries.addReview(id, { date: '2026-11-07', result: 'not_yet', note: '', exerciseId: null });
    await d.store.switchAccount('user-b', 'send', '2026-11-08T00:00:00.000Z');
    expect(outbox(d).map(([t, op]) => [t, op])).toEqual([['injury', 'create'], ['injury_review', 'create']]);
  });
});

describe('版13のマイグレーション', () => {
  test('版12の端末：表とトリガーを作り、受け取りの位置を消してスナップショットを取り直す', async () => {
    const db = memoryDb();
    const deps = testDeps();
    const v13 = MIGRATIONS.splice(12);
    try {
      await migrate(db, deps.now);
    } finally {
      MIGRATIONS.push(...v13);
    }
    db.raw.prepare(`INSERT INTO sync_meta (key, value) VALUES ('cursor', '42')`).run();
    expect(await migrate(db, deps.now)).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBeGreaterThanOrEqual(14);
    expect(db.raw.prepare(`SELECT value FROM sync_meta WHERE key = 'cursor'`).get()).toBeUndefined();
    db.raw.prepare(`INSERT INTO injuries (id, occurred_on, site, status, created_at, updated_at) VALUES ('i1', '2026-11-01', 'neck', 'fixing', 'x', 'x')`).run();
    const row = db.raw.prepare('SELECT entity_type, op, fields FROM sync_outbox').get() as { entity_type: string; op: string; fields: string };
    expect([row.entity_type, row.op]).toEqual(['injury', 'create']);
    expect(JSON.parse(row.fields)).toMatchObject({ site: 'neck', phase: '', cause: '', fix: '', side: null });
  });
});
