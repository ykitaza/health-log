// 食事のスコア。testdata/meals/meal_score.json はサーバー（services/meals/tests/test_shared_testdata.py）と同じもの。
// 期待する値は手で計算した数（calc に計算がある）で、サーバーもアプリも同じ点・内訳・伸ばしやすい項目になる
import * as fs from 'fs';
import * as path from 'path';
import type { Sex } from '../autoGoal';
import { changeAmount, ESTIMATE_FIELDS, MealItem, NutritionGoal, targetFor } from '../meals';
import { diffText, mealScore, scoreDiff, scoreSpeech, svBand } from '../mealScore';

type Item = { kcal: number; protein_g: number; fat_g: number } & Record<string, number | boolean | null>;
type Expected = {
  score: number | null;
  parts: Record<string, number | null>;
  easiest: { part: string; key: string; advice: string; gain: number } | null;
  band: { label: string; from_target: boolean };
  deferred: string[];
};
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'testdata', 'meals', 'meal_score.json'), 'utf8')) as {
  cases: {
    name: string; items: Item[]; target: { kcal: number | null; protein_g: number | null } | null; sex: Sex | null; in_progress: boolean;
    expected: Expected | null;
  }[];
  diffs: {
    name: string; goal: NutritionGoal; day_type: 'training' | 'rest'; sex: Sex | null; in_progress: boolean; today: Item[]; previous: Item[];
    expected: { points: number | null; previous_points: number | null; diff: number | null };
  }[];
  bands: { kcal: number | null; label: string; from_target: boolean }[];
  change_amount: { name: string; before: Record<string, unknown>; amount: number; after: Record<string, unknown> }[];
};

const toItem = (v: Item, n: number): MealItem => ({
  id: `i${n}`, name: `品目${n}`, amount: 1, unit: '個', confidence: 'high', carbs_g: 0, ...v,
} as MealItem);

describe('meal_score.json：サーバーと同じ点', () => {
  test.each(data.cases)('$name', ({ items, target, sex, in_progress, expected }) => {
    const meals = items.length ? [{ items: items.map(toItem) }] : [];
    const s = mealScore(meals, target, sex, in_progress);
    const got = s == null ? null : {
      score: s.score,
      parts: Object.fromEntries(s.parts.map((p) => [p.key, p.points])),
      easiest: s.easiest == null ? null : { part: s.easiest.part, key: s.easiest.item.key, advice: s.easiest.item.advice, gain: s.easiest.gain },
      band: { label: s.band.label, from_target: s.bandFromTarget },
      deferred: s.parts.filter((p) => p.deferred).map((p) => p.key),
    };
    expect(got).toEqual(expected);
  });

  test.each(data.diffs)('前の日との差：$name', ({ goal, day_type, sex, in_progress, today, previous, expected }) => {
    const target = targetFor(goal, day_type);
    const now = mealScore([{ items: today.map(toItem) }], target, sex, in_progress);
    const before = mealScore([{ items: previous.map(toItem) }], target, sex, in_progress);
    expect({ points: now?.score ?? null, previous_points: before?.score ?? null, diff: scoreDiff(now, before) }).toEqual(expected);
  });

  test.each(data.bands)('SV の欄：目標 $kcal kcal', ({ kcal, label, from_target }) => {
    const { band, fromTarget } = svBand(kcal);
    expect({ label: band.label, from_target: fromTarget }).toEqual({ label, from_target });
  });

  test.each(data.change_amount)('量を変える：$name', ({ before, amount, after }) => {
    const item = { id: 'x', name: '品目', confidence: 'high', ...before } as MealItem;
    const changed = changeAmount(item, amount);
    const view = Object.fromEntries(['amount', 'unit', 'kcal', 'protein_g', 'fat_g', 'carbs_g', ...ESTIMATE_FIELDS]
      .map((k) => [k, (changed as Record<string, unknown>)[k] ?? null]));
    expect(view).toEqual(after);
  });
});

describe('食事ごとに分かれていても、品目を前から順に足す', () => {
  test('食事を分けても、1 つの食事にまとめたときと同じ点', () => {
    const c = data.cases[0];
    const items = c.items.map(toItem);
    const split = mealScore([{ items: items.slice(0, 1) }, { items: items.slice(1) }], c.target, c.sex);
    expect(split?.score).toBe(c.expected!.score);
  });
});

describe('前の日との差と、読み上げ', () => {
  const full = data.cases[0];
  const today = mealScore([{ items: full.items.map(toItem) }], full.target, full.sex)!;
  const noTarget = data.cases.find((c) => c.name.startsWith('目標がない日'))!;
  const before = mealScore([{ items: noTarget.items.map(toItem) }], noTarget.target, noTarget.sex)!;

  test('差は今日 − 前の日。どちらかに点がなければ null', () => {
    expect(scoreDiff(today, before)).toBe(91 - 83);
    expect(scoreDiff(today, null)).toBeNull();
    expect(scoreDiff(null, before)).toBeNull();
  });

  test('差の見せ方', () => {
    expect([diffText(8), diffText(-3), diffText(0)]).toEqual(['+8', '−3', '±0']);
  });

  test('読み上げは、点・差・内訳（記録なしも）・伸ばしやすい項目', () => {
    expect(scoreSpeech(today, 8)).toBe(
      '食事のスコア 91点、前の日より 8点高い。内訳：エネルギー 100点、たんぱく質 100点、バランス 70点、控えたいもの 95点。伸ばしやすいのは、副菜をあと 4 つで +3点',
    );
    expect(scoreSpeech(before, -8)).toBe(
      '食事のスコア 83点、前の日より 8点低い。内訳：エネルギー 記録なし、たんぱく質 記録なし、バランス 70点、控えたいもの 95点。伸ばしやすいのは、副菜をあと 4 つで +7点',
    );
    // 今日（途中）は「ここまで」、エネルギーとたんぱく質は「1日の終わりに付く」
    const soFar = mealScore([{ items: full.items.map(toItem) }], full.target, full.sex, true)!;
    expect(scoreSpeech(soFar, 0)).toBe(
      '食事のスコア（ここまで） 83点、前の日と同じ。内訳：エネルギー 1日の終わりに付く、たんぱく質 1日の終わりに付く、バランス 70点、控えたいもの 95点。伸ばしやすいのは、副菜をあと 4 つで +7点',
    );
  });
});
