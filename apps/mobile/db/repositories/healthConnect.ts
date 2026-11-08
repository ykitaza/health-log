import { notifyRemoteChange } from '@/lib/sync/events';
import { notifyLocalWrite, oneAtATime } from '../serial';
import type { Db, Deps } from '../types';

/**
 * Health Connect の取り込みの保存先（docs/sync-design.md の「Health Connect の取り込み」）。
 * 取り込みの書き込みは、ここの write だけを通す。書き込みの列（serial.ts の oneAtATime）に並び、トランザクションの中で、
 * sync_meta に importing を置いて書く。トリガーはそのあいだの変更を origin = 'import' で outbox に積む。
 * 型ごとの changesToken と、最後に読んだ時刻も、同じトランザクションで書く（書けなかったら、次は同じところから読み直す）
 */
export const HC_META = {
  /** 「連携する」を押して、権限をもらった。「切る」で消す */
  connected: 'hc.connected',
  /** 最後に取り込みを終えた時刻（ISO 8601） */
  lastImportAt: 'hc.last_import_at',
  /** 型ごとの changesToken */
  token: (recordType: string) => `hc.token.${recordType}`,
  /** 型ごとに、最後に読んだ時刻（トークンが切れたとき、ここから読み直す） */
  readAt: (recordType: string) => `hc.read_at.${recordType}`,
} as const;

/** トークンと読んだ時刻（アカウントを変えて記録を消したときと、連携を切ったときに消す） */
export const SQL_DELETE_HC_TOKENS = `DELETE FROM sync_meta WHERE key LIKE 'hc.token.%' OR key LIKE 'hc.read_at.%'`;

/** 体組成の1件（Health Connect の1件を body_records の1行に。体重と体脂肪率は別の行） */
export type BodyImport = {
  id: string;
  externalId: string;
  date: string;
  measuredAt: string;
  originPackage: string | null;
  column: 'weight_kg' | 'body_fat_pct' | 'lean_mass_kg';
  value: number;
};

/** 睡眠の1件（Health Connect の SleepSession の1件を sleep_sessions の1行に） */
export type SleepImport = {
  id: string;
  externalId: string;
  date: string;
  startAt: string;
  endAt: string;
  asleepMin: number;
  awakeMin: number;
  originPackage: string | null;
};

/** 心拍の1日のまとめ（heart_rate_days の1行。id は日付から決める） */
export type HeartRateDayImport = {
  id: string;
  date: string;
  restingBpm: number | null;
  avgBpm: number | null;
  minBpm: number | null;
  maxBpm: number | null;
  samples: number;
};

/** 1回の書き込み。upserts は作るか直す。deletes は消えた記録の external_id（心拍は、記録がなくなった日付） */
export type ImportBatch = {
  body?: { upserts: BodyImport[]; deletes: string[] };
  sleep?: { upserts: SleepImport[]; deletes: string[] };
  heartRate?: { upserts: HeartRateDayImport[]; deletes: string[] };
};

type BodyRow = { id: string; deleted_at: string | null; date: string; measured_at: string; origin_package: string | null } & Record<string, unknown>;

export function healthConnectStore(db: Db, deps: Deps) {
  const meta = async (key: string) =>
    (await db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null;
  const putMeta = (key: string, value: string) => db.runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value],
  );

  /** 体組成：あれば変わった項目だけ直す。消した行（deleted_at あり）は戻さない。返すのは書いた行の数 */
  async function writeBody(body: NonNullable<ImportBatch['body']>, nowIso: string): Promise<number> {
    let written = 0;
    for (const r of body.upserts) {
      const row = await db.getFirstAsync<BodyRow>(
        `SELECT id, deleted_at, date, measured_at, origin_package, ${r.column} FROM body_records
         WHERE source = 'health_connect' AND external_id = ?`, [r.externalId],
      );
      if (row?.deleted_at) continue;
      if (row) {
        const next: Record<string, string | number | null> = {
          date: r.date, measured_at: r.measuredAt, origin_package: r.originPackage, [r.column]: r.value,
        };
        const changed = Object.entries(next).filter(([k, v]) => row[k] !== v);
        if (changed.length === 0) continue;
        await db.runAsync(
          `UPDATE body_records SET ${changed.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          [...changed.map(([, v]) => v), nowIso, row.id],
        );
      } else {
        await db.runAsync(
          `INSERT INTO body_records (id, date, measured_at, ${r.column}, memo, source, external_id, origin_package, created_at, updated_at)
           VALUES (?, ?, ?, ?, '', 'health_connect', ?, ?, ?, ?)`,
          [r.id, r.date, r.measuredAt, r.value, r.externalId, r.originPackage, nowIso, nowIso],
        );
      }
      written++;
    }
    return written + await softDelete('body_records', body.deletes, nowIso);
  }

  /** 取り込みの行を、external_id で消す（消えていなければ）。消した行の数 */
  async function softDelete(table: string, externalIds: string[], nowIso: string): Promise<number> {
    let n = 0;
    for (const externalId of externalIds) {
      const res = await db.runAsync(
        `UPDATE ${table} SET deleted_at = ?, updated_at = ?
         WHERE source = 'health_connect' AND external_id = ? AND deleted_at IS NULL`, [nowIso, nowIso, externalId],
      ) as { changes?: number };
      n += res?.changes ?? 0;
    }
    return n;
  }

  /** 睡眠：あれば変わった項目だけ直す。消した行は戻さない */
  async function writeSleep(sleep: NonNullable<ImportBatch['sleep']>, nowIso: string): Promise<number> {
    let written = 0;
    for (const r of sleep.upserts) {
      const row = await db.getFirstAsync<Record<string, string | number | null>>(
        `SELECT id, deleted_at, date, start_at, end_at, asleep_min, awake_min, origin_package FROM sleep_sessions
         WHERE source = 'health_connect' AND external_id = ?`, [r.externalId],
      );
      if (row?.deleted_at) continue;
      const next: Record<string, string | number | null> = {
        date: r.date, start_at: r.startAt, end_at: r.endAt, asleep_min: r.asleepMin, awake_min: r.awakeMin, origin_package: r.originPackage,
      };
      if (row) {
        const changed = Object.entries(next).filter(([k, v]) => row[k] !== v);
        if (changed.length === 0) continue;
        await db.runAsync(
          `UPDATE sleep_sessions SET ${changed.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          [...changed.map(([, v]) => v), nowIso, row.id],
        );
      } else {
        const cols = Object.keys(next);
        await db.runAsync(
          `INSERT INTO sleep_sessions (id, ${cols.join(', ')}, source, external_id, created_at, updated_at)
           VALUES (?, ${cols.map(() => '?').join(', ')}, 'health_connect', ?, ?, ?)`,
          [r.id, ...Object.values(next), r.externalId, nowIso, nowIso],
        );
      }
      written++;
    }
    return written + await softDelete('sleep_sessions', sleep.deletes, nowIso);
  }

  /**
   * 心拍の日のまとめ：集計し直した値で置き換える（日ごとに1行。消えていた日にまた記録があれば戻す）。
   * 記録がなくなった日は消す
   */
  async function writeHeartRate(heartRate: NonNullable<ImportBatch['heartRate']>, nowIso: string): Promise<number> {
    let written = 0;
    for (const r of heartRate.upserts) {
      const row = await db.getFirstAsync<Record<string, string | number | null>>(
        'SELECT id, deleted_at, resting_bpm, avg_bpm, min_bpm, max_bpm, samples FROM heart_rate_days WHERE id = ?', [r.id],
      );
      const next: Record<string, string | number | null> = {
        resting_bpm: r.restingBpm, avg_bpm: r.avgBpm, min_bpm: r.minBpm, max_bpm: r.maxBpm, samples: r.samples,
      };
      if (row) {
        const changed = Object.entries(next).filter(([k, v]) => row[k] !== v);
        if (changed.length === 0 && row.deleted_at == null) continue;
        await db.runAsync(
          `UPDATE heart_rate_days SET ${[...changed.map(([k]) => `${k} = ?`), 'deleted_at = NULL'].join(', ')}, updated_at = ? WHERE id = ?`,
          [...changed.map(([, v]) => v), nowIso, row.id],
        );
      } else {
        const cols = Object.keys(next);
        await db.runAsync(
          `INSERT INTO heart_rate_days (id, date, ${cols.join(', ')}, created_at, updated_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)`,
          [r.id, r.date, ...Object.values(next), nowIso, nowIso],
        );
      }
      written++;
    }
    for (const date of heartRate.deletes) {
      const res = await db.runAsync(
        'UPDATE heart_rate_days SET deleted_at = ?, updated_at = ? WHERE date = ? AND deleted_at IS NULL', [nowIso, nowIso, date],
      ) as { changes?: number };
      written += res?.changes ?? 0;
    }
    return written;
  }

  return {
    getMeta: meta,

    /**
     * 取り込んだものを書き、meta（トークン・読んだ時刻）も同じトランザクションで書く。書いた行の数を返す。
     * 1行でも書いたら、同期を始め（onLocalWrite）、開いている画面を読み直す
     */
    async write(batch: ImportBatch, metaUpdates: Record<string, string>): Promise<number> {
      const written = await oneAtATime(db, async () => {
        let n = 0;
        await db.withTransactionAsync(async () => {
          await putMeta('importing', '1');
          try {
            const nowIso = deps.now().toISOString();
            if (batch.body) n += await writeBody(batch.body, nowIso);
            if (batch.sleep) n += await writeSleep(batch.sleep, nowIso);
            if (batch.heartRate) n += await writeHeartRate(batch.heartRate, nowIso);
            for (const [k, v] of Object.entries(metaUpdates)) await putMeta(k, v);
          } finally {
            await db.runAsync(`DELETE FROM sync_meta WHERE key = 'importing'`, []);
          }
        });
        return n;
      });
      if (written > 0) {
        notifyLocalWrite(db);
        notifyRemoteChange();
      }
      return written;
    },

    setMeta: (key: string, value: string) => oneAtATime(db, () => putMeta(key, value)),

    /** 連携を切る：連携の印・トークン・読んだ時刻・最後に取り込んだ時刻を消す（取り込んだ記録は残す） */
    disconnect: () => oneAtATime(db, async () => {
      await db.runAsync(SQL_DELETE_HC_TOKENS, []);
      await db.runAsync('DELETE FROM sync_meta WHERE key IN (?, ?)', [HC_META.connected, HC_META.lastImportAt]);
    }),
  };
}

export type HealthConnectStore = ReturnType<typeof healthConnectStore>;
