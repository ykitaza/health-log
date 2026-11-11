import { addDays } from '../date';
import {
  growthScore, GrowthDay, growthSeries, Highlight, highlights, isTrainingCountMilestone, mealGoalReached, nextHighlight, pickSubtitles,
  playbackSeconds, prevHighlight, satellites,
} from '../growth';
import type { TrainingSetRow } from '../training';

// trained は、指定がなければ「負荷量があれば true」
const day = (date: string, p: Partial<GrowthDay> = {}): GrowthDay => ({
  date, trained: (p.volumeKg ?? 0) > 0, volumeKg: 0, mealRecorded: false, mealGoalReached: false, sleepMin: null, ...p,
});
const hl = (date: string, priority: number, text = date): Highlight => ({ date, kind: 'goalStreak', text, priority });

describe('mealGoalReached（食事の目標：カロリーとたんぱく質の両方が 90% 以上）', () => {
  const d = (kcal: number, protein: number, target: { kcal: number | null; protein_g: number | null } | null, n = 1) => ({
    meals: Array(n).fill({}) as never[],
    total: { kcal, protein_g: protein, fat_g: 0, carbs_g: 0 },
    target: target && { ...target, fat_g: null, carbs_g: null },
  });
  test('ちょうど 90% で届く。片方が足りなければ届かない', () => {
    expect(mealGoalReached(d(1800, 90, { kcal: 2000, protein_g: 100 }))).toBe(true);
    expect(mealGoalReached(d(1799, 90, { kcal: 2000, protein_g: 100 }))).toBe(false);
    expect(mealGoalReached(d(1800, 89, { kcal: 2000, protein_g: 100 }))).toBe(false);
  });
  test('記録なし・目標なし・片方の目標だけのときは届かない', () => {
    expect(mealGoalReached(d(2000, 100, { kcal: 2000, protein_g: 100 }, 0))).toBe(false);
    expect(mealGoalReached(d(2000, 100, null))).toBe(false);
    expect(mealGoalReached(d(2000, 100, { kcal: null, protein_g: 100 }))).toBe(false);
  });
});

describe('growthSeries', () => {
  test('記録が1つもなければ空。today より後の記録は見ない', () => {
    expect(growthSeries([], '2026-11-10')).toEqual([]);
    expect(growthSeries([day('2026-11-11', { volumeKg: 5 })], '2026-11-10')).toEqual([]);
  });
  test('最初の記録の日から today まで、記録のない日も埋める。休んでも値は減らない', () => {
    const s = growthSeries([
      day('2026-11-08', { volumeKg: 100, mealRecorded: true, mealGoalReached: true, sleepMin: 420 }),
      day('2026-11-10', { volumeKg: 50, mealRecorded: true, sleepMin: 419 }),
    ], '2026-11-11');
    expect(s).toEqual([
      { volumeKg: 100, foodDays: 1, sleepDays: 1, days: 1 },
      { volumeKg: 100, foodDays: 1, sleepDays: 1, days: 2 }, // 休んだ日
      { volumeKg: 150, foodDays: 1, sleepDays: 1, days: 3 }, // 目標に届かない食事、7時間未満の睡眠は数えない
      { volumeKg: 150, foodDays: 1, sleepDays: 1, days: 4 },
    ]);
  });
  test('食事は記録がなければ、届いた印があっても数えない。睡眠の記録がない日は数えない', () => {
    const s = growthSeries([day('2026-11-10', { mealRecorded: false, mealGoalReached: true, sleepMin: null })], '2026-11-10');
    expect(s).toEqual([{ volumeKg: 0, foodDays: 0, sleepDays: 0, days: 1 }]);
  });
});

describe('satellites', () => {
  test('記録がない日は3つとも none', () => {
    expect(satellites(null)).toEqual({ training: 'none', meal: 'none', sleep: 'none' });
    expect(satellites(day('2026-11-10'))).toEqual({ training: 'none', meal: 'none', sleep: 'none' });
  });
  test('筋トレはその日にセットがあれば bright（自重だけで負荷量 0 の日も）', () => {
    expect(satellites(day('x', { volumeKg: 1 })).training).toBe('bright');
    expect(satellites(day('x', { trained: true, volumeKg: 0 })).training).toBe('bright');
  });
  test('食事：記録なし none／届かない dim／届いた bright', () => {
    expect(satellites(day('x', { mealRecorded: true })).meal).toBe('dim');
    expect(satellites(day('x', { mealRecorded: true, mealGoalReached: true })).meal).toBe('bright');
  });
  test('睡眠：なし none／7時間未満 dim／7時間以上 bright', () => {
    expect(satellites(day('x', { sleepMin: 419 })).sleep).toBe('dim');
    expect(satellites(day('x', { sleepMin: 420 })).sleep).toBe('bright');
  });
});

describe('growthScore', () => {
  const today = '2026-11-11'; // 直近7日は 11/5〜11/11
  test('筋トレ：回数（目標が未設定なら3回）と、前の4週間の週平均に対する負荷量', () => {
    const days = [
      day('2026-10-20', { volumeKg: 4000 }), // 前の4週間（週平均 1000）
      day('2026-11-06', { volumeKg: 500 }),
      day('2026-11-08', { volumeKg: 500 }),
    ];
    // 回数 2/3 × 20 ＋ 負荷量 1000/1000 × 20
    expect(growthScore(days, today, null).training.points).toBeCloseTo(20 * (2 / 3) + 20, 6);
    expect(growthScore(days, today, 2).training.points).toBeCloseTo(40, 6);
    // 負荷量の割合は上限 1
    expect(growthScore([...days, day('2026-11-09', { volumeKg: 9000 })], today, 2).training.points).toBeCloseTo(40, 6);
  });
  test('自重だけで負荷量 0 の日も、筋トレの回数に入る', () => {
    const s = growthScore([day('2026-11-06', { trained: true })], today, 4);
    expect(s.training.points).toBeCloseTo(40 * (1 / 4), 6);
  });
  test('前の4週間に記録がなければ、負荷量の割合は回数の割合そのまま', () => {
    const s = growthScore([day('2026-11-06', { volumeKg: 500 })], today, 4);
    expect(s.training.points).toBeCloseTo(40 * (1 / 4), 6);
  });
  test('7日の窓は today を含み、today より後の日は含まない', () => {
    expect(growthScore([day('2026-11-12', { volumeKg: 500 })], today, 1).training.points).toBe(0);
    expect(growthScore([day('2026-11-05', { volumeKg: 500 })], today, 1).training.points).toBeCloseTo(40, 6);
    // 11/4 は窓の外（前の4週間に入る）。回数は 0
    const out = growthScore([day('2026-11-04', { volumeKg: 500 })], today, 1);
    expect(out.training.points).toBe(0);
  });
  test('食事：記録のある日のうち、目標に届いた日の割合。記録のない日は外す', () => {
    const days = [
      day('2026-11-06', { mealRecorded: true, mealGoalReached: true }),
      day('2026-11-07', { mealRecorded: true }),
      // 11/8〜11 は記録なし（0点にしない）
    ];
    expect(growthScore(days, today).meal.points).toBeCloseTo(15, 6);
  });
  test('睡眠：記録のある日の平均 ÷ 420分、上限 1', () => {
    expect(growthScore([day('2026-11-06', { sleepMin: 210 }), day('2026-11-07', { sleepMin: 420 })], today).sleep.points).toBeCloseTo(22.5, 6);
    expect(growthScore([day('2026-11-06', { sleepMin: 600 })], today).sleep.points).toBeCloseTo(30, 6);
  });
  test('食事・睡眠の記録がなければその柱は null。残りの柱を 100 点満点に換算する', () => {
    const s = growthScore([day('2026-11-06', { volumeKg: 500 })], today, 1);
    expect(s.meal.points).toBeNull();
    expect(s.sleep.points).toBeNull();
    expect(s.training.points).toBeCloseTo(40, 6);
    expect(s.total).toBe(100);
    const half = growthScore([day('2026-11-06', { volumeKg: 500, sleepMin: 210 })], today, 1);
    expect(half.meal.points).toBeNull();
    // 筋トレ 40/40、睡眠 15/30 → 55/70
    expect(half.total).toBe(Math.round((55 / 70) * 100));
  });
  test('満点は 100、記録が何もなければ 0', () => {
    const full = growthScore([day('2026-11-06', { volumeKg: 500, mealRecorded: true, mealGoalReached: true, sleepMin: 420 })], today, 1);
    expect(full.total).toBe(100);
    expect(full.training.max + full.meal.max + full.sleep.max).toBe(100);
    expect(growthScore([], today).total).toBe(0);
  });
  test('先週との差：7日前で終わる7日の合計との差。先週が計算できなければ null', () => {
    // 先週（10/29〜11/4）：食事が届かず 0点、今週：届いた 30点。柱は筋トレ（0点）と食事の2つ
    const days = [
      day('2026-10-30', { mealRecorded: true }),
      day('2026-11-06', { mealRecorded: true, mealGoalReached: true }),
    ];
    const s = growthScore(days, today);
    expect(s.total).toBe(Math.round((30 / 70) * 100));
    expect(s.diffFromLastWeek).toBe(s.total);
    // 最初の記録が先週の終わり（11/4）より後
    expect(growthScore([day('2026-11-06', { volumeKg: 1 })], today).diffFromLastWeek).toBeNull();
    expect(growthScore([], today).diffFromLastWeek).toBeNull();
  });
});

describe('playbackSeconds', () => {
  test('1x は 日数 × 0.5秒、最短 8秒・最長 20秒', () => {
    expect(playbackSeconds(20, 1)).toBe(10);
    expect(playbackSeconds(16, 1)).toBe(8); // 8秒ちょうど
    expect(playbackSeconds(15, 1)).toBe(8); // 7.5 → 8
    expect(playbackSeconds(1, 1)).toBe(8);
    expect(playbackSeconds(40, 1)).toBe(20); // 20秒ちょうど
    expect(playbackSeconds(41, 1)).toBe(20);
    expect(playbackSeconds(1000, 1)).toBe(20);
  });
  test('2x は半分、4x は4分の1（最短・最長は 1x で決めてから割る）', () => {
    expect(playbackSeconds(20, 2)).toBe(5);
    expect(playbackSeconds(20, 4)).toBe(2.5);
    expect(playbackSeconds(1000, 2)).toBe(10);
    expect(playbackSeconds(1000, 4)).toBe(5);
    expect(playbackSeconds(1, 4)).toBe(2);
  });
});

describe('pickSubtitles', () => {
  // 41日 → 1x は 20秒。1日あたり 0.5秒、3秒は 6日ぶん
  const start = '2026-01-01';
  const at = (n: number) => addDays(start, n);
  test('同じ3秒に重なったら、優先度の高いものを出す', () => {
    const { subtitles } = pickSubtitles([hl(at(1), 1), hl(at(2), 5), hl(at(3), 3)], 41, 1, start);
    expect(subtitles.map((s) => s.date)).toEqual([at(2)]);
  });
  test('優先度が同じなら早い日。3秒をまたげば別々に出る', () => {
    expect(pickSubtitles([hl(at(2), 3), hl(at(1), 3)], 41, 1, start).subtitles.map((s) => s.date)).toEqual([at(1)]);
    // 日 5 は 2.5秒、日 6 は 3.0秒 → 別の枠
    expect(pickSubtitles([hl(at(5), 1), hl(at(6), 1)], 41, 1, start).subtitles).toHaveLength(2);
  });
  test('2x は再生が短くなるので、枠あたりの日数が倍になる', () => {
    // 2x は 10秒で、1日 0.25秒。日 11 は 2.75秒（枠 0）、日 12 は 3.0秒（枠 1）
    expect(pickSubtitles([hl(at(10), 1), hl(at(11), 2)], 41, 2, start).subtitles.map((s) => s.date)).toEqual([at(11)]);
    expect(pickSubtitles([hl(at(11), 1), hl(at(12), 1)], 41, 2, start).subtitles).toHaveLength(2);
  });
  test('4x は字幕を1つも出さず、つまみの点の日付だけ返す（範囲外は外す。重複なし、古い順）', () => {
    const r = pickSubtitles([hl(at(30), 1), hl(at(30), 4), hl(at(5), 2), hl(at(41), 5), hl(addDays(start, -1), 5)], 41, 4, start);
    expect(r.subtitles).toEqual([]);
    expect(r.markDates).toEqual([at(5), at(30)]);
  });
  test('字幕のときも markDates を返す', () => {
    expect(pickSubtitles([hl(at(3), 1)], 41, 1, start).markDates).toEqual([at(3)]);
  });
});

describe('prevHighlight / nextHighlight', () => {
  const list = [hl('2026-03-01', 1), hl('2026-02-01', 1), hl('2026-04-01', 1)];
  test('その日より前・後のいちばん近い日。その日自身は含まない。なければ null', () => {
    expect(prevHighlight(list, '2026-03-01')).toBe('2026-02-01');
    expect(nextHighlight(list, '2026-03-01')).toBe('2026-04-01');
    expect(prevHighlight(list, '2026-02-01')).toBeNull();
    expect(nextHighlight(list, '2026-04-01')).toBeNull();
    expect(nextHighlight([], '2026-04-01')).toBeNull();
  });
});

describe('highlights', () => {
  const set = (date: string, exerciseId: string, weightKg: number, reps: number): TrainingSetRow => ({ date, exerciseId, bodyPartId: 'p', weightKg, reps });
  const base = {
    today: '2026-12-31', days: [] as GrowthDay[], sets: [] as TrainingSetRow[],
    exerciseNames: new Map([['bench', 'ベンチプレス'], ['squat', 'スクワット'], ['dl', 'デッドリフト']]),
    big3: { bench: 'bench', squat: 'squat', deadlift: 'dl' }, weights: [] as { date: string; weightKg: number }[],
    goalWeightKg: null as number | null, weeklyGoals: { trainingDays: 2, mealDays: 3, sleepDays: 0 },
  };

  test('筋トレの回数の節目：10・25・50・100、以後100ごと', () => {
    expect([9, 10, 25, 50, 75, 100, 150, 200].filter(isTrainingCountMilestone)).toEqual([10, 25, 50, 100, 200]);
    const sets = Array.from({ length: 25 }, (_, i) => set(addDays('2026-01-01', i), 'x', 20, 5));
    const r = highlights({ ...base, sets }).filter((h) => h.kind === 'trainingCount');
    expect(r.map((h) => [h.date, h.text])).toEqual([['2026-01-10', '筋トレ 10回目'], ['2026-01-25', '筋トレ 25回目']]);
  });

  test('自己ベスト：前に記録がある種目で、推定1RM を超えた日。同じ値や初回は出さない', () => {
    const sets = [set('2026-01-01', 'bench', 80, 1), set('2026-01-03', 'bench', 80, 1), set('2026-01-05', 'bench', 82.5, 1)];
    const r = highlights({ ...base, sets }).filter((h) => h.kind === 'personalBest');
    expect(r).toEqual([{ date: '2026-01-05', kind: 'personalBest', text: 'ベンチプレス 自己ベスト 82.5 kg', priority: 2 }]);
  });

  test('BIG3 合計：記録がある種目だけの合計が、50kg の節目を超えた日。種目が増えて飛び越えたら、いちばん高い節目だけ', () => {
    const sets = [
      set('2026-01-01', 'bench', 60, 1), set('2026-01-01', 'squat', 80, 1), // 2種目で合計 140 → 100 を超えた
      set('2026-01-02', 'dl', 100, 1), // デッドリフトが入って合計 240 → 150 を飛び越えて 200 を超えた
      set('2026-01-09', 'bench', 70, 1), // 合計 250
    ];
    const r = highlights({ ...base, sets }).filter((h) => h.kind === 'big3Total');
    expect(r.map((h) => [h.date, h.text, h.priority])).toEqual([
      ['2026-01-01', 'BIG3 合計 100.0 kg 突破', 4], ['2026-01-02', 'BIG3 合計 200.0 kg 突破', 4], ['2026-01-09', 'BIG3 合計 250.0 kg 突破', 4],
    ]);
  });

  test('目標体重：最初の体重から目標の向きに、はじめて届いた日', () => {
    const weights = [{ date: '2026-01-01', weightKg: 80 }, { date: '2026-02-01', weightKg: 74 }, { date: '2026-03-01', weightKg: 70 }, { date: '2026-04-01', weightKg: 69 }];
    const r = highlights({ ...base, weights, goalWeightKg: 70 }).filter((h) => h.kind === 'goalWeight');
    expect(r).toEqual([{ date: '2026-03-01', kind: 'goalWeight', text: '目標体重 70.0 kg に到達', priority: 5 }]);
    // 増やす目標
    expect(highlights({ ...base, weights: [{ date: '2026-01-01', weightKg: 60 }, { date: '2026-02-01', weightKg: 65 }], goalWeightKg: 65 })[0].date).toBe('2026-02-01');
    expect(highlights({ ...base, weights, goalWeightKg: null })).toEqual([]);
  });

  test('目標の連続達成：週の終わりに連続が2週になった日', () => {
    // 週の目標：筋トレ2日・食事3日（睡眠は切）。11/2（月）の週と 11/9 の週を達成
    const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-09', '2026-11-10', '2026-11-11'];
    const days = dates.map((d) => day(d, { volumeKg: 100, mealRecorded: true }));
    const sets = dates.map((d) => set(d, 'x', 20, 5));
    const r = highlights({ ...base, today: '2026-11-15', days, sets }).filter((h) => h.kind === 'goalStreak');
    expect(r).toEqual([{ date: '2026-11-15', kind: 'goalStreak', text: '2週連続で目標達成', priority: 1 }]);
  });

  test('日付の古い順', () => {
    const sets = [
      ...Array.from({ length: 10 }, (_, i) => set(addDays('2026-01-01', i), 'bench', 80, 1)),
      set('2026-01-11', 'bench', 85, 1),
    ];
    const r = highlights({ ...base, sets });
    // 1種目でも記録があれば、合計の節目（80kg → 50）が最初の日に出る
    expect(r.map((h) => [h.date, h.kind])).toEqual([['2026-01-01', 'big3Total'], ['2026-01-10', 'trainingCount'], ['2026-01-11', 'personalBest']]);
  });
});
