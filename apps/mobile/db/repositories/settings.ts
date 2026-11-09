import { Activity, isActivity, isSex, Sex } from '@/lib/autoGoal';
import { ChatApp, isChatApp } from '@/lib/chat';
import type { WeightUnit } from '@/lib/units';
import { serializeWrites } from '../serial';
import type { Db, Deps } from '../types';

export type Settings = {
  weightUnit: WeightUnit;
  defaultSetCount: number; // 1〜6
  heightCm: number | null;
  goalWeightKg: number | null;
  /** ふだんの活動の量（食事の目標の自動計算に使う） */
  activity: Activity | null;
};

export const DEFAULT_SETTINGS: Settings = { weightUnit: 'kg', defaultSetCount: 3, heightCm: null, goalWeightKg: null, activity: null };

/**
 * 性別と生まれた年（食事の目標の自動計算に使う）。個人の情報なので、同期しない sync_meta に置き、端末の外に出さない。
 * 別の端末やアプリを入れ直したときは、もう一度入れてもらう
 */
export type Profile = { sex: Sex | null; birthYear: number | null };
const PROFILE_KEYS = { sex: 'profile.sex', birthYear: 'profile.birth_year' } as const;
/** 前回、自動で計算した目標を保存したときの体重（kg）。端末だけに覚え、体重が変わったら計算し直すかを聞く */
const AUTO_GOAL_WEIGHT = 'goal.auto_weight_kg';
/** アカウントを切り替えて端末の記録を消すときに、いっしょに消す（db/repositories/sync.ts の switchAccount） */
export const SQL_DELETE_PROFILE = `DELETE FROM sync_meta WHERE key IN ('${PROFILE_KEYS.sex}', '${PROFILE_KEYS.birthYear}', '${AUTO_GOAL_WEIGHT}')`;

/** 最後に選んだチャットのアプリ。端末だけに覚える（同期しない sync_meta に置く） */
const LAST_CHAT_APP = 'chat.last_app';

/** 履歴の総負荷量のグラフを、週ごと・日ごとのどちらで見るか。端末だけに覚える（同期しない sync_meta に置く） */
export type VolumeRange = 'week' | 'day';
const VOLUME_RANGE = 'history.volume_range';

const KEYS: Record<keyof Settings, string> = {
  weightUnit: 'weight_unit',
  defaultSetCount: 'default_set_count',
  heightCm: 'height_cm',
  goalWeightKg: 'goal_weight_kg',
  activity: 'activity_level',
};

function num(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function settingsRepository(db: Db, deps: Deps) {
  async function get(): Promise<Settings> {
    const rows = await db.getAllAsync<{ id: string; value: string | null }>(
      'SELECT id, value FROM settings WHERE deleted_at IS NULL', [],
    );
    const m = new Map(rows.map((r) => [r.id, r.value]));
    const unit = m.get(KEYS.weightUnit);
    const sets = num(m.get(KEYS.defaultSetCount));
    return {
      weightUnit: unit === 'lb' ? 'lb' : 'kg',
      defaultSetCount: sets != null && sets >= 1 && sets <= 6 ? Math.round(sets) : DEFAULT_SETTINGS.defaultSetCount,
      heightCm: num(m.get(KEYS.heightCm)),
      goalWeightKg: num(m.get(KEYS.goalWeightKg)),
      activity: isActivity(m.get(KEYS.activity)) ? (m.get(KEYS.activity) as Activity) : null,
    };
  }

  const meta = async (key: string) =>
    (await db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null;
  const putMeta = async (key: string, value: string | null) => {
    if (value == null) await db.runAsync('DELETE FROM sync_meta WHERE key = ?', [key]);
    else await db.runAsync('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value]);
  };

  return serializeWrites(db, {
    get,

    async lastChatApp(): Promise<ChatApp | null> {
      const v = (await db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [LAST_CHAT_APP]))?.value;
      return isChatApp(v) ? v : null;
    },

    /** 性別と生まれた年（端末だけ。同期しない） */
    async profile(): Promise<Profile> {
      const sex = await meta(PROFILE_KEYS.sex);
      return { sex: isSex(sex) ? sex : null, birthYear: num(await meta(PROFILE_KEYS.birthYear)) };
    },

    /** 同期の対象ではないので、書き込みの列（serializeWrites）には並べない。null で消す */
    async setProfile(patch: Partial<Profile>): Promise<void> {
      if (patch.sex !== undefined) await putMeta(PROFILE_KEYS.sex, patch.sex);
      if (patch.birthYear !== undefined) await putMeta(PROFILE_KEYS.birthYear, patch.birthYear == null ? null : String(patch.birthYear));
    },

    /** 履歴の総負荷量のグラフの「週・日」。覚えていない・知らない値なら週 */
    volumeRange: async (): Promise<VolumeRange> => ((await meta(VOLUME_RANGE)) === 'day' ? 'day' : 'week'),
    /** 同期の対象ではないので、書き込みの列（serializeWrites）には並べない */
    setVolumeRange: (range: VolumeRange): Promise<void> => putMeta(VOLUME_RANGE, range),

    autoGoalWeight: async (): Promise<number | null> => num(await meta(AUTO_GOAL_WEIGHT)),
    setAutoGoalWeight: (kg: number | null): Promise<void> => putMeta(AUTO_GOAL_WEIGHT, kg == null ? null : String(kg)),

    /** 同期の対象ではないので、書き込みの列（serializeWrites）には並べない */
    async setLastChatApp(app: ChatApp): Promise<void> {
      await db.runAsync(
        'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [LAST_CHAT_APP, app],
      );
    },

    /** 今の値（初期値を含む）と同じ項目は書かない */
    async update(patch: Partial<Settings>): Promise<void> {
      const now = deps.now().toISOString();
      if (patch.defaultSetCount != null && (patch.defaultSetCount < 1 || patch.defaultSetCount > 6)) {
        throw new Error('セット数の初期値は1〜6です');
      }
      const current = await get();
      await db.withTransactionAsync(async () => {
        for (const [k, v] of Object.entries(patch) as [keyof Settings, Settings[keyof Settings]][]) {
          if (v === undefined || current[k] === v) continue;
          const value = v == null ? null : String(v);
          await db.runAsync(
            `INSERT INTO settings (id, value, created_at, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL`,
            [KEYS[k], value, now, now],
          );
        }
      });
    },
  }, ['update']);
}
