import {
  floatSum, GoalDraft, ItemDraft, mealTitle, parseGoal, parseItem, pfcRatio, templateNameError, weekDates,
} from '../meals';
import { uuid5 } from '../uuid5';

const draft = (d: Partial<ItemDraft> = {}): ItemDraft =>
  ({ name: '白米', amount: '150', unit: 'g', kcal: '234', protein_g: '3.8', fat_g: '0.5', carbs_g: '55.7', ...d });

describe('品目の入力', () => {
  test('よい入力。PFC の空欄は 0、全角や「,」の小数も受ける', () => {
    expect(parseItem(draft({ name: ' 白米 ', fat_g: '', carbs_g: '５５,７' }))).toEqual(
      { value: { name: '白米', amount: 150, unit: 'g', kcal: 234, protein_g: 3.8, fat_g: 0, carbs_g: 55.7 } });
  });

  test.each([
    [{ name: '  ' }, '品名を入れてください'],
    [{ name: 'あ'.repeat(201) }, '品名は200文字以内で入れてください'],
    [{ amount: '0' }, '量は0より大きい数で入れてください'],
    [{ amount: '' }, '量を数字で入れてください'],
    [{ amount: '100001' }, '量は 100,000 までで入れてください'],
    [{ kcal: '-1' }, 'エネルギーを数字で入れてください'],
    [{ kcal: '20001' }, 'エネルギーは 20,000 までで入れてください'],
    [{ protein_g: '5000.1' }, 'たんぱく質は 5,000 までで入れてください'],
    [{ carbs_g: 'abc' }, '炭水化物を数字で入れてください'],
  ])('%o → %s', (d, error) => {
    expect(parseItem(draft(d))).toEqual({ error });
  });

  test('品名の長さはコードポイントで数える（サーバーと同じ）', () => {
    expect('value' in parseItem(draft({ name: '🍙'.repeat(200) }))).toBe(true);
  });
});

const goalDraft = (d: Partial<GoalDraft> = {}): GoalDraft => ({
  policy: 'bulk', bodyWeight: '', proteinPerKg: '', targetWeight: '', eatingStyle: null,
  training: { kcal: '', fat_g: '', carbs_g: '' }, rest: { kcal: '', fat_g: '', carbs_g: '' }, ...d,
});

describe('目標の入力（MCP の set_goals と同じ）', () => {
  test('方針だけでよい', () => {
    expect(parseGoal(goalDraft({ policy: 'maintain' }))).toEqual({ value: {
      policy: 'maintain', body_weight_kg: null, protein_per_kg: null, targets: null, eating_style: null, target_weight_kg: null,
    } });
  });

  test('全部入れる', () => {
    expect(parseGoal(goalDraft({
      bodyWeight: '70', proteinPerKg: '2', targetWeight: '75', eatingStyle: 'home_cooked',
      training: { kcal: '2600', fat_g: '72', carbs_g: '340' }, rest: { kcal: '2200', fat_g: '61', carbs_g: '280' },
    }))).toEqual({ value: {
      policy: 'bulk', body_weight_kg: 70, protein_per_kg: 2, target_weight_kg: 75, eating_style: 'home_cooked',
      targets: { training_day: { kcal: 2600, fat_g: 72, carbs_g: 340 }, rest_day: { kcal: 2200, fat_g: 61, carbs_g: 280 } },
    } });
  });

  test.each([
    [{ bodyWeight: '0' }, '体重は 0 より大きく 300kg までで入れてください'],
    [{ proteinPerKg: '5.1' }, '体重1kgあたりのたんぱく質は 0 より大きく 5g までで入れてください'],
    [{ targetWeight: '29' }, '目標体重は 30〜300kg で入れてください'],
    [{ training: { kcal: '2600', fat_g: '', carbs_g: '' } }, '筋トレの日と休みの日の kcal・脂質・炭水化物は、全部入れるか、全部空にしてください'],
    [{ training: { kcal: '2600', fat_g: '72', carbs_g: '340' }, rest: { kcal: '20001', fat_g: '1', carbs_g: '1' } }, '休みの日のエネルギーは 20,000 までで入れてください'],
  ])('%o → %s', (d, error) => {
    expect(parseGoal(goalDraft(d as Partial<GoalDraft>))).toEqual({ error });
  });
});

test('いつものの名前', () => {
  expect(templateNameError(' ')).toBe('いつものの名前を入れてください');
  expect(templateNameError('あ'.repeat(101))).toBe('いつものの名前は100文字以内で入れてください');
  expect(templateNameError('朝の定番')).toBeNull();
});

test('PFC の割合（kcal）', () => {
  expect(pfcRatio({ protein_g: 25, fat_g: 0, carbs_g: 75 })).toEqual({ p: 25, f: 0, c: 75 });
  expect(pfcRatio({ protein_g: 0, fat_g: 0, carbs_g: 0 })).toBeNull();
  expect(pfcRatio({ protein_g: null, fat_g: 1, carbs_g: 1 })).toBeNull();
});

test('食事の名前は説明、なければ品目の名前', () => {
  const base = { id: 'm', date: '2026-11-08', slot: 'lunch' as const, time: null, source: 'text' as const, createdAt: '', basis: null };
  const items = [{ id: 'a', name: '白米', amount: 1, unit: 'g' as const, confidence: 'high' as const, kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
    { id: 'b', name: '味噌汁', amount: 1, unit: '杯' as const, confidence: 'high' as const, kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }];
  expect(mealTitle({ ...base, description: '', items })).toBe('白米、味噌汁');
  expect(mealTitle({ ...base, description: '定食', items })).toBe('定食');
});

test('7日（古い順）と、数の並びの合計（誤差を補う）', () => {
  expect(weekDates('2026-11-08')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  expect(floatSum([0.1, 0.2, 0.3])).toBe(0.6);
  expect(floatSum([1e100, 1, -1e100])).toBe(1);
});

test('UUID v5（RFC 9562 の例と同じ）', () => {
  // Python：uuid.uuid5(uuid.NAMESPACE_DNS, "www.example.com")
  expect(uuid5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
});
