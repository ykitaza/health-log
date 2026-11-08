// サーバー（services/meals/tests/test_shared_testdata.py）と同じテストのデータ（testdata/meals/*.json）で、アプリの計算を確かめる。
// summaries.json の states は、アプリから届いた変更をサーバーが当てはめた状態（同じ項目は新しい方、削除が勝つ）。
// サーバーはその状態になることを確かめ、アプリはその状態から同じ合計・目標・残り・週のふり返りを出すことを確かめる（小数の誤差まで）。
import * as fs from 'fs';
import * as path from 'path';
import {
  changeAmount, daySummary, Gap, MealItem, MealState, mealTotal, Nutrition, NutritionGoal, readableMeals, remaining,
  resolveDayType, targetFor, templateId, weekDates, weeklyReview,
} from '../meals';

const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'testdata', 'meals', name), 'utf8'));

type State = { entity_type: string; entity_id: string; parent_id: string | null; fields: Record<string, unknown>; deleted: boolean; created_at: string };

/** 受け取った状態を、食事ごとにまとめる（端末の表に入れたのと同じ形） */
function mealStates(states: State[]): MealState[] {
  return states.filter((s) => s.entity_type === 'meal').map((s) => ({
    id: s.entity_id, fields: s.fields, deleted: s.deleted, createdAt: s.created_at,
    items: states.filter((i) => i.entity_type === 'meal_item' && i.parent_id === s.entity_id)
      .map((i) => ({ id: i.entity_id, fields: i.fields, deleted: i.deleted })),
  }));
}

describe('summaries.json', () => {
  const data = load('summaries.json');
  const states: State[] = data.states;
  const meals = readableMeals(mealStates(states));
  const goalState = states.find((s) => s.entity_type === 'nutrition_goal' && !s.deleted);
  const goal = (goalState?.fields ?? null) as NutritionGoal | null;
  const chosen = new Map(states.filter((s) => s.entity_type === 'day_type' && !s.deleted)
    .map((s) => [s.entity_id, s.fields.day_type as 'training' | 'rest']));
  const trained = new Set<string>(data.training_days);
  const days = weekDates(data.last_day).map((d) =>
    daySummary(d, resolveDayType(chosen.get(d) ?? null, trained.has(d)), meals.filter((m) => m.date === d), goal));

  test('1日のまとめ（出す食事と品目の順、合計、日の種類、目標、残り）', () => {
    const actual = days.map((d) => ({
      date: d.date, day_type: d.dayType,
      meals: d.meals.map((m) => ({ meal_id: m.id, slot: m.slot, item_ids: m.items.map((i) => i.id), total: mealTotal(m) })),
      total: d.total, target: d.target, remaining: d.remaining,
    }));
    expect(actual).toEqual(data.expected.daily);
  });

  test('週のふり返り（平均は記録した日だけ）', () => {
    const r = weeklyReview(days);
    expect({
      recorded_days: r.recordedDays, average: r.average, average_target: r.averageTarget, gap: r.gap,
      days: r.days.map((d) => ({ date: d.date, day_type: d.dayType, recorded: d.meals.length > 0, total: d.total })),
    }).toEqual(data.expected.weekly);
  });
});

describe('targets.json', () => {
  const cases: { name: string; goal: (Partial<NutritionGoal> & Pick<NutritionGoal, 'policy'>) | null; day_type: 'training' | 'rest'; eaten: Nutrition; target: Gap | null; remaining: Gap | null }[] =
    load('targets.json').cases;
  test.each(cases)('$name', (c) => {
    const goal = c.goal ? { body_weight_kg: null, protein_per_kg: null, targets: null, eating_style: null, target_weight_kg: null, ...c.goal } : null;
    const target = goal ? targetFor(goal, c.day_type) : null;
    expect(target).toEqual(c.target);
    expect(target ? remaining(target, c.eaten) : null).toEqual(c.remaining);
  });
});

describe('templates.json', () => {
  const data = load('templates.json');
  test.each(data.template_ids as { name: string; id: string }[])('いつものの ID：$name', ({ name, id }) => {
    expect(templateId(name)).toBe(id);
  });
  test.each(data.change_amount as { before: Omit<MealItem, 'id' | 'name' | 'confidence'>; amount: number; after: object }[])(
    '量を変える：$before.amount$before.unit → $amount', ({ before, amount, after }) => {
      const item: MealItem = { ...before, id: 'x', name: '白米', confidence: 'high' };
      const { id: _, name: __, confidence: ___, ...rest } = changeAmount(item, amount);
      expect(rest).toEqual(after);
    });
});
