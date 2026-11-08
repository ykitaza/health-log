import { addDays, DateKey } from '@/lib/date';
import {
  DaySummary, daySummary, DayType, resolveDayType, ItemInput, MAX_ITEMS, Meal, MealItem, MealState, MealTemplate, NutritionGoal, readableMeals, Slot, Source,
  TemplateItem, templateDescription, templateId, templateMealItems,
} from '@/lib/meals';
import { serializeWrites } from '../serial';
import type { Bind, Db, Deps } from '../types';

type MealRow = { id: string; date: string; slot: string; time: string | null; description: string; source: string; created_at: string; deleted_at: string | null };
type ItemRow = {
  meal_id: string; id: string; name: string; amount: number; unit: string; kcal: number; protein_g: number;
  fat_g: number; carbs_g: number; confidence: string; sort_order: number; deleted_at: string | null;
};
type GoalRow = {
  policy: string; body_weight_kg: number | null; protein_per_kg: number | null; targets: string | null;
  eating_style: string | null; target_weight_kg: number | null;
};

export const GOAL_ID = 'current';
const ITEM_COLUMNS = ['name', 'amount', 'unit', 'kcal', 'protein_g', 'fat_g', 'carbs_g', 'confidence', 'sort_order'] as const;

export class MealRuleError extends Error {}

/** 記録するときの品目。id があれば使う（複製・いつものは元の品目の ID のまま。サーバーと同じ） */
export type NewItem = ItemInput & { id?: string; confidence?: MealItem['confidence'] };

/**
 * 食事・品目・いつもの・目標・日の種類。どれも論理削除（deleted_at）で、同期できる形にしてある。
 * 読むときは、同期の状態と同じ決まり（lib/meals.ts の readableMeals）で、出す食事を選ぶ
 */
export function mealRepository(db: Db, deps: Deps) {
  async function load(where: string, params: Bind[]): Promise<Meal[]> {
    const meals = await db.getAllAsync<MealRow>(
      `SELECT id, date, slot, time, description, source, created_at, deleted_at FROM meals WHERE deleted_at IS NULL AND ${where}`, params,
    );
    if (meals.length === 0) return [];
    const items = await db.getAllAsync<ItemRow>(
      `SELECT * FROM meal_items WHERE meal_id IN (${meals.map(() => '?').join(', ')})`, meals.map((m) => m.id),
    );
    const states: MealState[] = meals.map((m) => ({
      id: m.id, deleted: false, createdAt: m.created_at,
      fields: { date: m.date, slot: m.slot, time: m.time, description: m.description, source: m.source },
      items: items.filter((i) => i.meal_id === m.id).map((i) => ({
        id: i.id, deleted: i.deleted_at != null, fields: Object.fromEntries(ITEM_COLUMNS.map((c) => [c, i[c]])),
      })),
    }));
    return readableMeals(states);
  }

  const getMeal = async (id: string) => (await load('id = ?', [id]))[0] ?? null;

  function checkCount(n: number) {
    if (n === 0) throw new MealRuleError('品目が1つもありません');
    if (n > MAX_ITEMS) throw new MealRuleError(`品目は1回の食事に${MAX_ITEMS}件までです`);
  }

  async function insertMeal(m: { date: DateKey; slot: Slot; time: string | null; description: string; source: Source; items: NewItem[] }) {
    checkCount(m.items.length);
    const id = deps.newId();
    const now = deps.now().toISOString();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'INSERT INTO meals (id, date, slot, time, description, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, m.date, m.slot, m.time, m.description, m.source, now, now],
      );
      for (const [order, item] of m.items.entries()) await insertItem(id, item, order, now);
    });
    return id;
  }

  const insertItem = (mealId: string, item: NewItem, order: number, now: string) => db.runAsync(
    `INSERT INTO meal_items (meal_id, id, name, amount, unit, kcal, protein_g, fat_g, carbs_g, confidence, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [mealId, item.id ?? deps.newId(), item.name, item.amount, item.unit, item.kcal, item.protein_g, item.fat_g, item.carbs_g,
      item.confidence ?? 'high', order, now, now],
  );

  async function readTemplates(): Promise<MealTemplate[]> {
    const rows = await db.getAllAsync<{ id: string; name: string; items: string }>(
      'SELECT id, name, items FROM meal_templates WHERE deleted_at IS NULL ORDER BY created_at, id', [],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, items: JSON.parse(r.items) as TemplateItem[] }));
  }

  /** いつものを保存する。同じ名前は上書きする（消してあれば戻す。MCP の save_template と同じ） */
  async function writeTemplate(name: string, items: MealItem[]) {
    checkCount(items.length);
    const id = templateId(name);
    const now = deps.now().toISOString();
    const json = JSON.stringify(items.map((i): TemplateItem => ({
      item_id: i.id, name: i.name, amount: i.amount, unit: i.unit, kcal: i.kcal, protein_g: i.protein_g,
      fat_g: i.fat_g, carbs_g: i.carbs_g, confidence: i.confidence,
    })));
    await db.runAsync(
      `INSERT INTO meal_templates (id, name, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, items = excluded.items, updated_at = excluded.updated_at, deleted_at = NULL`,
      [id, name, json, now, now],
    );
  }

  async function getGoal(): Promise<NutritionGoal | null> {
    const r = await db.getFirstAsync<GoalRow>(
      'SELECT policy, body_weight_kg, protein_per_kg, targets, eating_style, target_weight_kg FROM nutrition_goals WHERE id = ? AND deleted_at IS NULL', [GOAL_ID],
    );
    if (!r) return null;
    return { ...r, targets: r.targets ? JSON.parse(r.targets) : null } as NutritionGoal;
  }

  /** 本人が決めた日の種類 */
  async function chosenDayTypes(from: DateKey, to: DateKey): Promise<Map<DateKey, DayType>> {
    const rows = await db.getAllAsync<{ id: string; day_type: DayType }>(
      'SELECT id, day_type FROM day_types WHERE deleted_at IS NULL AND id BETWEEN ? AND ?', [from, to],
    );
    return new Map(rows.map((r) => [r.id, r.day_type]));
  }

  /** 筋トレの記録（セット）がある日（サーバーの training_dates と同じ） */
  async function trainingDays(from: DateKey, to: DateKey): Promise<Set<DateKey>> {
    const rows = await db.getAllAsync<{ date: string }>(
      `SELECT DISTINCT w.date FROM workout_sets s JOIN workout_entries w ON w.id = s.entry_id
       WHERE s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.date BETWEEN ? AND ?`, [from, to],
    );
    return new Set(rows.map((r) => r.date));
  }

  return serializeWrites(db, {
    /** 期間（両端を含む）の食事。日付・区分・記録した順 */
    listRange: (from: DateKey, to: DateKey) => load('date BETWEEN ? AND ?', [from, to]),
    listDay: (date: DateKey) => load('date = ?', [date]),
    getMeal,

    /** 品目を手で入れて記録する */
    async record(m: { date: DateKey; slot: Slot; description?: string; source: 'text' | 'numbers'; items: NewItem[] }): Promise<string> {
      return insertMeal({ ...m, time: null, description: m.description ?? '' });
    },

    /**
     * 記録済みの食事を直す（MCP の update_meal と同じ：量の変更・品目の追加・削除、日付と区分の変更）。
     * items は直したあとの品目の一覧。今の品目にない ID は足し、一覧にない品目は消す
     */
    async update(id: string, change: { date: DateKey; slot: Slot; items: NewItem[] }): Promise<void> {
      const meal = await getMeal(id);
      if (!meal) throw new MealRuleError('食事が見つかりません');
      checkCount(change.items.length);
      const now = deps.now().toISOString();
      await db.withTransactionAsync(async () => {
        if (meal.date !== change.date || meal.slot !== change.slot) {
          await db.runAsync('UPDATE meals SET date = ?, slot = ?, updated_at = ? WHERE id = ?', [change.date, change.slot, now, id]);
        }
        const current = new Map(meal.items.map((i, order) => [i.id, { ...i, sort_order: order }]));
        for (const [order, item] of change.items.entries()) {
          const old = item.id ? current.get(item.id) : undefined;
          if (!old) {
            // 足した品目は新しい ID にする（前に消した品目と ID が重ならないように）
            await insertItem(id, { ...item, id: undefined }, order, now);
            continue;
          }
          const next: Record<string, Bind> = {
            name: item.name, amount: item.amount, unit: item.unit, kcal: item.kcal, protein_g: item.protein_g,
            fat_g: item.fat_g, carbs_g: item.carbs_g, confidence: item.confidence ?? old.confidence, sort_order: order,
          };
          const diff = ITEM_COLUMNS.filter((c) => next[c] !== (old as Record<string, unknown>)[c]);
          if (diff.length > 0) {
            await db.runAsync(
              `UPDATE meal_items SET ${diff.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE meal_id = ? AND id = ?`,
              [...diff.map((c) => next[c]), now, id, old.id],
            );
          }
        }
        const kept = new Set(change.items.map((i) => i.id));
        for (const old of meal.items) {
          if (!kept.has(old.id)) {
            await db.runAsync('UPDATE meal_items SET deleted_at = ?, updated_at = ? WHERE meal_id = ? AND id = ?', [now, now, id, old.id]);
          }
        }
      });
    },

    /** 食事を消す（品目は食事と一緒に見えなくなる。サーバーと同じく、食事だけに削除の印を付ける） */
    async remove(id: string): Promise<void> {
      const now = deps.now().toISOString();
      await db.runAsync('UPDATE meals SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id]);
    },

    /** 昨日と同じ：記録済みの食事を、別の日・区分に複製する（MCP の copy_meal。品目の ID は元のまま） */
    async copy(id: string, to: { date: DateKey; slot: Slot }): Promise<string> {
      const meal = await getMeal(id);
      if (!meal) throw new MealRuleError('食事が見つかりません');
      return insertMeal({ ...to, time: null, description: meal.description, source: 'copy', items: meal.items });
    },

    listTemplates: readTemplates,

    /** いつものとして保存する（品目の一覧から。記録の画面の「いつものとして保存」） */
    saveTemplate: (name: string, items: MealItem[]) => writeTemplate(name.trim(), items),

    /** 記録済みの食事を、いつものとして保存する（MCP の save_template） */
    async saveTemplateFromMeal(mealId: string, name: string): Promise<void> {
      const meal = await getMeal(mealId);
      if (!meal) throw new MealRuleError('食事が見つかりません');
      await writeTemplate(name.trim(), meal.items);
    },

    /** いつもので記録する（MCP の record_template） */
    async recordTemplate(id: string, to: { date: DateKey; slot: Slot }): Promise<string> {
      const template = (await readTemplates()).find((t) => t.id === id);
      if (!template) throw new MealRuleError('いつものが見つかりません');
      return insertMeal({ ...to, time: null, description: templateDescription(template.name), source: 'template', items: templateMealItems(template) });
    },

    getGoal,

    /** 目標を保存する（1人に1つ。上書きする。MCP の set_goals と同じ） */
    async saveGoal(g: NutritionGoal): Promise<void> {
      const now = deps.now().toISOString();
      const values: Bind[] = [g.policy, g.body_weight_kg, g.protein_per_kg, g.targets ? JSON.stringify(g.targets) : null, g.eating_style, g.target_weight_kg];
      const old = await db.getFirstAsync<GoalRow & { deleted_at: string | null }>('SELECT * FROM nutrition_goals WHERE id = ?', [GOAL_ID]);
      if (!old) {
        await db.runAsync(
          `INSERT INTO nutrition_goals (id, policy, body_weight_kg, protein_per_kg, targets, eating_style, target_weight_kg, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [GOAL_ID, ...values, now, now],
        );
        return;
      }
      const cols = ['policy', 'body_weight_kg', 'protein_per_kg', 'targets', 'eating_style', 'target_weight_kg'] as const;
      const diff = cols.map((c, i) => [c, values[i]] as const).filter(([c, v]) => old[c] !== v);
      if (diff.length === 0 && old.deleted_at == null) return;
      await db.runAsync(
        `UPDATE nutrition_goals SET ${[...diff.map(([c]) => `${c} = ?`), 'updated_at = ?', 'deleted_at = NULL'].join(', ')} WHERE id = ?`,
        [...diff.map(([, v]) => v), now, GOAL_ID],
      );
    },

    /** 期間の日ごとのまとめ（合計・日の種類・目標・残り）と目標。古い順 */
    async summaries(from: DateKey, to: DateKey): Promise<{ days: DaySummary[]; goal: NutritionGoal | null }> {
      const [meals, chosen, trained, goal] = await Promise.all([
        load('date BETWEEN ? AND ?', [from, to]), chosenDayTypes(from, to), trainingDays(from, to), getGoal(),
      ]);
      const days: DaySummary[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        days.push(daySummary(d, resolveDayType(chosen.get(d) ?? null, trained.has(d)), meals.filter((m) => m.date === d), goal));
      }
      return { days, goal };
    },

    /** 本人が決めた日の種類（決めていなければ null） */
    chosenDayTypes,

    /** その日の種類を決める（MCP の set_day_type） */
    async setDayType(date: DateKey, dayType: DayType): Promise<void> {
      const now = deps.now().toISOString();
      await db.runAsync(
        `INSERT INTO day_types (id, day_type, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET day_type = excluded.day_type, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE day_types.day_type IS NOT excluded.day_type OR day_types.deleted_at IS NOT NULL`,
        [date, dayType, now, now],
      );
    },

    trainingDays,
  }, ['record', 'update', 'remove', 'copy', 'saveTemplate', 'saveTemplateFromMeal', 'recordTemplate', 'saveGoal', 'setDayType']);
}
