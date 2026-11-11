// Health Connect の取り込み（lib/healthConnect/importer.ts、db/repositories/healthConnect.ts）。
// Health Connect は偽物（test-utils/fakeHealthConnect.ts）、サーバーは偽の同期サーバー（当てはめの決まりはサーバーと同じ）
import { LATEST_VERSION, migrate, MIGRATIONS } from '../migrations';
import { HC_META, healthConnectStore } from '../repositories/healthConnect';
import { toPushChange } from '../repositories/sync';
import { formatClock, formatHeartRate, formatMinutes } from '@/lib/health';
import {
  heartRateDayId, importedId, importHealthConnect, INITIAL_DAYS, PERMISSIONS, requestReadPermissions, sleepMinutes, stepDayId, STEPS_MAX,
} from '@/lib/healthConnect/importer';
import { uuid5 } from '@/lib/uuid5';
import { bodyFat, fakeHealthConnect as hc, heartRate, leanMass, restingHeartRate, sleep, steps, weight } from '@/test-utils/fakeHealthConnect';
import { memoryDb, testDeps } from '@/test-utils/nodeDb';
import { Device, device } from '@/test-utils/syncHarness';

jest.mock('react-native-health-connect', () => require('@/test-utils/fakeHealthConnect').module);

beforeEach(() => hc.reset());

/** 取り込みを1回動かす */
const runImport = (d: Device) => importHealthConnect(healthConnectStore(d.db, d.deps), d.deps.now);
const bodyRows = (d: Device) => d.db.raw.prepare(
  `SELECT id, date, measured_at, weight_kg, body_fat_pct, lean_mass_kg, source, external_id, origin_package, deleted_at
   FROM body_records ORDER BY measured_at, external_id`,
).all() as Record<string, unknown>[];
const outbox = (d: Device) => d.outbox().map((r) => ({ type: r.entity_type, id: r.entity_id, op: r.op, origin: r.origin, fields: r.fields ? JSON.parse(r.fields as string) : null }));

describe('ID の作り方', () => {
  test('uuid5（固定の名前空間、"hc:" + Health Connect の ID）。同じ記録はいつも同じ ID', () => {
    expect(importedId('abc')).toBe(uuid5('08e139e3-1bcd-47c7-af17-1a18a473f1c3', 'hc:abc'));
    expect(importedId('abc')).toBe(importedId('abc'));
    expect(importedId('abc')).not.toBe(importedId('abd'));
  });
});

describe('初めての取り込み', () => {
  test('先にトークンを取り、過去30日を全ページ読む。1件を1行に（体重・体脂肪率・除脂肪体重は別の行）、origin = import で積む', async () => {
    const d = await device(); // 今は 2026-11-08T00:00Z
    hc.put(weight('w-old', '2026-10-01T22:00:00Z', 72)); // 30日より前：読まない
    hc.put(weight('w1', '2026-11-01T22:00:00Z', 70.2)); // 日本時間 11/2 の朝
    hc.put(weight('w2', '2026-11-05T22:00:00Z', 69.8));
    hc.put(weight('w3', '2026-11-06T22:00:00Z', 69.6));
    hc.put(bodyFat('f1', '2026-11-06T22:00:00Z', 18.4));
    hc.put(leanMass('l1', '2026-11-06T22:00:00Z', 56.8));

    const result = await runImport(d);
    expect(result.written).toBe(5);
    // トークンを先に取ってから読む（読んでいるあいだの変更は、次の差分で届く）
    const order = hc.calls.filter((c) => c.fn !== 'revokeAllPermissions').map((c) => c.fn);
    expect(order.slice(0, 3)).toEqual(['getChanges', 'readRecords', 'readRecords']); // 体重は3件 → 2ページ
    const read = hc.calls.find((c) => c.fn === 'readRecords')!.args[1] as { timeRangeFilter: { startTime: string } };
    expect(read.timeRangeFilter.startTime).toBe(new Date(Date.parse('2026-11-08T00:00:00Z') - INITIAL_DAYS * 86_400_000).toISOString());

    const rows = bodyRows(d);
    expect(rows.map((r) => [r.external_id, r.date, r.weight_kg, r.body_fat_pct, r.lean_mass_kg])).toEqual([
      ['w1', '2026-11-02', 70.2, null, null],
      ['w2', '2026-11-06', 69.8, null, null],
      ['f1', '2026-11-07', null, 18.4, null],
      ['l1', '2026-11-07', null, null, 56.8],
      ['w3', '2026-11-07', 69.6, null, null],
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({ id: importedId(r.external_id as string), source: 'health_connect', origin_package: 'com.example.scale', deleted_at: null });
    }
    expect(outbox(d).map((c) => [c.op, c.origin])).toEqual(Array(5).fill(['create', 'import']));
    // 送る形にも origin が入る
    expect(toPushChange(d.outbox()[0] as never).origin).toBe('import');
    // 型ごとのトークンと、最後に取り込んだ時刻
    const meta = (k: string) => healthConnectStore(d.db, d.deps).getMeta(k);
    expect(await meta(HC_META.token('Weight'))).toBe('Weight:4');
    expect(await meta(HC_META.lastImportAt)).toBe('2026-11-08T00:00:00.000Z');
    // 画面の1日の値：取り込みの印
    expect(await d.r.body.getDay('2026-11-07')).toEqual({
      date: '2026-11-07', weightKg: 69.6, bodyFatPct: 18.4, musclePct: null, waistCm: null, memo: '', imported: ['weightKg', 'bodyFatPct'],
    });
  });

  test('範囲の外の値（lib/limits.ts とサーバーの範囲）は取り込まない', async () => {
    const d = await device();
    hc.put(weight('w-low', '2026-11-06T22:00:00Z', 25));
    hc.put(weight('w-high', '2026-11-06T22:10:00Z', 301));
    hc.put(bodyFat('f-bad', '2026-11-06T22:00:00Z', 120));
    hc.put(weight('w-ok', '2026-11-06T22:20:00Z', 30));
    await runImport(d);
    expect(bodyRows(d).map((r) => r.external_id)).toEqual(['w-ok']);
  });

  test('権限のない型は読まない', async () => {
    const d = await device();
    hc.grant(['BodyFat']);
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    hc.put(bodyFat('f1', '2026-11-06T22:00:00Z', 18));
    expect((await runImport(d)).types).toEqual(['BodyFat']);
    expect(bodyRows(d).map((r) => r.external_id)).toEqual(['f1']);
  });
});

describe('差分', () => {
  test('直したら update、消えたら delete（どちらも origin = import）。変わっていなければ何も積まない。同じ回に足して消えたものは書かない', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    await d.engine.run();
    expect(outbox(d)).toEqual([]);

    expect((await runImport(d)).written).toBe(0); // 変更なし
    expect(outbox(d)).toEqual([]);

    d.deps.advance(60_000);
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 69.4));
    hc.put(weight('w2', '2026-11-07T22:00:00Z', 69.1));
    hc.put(weight('w3', '2026-11-07T23:00:00Z', 69.0));
    hc.remove('w3');
    await runImport(d); // 4件の変更 → 2ページ
    expect(outbox(d)).toEqual([
      { type: 'body_record', id: importedId('w1'), op: 'update', origin: 'import', fields: { weight_kg: 69.4 } },
      { type: 'body_record', id: importedId('w2'), op: 'create', origin: 'import', fields: expect.objectContaining({ weight_kg: 69.1 }) },
    ]);
    expect(await healthConnectStore(d.db, d.deps).getMeta(HC_META.token('Weight'))).toBe('Weight:5');
    await d.engine.run();

    hc.remove('w2');
    await runImport(d);
    expect(outbox(d)).toEqual([{ type: 'body_record', id: importedId('w2'), op: 'delete', origin: 'import', fields: null }]);
    expect(bodyRows(d).find((r) => r.external_id === 'w2')!.deleted_at).not.toBeNull();
  });

  test('端末で消えている取り込みの記録（同期で消されたものなど）は、Health Connect で直されても戻らない', async () => {
    // アプリの画面からは取り込みの記録を消さない（からだの欄を空にして保存しても、消えるのは手入力の値だけ）
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    d.db.raw.prepare(`UPDATE body_records SET deleted_at = ? WHERE external_id = 'w1'`).run('2026-11-08T00:00:00.000Z');
    expect(await d.r.body.getDay('2026-11-07')).toBeNull();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70.5));
    await runImport(d);
    expect(bodyRows(d)).toMatchObject([{ external_id: 'w1', weight_kg: 70, deleted_at: expect.any(String) }]);
    // 直された取り込みを、送る変更に積まない（消した行の削除だけ）
    expect(outbox(d).filter((c) => c.origin === 'import').map((c) => c.op)).toEqual(['create']);
  });

  test('トークンが切れていたら、最後に読んだ時刻から読み直す', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d); // 読んだ時刻 2026-11-08T00:00Z
    d.deps.advance(3 * 86_400_000);
    hc.put(weight('w2', '2026-11-09T22:00:00Z', 69.5));
    hc.expireTokens('Weight');
    hc.calls.length = 0;
    await runImport(d);
    const read = hc.calls.filter((c) => c.fn === 'readRecords' && c.args[0] === 'Weight')
      .map((c) => (c.args[1] as { timeRangeFilter: { startTime: string } }).timeRangeFilter.startTime);
    expect(read).toEqual(['2026-11-08T00:00:00.000Z']);
    expect(bodyRows(d).map((r) => r.external_id)).toEqual(['w1', 'w2']);
    expect(await healthConnectStore(d.db, d.deps).getMeta(HC_META.token('Weight'))).toBe('Weight:2');
  });

  test('読めなかったら、トークンは進めない（次は同じところから読む）', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    hc.put(weight('w2', '2026-11-07T22:00:00Z', 69));
    const getChanges = hc.module.getChanges;
    hc.module.getChanges = async () => { throw new Error('読めない'); };
    try {
      await expect(runImport(d)).rejects.toThrow('読めない');
    } finally {
      hc.module.getChanges = getChanges;
    }
    expect(await healthConnectStore(d.db, d.deps).getMeta(HC_META.token('Weight'))).toBe('Weight:1');
    await runImport(d);
    expect(bodyRows(d).map((r) => r.external_id)).toEqual(['w1', 'w2']);
  });
});

describe('手入力が先', () => {
  test('同じ日に手入力と取り込みがあれば、取り込みが新しくても手入力を出す（取り込みは手入力がない項目だけ）', async () => {
    const d = await device(undefined, '2026-11-07T10:00:00.000Z'); // 日本時間 19:00
    await d.r.body.saveManual('2026-11-07', { weightKg: 69 });
    d.deps.advance(3_600_000);
    hc.put(weight('w1', '2026-11-07T10:30:00Z', 68.5)); // 手入力よりあと
    hc.put(bodyFat('f1', '2026-11-07T10:30:00Z', 17.2));
    await runImport(d);
    expect(await d.r.body.getDay('2026-11-07')).toMatchObject({ weightKg: 69, bodyFatPct: 17.2, imported: ['bodyFatPct'] });
    // 計測を入れるシートの「取り込み 68.5 kg」：手入力があっても、取り込みだけの値
    expect(await d.r.body.getImportedDay('2026-11-07')).toMatchObject({ weightKg: 68.5, bodyFatPct: 17.2 });
    // 体重の欄を空にして保存すると、手入力の値だけが消え、取り込みの値に戻る（取り込みの行は消さない）
    await d.r.body.saveManual('2026-11-07', { weightKg: null });
    expect(await d.r.body.getDay('2026-11-07')).toMatchObject({ weightKg: 68.5, bodyFatPct: 17.2, imported: ['weightKg', 'bodyFatPct'] });
    expect(bodyRows(d).filter((r) => r.source === 'health_connect').every((r) => r.deleted_at == null)).toBe(true);
  });

  test('取り込んだ記録を手（MCP）で直した値は、次の取り込みで負けない（同期のあとも手の値）', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    expect(await d.engine.run()).toMatchObject({ ok: true, sent: 1 });
    // MCP で直す（サーバーが受け付けた時刻で、手入力の強さ）
    d.server.setClock(() => '2026-11-08T00:10:00.000Z');
    d.server.append([{
      change_id: crypto.randomUUID(), entity_type: 'body_record', entity_id: importedId('w1'), parent_id: null, op: 'update',
      fields: { weight_kg: 69.5 }, changed_at: '2026-11-08T00:10:00.000Z', origin: 'mcp', device_id: null,
    }]);
    await d.engine.run();
    expect(bodyRows(d)[0].weight_kg).toBe(69.5);
    // 体重計の値が直される（あとの時刻）。取り込みは端末の値を書き換えて送るが、サーバーで手の値に負ける
    d.deps.advance(3_600_000);
    d.server.setClock(() => '2026-11-08T01:00:00.000Z');
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 71));
    await runImport(d);
    expect(await d.engine.run()).toMatchObject({ ok: true, rejected: 0 });
    expect(bodyRows(d)[0].weight_kg).toBe(69.5);
    expect(d.server.state('body_record', importedId('w1'))!.fields.weight_kg).toBe(69.5);
  });
});

describe('睡眠', () => {
  test('眠っていた分は、全体から「起きていた・ベッドの外」の段階を引く（記録からはみ出した段階は数えない）。段階がなければ全部', () => {
    expect(sleepMinutes({ startTime: '2026-11-06T14:40:00Z', endTime: '2026-11-06T21:55:00Z' })).toEqual({ asleepMin: 435, awakeMin: 0 });
    expect(sleepMinutes({
      startTime: '2026-11-06T14:40:00Z', endTime: '2026-11-06T21:55:00Z',
      stages: [
        { startTime: '2026-11-06T14:30:00Z', endTime: '2026-11-06T14:50:00Z', stage: 1 }, // 10分だけ記録の中
        { startTime: '2026-11-06T14:50:00Z', endTime: '2026-11-06T18:00:00Z', stage: 5 },
        { startTime: '2026-11-06T18:00:00Z', endTime: '2026-11-06T18:12:00Z', stage: 3 },
        { startTime: '2026-11-06T18:12:00Z', endTime: '2026-11-06T21:55:00Z', stage: 6 },
      ],
    })).toEqual({ asleepMin: 413, awakeMin: 22 });
    expect(sleepMinutes({ startTime: '2026-11-06T21:55:00Z', endTime: '2026-11-06T14:40:00Z' })).toBeNull();
    expect(formatMinutes(413)).toBe('6時間53分');
    expect(formatMinutes(45)).toBe('45分');
    expect(formatMinutes(420)).toBe('7時間');
  });

  test('1件を1行に。日付は起きた日（その土地の日付）。origin = import で積み、消えたら消す。24時間を超えるものは取り込まない', async () => {
    const d = await device();
    // 日本時間 11/6 23:40 〜 11/7 6:55
    hc.put(sleep('s1', '2026-11-06T14:40:00Z', '2026-11-06T21:55:00Z', [['2026-11-06T18:00:00Z', '2026-11-06T18:15:00Z', 1]]));
    hc.put(sleep('s2', '2026-11-07T04:00:00Z', '2026-11-07T04:30:00Z')); // 昼寝
    hc.put(sleep('s-long', '2026-11-01T10:00:00Z', '2026-11-02T10:01:00Z'));
    await runImport(d);
    const rows = d.db.raw.prepare('SELECT * FROM sleep_sessions ORDER BY start_at').all() as Record<string, unknown>[];
    expect(rows.map((r) => [r.external_id, r.date, r.asleep_min, r.awake_min, r.source, r.origin_package])).toEqual([
      ['s1', '2026-11-07', 420, 15, 'health_connect', 'com.example.watch'],
      ['s2', '2026-11-07', 30, 0, 'health_connect', 'com.example.watch'],
    ]);
    expect(rows[0].id).toBe(importedId('s1'));
    expect(outbox(d).map((c) => [c.type, c.op, c.origin])).toEqual([
      ['sleep_session', 'create', 'import'], ['sleep_session', 'create', 'import'],
    ]);
    expect(outbox(d)[0].fields).toEqual({
      date: '2026-11-07', start_at: '2026-11-06T14:40:00.000Z', end_at: '2026-11-06T21:55:00.000Z', asleep_min: 420, awake_min: 15,
      source: 'health_connect', external_id: 's1', origin_package: 'com.example.watch',
    });
    const day = await d.r.health.sleepDay('2026-11-07');
    expect(day).toMatchObject({ asleepMin: 450, awakeMin: 15, mainStartAt: '2026-11-06T14:40:00.000Z', sessions: 2 });
    expect(formatClock(day!.mainEndAt)).toBe(`${new Date('2026-11-06T21:55:00Z').getHours()}:55`);

    await d.engine.run();
    expect(d.server.state('sleep_session', importedId('s1'))!.fields).toMatchObject({ asleep_min: 420 });
    hc.remove('s2');
    await runImport(d);
    expect(outbox(d)).toEqual([{ type: 'sleep_session', id: importedId('s2'), op: 'delete', origin: 'import', fields: null }]);
    expect(await d.r.health.sleepDay('2026-11-07')).toMatchObject({ asleepMin: 420, sessions: 1 });
  });

  test('アカウントを変えて「消して受け取り直す」と睡眠も消え、取り込み直す', async () => {
    const d = await device();
    hc.put(sleep('s1', '2026-11-06T14:40:00Z', '2026-11-06T21:55:00Z'));
    await runImport(d);
    await d.store.switchAccount('user-b', 'replace', d.deps.now().toISOString());
    expect(await d.r.health.sleepDay('2026-11-07')).toBeNull();
    await runImport(d);
    expect(await d.r.health.sleepDay('2026-11-07')).toMatchObject({ asleepMin: 435 });
  });
});

describe('心拍', () => {
  // 日付は端末の暦（日本時間でも UTC でも同じ日になるよう、UTC の 0〜15時の記録にする）
  const hrRows = (d: Device) => d.db.raw.prepare(
    'SELECT id, date, resting_bpm, avg_bpm, min_bpm, max_bpm, samples, deleted_at FROM heart_rate_days ORDER BY date',
  ).all() as Record<string, unknown>[];

  test('初回は記録を読まず、過去30日を日ごとに集計する。1日1行（ID は日付から）、サンプルは送らない', async () => {
    const d = await device();
    hc.put(heartRate('h1', [['2026-11-06T03:00:00Z', 60], ['2026-11-06T03:05:00Z', 80]]));
    hc.put(heartRate('h2', [['2026-11-06T09:00:00Z', 140]]));
    hc.put(restingHeartRate('r1', '2026-11-06T01:00:00Z', 55));
    hc.put(restingHeartRate('r2', '2026-11-05T01:00:00Z', 57)); // 安静時だけの日
    hc.put(heartRate('h-old', [['2026-09-01T03:00:00Z', 70]])); // 30日より前
    await runImport(d);
    expect(hc.calls.filter((c) => c.fn === 'readRecords' && ['HeartRate', 'RestingHeartRate'].includes(c.args[0] as string))).toEqual([]);
    expect(hrRows(d)).toEqual([
      { id: heartRateDayId('2026-11-05'), date: '2026-11-05', resting_bpm: 57, avg_bpm: null, min_bpm: null, max_bpm: null, samples: 0, deleted_at: null },
      { id: heartRateDayId('2026-11-06'), date: '2026-11-06', resting_bpm: 55, avg_bpm: 93, min_bpm: 60, max_bpm: 140, samples: 3, deleted_at: null },
    ]);
    const changes = outbox(d).filter((c) => c.type === 'heart_rate_day');
    expect(changes.map((c) => [c.op, c.origin])).toEqual([['create', 'import'], ['create', 'import']]);
    expect(changes[1].fields).toEqual({ date: '2026-11-06', resting_bpm: 55, avg_bpm: 93, min_bpm: 60, max_bpm: 140, samples: 3 });
    expect(heartRateDayId('2026-11-06')).toBe(uuid5('08e139e3-1bcd-47c7-af17-1a18a473f1c3', 'hc-hr-day:2026-11-06'));
    expect(formatHeartRate((await d.r.health.heartRateDay('2026-11-06'))!)).toBe('安静時 55 ・ 平均 93（60〜140） 拍/分');
    expect(formatHeartRate((await d.r.health.heartRateDay('2026-11-05'))!)).toBe('安静時 57 拍/分');
  });

  test('差分：変わった記録の日だけ集計し直す。記録がなくなった日は消し、また記録があれば戻す', async () => {
    const d = await device();
    hc.put(heartRate('h1', [['2026-11-06T03:00:00Z', 60]]));
    hc.put(heartRate('h2', [['2026-11-07T03:00:00Z', 70]]));
    await runImport(d);
    await d.engine.run();

    hc.calls.length = 0;
    hc.put(heartRate('h3', [['2026-11-07T04:00:00Z', 90]]));
    hc.put(restingHeartRate('r1', '2026-11-07T01:00:00Z', 52));
    await runImport(d);
    // 変わった日（11/7）だけ、心拍と安静時心拍を1回ずつ集計（2つの型の変更で2回）
    const aggregated = hc.calls.filter((c) => c.fn === 'aggregateRecord')
      .map((c) => (c.args[0] as { timeRangeFilter: { startTime: string } }).timeRangeFilter.startTime);
    expect(new Set(aggregated)).toEqual(new Set([new Date(2026, 10, 7).toISOString()]));
    expect(outbox(d).map((c) => [c.op, c.origin, c.fields])).toEqual([
      ['update', 'import', { resting_bpm: 52, avg_bpm: 80, max_bpm: 90, samples: 2 }],
    ]);
    await d.engine.run();

    hc.remove('h1'); // どの日のものか分からないので、過去30日を集計し直す
    await runImport(d);
    expect(outbox(d).map((c) => [c.id, c.op, c.origin])).toEqual([[heartRateDayId('2026-11-06'), 'delete', 'import']]);
    expect(await d.r.health.heartRateDay('2026-11-06')).toBeNull();
    await d.engine.run();

    hc.put(heartRate('h4', [['2026-11-06T05:00:00Z', 65]]));
    await runImport(d);
    expect(outbox(d).map((c) => [c.op, c.origin, c.fields])).toEqual([
      ['restore', 'import', null], ['update', 'import', { avg_bpm: 65, min_bpm: 65, max_bpm: 65 }],
    ]);
    expect(await d.r.health.heartRateDay('2026-11-06')).toMatchObject({ avgBpm: 65, samples: 1 });
  });

  test('トークンが切れたら、最後に読んだ時刻の日から集計し直す', async () => {
    const d = await device();
    hc.put(heartRate('h1', [['2026-11-07T03:00:00Z', 60]]));
    await runImport(d);
    d.deps.advance(2 * 86_400_000);
    hc.put(heartRate('h2', [['2026-11-09T03:00:00Z', 75]]));
    hc.expireTokens('HeartRate');
    hc.calls.length = 0;
    await runImport(d);
    const days = hc.calls.filter((c) => c.fn === 'aggregateRecord' && (c.args[0] as { recordType: string }).recordType === 'HeartRate')
      .map((c) => (c.args[0] as { timeRangeFilter: { startTime: string } }).timeRangeFilter.startTime);
    // 読んだ時刻（11/8 0時 UTC）の日から今日（11/10）まで
    expect(days).toEqual([8, 9, 10].map((d) => new Date(2026, 10, d).toISOString()));
    expect(hrRows(d).map((r) => [r.date, r.avg_bpm])).toEqual([['2026-11-07', 60], ['2026-11-09', 75]]);
  });
});

describe('アカウントと連携', () => {
  test('アカウントを変えて「消して受け取り直す」と、トークンも消え、次は過去30日から取り込み直す。「送る」は取り込みを import で積む', async () => {
    const d = await device();
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    await d.engine.run();
    const store = healthConnectStore(d.db, d.deps);

    await d.store.switchAccount('user-b', 'send', d.deps.now().toISOString());
    expect(outbox(d).filter((c) => c.type === 'body_record').map((c) => [c.op, c.origin])).toEqual([['create', 'import']]);
    expect(await store.getMeta(HC_META.token('Weight'))).toBe('Weight:1');

    await d.store.switchAccount('user-c', 'replace', d.deps.now().toISOString());
    expect(bodyRows(d)).toEqual([]);
    expect(await store.getMeta(HC_META.token('Weight'))).toBeNull();
    expect(await store.getMeta(HC_META.readAt('Weight'))).toBeNull();
    await runImport(d);
    expect(bodyRows(d).map((r) => [r.id, r.deleted_at])).toEqual([[importedId('w1'), null]]);
  });

  test('連携を切ると、トークンと連携の印を消す（取り込んだ記録は残す）', async () => {
    const d = await device();
    const store = healthConnectStore(d.db, d.deps);
    await store.setMeta(HC_META.connected, '1');
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    await runImport(d);
    await store.disconnect();
    for (const k of [HC_META.connected, HC_META.lastImportAt, HC_META.token('Weight'), HC_META.readAt('Weight')]) {
      expect(await store.getMeta(k)).toBeNull();
    }
    expect(bodyRows(d)).toHaveLength(1);
  });
});

describe('版4のマイグレーション', () => {
  test('版3の端末：まだ送っていない変更は origin = app のまま残り、そのあとの変更も app で積む', async () => {
    const db = memoryDb();
    const deps = testDeps();
    const v4 = MIGRATIONS.splice(3);
    try {
      await migrate(db, deps.now);
    } finally {
      MIGRATIONS.push(...v4);
    }
    db.raw.prepare(`INSERT INTO settings (id, value, created_at, updated_at) VALUES ('weight_unit', 'lb', 'x', 'x')`).run();
    expect(await migrate(db, deps.now)).toBe(LATEST_VERSION);
    db.raw.prepare(`UPDATE settings SET value = 'kg', updated_at = 'y' WHERE id = 'weight_unit'`).run();
    const rows = db.raw.prepare('SELECT op, origin FROM sync_outbox ORDER BY seq').all();
    expect(rows).toEqual([{ op: 'create', origin: 'app' }, { op: 'update', origin: 'app' }]);
  });
});

describe('歩数', () => {
  // 日付は端末の暦（心拍と同じく、日本時間でも UTC でも同じ日になるよう、UTC の 0〜15時の記録にする）
  const stepRows = (d: Device) => d.db.raw.prepare('SELECT id, date, steps, deleted_at FROM step_days ORDER BY date').all() as Record<string, unknown>[];
  const stepCalls = () => hc.calls.filter((c) => c.fn === 'aggregateRecord' && (c.args[0] as { recordType: string }).recordType === 'Steps')
    .map((c) => (c.args[0] as { timeRangeFilter: { startTime: string } }).timeRangeFilter.startTime);

  test('初回は記録を読まず、過去30日を日ごとに集計する（Health Connect の集計の合計）。1日1行（ID は日付から）で、合計だけを送る', async () => {
    const d = await device();
    hc.put(steps('st1', '2026-11-06T01:00:00Z', '2026-11-06T02:00:00Z', 3000));
    hc.put(steps('st2', '2026-11-06T09:00:00Z', '2026-11-06T10:00:00Z', 5240, 'com.example.watch'));
    hc.put(steps('st3', '2026-11-07T03:00:00Z', '2026-11-07T04:00:00Z', 120));
    hc.put(steps('st-old', '2026-09-01T03:00:00Z', '2026-09-01T04:00:00Z', 9000)); // 30日より前
    await runImport(d);
    expect(hc.calls.filter((c) => c.fn === 'readRecords' && c.args[0] === 'Steps')).toEqual([]);
    expect(stepCalls()).toHaveLength(INITIAL_DAYS + 1); // 30日前の日から今日まで
    expect(stepRows(d)).toEqual([
      { id: stepDayId('2026-11-06'), date: '2026-11-06', steps: 8240, deleted_at: null },
      { id: stepDayId('2026-11-07'), date: '2026-11-07', steps: 120, deleted_at: null },
    ]);
    const changes = outbox(d).filter((c) => c.type === 'step_day');
    expect(changes.map((c) => [c.op, c.origin, c.fields])).toEqual([
      ['create', 'import', { date: '2026-11-06', steps: 8240 }], ['create', 'import', { date: '2026-11-07', steps: 120 }],
    ]);
    expect(stepDayId('2026-11-06')).toBe(uuid5('08e139e3-1bcd-47c7-af17-1a18a473f1c3', 'hc-steps-day:2026-11-06'));
    expect(await d.r.health.stepDay('2026-11-06')).toEqual({ date: '2026-11-06', steps: 8240 });
    expect(await d.r.health.stepDay('2026-11-05')).toBeNull();
  });

  test('差分：変わった記録の日だけ集計し直す。記録がなくなった日は消し、また記録があれば戻す', async () => {
    const d = await device();
    hc.put(steps('st1', '2026-11-06T01:00:00Z', '2026-11-06T02:00:00Z', 3000));
    hc.put(steps('st2', '2026-11-07T01:00:00Z', '2026-11-07T02:00:00Z', 4000));
    await runImport(d);
    await d.engine.run();

    hc.calls.length = 0;
    hc.put(steps('st3', '2026-11-07T05:00:00Z', '2026-11-07T06:00:00Z', 1500));
    await runImport(d);
    expect(stepCalls()).toEqual([new Date(2026, 10, 7).toISOString()]);
    expect(outbox(d).map((c) => [c.op, c.origin, c.fields])).toEqual([['update', 'import', { steps: 5500 }]]);
    await d.engine.run();

    hc.remove('st1'); // どの日のものか分からないので、過去30日を集計し直す
    await runImport(d);
    expect(outbox(d).map((c) => [c.id, c.op, c.origin])).toEqual([[stepDayId('2026-11-06'), 'delete', 'import']]);
    expect(await d.r.health.stepDay('2026-11-06')).toBeNull();
    await d.engine.run();

    hc.put(steps('st4', '2026-11-06T03:00:00Z', '2026-11-06T04:00:00Z', 700));
    await runImport(d);
    expect(outbox(d).map((c) => [c.op, c.origin, c.fields])).toEqual([['restore', 'import', null], ['update', 'import', { steps: 700 }]]);
    expect(await d.r.health.stepDays('2026-11-01', '2026-11-08')).toEqual([{ date: '2026-11-06', steps: 700 }, { date: '2026-11-07', steps: 5500 }]);
  });

  test('サーバーの範囲（1〜1,000,000）の外の日は取り込まない', async () => {
    const d = await device();
    hc.put(steps('st1', '2026-11-06T01:00:00Z', '2026-11-06T02:00:00Z', STEPS_MAX));
    hc.put(steps('st2', '2026-11-07T01:00:00Z', '2026-11-07T02:00:00Z', STEPS_MAX));
    hc.put(steps('st3', '2026-11-07T03:00:00Z', '2026-11-07T04:00:00Z', 1));
    await runImport(d);
    expect(stepRows(d).map((r) => [r.date, r.steps])).toEqual([['2026-11-06', STEPS_MAX]]);
  });

  test('歩数の許可がないあいだ（前の APK・許可していない）は歩数を読まず、ほかの型はいつもどおり取り込む', async () => {
    const d = await device();
    hc.grant(['Weight', 'SleepSession', 'HeartRate', 'RestingHeartRate']);
    hc.put(steps('st1', '2026-11-06T01:00:00Z', '2026-11-06T02:00:00Z', 3000));
    hc.put(weight('w1', '2026-11-06T22:00:00Z', 70));
    const result = await runImport(d);
    expect(result.types).not.toContain('Steps');
    expect(result.types).toContain('Weight');
    expect(stepCalls()).toEqual([]);
    expect(stepRows(d)).toEqual([]);
    expect(bodyRows(d).map((r) => r.external_id)).toEqual(['w1']);
    // あとで許可したら、そのときに過去30日を取り込む
    hc.grant(['Weight', 'SleepSession', 'HeartRate', 'RestingHeartRate', 'Steps']);
    expect((await runImport(d)).types).toContain('Steps');
    expect(stepRows(d).map((r) => [r.date, r.steps])).toEqual([['2026-11-06', 3000]]);
  });

  test('権限を求める：前の APK（AndroidManifest に READ_STEPS がない）で失敗したら、歩数を外して求め直す', async () => {
    const request = hc.module.requestPermission;
    expect((await requestReadPermissions(request)).map((p) => p.recordType)).toContain('Steps');

    hc.calls.length = 0;
    hc.declare(['Weight', 'BodyFat', 'LeanBodyMass', 'SleepSession', 'HeartRate', 'RestingHeartRate']);
    hc.grant(['Weight', 'BodyFat', 'LeanBodyMass', 'SleepSession', 'HeartRate', 'RestingHeartRate']);
    const granted = await requestReadPermissions(request);
    expect(granted.map((p) => p.recordType)).toEqual(['Weight', 'BodyFat', 'LeanBodyMass', 'SleepSession', 'HeartRate', 'RestingHeartRate']);
    const asked = hc.calls.filter((c) => c.fn === 'requestPermission').map((c) => (c.args[0] as { recordType: string }[]).length);
    expect(asked).toEqual([PERMISSIONS.length, PERMISSIONS.length - 1]);

    // 歩数のせいでないとき（Health Connect が使えないなど）は、2回目も失敗し、初めの失敗を投げる
    const failing = jest.fn(async () => { throw new Error('unavailable'); });
    await expect(requestReadPermissions(failing)).rejects.toThrow('unavailable');
  });
});

describe('版11のマイグレーション', () => {
  test('版10の端末：今までの記録とまだ送っていない変更は残り、歩数の表ができる（受け取りの位置は消さない）', async () => {
    const db = memoryDb();
    const deps = testDeps();
    const v11 = MIGRATIONS.splice(10);
    try {
      expect(await migrate(db, deps.now)).toBe(10);
    } finally {
      MIGRATIONS.push(...v11);
    }
    db.raw.prepare(`INSERT INTO settings (id, value, created_at, updated_at) VALUES ('weight_unit', 'lb', 'x', 'x')`).run();
    db.raw.prepare(`INSERT INTO sync_meta (key, value) VALUES ('cursor', '42')`).run();
    // 版11まで当てる（版12はレポートのために受け取りの位置を消す）
    const v12 = MIGRATIONS.splice(11);
    try {
      expect(await migrate(db, deps.now)).toBe(11);
    } finally {
      MIGRATIONS.push(...v12);
    }
    expect(db.raw.prepare('SELECT entity_type, op FROM sync_outbox ORDER BY seq').all()).toEqual([{ entity_type: 'setting', op: 'create' }]);
    expect(db.raw.prepare(`SELECT value FROM sync_meta WHERE key = 'cursor'`).get()).toEqual({ value: '42' });
    db.raw.prepare(`INSERT INTO step_days (id, date, steps, created_at, updated_at) VALUES ('s', '2026-11-08', 10, 'y', 'y')`).run();
    expect(db.raw.prepare(`SELECT entity_type, op, fields FROM sync_outbox WHERE entity_type = 'step_day'`).all())
      .toEqual([{ entity_type: 'step_day', op: 'create', fields: JSON.stringify({ date: '2026-11-08', steps: 10 }) }]);
  });
});

describe('睡眠・心拍の期間の読み出し（推移の画面）', () => {
  test('期間の日ごとの睡眠（同じ日の複数の睡眠は足し、いちばん長いものの時刻）と心拍。期間の外と消したものは入らない', async () => {
    const d = await device();
    hc.put(sleep('s1', '2026-11-04T14:00:00Z', '2026-11-04T21:00:00Z'));
    hc.put(sleep('s2', '2026-11-06T14:40:00Z', '2026-11-06T21:55:00Z'));
    hc.put(sleep('s3', '2026-11-07T04:00:00Z', '2026-11-07T04:30:00Z'));
    hc.put(sleep('s4', '2026-10-01T14:00:00Z', '2026-10-01T21:00:00Z'));
    hc.put(restingHeartRate('r1', '2026-11-05T03:00:00Z', 57));
    hc.put(restingHeartRate('r2', '2026-11-06T03:00:00Z', 55));
    await runImport(d);
    const days = await d.r.health.sleepDays('2026-11-01', '2026-11-08');
    expect(days.map((x) => [x.date, x.sessions])).toEqual([['2026-11-05', 1], ['2026-11-07', 2]]);
    expect(days[1]).toMatchObject({ mainStartAt: '2026-11-06T14:40:00.000Z', mainEndAt: '2026-11-06T21:55:00.000Z' });
    expect(days[1].asleepMin).toBe((await d.r.health.sleepDay('2026-11-07'))!.asleepMin);
    hc.remove('s1');
    await runImport(d);
    expect((await d.r.health.sleepDays('2026-11-01', '2026-11-08')).map((x) => x.date)).toEqual(['2026-11-07']);

    const hr = await d.r.health.heartRateDays('2026-11-06', '2026-11-08');
    expect(hr.map((x) => [x.date, x.restingBpm])).toEqual([['2026-11-06', 55]]);
    expect(await d.r.health.heartRateDays('2026-11-01', '2026-11-08')).toHaveLength(2);
  });
});
