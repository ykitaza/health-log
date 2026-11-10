// 食事の計算と決まり。サーバー（services/meals の domain と infrastructure/sync_entities.py）と同じ結果になるようにする。
// 同じテストのデータ（testdata/meals/*.json）で、サーバー（pytest）とアプリ（jest）の両方から確かめている。
// 小数の誤差までそろえるため、足す順番と計算の仕方（平均は 1/n を掛ける、など）もサーバーに合わせる。
import { addDays, DateKey, weekStart } from './date';
import { parseNumber } from './units';
import { uuid5 } from './uuid5';

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
/** 区分の順番（サーバーの MealSlot の順。並べるときもこの順） */
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const SLOT_LABELS: Record<Slot, string> = { breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食' };
/** 今の時刻（0〜23 時）から近い区分。「食事を追加」で初めに選んでおく。4〜10 時 朝食、10〜15 時 昼食、15〜21 時 夕食、それ以外は間食 */
export function slotAt(hour: number): Slot {
  if (hour >= 4 && hour < 10) return 'breakfast';
  if (hour >= 10 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 21) return 'dinner';
  return 'snack';
}

export type Unit = 'g' | 'ml' | '個' | '杯';
export const UNITS: Unit[] = ['g', 'ml', '個', '杯'];
export type Source = 'photo' | 'text' | 'numbers' | 'copy' | 'template';
export type Confidence = 'high' | 'medium' | 'low';
export type DayType = 'training' | 'rest';
export const DAY_TYPE_LABELS: Record<DayType, string> = { training: '筋トレの日', rest: '休みの日' };
export type Policy = 'bulk' | 'maintain' | 'cut';
export const POLICY_LABELS: Record<Policy, string> = { bulk: '増量', maintain: '維持', cut: '減量' };
export type EatingStyle = 'home_cooked' | 'eating_out' | 'convenience_store';
export const EATING_STYLE_LABELS: Record<EatingStyle, string> = {
  home_cooked: '自炊が多い', eating_out: '外食が多い', convenience_store: 'コンビニが多い',
};

/** 栄養（kcal と PFC）。項目の名前は同期の API と同じ */
export type Nutrition = { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
/** 目標や残り。目標がない項目は null */
export type Gap = { kcal: number | null; protein_g: number | null; fat_g: number | null; carbs_g: number | null };
const KEYS = ['kcal', 'protein_g', 'fat_g', 'carbs_g'] as const;

export const ZERO: Nutrition = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };

export type MealItem = Nutrition & { id: string; name: string; amount: number; unit: Unit; confidence: Confidence };
export type Meal = {
  id: string; date: DateKey; slot: Slot; time: string | null; description: string; source: Source;
  items: MealItem[]; createdAt: string;
  /** kcal と PFC を推定したときの根拠（MCP が書く。アプリで記録した食事は null）。画面に出すだけで、アプリでは変えない */
  basis: string | null;
};

export type DailyTarget = { kcal: number; fat_g: number; carbs_g: number };
export type NutritionGoal = {
  policy: Policy;
  body_weight_kg: number | null;
  protein_per_kg: number | null;
  targets: { training_day: DailyTarget; rest_day: DailyTarget } | null;
  eating_style: EatingStyle | null;
  target_weight_kg: number | null;
};

// --- 上限（サーバーの sync_entities.py と同じ。lib/__tests__/meals-limits.test.ts で突き合わせる） ---
export const MAX_ITEMS = 50;
export const ITEM_NAME_MAX = 200;
export const TEMPLATE_NAME_MAX = 100;
export const DESCRIPTION_MAX = 2000;
export const AMOUNT_MAX = 100000;
export const KCAL_MAX = 20000;
export const GRAMS_MAX = 5000;
export const BODY_WEIGHT_MAX = 300;
export const PROTEIN_PER_KG_MAX = 5;
export const TARGET_WEIGHT = { min: 30, max: 300 };

// --- 計算 ---

export function add(a: Nutrition, b: Nutrition): Nutrition {
  return { kcal: a.kcal + b.kcal, protein_g: a.protein_g + b.protein_g, fat_g: a.fat_g + b.fat_g, carbs_g: a.carbs_g + b.carbs_g };
}

/** 合計（0 から順に足す。サーバーの sum(..., Nutrition.zero()) と同じ順） */
export function sum(list: Nutrition[]): Nutrition {
  return list.reduce(add, ZERO);
}

function times(n: Nutrition, factor: number): Nutrition {
  return { kcal: n.kcal * factor, protein_g: n.protein_g * factor, fat_g: n.fat_g * factor, carbs_g: n.carbs_g * factor };
}

const pick = (n: Nutrition): Nutrition => ({ kcal: n.kcal, protein_g: n.protein_g, fat_g: n.fat_g, carbs_g: n.carbs_g });

export function mealTotal(meal: { items: Nutrition[] }): Nutrition {
  return sum(meal.items.map(pick));
}

/** 量を変える。単位はそのまま、栄養も同じ割合で変わる（サーバーの FoodItem.with_amount） */
export function changeAmount<T extends MealItem>(item: T, amount: number): T {
  return { ...item, amount, ...times(pick(item), amount / item.amount) };
}

/** その日の目標。たんぱく質は体重 × 体重1kgあたり（日の種類によらない）。kcal・脂質・炭水化物は日の種類で選ぶ */
export function targetFor(goal: NutritionGoal, dayType: DayType): Gap {
  const protein = goal.body_weight_kg != null && goal.protein_per_kg != null ? goal.body_weight_kg * goal.protein_per_kg : null;
  const daily = goal.targets ? (dayType === 'training' ? goal.targets.training_day : goal.targets.rest_day) : null;
  if (!daily) return { kcal: null, protein_g: protein, fat_g: null, carbs_g: null };
  return { kcal: daily.kcal, protein_g: protein, fat_g: daily.fat_g, carbs_g: daily.carbs_g };
}

/** 目標から食べた分を引いた残り（負なら超えている） */
export function remaining(target: Gap, eaten: Nutrition): Gap {
  const out = {} as Gap;
  for (const k of KEYS) out[k] = target[k] == null ? null : target[k]! - eaten[k];
  return out;
}

/** 日の種類：本人が決めた日はそれ。決めていない日は、筋トレの記録があれば筋トレの日、なければ休みの日 */
export function resolveDayType(chosen: DayType | null, trained: boolean): DayType {
  return chosen ?? (trained ? 'training' : 'rest');
}

export type DaySummary = {
  date: DateKey; dayType: DayType; meals: Meal[];
  total: Nutrition; target: Gap | null; remaining: Gap | null;
};

export function daySummary(date: DateKey, dayType: DayType, meals: Meal[], goal: NutritionGoal | null): DaySummary {
  const total = sum(meals.map(mealTotal));
  const target = goal ? targetFor(goal, dayType) : null;
  return { date, dayType, meals, total, target, remaining: target ? remaining(target, total) : null };
}

export type WeeklyReview = {
  days: DaySummary[]; recordedDays: number;
  average: Nutrition | null; averageTarget: Gap | null; gap: Gap | null;
};

/** 週のふり返り。平均は記録した日だけで出す（記録しなかった日を責めない。サーバーの WeeklyReview） */
export function weeklyReview(days: DaySummary[]): WeeklyReview {
  const recorded = days.filter((d) => d.meals.length > 0);
  const average = recorded.length ? times(sum(recorded.map((d) => d.total)), 1 / recorded.length) : null;
  // 目標の平均：項目ごとに、記録した日のすべてに目標があるときだけ出す
  const targets = recorded.map((d) => d.target);
  let averageTarget: Gap | null = null;
  if (targets.length && targets.every((t) => t != null)) {
    averageTarget = {} as Gap;
    for (const k of KEYS) {
      const col = targets.map((t) => t![k]);
      averageTarget[k] = col.some((v) => v == null) ? null : floatSum(col as number[]) / col.length;
    }
  }
  let gap: Gap | null = null;
  if (average && averageTarget) {
    const r = remaining(averageTarget, average);
    gap = {} as Gap;
    for (const k of KEYS) gap[k] = r[k] == null ? null : -r[k]!;
  }
  return { days, recordedDays: recorded.length, average, averageTarget, gap };
}

/**
 * 数の並びの合計。Python（3.12 から）の sum() と同じく、Neumaier の方法で丸めの誤差を補って足す。
 * サーバーの WeeklyReview.average_target は sum(数の並び) で足すので、同じ値にするために使う
 */
export function floatSum(values: number[]): number {
  let total = 0, c = 0;
  for (const x of values) {
    const t = total + x;
    c += Math.abs(total) >= Math.abs(x) ? (total - t) + x : (x - t) + total;
    total = t;
  }
  return c !== 0 && Number.isFinite(c) ? total + c : total;
}

/** 日を選ぶシートで選んだ日を含む週の、最後の日（週は月〜日。今週は今日まで＝今日までの7日） */
export function weekLastDayFor(date: DateKey, today: DateKey): DateKey {
  const end = addDays(weekStart(date), 6);
  return end > today ? today : end;
}

/** lastDay までの7日（古い順） */
export function weekDates(lastDay: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(lastDay, i - 6));
}

/** PFC の kcal の割合（%）。P・C は 1g 4kcal、F は 9kcal。合計が 0 なら null */
export function pfcRatio(n: { protein_g: number | null; fat_g: number | null; carbs_g: number | null }) {
  if (n.protein_g == null || n.fat_g == null || n.carbs_g == null) return null;
  const p = n.protein_g * 4, f = n.fat_g * 9, c = n.carbs_g * 4;
  const all = p + f + c;
  if (all <= 0) return null;
  return { p: (p / all) * 100, f: (f / all) * 100, c: (c / all) * 100 };
}

// --- 同期の状態から食事を読む ---

/** 同期の状態の形（API の EntityState のうち、読むのに使うもの） */
export type MealState = {
  id: string; fields: Partial<Record<string, unknown>>; deleted: boolean; createdAt: string;
  items: { id: string; fields: Partial<Record<string, unknown>>; deleted: boolean }[];
};

const MEAL_KEYS = ['date', 'slot', 'description', 'source'];
const ITEM_KEYS = ['name', 'amount', 'unit', 'kcal', 'protein_g', 'fat_g', 'carbs_g', 'confidence', 'sort_order'];
const has = (fields: Partial<Record<string, unknown>>, keys: string[]) => keys.every((k) => k in fields && fields[k] !== undefined);

/**
 * 一覧と合計に出す食事（サーバーの meal_from_doc と SyncMealRepository.find と同じ決まり）。
 * 消えた食事、日付などがそろっていない食事、生きている品目がない食事は出さない。
 * 品目は並び順（sort_order）、同じなら ID の順。食事は日付・区分の順・作った時刻・ID の順
 */
export function readableMeals(states: MealState[]): Meal[] {
  const meals: Meal[] = [];
  for (const s of states) {
    if (s.deleted || !has(s.fields, MEAL_KEYS)) continue;
    const items = s.items
      .filter((i) => !i.deleted && has(i.fields, ITEM_KEYS))
      .sort((a, b) => (a.fields.sort_order as number) - (b.fields.sort_order as number) || cmp(a.id, b.id));
    if (items.length === 0) continue;
    const f = s.fields;
    meals.push({
      id: s.id, date: f.date as string, slot: f.slot as Slot, time: (f.time as string | null) ?? null,
      description: f.description as string, source: f.source as Source, createdAt: s.createdAt,
      basis: typeof f.basis === 'string' && f.basis.trim() !== '' ? f.basis : null,
      items: items.map((i) => ({
        id: i.id, name: i.fields.name as string, amount: i.fields.amount as number, unit: i.fields.unit as Unit,
        kcal: i.fields.kcal as number, protein_g: i.fields.protein_g as number, fat_g: i.fields.fat_g as number,
        carbs_g: i.fields.carbs_g as number, confidence: i.fields.confidence as Confidence,
      })),
    });
  }
  return meals.sort((a, b) =>
    cmp(a.date, b.date) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
}

/** 文字列の比較（Python の文字列の比較と同じく、文字コードの順） */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 一覧に出す食事の名前：説明があれば説明、なければ品目の名前を「、」でつなぐ */
export function mealTitle(meal: Meal): string {
  return meal.description.trim() || meal.items.map((i) => i.name).join('、');
}

// --- いつもの ---

/** いつものの ID は名前から決める（同じ名前は1つ。アプリと MCP で同じ ID。サーバーの template_id） */
const TEMPLATE_NAMESPACE = '6f1d3c52-6a1e-4f5f-9d0b-2c7a8e0f4b61';
export function templateId(name: string): string {
  return uuid5(TEMPLATE_NAMESPACE, name);
}

export type TemplateItem = Nutrition & { item_id?: string | null; name: string; amount: number; unit: Unit; confidence: Confidence };
export type MealTemplate = { id: string; name: string; items: TemplateItem[] };

/** いつものの品目を、食事の品目にする。ID は item_id、なければ並び順から（サーバーの template_from_state と同じ） */
export function templateMealItems(template: MealTemplate): MealItem[] {
  return template.items.map((i, n) => ({
    id: i.item_id || `item${n + 1}`, name: i.name, amount: i.amount, unit: i.unit, confidence: i.confidence,
    kcal: i.kcal, protein_g: i.protein_g, fat_g: i.fat_g, carbs_g: i.carbs_g,
  }));
}

/** いつもので記録するときの説明（サーバーの MealTemplate.to_meal と同じ） */
export const templateDescription = (name: string) => `いつもの：${name}`;

// --- 入力の確かめ ---

export type ItemDraft = { name: string; amount: string; unit: Unit; kcal: string; protein_g: string; fat_g: string; carbs_g: string };
export type ItemInput = Nutrition & { name: string; amount: number; unit: Unit };

const codePoints = (s: string) => [...s].length;

function num(text: string, label: string, max: number, positive = false): number | string {
  const n = parseNumber(text);
  if (n == null) return `${label}を数字で入れてください`;
  if (positive ? n <= 0 : n < 0) return `${label}は${positive ? '0より大きい' : '0以上の'}数で入れてください`;
  if (n > max) return `${label}は ${max.toLocaleString('en-US')} までで入れてください`;
  return n;
}

/** 品目の入力を確かめる。よければ値、だめなら文言（サーバーの MealItemFields と同じ範囲） */
export function parseItem(d: ItemDraft): { value: ItemInput } | { error: string } {
  const name = d.name.trim();
  if (!name) return { error: '品名を入れてください' };
  if (codePoints(name) > ITEM_NAME_MAX) return { error: `品名は${ITEM_NAME_MAX}文字以内で入れてください` };
  const amount = num(d.amount, '量', AMOUNT_MAX, true);
  if (typeof amount === 'string') return { error: amount };
  const kcal = num(d.kcal, 'エネルギー', KCAL_MAX);
  if (typeof kcal === 'string') return { error: kcal };
  const values: Record<'protein_g' | 'fat_g' | 'carbs_g', number> = { protein_g: 0, fat_g: 0, carbs_g: 0 };
  for (const [k, label] of [['protein_g', 'たんぱく質'], ['fat_g', '脂質'], ['carbs_g', '炭水化物']] as const) {
    const v = d[k].trim() === '' ? 0 : num(d[k], label, GRAMS_MAX);
    if (typeof v === 'string') return { error: v };
    values[k] = v;
  }
  return { value: { name, amount, unit: d.unit, kcal, ...values } };
}

/** 量を変えたあとの品目が、サーバーの範囲に入っているか（量を増やして kcal が上限を超えた、など） */
export function itemRangeError(item: Nutrition & { amount: number; name: string }): string | null {
  if (!(item.amount > 0) || item.amount > AMOUNT_MAX) return `${item.name}：量は 0 より大きく ${AMOUNT_MAX.toLocaleString('en-US')} までにしてください`;
  if (item.kcal > KCAL_MAX) return `${item.name}：エネルギーが ${KCAL_MAX.toLocaleString('en-US')}kcal を超えます`;
  if (Math.max(item.protein_g, item.fat_g, item.carbs_g) > GRAMS_MAX) return `${item.name}：PFC が ${GRAMS_MAX.toLocaleString('en-US')}g を超えます`;
  return null;
}

export function templateNameError(name: string): string | null {
  const t = name.trim();
  if (!t) return 'いつものの名前を入れてください';
  if (codePoints(t) > TEMPLATE_NAME_MAX) return `いつものの名前は${TEMPLATE_NAME_MAX}文字以内で入れてください`;
  return null;
}

export type GoalDraft = {
  policy: Policy; bodyWeight: string; proteinPerKg: string; targetWeight: string; eatingStyle: EatingStyle | null;
  training: { kcal: string; fat_g: string; carbs_g: string };
  rest: { kcal: string; fat_g: string; carbs_g: string };
};

/**
 * 目標の入力を確かめる（MCP の set_goals と同じ。サーバーの NutritionGoalFields の範囲）。
 * 空の欄は「その目標なし」。筋トレの日と休みの日の kcal・脂質・炭水化物は、全部入れるか、全部空にする
 */
export function parseGoal(d: GoalDraft): { value: NutritionGoal } | { error: string } {
  const optional = (text: string, label: string, check: (n: number) => string | null): number | null | string => {
    if (text.trim() === '') return null;
    const n = parseNumber(text);
    if (n == null) return `${label}を数字で入れてください`;
    return check(n) ?? n;
  };
  const bw = optional(d.bodyWeight, '体重', (n) => (n > 0 && n <= BODY_WEIGHT_MAX ? null : `体重は 0 より大きく ${BODY_WEIGHT_MAX}kg までで入れてください`));
  if (typeof bw === 'string') return { error: bw };
  const ppk = optional(d.proteinPerKg, '体重1kgあたりのたんぱく質', (n) =>
    n > 0 && n <= PROTEIN_PER_KG_MAX ? null : `体重1kgあたりのたんぱく質は 0 より大きく ${PROTEIN_PER_KG_MAX}g までで入れてください`);
  if (typeof ppk === 'string') return { error: ppk };
  const tw = optional(d.targetWeight, '目標体重', (n) =>
    n >= TARGET_WEIGHT.min && n <= TARGET_WEIGHT.max ? null : `目標体重は ${TARGET_WEIGHT.min}〜${TARGET_WEIGHT.max}kg で入れてください`);
  if (typeof tw === 'string') return { error: tw };
  const cells = [d.training.kcal, d.training.fat_g, d.training.carbs_g, d.rest.kcal, d.rest.fat_g, d.rest.carbs_g];
  let targets: NutritionGoal['targets'] = null;
  if (cells.some((c) => c.trim() !== '')) {
    if (cells.some((c) => c.trim() === '')) {
      return { error: '筋トレの日と休みの日の kcal・脂質・炭水化物は、全部入れるか、全部空にしてください' };
    }
    const daily = (t: GoalDraft['training'], label: string): DailyTarget | string => {
      const kcal = num(t.kcal, `${label}のエネルギー`, KCAL_MAX);
      if (typeof kcal === 'string') return kcal;
      const fat = num(t.fat_g, `${label}の脂質`, GRAMS_MAX);
      if (typeof fat === 'string') return fat;
      const carbs = num(t.carbs_g, `${label}の炭水化物`, GRAMS_MAX);
      if (typeof carbs === 'string') return carbs;
      return { kcal, fat_g: fat, carbs_g: carbs };
    };
    const training = daily(d.training, '筋トレの日');
    if (typeof training === 'string') return { error: training };
    const rest = daily(d.rest, '休みの日');
    if (typeof rest === 'string') return { error: rest };
    targets = { training_day: training, rest_day: rest };
  }
  return {
    value: { policy: d.policy, body_weight_kg: bw, protein_per_kg: ppk, targets, eating_style: d.eatingStyle, target_weight_kg: tw },
  };
}
