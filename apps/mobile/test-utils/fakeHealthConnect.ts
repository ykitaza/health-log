/**
 * テスト用の偽の Health Connect（react-native-health-connect の、取り込みが使う関数だけ）。
 * jest.mock('react-native-health-connect', () => require('@/test-utils/fakeHealthConnect').module) で差し替える。
 * 記録を足す・直す・消すと、型ごとの変更の列に積む。changesToken は「型:列の位置」。1ページは2件（ページ送りを確かめるため）
 */
type Rec = { recordType: string; metadata: { id: string; dataOrigin?: string }; time?: string; startTime?: string; endTime?: string } & Record<string, unknown>;
type Change = { kind: 'upsert'; record: Rec } | { kind: 'delete'; id: string };

const PAGE = 2;

export function createFakeHealthConnect() {
  const records = new Map<string, Rec>();
  const changes = new Map<string, Change[]>();
  const expired = new Set<string>();
  let granted = ['Weight', 'BodyFat', 'LeanBodyMass', 'SleepSession', 'HeartRate', 'RestingHeartRate'];
  const calls: { fn: string; args: unknown[] }[] = [];

  const log = (type: string) => { if (!changes.has(type)) changes.set(type, []); return changes.get(type)!; };
  const timeOf = (r: Rec) => r.time ?? r.startTime ?? '';

  const module = {
    SdkAvailabilityStatus: { SDK_UNAVAILABLE: 1, SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2, SDK_AVAILABLE: 3 },
    getSdkStatus: async () => 3,
    initialize: async () => true,
    openHealthConnectSettings: () => undefined,
    requestPermission: async (perms: { accessType: string; recordType: string }[]) => perms.filter((p) => granted.includes(p.recordType)),
    getGrantedPermissions: async () => granted.map((recordType) => ({ accessType: 'read', recordType })),
    revokeAllPermissions: async () => { calls.push({ fn: 'revokeAllPermissions', args: [] }); },
    async getChanges(req: { changesToken?: string; recordTypes?: string[] }) {
      calls.push({ fn: 'getChanges', args: [req] });
      if (!req.changesToken) {
        const type = req.recordTypes![0];
        return { upsertionChanges: [], deletionChanges: [], nextChangesToken: `${type}:${log(type).length}`, hasMore: false, changesTokenExpired: false };
      }
      const [type, at] = req.changesToken.split(':');
      if (expired.has(req.changesToken)) {
        return { upsertionChanges: [], deletionChanges: [], nextChangesToken: '', hasMore: false, changesTokenExpired: true };
      }
      const all = log(type);
      const page = all.slice(Number(at), Number(at) + PAGE);
      const next = Number(at) + page.length;
      return {
        upsertionChanges: page.filter((c) => c.kind === 'upsert').map((c) => ({ record: (c as { record: Rec }).record })),
        deletionChanges: page.filter((c) => c.kind === 'delete').map((c) => ({ recordId: (c as { id: string }).id })),
        nextChangesToken: `${type}:${next}`, hasMore: next < all.length, changesTokenExpired: false,
      };
    },
    async readRecords(type: string, opts: { timeRangeFilter: { startTime: string; endTime: string }; pageToken?: string }) {
      calls.push({ fn: 'readRecords', args: [type, opts] });
      const { startTime, endTime } = opts.timeRangeFilter;
      const all = [...records.values()]
        .filter((r) => r.recordType === type && timeOf(r) >= startTime && timeOf(r) < endTime)
        .sort((a, b) => (timeOf(a) < timeOf(b) ? -1 : 1))
        .map(({ recordType: _, ...r }) => r);
      const start = Number(opts.pageToken ?? 0);
      const page = all.slice(start, start + PAGE);
      return { records: page, pageToken: start + PAGE < all.length ? String(start + PAGE) : undefined };
    },
    /** 心拍の集計（本物と同じく、記録がなければ 0 を返す） */
    async aggregateRecord(req: { recordType: string; timeRangeFilter: { startTime: string; endTime: string } }) {
      calls.push({ fn: 'aggregateRecord', args: [req] });
      const { startTime, endTime } = req.timeRangeFilter;
      const inRange = (t: string) => t >= startTime && t < endTime;
      const all = [...records.values()].filter((r) => r.recordType === req.recordType);
      const values = req.recordType === 'HeartRate'
        ? all.flatMap((r) => (r.samples as { time: string; beatsPerMinute: number }[]).filter((s) => inRange(s.time)).map((s) => s.beatsPerMinute))
        : all.filter((r) => inRange(r.time!)).map((r) => r.beatsPerMinute as number);
      const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
      return {
        BPM_AVG: avg, BPM_MIN: values.length ? Math.min(...values) : 0, BPM_MAX: values.length ? Math.max(...values) : 0,
        ...(req.recordType === 'HeartRate' ? { MEASUREMENTS_COUNT: values.length } : {}),
        dataOrigins: values.length ? ['com.example.watch'] : [],
      };
    },
  };

  return {
    module,
    calls,
    /** 記録を足すか直す（変更の列にも積む） */
    put(record: Rec) {
      records.set(record.metadata.id, record);
      log(record.recordType).push({ kind: 'upsert', record });
    },
    remove(id: string) {
      const r = records.get(id);
      if (!r) return;
      records.delete(id);
      log(r.recordType).push({ kind: 'delete', id });
    },
    /** その型の今までのトークンを、すべて切れたことにする */
    expireTokens(type: string) {
      for (let i = 0; i <= log(type).length; i++) expired.add(`${type}:${i}`);
    },
    grant(types: string[]) { granted = types; },
    reset() {
      records.clear(); changes.clear(); expired.clear(); calls.length = 0;
      granted = ['Weight', 'BodyFat', 'LeanBodyMass', 'SleepSession', 'HeartRate', 'RestingHeartRate'];
    },
  };
}

/** jest.mock から使う、ひとつだけの偽物 */
export const fakeHealthConnect = createFakeHealthConnect();
export const module = fakeHealthConnect.module;

/** 記録した土地の時差（テストの記録は日本時間） */
const JST = { id: '+09:00', totalSeconds: 9 * 3600 };

/** 体重の記録（Health Connect の WeightRecord の読み取りの形） */
export const weight = (id: string, time: string, kg: number, opts: { origin?: string } = {}): Rec => ({
  recordType: 'Weight', time, zoneOffset: JST, weight: { inKilograms: kg, inGrams: kg * 1000 },
  metadata: { id, dataOrigin: opts.origin ?? 'com.example.scale' },
});

export const bodyFat = (id: string, time: string, pct: number): Rec => ({
  recordType: 'BodyFat', time, zoneOffset: JST, percentage: pct, metadata: { id, dataOrigin: 'com.example.scale' },
});

export const leanMass = (id: string, time: string, kg: number): Rec => ({
  recordType: 'LeanBodyMass', time, zoneOffset: JST, mass: { inKilograms: kg }, metadata: { id, dataOrigin: 'com.example.scale' },
});

/** 睡眠の記録。stages は [始まり, 終わり, 段階]（1：起きていた、4：浅い、5：深い、6：レム など） */
export const sleep = (id: string, startTime: string, endTime: string, stages: [string, string, number][] = []): Rec => ({
  recordType: 'SleepSession', startTime, endTime, startZoneOffset: JST, endZoneOffset: JST,
  stages: stages.map(([s, e, stage]) => ({ startTime: s, endTime: e, stage })),
  metadata: { id, dataOrigin: 'com.example.watch' },
});

/** 心拍の記録（samples は [時刻, 拍/分]） */
export const heartRate = (id: string, samples: [string, number][]): Rec => ({
  recordType: 'HeartRate', startTime: samples[0][0], endTime: samples[samples.length - 1][0], startZoneOffset: JST, endZoneOffset: JST,
  samples: samples.map(([time, beatsPerMinute]) => ({ time, beatsPerMinute })),
  metadata: { id, dataOrigin: 'com.example.watch' },
});

export const restingHeartRate = (id: string, time: string, beatsPerMinute: number): Rec => ({
  recordType: 'RestingHeartRate', time, zoneOffset: JST, beatsPerMinute, metadata: { id, dataOrigin: 'com.example.watch' },
});
