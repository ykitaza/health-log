import {
  goalA11yLabel, goalLine, goalRatio, goalStreakText, HOME_BIG3_MONTHS, homeBig3, mealRecordTarget, previousTodo, shouldCelebrate, signedChange, weeklyGoalCardLabel, sleepNote, thisWeekVolume, todoAllDone, todoCount, todoWeeks, toggleTodo, weekRangeLabel, weeklyTodo,
} from '../home';
import { big3Trend, TrainingSetRow } from '../training';

const setRow = (date: string, exerciseId: string, weightKg: number | null, reps: number): TrainingSetRow =>
  ({ date, exerciseId, bodyPartId: 'p', weightKg, reps });

describe('合計負荷量／今週（月曜始まり）', () => {
  const rows = [
    setRow('2026-11-08', 'bench', 100, 10), // 1000（今日・日曜）
    setRow('2026-11-02', 'bench', 100, 5), //  500（今週の月曜）
    setRow('2026-11-01', 'bench', 100, 3), //  300（前の週の日曜。7日間には入るが今週ではない）
    setRow('2026-11-09', 'bench', 100, 100), // 未来は数えない
    setRow('2026-11-05', 'chin', null, 10), // 回数だけ（体重がなければ 0）
  ];
  test('月曜から今日まで', () => {
    expect(thisWeekVolume(rows, '2026-11-08')).toBe(1500);
  });
  test('今日が月曜なら、その日だけ', () => {
    expect(thisWeekVolume(rows, '2026-11-02')).toBe(500);
    expect(thisWeekVolume([], '2026-11-02')).toBe(0);
  });
});

describe('ホームの BIG3 推定1RM 合計', () => {
  const today = '2026-11-08';
  const assigned = { bench: 'bench', squat: 'squat', deadlift: 'dl' };
  const rows = [
    setRow('2026-07-01', 'dl', 120, 5), // 140
    setRow('2026-09-01', 'bench', 80, 8), // 101.33…
    setRow('2026-09-10', 'squat', 100, 5), // 116.67…
    setRow('2026-11-06', 'squat', 110, 5), // 128.33…（1か月前より伸びた）
  ];

  test('筋トレの推移のグラフと同じ計算（big3Trend の3か月）', () => {
    const b = homeBig3(rows, assigned, today)!;
    const t = big3Trend(rows, assigned, today, '2026-08-08');
    expect(HOME_BIG3_MONTHS).toBe(3);
    expect(b.from).toBe('2026-08-08');
    expect(b.totalKg).toBe(t.total);
    expect(b.diffKg).toBeCloseTo(t.total! - t.totalMonthAgo!, 6);
    expect(b.diffKg).toBeCloseTo(10 * (1 + 5 / 30), 6);
    expect(b.points).toEqual(t.points);
  });

  test('1か月前にそろっていなければ、差は null', () => {
    const b = homeBig3(rows.filter((r) => r.date !== '2026-09-10'), assigned, today)!;
    expect(b.totalKg).toBeCloseTo(140 + 80 * (1 + 8 / 30) + 110 * (1 + 5 / 30), 6);
    expect(b.diffKg).toBeNull();
  });

  test('割り当てがない・記録がそろわないときは null（「—」を出す）', () => {
    expect(homeBig3(rows, {}, today)).toBeNull();
    expect(homeBig3(rows.filter((r) => r.exerciseId !== 'dl'), assigned, today)).toBeNull();
    expect(homeBig3([], assigned, today)).toBeNull();
  });

  test('先月との差の向きと文字', () => {
    expect(signedChange(7.5)).toEqual({ dir: 'up', text: '+7.5' });
    expect(signedChange(-2.46)).toEqual({ dir: 'down', text: '−2.5' });
    expect(signedChange(0.04)).toEqual({ dir: 'flat', text: '±0' });
    expect(signedChange(-0.04)).toEqual({ dir: 'flat', text: '±0' });
  });
});

describe('今日の体調の2行目（目標体重まで）', () => {
  test('目標と体重があるときだけ。届いていれば届いたと出す。lb の表示', () => {
    expect(goalLine(68.4, 65, 'kg')).toBe('目標まで あと 3.4 kg');
    expect(goalLine(60, 62.5, 'kg')).toBe('目標まで あと 2.5 kg');
    expect(goalLine(65, 65, 'kg')).toBe('目標に届きました');
    expect(goalLine(70, 65, 'lb')).toBe('目標まで あと 11.0 lb');
    expect(goalLine(null, 65, 'kg')).toBeNull();
    expect(goalLine(68, null, 'kg')).toBeNull();
  });
});

describe('寝不足の日のひとこと', () => {
  test('6時間未満のときだけ', () => {
    expect(sleepNote(320)).toBe('睡眠 5時間20分。今日は軽めでも大丈夫');
    expect(sleepNote(359)).toBe('睡眠 5時間59分。今日は軽めでも大丈夫');
    expect(sleepNote(360)).toBeNull();
    expect(sleepNote(null)).toBeNull();
    expect(sleepNote(undefined)).toBeNull();
  });
});

describe('今週の目標の棒と読み上げ', () => {
  test('届いたら満たす。目標がなければ 0', () => {
    expect(goalRatio({ days: 2, goal: 3, reached: false })).toBeCloseTo(2 / 3);
    expect(goalRatio({ days: 4, goal: 3, reached: true })).toBe(1);
    expect(goalRatio({ days: 0, goal: 5, reached: false })).toBe(0);
    expect(goalRatio({ days: 2, goal: null, reached: false })).toBe(0);
  });

  test('達成も言葉で伝える', () => {
    expect(goalA11yLabel('筋トレ', '回', { days: 2, goal: 3, reached: false })).toBe('筋トレ 2回、目標 3回');
    expect(goalA11yLabel('食事の記録', '日', { days: 6, goal: 5, reached: true })).toBe('食事の記録 6日、目標 5日、達成');
  });
});

describe('今週やること', () => {
  // 今日は 2026-11-10（火）。今週は 11/9〜11/15、先週は 11/2〜11/8
  const TODAY = '2026-11-10';
  const r = (id: string, kind: 'daily' | 'weekly' | 'monthly', periodEnd: string | null, nextSteps: string[], periodStart: string | null = null,
    nextStepsDone: number[] = []) => ({ id, kind, periodStart, periodEnd, nextSteps, nextStepsDone });

  test('いちばん新しい、今週か先週の週のまとめの次の一歩', () => {
    expect(weeklyTodo([
      r('d1', 'daily', '2026-11-10', ['寝る']),
      r('w2', 'weekly', '2026-11-08', ['脚の日を2回入れる', 'たんぱく質を毎日 120g とる']),
      r('w1', 'weekly', '2026-11-01', ['古い']),
    ], TODAY)).toEqual({ reportId: 'w2', steps: ['脚の日を2回入れる', 'たんぱく質を毎日 120g とる'], done: [] });
    // 済んだ番号はレポートのもの（同期でサーバーにも届く）
    expect(weeklyTodo([r('w', 'weekly', '2026-11-08', ['a', 'b'], null, [1])], TODAY)?.done).toEqual([1]);
    // 先週の月曜に終わる期間も入る。期間の終わりがなければ始まりで見る
    expect(weeklyTodo([r('w', 'weekly', '2026-11-02', ['a'])], TODAY)?.reportId).toBe('w');
    expect(weeklyTodo([r('w', 'weekly', null, ['a'], '2026-11-09')], TODAY)?.reportId).toBe('w');
  });

  test('週のまとめがない・古い・次の一歩がないときは出さない', () => {
    expect(weeklyTodo([], TODAY)).toBeNull();
    expect(weeklyTodo([r('m', 'monthly', '2026-11-08', ['a'])], TODAY)).toBeNull();
    expect(weeklyTodo([r('w', 'weekly', '2026-11-01', ['a'])], TODAY)).toBeNull();
    expect(weeklyTodo([r('w', 'weekly', null, ['a'])], TODAY)).toBeNull();
    // いちばん新しい週のまとめに次の一歩がなければ、前のものに戻らない
    expect(weeklyTodo([r('w2', 'weekly', '2026-11-09', []), r('w1', 'weekly', '2026-11-08', ['a'])], TODAY)).toBeNull();
  });

  test('済んだ数と、全部できたか', () => {
    expect(todoCount(['a', 'b', 'c'], [0, 2])).toBe(2);
    expect(todoCount(['a'], [0, 3])).toBe(1);
    expect(todoAllDone(['a', 'b'], [0, 1])).toBe(true);
    expect(todoAllDone(['a', 'b'], [1])).toBe(false);
    expect(todoAllDone([], [])).toBe(false);
  });

  test('週の見出し（月曜から7日）', () => {
    expect(weekRangeLabel('2026-11-09')).toBe('11月9日〜15日');
    expect(weekRangeLabel('2026-11-30')).toBe('11月30日〜12月6日');
  });

  test('レポートのタブのやること：やることの週（まとめの期間の次の週）の新しい順。同じ週は新しいまとめだけ、次の一歩がない週は出さない', () => {
    const weeks = todoWeeks([
      r('d1', 'daily', '2026-11-10', ['寝る']),
      r('w1', 'weekly', '2026-11-01', ['ベンチ'], '2026-10-26', [0]),
      // 作った順と期間の順が違っても、やることの週の新しい順
      r('w3', 'weekly', '2026-11-08', ['脚の日', '水'], '2026-11-02', [1]),
      r('w3old', 'weekly', '2026-11-08', ['古いほう']),
      r('w0', 'weekly', '2026-10-25', []),
      r('wn', 'weekly', null, ['a'], '2026-10-12'),
      r('none', 'weekly', null, ['a']),
      r('m', 'monthly', '2026-10-31', ['月']),
    ]);
    expect(weeks).toEqual([
      { reportId: 'w3', start: '2026-11-09', steps: ['脚の日', '水'], done: [1] },
      { reportId: 'w1', start: '2026-11-02', steps: ['ベンチ'], done: [0] },
      { reportId: 'wn', start: '2026-10-19', steps: ['a'], done: [] },
    ]);
    // 同じ週の新しいまとめに次の一歩がなければ、前のまとめに戻らない
    expect(todoWeeks([r('w2', 'weekly', '2026-11-08', []), r('w1', 'weekly', '2026-11-08', ['a'])])).toEqual([]);
  });

  test('週のまとめの「先週やることの振り返り」：そのまとめの週にやることだった、前の週のまとめの次の一歩', () => {
    const reports = [
      r('w2', 'weekly', '2026-11-08', ['脚の日'], '2026-11-02'),
      r('w1', 'weekly', '2026-11-01', ['ベンチ', '水'], '2026-10-26', [0, 1]),
    ];
    expect(previousTodo(reports, { kind: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-08' }))
      .toEqual({ reportId: 'w1', start: '2026-11-02', steps: ['ベンチ', '水'], done: [0, 1] });
    // 前の週のまとめがない・日や月のまとめ・期間がないときは出さない
    expect(previousTodo(reports, { kind: 'weekly', periodStart: '2026-10-26', periodEnd: '2026-11-01' })).toBeNull();
    expect(previousTodo(reports, { kind: 'daily', periodStart: '2026-11-05', periodEnd: '2026-11-05' })).toBeNull();
    expect(previousTodo(reports, { kind: 'weekly', periodStart: null, periodEnd: null })).toBeNull();
  });

  test('切り替え', () => {
    expect(toggleTodo([], 1)).toEqual([1]);
    expect(toggleTodo([2], 0)).toEqual([0, 2]);
    expect(toggleTodo([0, 2], 2)).toEqual([0]);
  });
});

describe('「記録する」の食事の行', () => {
  test('今日は時刻から区分を決める。過去の日は区分を選ぶ所へ', () => {
    expect(mealRecordTarget('2026-11-08', '2026-11-08', 19)).toEqual({ slot: 'dinner', text: '夕食として記録します（時刻から）' });
    expect(mealRecordTarget('2026-11-08', '2026-11-08', 7)).toEqual({ slot: 'breakfast', text: '朝食として記録します（時刻から）' });
    expect(mealRecordTarget('2026-11-03', '2026-11-08', 19)).toEqual({ slot: null, text: '区分を選んで記録します' });
  });
});

describe('今週の目標の連続と、達成のチェックを動かすか', () => {
  test('今週を含む・含まない。0 なら出さない', () => {
    expect(goalStreakText({ weeks: 3, thisWeek: true })).toBe('3週連続で達成');
    expect(goalStreakText({ weeks: 2, thisWeek: false })).toBe('先週まで 2週連続で達成');
    expect(goalStreakText({ weeks: 0, thisWeek: false })).toBeNull();
  });
  test('カード全体の読み上げ：達成・各行・連続と、押すと設定で変えられること', () => {
    expect(weeklyGoalCardLabel(true, ['筋トレ 2回、目標 2回、達成', '食事の記録 3日、目標 3日、達成'], '3週連続で達成'))
      .toBe('今週の目標をすべて達成。筋トレ 2回、目標 2回、達成。食事の記録 3日、目標 3日、達成。3週連続で達成。押すと設定で変えられます');
    expect(weeklyGoalCardLabel(false, ['筋トレ 1回、目標 3回'], null)).toBe('今週の目標。筋トレ 1回、目標 3回。押すと設定で変えられます');
  });
  test('その週で初めて達成を見たときだけ動かす', () => {
    expect(shouldCelebrate(true, '2026-11-09', null)).toBe(true);
    expect(shouldCelebrate(true, '2026-11-09', '2026-11-02')).toBe(true); // 先週に動かした
    expect(shouldCelebrate(true, '2026-11-09', '2026-11-09')).toBe(false); // 同じ週の2回目
    expect(shouldCelebrate(false, '2026-11-09', null)).toBe(false);
  });
});
