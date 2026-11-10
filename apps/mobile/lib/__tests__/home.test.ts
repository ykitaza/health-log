import { goalA11yLabel, goalLine, goalRatio, mealRecordTarget, readTodoChecks, sleepNote, toggleTodo, weeklyTodo } from '../home';

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
  const r = (id: string, kind: 'daily' | 'weekly' | 'monthly', periodEnd: string | null, nextSteps: string[], periodStart: string | null = null) =>
    ({ id, kind, periodStart, periodEnd, nextSteps });

  test('いちばん新しい、今週か先週の週のまとめの次の一歩', () => {
    expect(weeklyTodo([
      r('d1', 'daily', '2026-11-10', ['寝る']),
      r('w2', 'weekly', '2026-11-08', ['脚の日を2回入れる', 'たんぱく質を毎日 120g とる']),
      r('w1', 'weekly', '2026-11-01', ['古い']),
    ], TODAY)).toEqual({ reportId: 'w2', steps: ['脚の日を2回入れる', 'たんぱく質を毎日 120g とる'] });
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

  test('チェックは同じレポートの分だけ読む。壊れた値は空', () => {
    expect(readTodoChecks(JSON.stringify({ reportId: 'w2', done: [0, 2] }), 'w2')).toEqual([0, 2]);
    expect(readTodoChecks(JSON.stringify({ reportId: 'w1', done: [0] }), 'w2')).toEqual([]);
    expect(readTodoChecks(JSON.stringify({ reportId: 'w2', done: [0, -1, 1.5, 'x'] }), 'w2')).toEqual([0]);
    expect(readTodoChecks('{', 'w2')).toEqual([]);
    expect(readTodoChecks(null, 'w2')).toEqual([]);
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
