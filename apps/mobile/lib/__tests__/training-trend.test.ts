import { openFormVideo } from '../exercises';
import { big3Trend, dayCardSummary, menuFromDay, summarizeSets, TrainingSetRow, trendDays } from '../training';

const row = (date: string, exerciseId: string, weightKg: number | null, reps: number): TrainingSetRow =>
  ({ date, exerciseId, bodyPartId: 'p', weightKg, reps });

describe('推移の記録のカード', () => {
  test('セットの要約：同じ重さが続くと回数をつなぐ。回数だけは「回」。lb でも出せる', () => {
    expect(summarizeSets([{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 75, reps: 10 }], 'kg')).toBe('80.0 kg × 8・8　75.0 kg × 10');
    expect(summarizeSets([{ weightKg: 80, reps: 8 }, { weightKg: 75, reps: 10 }, { weightKg: 80, reps: 6 }], 'kg')).toBe('80.0 kg × 8　75.0 kg × 10　80.0 kg × 6');
    expect(summarizeSets([{ weightKg: null, reps: 10 }, { weightKg: null, reps: 8 }], 'kg')).toBe('10・8 回');
    expect(summarizeSets([{ weightKg: 100, reps: 5 }], 'lb')).toBe('220.5 lb × 5');
    expect(summarizeSets([], 'kg')).toBe('');
  });

  test('出す日は新しい順。種目を選ぶと、その種目をした日だけ', () => {
    const rows = [row('2026-11-02', 'bench', 80, 8), row('2026-11-06', 'squat', 100, 5), row('2026-11-06', 'bench', 80, 8), row('2026-11-04', 'squat', 90, 5)];
    expect(trendDays(rows, null)).toEqual(['2026-11-06', '2026-11-04', '2026-11-02']);
    expect(trendDays(rows, 'bench')).toEqual(['2026-11-06', '2026-11-02']);
    expect(trendDays(rows, 'deadlift')).toEqual([]);
  });

  test('日のカードの見出し：部位（重なりなし）とその日の合計負荷量', () => {
    expect(dayCardSummary([
      { bodyPartName: '胸', sets: [{ weightKg: 80, reps: 8 }, { weightKg: 75, reps: 10 }] },
      { bodyPartName: '胸', sets: [{ weightKg: 26, reps: 10 }] },
      { bodyPartName: '背中', sets: [{ weightKg: null, reps: 10, bodyweightLoadKg: null }] },
    ])).toEqual({ parts: ['胸', '背中'], volume: 640 + 750 + 260 });
  });
});

test('前回のメニュー：重さと回数だけを未完了で写す（メモと完了は写さない）。セットのない種目は写さない', () => {
  expect(menuFromDay([
    { exerciseId: 'bench', sets: [{ weightKg: 80, reps: 8, memo: 'きつい', done: true } as never, { weightKg: 75, reps: 10 }] },
    { exerciseId: 'empty', sets: [] },
    { exerciseId: 'pullup', sets: [{ weightKg: null, reps: 10 }] },
  ])).toEqual([
    { exerciseId: 'bench', sets: [{ weightKg: 80, reps: 8, memo: '', done: false }, { weightKg: 75, reps: 10, memo: '', done: false }] },
    { exerciseId: 'pullup', sets: [{ weightKg: null, reps: 10, memo: '', done: false }] },
  ]);
});

describe('BIG3 の推定1RM の合計', () => {
  const today = '2026-11-08';
  const from = '2026-08-08';
  const assigned = { bench: 'bench', squat: 'squat', deadlift: 'dl' };
  // 推定1RM：80×8 = 101.33…、100×5 = 116.67…、120×5 = 140、1回はそのまま
  const rows = [
    row('2026-07-01', 'dl', 120, 5), // 範囲より前でも「その日までの最高」に入る
    row('2026-09-01', 'bench', 80, 8),
    row('2026-09-10', 'squat', 100, 5),
    row('2026-10-20', 'bench', 75, 10), // 前より低い（最高は変わらない）
    row('2026-11-05', 'bench', 100, 1),
    row('2026-11-05', 'squat', null, 20), // 推定1RM の出ないセットは入れない
    row('2026-11-06', 'squat', 110, 5), // 1か月前より伸びた
    row('2026-11-09', 'dl', 200, 1), // 今日より後は入れない
  ];

  test('今の合計、1か月前の合計、3種目それぞれの値', () => {
    const t = big3Trend(rows, assigned, today, from);
    expect(t.unassigned).toEqual([]);
    expect(t.noRecord).toEqual([]);
    expect(t.total).toBeCloseTo(80 * (1 + 8 / 30) + 110 * (1 + 5 / 30) + 140, 6); // ベンチは 80×8（101.3）が 100×1 より大きい
    expect(t.totalMonthAgo).toBeCloseTo(80 * (1 + 8 / 30) + 100 * (1 + 5 / 30) + 140, 6); // 10/8 まで
    expect(t.lifts.map((l) => [l.role, l.exerciseId])).toEqual([['bench', 'bench'], ['squat', 'squat'], ['deadlift', 'dl']]);
    expect(t.lifts[1].current! - t.lifts[1].monthAgo!).toBeCloseTo(10 * (1 + 5 / 30), 6);
    expect(t.lifts[0].current).toBeCloseTo(80 * (1 + 8 / 30), 6); // 100×1 = 100 より 80×8 のほうが大きい
  });

  test('折れ線：3種目がそろった日から。記録のあった日と今日', () => {
    const t = big3Trend(rows, assigned, today, from);
    expect(t.points.map((p) => p.date)).toEqual(['2026-09-10', '2026-10-20', '2026-11-05', '2026-11-06', '2026-11-08']);
    expect(t.points[0].total).toBeCloseTo(80 * (1 + 8 / 30) + 100 * (1 + 5 / 30) + 140, 6);
  });

  test('そろわないとき：割り当てていない役と、記録がない役。合計は出さない', () => {
    const t = big3Trend(rows.filter((r) => r.exerciseId !== 'squat'), { bench: 'bench', squat: 'squat' }, today, from);
    expect(t.unassigned).toEqual(['deadlift']);
    expect(t.noRecord).toEqual(['squat']);
    expect(t.total).toBeNull();
    expect(t.totalMonthAgo).toBeNull();
    expect(t.points).toEqual([]);
    expect(t.lifts[0].current).toBeCloseTo(80 * (1 + 8 / 30), 6);
    expect(t.lifts[2]).toEqual({ role: 'deadlift', exerciseId: null, current: null, monthAgo: null });
  });
});

test('フォームの動画：開けたら true、開けなかったら false', async () => {
  const opened: string[] = [];
  expect(await openFormVideo('https://youtu.be/abc', async (u) => { opened.push(u); })).toBe(true);
  expect(opened).toEqual(['https://youtu.be/abc']);
  expect(await openFormVideo('https://youtu.be/abc', async () => { throw new Error('no app'); })).toBe(false);
});
