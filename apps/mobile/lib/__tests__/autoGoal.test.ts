import {
  basalMetabolism, bodyBasis, calcGoal, GoalInput, missingInputs, parseBirthYear, policyFor, weightChanged,
} from '../autoGoal';

const base: GoalInput = { weightKg: 68, bodyFatPct: null, heightCm: 170, age: 35, sex: 'male', activity: 'light', targetWeightKg: 65 };

test('代表の値：男性 68kg・170cm・35歳・少し動く、目標 65kg（Mifflin-St Jeor、減量）', () => {
  const r = calcGoal(base)!;
  expect(r.bmrMethod).toBe('mifflin-st-jeor');
  expect(r.bmr).toBeCloseTo(1572.5, 5); // 680 + 1062.5 − 175 + 5
  expect(r.tdeeRest).toBeCloseTo(2162.1875, 5); // × 1.375
  expect(r.tdeeTraining).toBeCloseTo(2442.1875, 5); // + 280
  expect(r.policy).toBe('cut');
  expect(r.weeklyKg).toBeCloseTo(-0.34, 5); // 68kg の 0.5%
  expect(r.dailyDelta).toBeCloseTo((-0.34 * 7200) / 7, 5); // −349.7
  expect(r.proteinG).toBe(136);
  expect(r.floored).toBe(false);
  // 休み：1812.5 → 1810kcal、F 1810×25%÷9 = 50g、C (1810 − 136×4 − 50×9)÷4 = 204g
  expect(r.rest).toEqual({ kcal: 1810, fat_g: 50, carbs_g: 204 });
  // 筋トレ：2092.5 → 2090kcal、F 58g、C (2090 − 544 − 522)÷4 = 256g（炭水化物が多い）
  expect(r.training).toEqual({ kcal: 2090, fat_g: 58, carbs_g: 256 });
});

test('体脂肪率があれば Katch-McArdle（性別・年齢・身長は使わない）', () => {
  const r = calcGoal({ ...base, bodyFatPct: 15, heightCm: null, age: null, sex: null, activity: 'moderate', targetWeightKg: 68.5 })!;
  expect(r.bmrMethod).toBe('katch-mcardle');
  expect(r.bmr).toBeCloseTo(370 + 21.6 * 57.8, 5); // 除脂肪体重 57.8kg
  expect(r.policy).toBe('maintain');
  expect(r.rest.kcal).toBe(2510); // 1618.48 × 1.55 = 2508.6
  expect(r.training.kcal).toBe(2790);
});

test('体脂肪率がなく、身長・年齢・性別のどれかがなければ計算しない', () => {
  expect(calcGoal({ ...base, heightCm: null })).toBeNull();
  expect(basalMetabolism({ weightKg: 55, bodyFatPct: null, heightCm: 160, age: 30, sex: 'female' })!.bmr).toBeCloseTo(1239, 5);
});

test('方針の境目：目標体重との差が ±1% 以内なら維持。増量は週 0.25%', () => {
  expect(policyFor(70, null)).toEqual({ policy: 'maintain', weeklyKg: 0 });
  expect(policyFor(70, 70.7).policy).toBe('maintain'); // ちょうど 1%
  expect(policyFor(70, 69.3).policy).toBe('maintain');
  expect(policyFor(70, 70.8).policy).toBe('bulk');
  expect(policyFor(70, 69.2).policy).toBe('cut');
  expect(policyFor(70, 75).weeklyKg).toBeCloseTo(0.175, 5);
  const r = calcGoal({ ...base, weightKg: 70, targetWeightKg: 75 })!;
  expect(r.dailyDelta).toBeCloseTo(180, 5);
});

test('下限：目標のカロリーは基礎代謝を下回らない（10kcal 単位で切り上げる）', () => {
  const r = calcGoal({ weightKg: 50, bodyFatPct: null, heightCm: 155, age: 40, sex: 'female', activity: 'sedentary', targetWeightKg: 40 })!;
  expect(r.bmr).toBeCloseTo(1107.75, 5);
  expect(r.floored).toBe(true);
  expect(r.rest.kcal).toBe(1110); // 1329.3 − 257.1 = 1072 は BMR より下
  expect(r.training.kcal).toBe(1350); // こちらは下限より上
});

test('丸め：体重は 0.1kg、kcal は 10、g は 1 の単位', () => {
  const r = calcGoal({ ...base, weightKg: 68.26 })!;
  expect(r.bodyWeightKg).toBe(68.3);
  expect(r.proteinG).toBe(137); // 136.6
  for (const d of [r.rest, r.training]) {
    expect(d.kcal % 10).toBe(0);
    expect(Number.isInteger(d.fat_g) && Number.isInteger(d.carbs_g)).toBe(true);
  }
});

test('体重・体脂肪率は、いちばん新しい体重の日までの 7 日の平均。未来の日と古い体脂肪率は使わない', () => {
  const days = [
    { date: '2026-10-20', weightKg: 80, bodyFatPct: 25 }, // 範囲の外
    { date: '2026-11-02', weightKg: 69, bodyFatPct: null },
    { date: '2026-11-05', weightKg: 68, bodyFatPct: null },
    { date: '2026-11-07', weightKg: 67, bodyFatPct: null },
    { date: '2026-11-09', weightKg: 60, bodyFatPct: 10 }, // 今日より先
  ];
  expect(bodyBasis(days, '2026-11-08')).toEqual({
    weightKg: 68, weightFrom: '2026-11-02', weightTo: '2026-11-07', weightDays: 3, bodyFat: null,
  });
  const withFat = bodyBasis([...days, { date: '2026-11-06', weightKg: null, bodyFatPct: 16 }], '2026-11-08')!;
  expect(withFat.bodyFat).toEqual({ pct: 16, from: '2026-11-06', to: '2026-11-06', days: 1 });
  expect(bodyBasis([{ date: '2026-11-01', weightKg: null, bodyFatPct: 15 }], '2026-11-08')).toBeNull();
});

test('足りない入力：体脂肪率があれば、性別・生まれた年・身長は聞かない', () => {
  const basis = { weightKg: 68, weightFrom: '2026-11-08', weightTo: '2026-11-08', weightDays: 1, bodyFat: null };
  expect(missingInputs({ basis: null, heightCm: null, sex: null, birthYear: null, activity: null })).toEqual(['weight']);
  expect(missingInputs({ basis, heightCm: null, sex: null, birthYear: null, activity: null })).toEqual(['sex', 'birthYear', 'height', 'activity']);
  expect(missingInputs({ basis, heightCm: 170, sex: 'male', birthYear: 1990, activity: 'light' })).toEqual([]);
  const fat = { ...basis, bodyFat: { pct: 15, from: '2026-11-08', to: '2026-11-08', days: 1 } };
  expect(missingInputs({ basis: fat, heightCm: null, sex: null, birthYear: null, activity: null })).toEqual(['activity']);
});

test('生まれた年は 15〜100 歳の整数。空は消す', () => {
  expect(parseBirthYear('1990', 2026)).toEqual({ value: 1990 });
  expect(parseBirthYear('１９９０', 2026)).toEqual({ value: 1990 });
  expect(parseBirthYear('2012', 2026)).toEqual({ error: '生まれた年は 1926〜2011 の数字で入れてください' });
  expect('error' in parseBirthYear('1925', 2026)).toBe(true);
  expect('error' in parseBirthYear('1990.5', 2026)).toBe(true);
  expect(parseBirthYear(' ', 2026)).toEqual({ value: null });
});

test('体重が前回の自動計算から ±2% 以上変わったら知らせる', () => {
  expect(weightChanged(70, 71.4)).toBe(true); // ちょうど 2%
  expect(weightChanged(70, 68.6)).toBe(true);
  expect(weightChanged(70, 71.3)).toBe(false);
  expect(weightChanged(null, 70)).toBe(false);
  expect(weightChanged(70, null)).toBe(false);
});
