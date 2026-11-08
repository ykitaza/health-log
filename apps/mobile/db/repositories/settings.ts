import type { WeightUnit } from '@/lib/units';
import { serializeWrites } from '../serial';
import type { Db, Deps } from '../types';

export type Settings = {
  weightUnit: WeightUnit;
  defaultSetCount: number; // 1〜6
  heightCm: number | null;
  goalWeightKg: number | null;
};

export const DEFAULT_SETTINGS: Settings = { weightUnit: 'kg', defaultSetCount: 3, heightCm: null, goalWeightKg: null };

const KEYS: Record<keyof Settings, string> = {
  weightUnit: 'weight_unit',
  defaultSetCount: 'default_set_count',
  heightCm: 'height_cm',
  goalWeightKg: 'goal_weight_kg',
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
    };
  }

  return serializeWrites(db, {
    get,

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
