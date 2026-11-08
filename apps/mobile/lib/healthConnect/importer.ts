/**
 * Health Connect の取り込み（docs/sync-design.md の「Health Connect の取り込み」）。
 * アプリを開いたとき・前面に戻ったとき・「今すぐ取り込む」で、型ごとに差分（getChanges）を読み、端末の表に書く。
 * - 初めての型は、先にトークンを取ってから、過去30日を readRecords で全ページ読む（読んでいるあいだの変更は、次の差分で届く）
 * - トークンが切れていたら、最後に読んだ時刻（なければ30日前）から読み直す
 * - 書くのは db/repositories/healthConnect.ts の write だけ（origin = 'import' で outbox に積まれる）
 * ID は Health Connect の記録の ID から決める（uuid5）。同じ記録を別の端末で取り込んでも、同じ行になる
 */
import type { HealthConnectRecordResult, Permission, RecordType } from 'react-native-health-connect';
import { BodyImport, HC_META, HealthConnectStore, ImportBatch } from '@/db/repositories/healthConnect';
import { toDateKey } from '@/lib/date';
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
export const READ_TYPES = ['Weight', 'BodyFat', 'LeanBodyMass', 'SleepSession', 'HeartRate', 'RestingHeartRate'] as const satisfies RecordType[];
export const PERMISSIONS: Permission[] = READ_TYPES.map((recordType) => ({ accessType: 'read', recordType }));

type Upsert = { kind: 'upsert'; record: HealthConnectRecordResult };
type Removal = { kind: 'delete'; id: string };
type Event = Upsert | Removal;

/** 型ごとの、読んだ記録を書き込みに変えるもの */
type Handler = { recordType: RecordType; toBatch: (events: Event[]) => Promise<ImportBatch> };

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
    const meta = { [HC_META.readAt(type)]: startedAt.toISOString() };
    let token = await store.getMeta(HC_META.token(type));
    let events: Event[] = [];
    if (token == null) {
      token = await freshToken(type);
      events = await readSince(type, new Date(startedAt.getTime() - INITIAL_DAYS * 86_400_000), startedAt);
    } else {
      for (;;) {
        const page = await hc.getChanges({ changesToken: token });
        if (page.changesTokenExpired) {
          // 切れたトークンの続きは読めないので、最後に読んだ時刻から読み直す
          const readAt = await store.getMeta(HC_META.readAt(type));
          const from = readAt ? new Date(readAt) : new Date(startedAt.getTime() - INITIAL_DAYS * 86_400_000);
          token = await freshToken(type);
          events = await readSince(type, from, startedAt);
          break;
        }
        for (const c of page.upsertionChanges) events.push({ kind: 'upsert', record: c.record });
        for (const c of page.deletionChanges) events.push({ kind: 'delete', id: c.recordId });
        token = page.nextChangesToken;
        if (!page.hasMore) break;
      }
    }
    written += await store.write(await handler.toBatch(events), { ...meta, [HC_META.token(type)]: token });
    types.push(type);
  }
  await store.setMeta(HC_META.lastImportAt, now().toISOString());
  return { written, types };
}
