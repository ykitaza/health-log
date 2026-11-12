import type { GrowthDay, GrowthScore } from '../growth';
import {
  big3Range, goalLine, HOME_BIG3_MONTHS, homeBig3, homeGrowth, mealRecordTarget, previousTodo, scoreA11yLabel, scoreDiff,
  scoreDiffSpoken, scorePillars, scoreTotalText, signedChange, sleepNote, thisWeekVolume, todoAllDone,
  todoCount, todoWeeks, toggleTodo, weekRangeLabel, weeklyTodo,
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

  test('筋トレの推移のグラフと同じ計算（記録が1か月を超えるなら big3Trend の3か月）', () => {
    const b = homeBig3(rows, assigned, today)!;
    const t = big3Trend(rows, assigned, today, '2026-08-08');
    expect(HOME_BIG3_MONTHS).toBe(3);
    expect(b.from).toBe('2026-08-08');
    expect(b.diffText).toBe('先月より');
    expect(b.note).toBeNull();
    expect(b.totalKg).toBe(t.total);
    expect(b.diffKg).toBeCloseTo(t.total! - t.totalMonthAgo!, 6);
    expect(b.diffKg).toBeCloseTo(10 * (1 + 5 / 30), 6);
    expect(b.points).toEqual(t.points);
  });

  test('2種目だけのとき：その合計と添え書き。欠けた種目は 0 として、差も同じ', () => {
    const b = homeBig3(rows.filter((r) => r.exerciseId !== 'dl'), assigned, today)!;
    expect(b.totalKg).toBeCloseTo(80 * (1 + 8 / 30) + 110 * (1 + 5 / 30), 6);
    expect(b.diffKg).toBeCloseTo(10 * (1 + 5 / 30), 6);
    expect(b.note).toBe('2種目の合計（デッドリフトはまだ）');
    expect(homeBig3(rows.filter((r) => r.exerciseId === 'squat'), { squat: 'squat' }, today)!.note).toBe('1種目の合計（ベンチプレス・デッドリフトはまだ）');
  });

  test('基準の日は最初の記録の日より後なので、その日までの合計が基準になる（記録が1日だけなら差は 0）', () => {
    const b = homeBig3([setRow('2026-10-20', 'bench', 100, 5)], assigned, today)!; // 19日前に始めた（15日〜1か月）→ 7日前（11/1）との差
    expect(b.diffKg).toBe(0);
    expect(b.diffText).toBe('先週より');
    expect(b.noDiffText).toBe('先週の記録なし');
  });

  test('記録が1つもないときは null（「—」を出す）', () => {
    expect(homeBig3(rows, {}, today)).toBeNull();
    expect(homeBig3([], assigned, today)).toBeNull();
    expect(homeBig3([setRow('2026-11-09', 'bench', 100, 5)], assigned, today)).toBeNull();
  });

  test('始めて7日以内：7日の幅。最初の記録の日との差（始めた日より）', () => {
    const b = homeBig3([setRow('2026-11-05', 'bench', 100, 5), setRow('2026-11-07', 'bench', 110, 5)], assigned, today)!;
    expect(b.from).toBe('2026-11-01');
    expect(b.diffText).toBe('始めた日より');
    expect(b.diffKg).toBeCloseTo(10 * (1 + 5 / 30), 6);
    expect(b.points.map((p) => p.date)).toEqual(['2026-11-05', '2026-11-07', '2026-11-08']);
  });

  test('始めた日だけ記録：差は ±0', () => {
    const b = homeBig3([setRow('2026-11-08', 'bench', 100, 5)], assigned, today)!;
    expect(b.diffKg).toBe(0);
    expect(b.from).toBe('2026-11-01');
  });

  test('幅の段階の境目：7日・14日・1か月・1か月を超える', () => {
    const r = (first: string) => big3Range(first, today);
    // 7日以内
    expect(r('2026-11-08')).toMatchObject({ from: '2026-11-01', base: '2026-11-08', diffText: '始めた日より' });
    expect(r('2026-11-01')).toMatchObject({ from: '2026-11-01', base: '2026-11-01', diffText: '始めた日より' }); // ちょうど7日
    // 8日〜14日
    expect(r('2026-10-31')).toMatchObject({ from: '2026-10-25', base: '2026-11-01', diffText: '先週より', noDiffText: '先週の記録なし' }); // 8日
    expect(r('2026-10-25')).toMatchObject({ from: '2026-10-25', base: '2026-11-01', diffText: '先週より' }); // ちょうど14日
    // 15日〜1か月（今日 11/8 の1か月前は 10/8）
    expect(r('2026-10-24')).toMatchObject({ from: '2026-10-08', base: '2026-11-01', diffText: '先週より' }); // 15日
    expect(r('2026-10-08')).toMatchObject({ from: '2026-10-08', base: '2026-11-01', diffText: '先週より' }); // ちょうど1か月
    // 1か月を超える
    expect(r('2026-10-07')).toMatchObject({ from: '2026-08-08', base: '2026-10-08', diffText: '先月より', noDiffText: '先月の記録なし' });
    expect(r('2025-01-01')).toMatchObject({ from: '2026-08-08', base: '2026-10-08' });
  });

  test('折れ線の幅は段階どおり（8〜14日は14日、15日〜1か月は1か月）', () => {
    expect(homeBig3([setRow('2026-10-30', 'bench', 100, 5)], assigned, today)!.from).toBe('2026-10-25');
    expect(homeBig3([setRow('2026-10-20', 'bench', 100, 5)], assigned, today)!.from).toBe('2026-10-08');
    expect(homeBig3([setRow('2026-10-01', 'bench', 100, 5)], assigned, today)!.from).toBe('2026-08-08');
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

describe('形の段：形の値・今日の衛星・成長スコア', () => {
  const gday = (date: string, p: Partial<GrowthDay> = {}): GrowthDay => ({
    date, trained: false, volumeKg: 0, mealRecorded: false, mealGoalReached: false, sleepMin: null, ...p,
  });
  test('記録がまだないときは、形の値は全部 0（種だけ）、衛星はなし、スコアは出せない', () => {
    expect(homeGrowth([], '2026-11-08', null)).toEqual({
      params: { volumeKg: 0, foodDays: 0, sleepDays: 0, days: 0, partSets: [0, 0, 0, 0, 0, 0] },
      sats: { training: 'none', food: 'none', sleep: 'none' },
      score: null,
    });
    // 未来の日の記録だけなら、まだないのと同じ
    expect(homeGrowth([gday('2026-11-09', { trained: true, volumeKg: 500 })], '2026-11-08', null).score).toBeNull();
  });
  test('形の値は今日までの累計の最後、衛星は今日の記録（meal を food に写す）', () => {
    const g = homeGrowth([
      gday('2026-11-01', { trained: true, volumeKg: 1000 }),
      gday('2026-11-08', { trained: true, volumeKg: 500, mealRecorded: true, mealGoalReached: false, sleepMin: 480 }),
    ], '2026-11-08', 3);
    expect(g.params).toEqual({ volumeKg: 1500, foodDays: 0, sleepDays: 1, days: 8, partSets: [0, 0, 0, 0, 0, 0] });
    expect(g.sats).toEqual({ training: 'bright', food: 'dim', sleep: 'bright' });
    expect(g.score?.total).toEqual(expect.any(Number));
  });
  test('記録が今日だけ：筋トレ 1/3 回（負荷量も回数の割合）・食事と睡眠は満点。先週の差は出せない', () => {
    const g = homeGrowth([gday('2026-11-08', { trained: true, volumeKg: 500, mealRecorded: true, mealGoalReached: true, sleepMin: 480 })], '2026-11-08', null);
    expect(scoreTotalText(g.score)).toBe('73 / 100');
    expect(scorePillars(g.score).map((p) => `${p.name} ${p.text}`)).toEqual(['筋トレ 13 / 40', '食事 30 / 30', '睡眠 30 / 30']);
    expect(scoreDiff(g.score!.diffFromLastWeek)).toBeNull();
    expect(scoreA11yLabel(g.score)).toBe('成長スコア 73点、直近7日。押すと内訳');
  });

  const score = (total: number, diff: number | null, meal: number | null = 22): GrowthScore => ({
    total, training: { points: 32, max: 40 }, meal: { points: meal, max: 30 }, sleep: { points: 24.4, max: 30 }, diffFromLastWeek: diff,
  });
  test('先週との差：矢印と符号。0 は ±0。出せないときは出さない', () => {
    expect(scoreDiff(4)).toEqual({ dir: 'up', text: '↑ +4' });
    expect(scoreDiff(-3)).toEqual({ dir: 'down', text: '↓ −3' });
    expect(scoreDiff(0)).toEqual({ dir: 'flat', text: '±0' });
    expect(scoreDiff(null)).toBeNull();
    expect(scoreDiffSpoken(4)).toBe('先週より 4点高い');
    expect(scoreDiffSpoken(-3)).toBe('先週より 3点低い');
    expect(scoreDiffSpoken(0)).toBe('先週と同じ');
    expect(scoreDiffSpoken(null)).toBeNull();
  });
  test('点が出せないときは「—」', () => {
    expect(scoreTotalText(null)).toBe('—');
    expect(scorePillars(null).map((p) => p.text)).toEqual(['—', '—', '—']);
    expect(scoreA11yLabel(null)).toBe('成長スコア まだ記録がありません。押すと内訳');
  });
  test('内訳：柱ごとに 点／満点（四捨五入）。記録がない柱は「—」', () => {
    expect(scorePillars(score(78, 4))).toEqual([
      { key: 'training', name: '筋トレ', text: '32 / 40', label: '筋トレ 32点、40点満点' },
      { key: 'meal', name: '食事', text: '22 / 30', label: '食事 22点、30点満点' },
      { key: 'sleep', name: '睡眠', text: '24 / 30', label: '睡眠 24点、30点満点' },
    ]);
    expect(scorePillars(score(70, null, null))[1]).toEqual({ key: 'meal', name: '食事', text: '—', label: '食事 記録なし' });
  });
  test('スコアの読み上げ', () => {
    expect(scoreA11yLabel(score(78, 4))).toBe('成長スコア 78点、直近7日。先週より 4点高い。押すと内訳');
    expect(scoreA11yLabel(score(60, -3))).toBe('成長スコア 60点、直近7日。先週より 3点低い。押すと内訳');
    expect(scoreA11yLabel(score(60, 0))).toBe('成長スコア 60点、直近7日。先週と同じ。押すと内訳');
  });
});
