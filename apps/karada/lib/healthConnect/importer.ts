/**
 * Health Connect の取り込み（docs/sync-design.md の「Health Connect の取り込み」）。
 * アプリを開いたとき・前面に戻ったとき・「今すぐ取り込む」で、型ごとに差分（getChanges）を読み、端末の表に書く。
 * - 初めての型は、先にトークンを取ってから、過去30日を readRecords で全ページ読む（読んでいるあいだの変更は、次の差分で届く）
 * - トークンが切れていたら、最後に読んだ時刻（なければ30日前）から読み直す
 * - 心拍は、サンプルを持たず、日ごとのまとめ（Health Connect の集計）だけを持つ。歩数も、日ごとの合計（集計）だけを持つ
 * - 書くのは db/repositories/healthConnect.ts の write だけ（origin = 'import' で outbox に積まれる）
 * ID は Health Connect の記録の ID から決める（uuid5）。同じ記録を別の端末で取り込んでも、同じ行になる
 */
import type { HealthConnectRecordResult, Permission, RecordType } from 'react-native-health-connect';
import { BodyImport, HC_META, HealthConnectStore, HeartRateDayImport, ImportBatch, SleepImport, StepDayImport } from '@/db/repositories/healthConnect';
import { addDays, toDateKey } from '@/lib/date';
import { inRange, Limit, LIMITS } from '@/lib/limits';
import { uuid5 } from '@/lib/uuid5';
import * as hc from './client';

/** 取り込みの ID の名前空間（変えない。変えると、取り込み直しで別の行ができる） */
export const HC_NAMESPACE = '08e139e3-1bcd-47c7-af17-1a18a473f1c3';

/** 取り込んだ記録の行の ID */
export const importedId = (healthConnectId: string) => uuid5(HC_NAMESPACE, `hc:${healthConnectId}`);

/** 初めて読むとき・トークンが切れて読む時刻がないときに、さかのぼる日数 */
export const INITIAL_DAYS = 30;

/** 求める権限（読み取りだけ）。AndroidManifest にも同じものを書く（app.json の android.permissions） */
export const READ_TYPES = ['Weight', 'BodyFat', 'LeanBodyMass', 'SleepSession', 'HeartRate', 'RestingHeartRate', 'Steps'] as const satisfies RecordType[];
export const PERMISSIONS: Permission[] = READ_TYPES.map((recordType) => ({ accessType: 'read', recordType }));

/** あとから足した型（歩数）。前の APK の AndroidManifest にはないので、求めて断られたら、これを外して求め直す */
export const LATER_TYPES: readonly RecordType[] = ['Steps'];

/**
 * 権限を求める。前の APK（READ_STEPS がない）で、歩数を含めて求めたせいで失敗したときは、歩数を外してもう一度求める
 * （ほかの型の連携と取り込みを止めないため）。もらえた権限を返す
 */
export async function requestReadPermissions<T>(request: (perms: Permission[]) => Promise<T[]>): Promise<T[]> {
  try {
    return await request(PERMISSIONS);
  } catch (e) {
    const base = PERMISSIONS.filter((p) => !LATER_TYPES.includes(p.recordType));
    try {
      return await request(base);
    } catch {
      throw e;
    }
  }
}

type Upsert = { kind: 'upsert'; record: HealthConnectRecordResult };
type Removal = { kind: 'delete'; id: string };
type Event = Upsert | Removal;

type Context = { granted: Set<string>; now: Date };

/**
 * 型ごとの、読んだ記録を書き込みに変えるもの。
 * readRange があれば、初めて読むときとトークンが切れたときは、記録を読む代わりにそれを使う（心拍：記録が多いので、日ごとに集計し直す）
 */
type Handler = {
  recordType: RecordType;
  toBatch: (events: Event[], ctx: Context) => Promise<ImportBatch>;
  readRange?: (from: Date, to: Date, ctx: Context) => Promise<ImportBatch>;
};

/** 記録の時刻を、その土地の日付にする（zoneOffset がなければ端末の暦） */
export function localDate(time: string, zoneOffset?: { totalSeconds: number } | null): string {
  const t = new Date(time);
  if (zoneOffset == null) return toDateKey(t);
  return new Date(t.getTime() + zoneOffset.totalSeconds * 1000).toISOString().slice(0, 10);
}

/** 同じ記録の変更は、最後のものだけを残す（記録の ID → 記録、消えたものは null） */
function lastById(events: Event[]): Map<string, HealthConnectRecordResult | null> {
  const out = new Map<string, HealthConnectRecordResult | null>();
  for (const e of events) {
    if (e.kind === 'delete') out.set(e.id, null);
    else if (e.record.metadata?.id) out.set(e.record.metadata.id, e.record);
  }
  return out;
}

type BodyValue = { column: BodyImport['column']; limit: Limit; value: (r: HealthConnectRecordResult) => number | undefined };

/** 体組成：Health Connect の1件を body_records の1行に。範囲の外の値は取り込まない */
function bodyHandler(recordType: 'Weight' | 'BodyFat' | 'LeanBodyMass', v: BodyValue): Handler {
  return {
    recordType,
    async toBatch(events) {
      const upserts: BodyImport[] = [];
      const deletes: string[] = [];
      for (const [externalId, r] of lastById(events)) {
        if (r == null) { deletes.push(externalId); continue; }
        const rec = r as HealthConnectRecordResult & { time: string; zoneOffset?: { totalSeconds: number } };
        const value = v.value(r);
        if (value == null || !Number.isFinite(value) || !inRange(value, v.limit)) continue;
        upserts.push({
          id: importedId(externalId), externalId, date: localDate(rec.time, rec.zoneOffset),
          measuredAt: new Date(rec.time).toISOString(), originPackage: r.metadata?.dataOrigin ?? null, column: v.column, value,
        });
      }
      return { body: { upserts, deletes } };
    },
  };
}

/** 睡眠の段階のうち、眠っていなかったもの（起きていた・ベッドの外・ベッドで起きていた） */
const AWAKE_STAGES = new Set([1, 3, 7]);
/** 1件の睡眠の長さの上限（分）。サーバーの sleep_session と同じ */
export const SLEEP_MAX_MIN = 24 * 60;

type Stage = { startTime: string; endTime: string; stage: number };
type SleepRecord = HealthConnectRecordResult & {
  startTime: string; endTime: string; endZoneOffset?: { totalSeconds: number } | null; stages?: Stage[];
};

/** 睡眠の1件の、眠っていた分と起きていた分（段階から。段階がなければ全部を眠っていたとする） */
export function sleepMinutes(r: Pick<SleepRecord, 'startTime' | 'endTime' | 'stages'>): { asleepMin: number; awakeMin: number } | null {
  const start = Date.parse(r.startTime);
  const end = Date.parse(r.endTime);
  if (!(end > start)) return null;
  let awakeMs = 0;
  for (const s of r.stages ?? []) {
    if (!AWAKE_STAGES.has(s.stage)) continue;
    // 段階は記録の中に収める（はみ出した分は数えない）
    awakeMs += Math.max(0, Math.min(end, Date.parse(s.endTime)) - Math.max(start, Date.parse(s.startTime)));
  }
  const totalMin = Math.round((end - start) / 60_000);
  const awakeMin = Math.min(totalMin, Math.round(awakeMs / 60_000));
  return { asleepMin: totalMin - awakeMin, awakeMin };
}

/** 睡眠：起きた日（その土地の日付）に付ける。24時間を超えるもの・終わりが始まりより前のものは取り込まない */
const sleepHandler: Handler = {
  recordType: 'SleepSession',
  async toBatch(events) {
    const upserts: SleepImport[] = [];
    const deletes: string[] = [];
    for (const [externalId, r] of lastById(events)) {
      if (r == null) { deletes.push(externalId); continue; }
      const rec = r as SleepRecord;
      const minutes = sleepMinutes(rec);
      if (!minutes || minutes.asleepMin + minutes.awakeMin > SLEEP_MAX_MIN) continue;
      upserts.push({
        id: importedId(externalId), externalId, date: localDate(rec.endTime, rec.endZoneOffset),
        startAt: new Date(rec.startTime).toISOString(), endAt: new Date(rec.endTime).toISOString(),
        ...minutes, originPackage: r.metadata?.dataOrigin ?? null,
      });
    }
    return { sleep: { upserts, deletes } };
  },
};

/** 心拍の日のまとめの行の ID（日付から決める。どの端末で集計しても同じ行になる） */
export const heartRateDayId = (date: string) => uuid5(HC_NAMESPACE, `hc-hr-day:${date}`);

/** 心拍の値の範囲（Health Connect の決まりと同じ。サーバーの heart_rate_day も同じ） */
export const BPM_MIN = 1;
export const BPM_MAX = 300;

const bpm = (v: number | undefined, has: boolean) => (has && v != null && Number.isFinite(v) && v >= BPM_MIN && v <= BPM_MAX ? v : null);

/** 端末の暦の日の、始まりと終わり（次の日の始まり） */
function dayRange(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return { operator: 'between' as const, startTime: new Date(y, m - 1, d).toISOString(), endTime: new Date(y, m - 1, d + 1).toISOString() };
}

/**
 * その日の心拍を、Health Connect の集計（aggregateRecord）で出し直す。サンプルそのものは持たない。
 * 心拍のサンプルも安静時心拍もなければ null（その日の行を消す）
 */
export async function heartRateDay(date: string, granted: Set<string>): Promise<HeartRateDayImport | null> {
  const timeRangeFilter = dayRange(date);
  let hr = { avg: null as number | null, min: null as number | null, max: null as number | null, samples: 0 };
  if (granted.has('HeartRate')) {
    const r = await hc.aggregateRecord({ recordType: 'HeartRate', timeRangeFilter });
    const samples = Math.round(r.MEASUREMENTS_COUNT ?? 0);
    hr = { avg: bpm(r.BPM_AVG, samples > 0), min: bpm(r.BPM_MIN, samples > 0), max: bpm(r.BPM_MAX, samples > 0), samples };
  }
  let resting: number | null = null;
  if (granted.has('RestingHeartRate')) {
    const r = await hc.aggregateRecord({ recordType: 'RestingHeartRate', timeRangeFilter });
    resting = bpm(r.BPM_AVG, true); // 記録がない日は 0 が返る（範囲の外なので null になる）
  }
  if (hr.samples === 0 && resting == null) return null;
  return { id: heartRateDayId(date), date, restingBpm: resting, avgBpm: hr.avg, minBpm: hr.min, maxBpm: hr.max, samples: hr.samples };
}

/** 歩数の日の合計の行の ID（日付から決める。どの端末で集計しても同じ行になる） */
export const stepDayId = (date: string) => uuid5(HC_NAMESPACE, `hc-steps-day:${date}`);

/** 1日の歩数の範囲（Health Connect の StepsRecord の1件の範囲。サーバーの step_day も同じ） */
export const STEPS_MIN = 1;
export const STEPS_MAX = 1_000_000;

/**
 * その日の歩数を、Health Connect の集計（aggregateRecord の COUNT_TOTAL）で出し直す。1件ごとの記録は持たない。
 * 集計は、同じ時間を複数のアプリ（スマホとウォッチなど）が書いたときの重なりを、Health Connect が除いた合計になる。
 * 記録がない日（0 が返る）・範囲の外は null（その日の行を消す）
 */
export async function stepsDay(date: string): Promise<StepDayImport | null> {
  const r = await hc.aggregateRecord({ recordType: 'Steps', timeRangeFilter: dayRange(date) });
  const steps = Math.round(r.COUNT_TOTAL ?? 0);
  if (!(steps >= STEPS_MIN && steps <= STEPS_MAX)) return null;
  return { id: stepDayId(date), date, steps };
}

async function stepsBatch(dates: Iterable<string>): Promise<ImportBatch> {
  const upserts: StepDayImport[] = [];
  const deletes: string[] = [];
  for (const date of [...new Set(dates)].sort()) {
    const day = await stepsDay(date);
    if (day) upserts.push(day); else deletes.push(date);
  }
  return { steps: { upserts, deletes } };
}

/** 日付の一覧の日を、集計し直して書き込みにする */
async function heartRateBatch(dates: Iterable<string>, granted: Set<string>): Promise<ImportBatch> {
  const upserts: HeartRateDayImport[] = [];
  const deletes: string[] = [];
  for (const date of [...new Set(dates)].sort()) {
    const day = await heartRateDay(date, granted);
    if (day) upserts.push(day); else deletes.push(date);
  }
  return { heartRate: { upserts, deletes } };
}

/** from から to までの、端末の暦の日付 */
function datesBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = toDateKey(from); d <= toDateKey(to); d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * 日ごとに集計する型（心拍の HeartRate・RestingHeartRate、歩数の Steps）：変わった記録の日を集め、その日を集計し直す。
 * 消えた記録は、どの日のものか分からない（ID しか届かない）ので、過去30日を集計し直す
 */
function dailyHandler(recordType: 'HeartRate' | 'RestingHeartRate' | 'Steps', batch: (dates: Iterable<string>, ctx: Context) => Promise<ImportBatch>): Handler {
  return {
    recordType,
    async toBatch(events, ctx) {
      const dates = new Set<string>();
      for (const e of events) {
        if (e.kind === 'delete') {
          for (const d of datesBetween(new Date(ctx.now.getTime() - INITIAL_DAYS * 86_400_000), ctx.now)) dates.add(d);
          continue;
        }
        const r = e.record as { time?: string; startTime?: string; endTime?: string };
        for (const t of [r.time, r.startTime, r.endTime]) if (t) dates.add(toDateKey(new Date(t)));
      }
      return batch(dates, ctx);
    },
    readRange: (from, to, ctx) => batch(datesBetween(from, to), ctx),
  };
}

const heartRateHandler = (recordType: 'HeartRate' | 'RestingHeartRate') =>
  dailyHandler(recordType, (dates, ctx) => heartRateBatch(dates, ctx.granted));

export const HANDLERS: Handler[] = [
  bodyHandler('Weight', {
    column: 'weight_kg', limit: LIMITS.bodyWeight,
    value: (r) => (r as { weight?: { inKilograms?: number } }).weight?.inKilograms,
  }),
  bodyHandler('BodyFat', {
    column: 'body_fat_pct', limit: LIMITS.bodyFat,
    value: (r) => (r as { percentage?: number }).percentage,
  }),
  bodyHandler('LeanBodyMass', {
    column: 'lean_mass_kg', limit: LIMITS.leanMass,
    value: (r) => (r as { mass?: { inKilograms?: number } }).mass?.inKilograms,
  }),
  sleepHandler,
  heartRateHandler('HeartRate'),
  heartRateHandler('RestingHeartRate'),
  dailyHandler('Steps', (dates) => stepsBatch(dates)),
];

/** 型の記録を、from から今まで全ページ読む */
async function readSince(recordType: RecordType, from: Date, to: Date): Promise<Event[]> {
  const events: Event[] = [];
  let pageToken: string | undefined;
  do {
    const page = await hc.readRecords(recordType, {
      timeRangeFilter: { operator: 'between', startTime: from.toISOString(), endTime: to.toISOString() },
      ...(pageToken ? { pageToken } : {}),
    });
    for (const record of page.records) events.push({ kind: 'upsert', record: { ...record, recordType } as HealthConnectRecordResult });
    pageToken = page.pageToken || undefined;
  } while (pageToken);
  return events;
}

/** 今からの変更を読むためのトークン（読む前に取る） */
async function freshToken(recordType: RecordType): Promise<string> {
  return (await hc.getChanges({ recordTypes: [recordType] })).nextChangesToken;
}

export type ImportResult = { written: number; types: RecordType[] };

/**
 * 1回分の取り込み。権限のある型だけを読む。型ごとに、読んだものとトークンを1つのトランザクションで書く。
 * 読めなかった型があれば、そこで止めて投げる（書けた型のトークンは進んでいる）
 */
export async function importHealthConnect(store: HealthConnectStore, now: () => Date = () => new Date()): Promise<ImportResult> {
  const granted = new Set((await hc.getGrantedPermissions())
    .filter((p) => p.accessType === 'read').map((p) => p.recordType as string));
  let written = 0;
  const types: RecordType[] = [];
  for (const handler of HANDLERS) {
    const type = handler.recordType;
    if (!granted.has(type)) continue;
    const startedAt = now();
    const ctx: Context = { granted, now: startedAt };
    const meta = { [HC_META.readAt(type)]: startedAt.toISOString() };
    // 全部を読む（初めて・トークンが切れた）：先にトークンを取ってから読む
    const readAll = async (from: Date): Promise<ImportBatch> => (handler.readRange
      ? handler.readRange(from, startedAt, ctx)
      : handler.toBatch(await readSince(type, from, startedAt), ctx));
    let token = await store.getMeta(HC_META.token(type));
    let batch: ImportBatch | null = null;
    if (token == null) {
      token = await freshToken(type);
      batch = await readAll(new Date(startedAt.getTime() - INITIAL_DAYS * 86_400_000));
    } else {
      const events: Event[] = [];
      for (;;) {
        const page = await hc.getChanges({ changesToken: token });
        if (page.changesTokenExpired) {
          // 切れたトークンの続きは読めないので、最後に読んだ時刻から読み直す
          const readAt = await store.getMeta(HC_META.readAt(type));
          const from = readAt ? new Date(readAt) : new Date(startedAt.getTime() - INITIAL_DAYS * 86_400_000);
          token = await freshToken(type);
          batch = await readAll(from);
          break;
        }
        for (const c of page.upsertionChanges) events.push({ kind: 'upsert', record: c.record });
        for (const c of page.deletionChanges) events.push({ kind: 'delete', id: c.recordId });
        token = page.nextChangesToken;
        if (!page.hasMore) break;
      }
      batch ??= await handler.toBatch(events, ctx);
    }
    written += await store.write(batch, { ...meta, [HC_META.token(type)]: token });
    types.push(type);
  }
  await store.setMeta(HC_META.lastImportAt, now().toISOString());
  return { written, types };
}
