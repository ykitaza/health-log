// レポートの種類ごとの中身：つながりと目標の見直しの読み方、アプリが出す達成（日・週）、体の変化（月）、BIG3、まだのまとめの補足
import { DailyAchievement, WeeklyAchievement } from '../goals';
import {
  achievementRowLabel, achievementScope, big3Total, bodyChange, dailyAchievementRows, linkCaption, parseReport, PendingReport, pendingSummary,
  ReportRow, weeklyAchievementRows,
} from '../reports';
import type { TrainingSetRow } from '../training';

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: 'r1', title: '10月のまとめ', body: '', kind: 'monthly', period_start: '2026-10-01', period_end: '2026-10-31',
  overall_tone: 'good', headline: '', highlights: null, next_steps: null, links: null, review: null, created_at: '2026-11-01T01:00:00.000Z', ...over,
});

describe('つながりと目標の見直しを読む', () => {
  test('links は形の合うもの（分野が違う2つ、文がある）だけ、3件まで。basis は空なら null', () => {
    const ok = { from_area: 'sleep', to_area: 'training', text: '短い日の翌日は少ない', basis: '3日' };
    const links = JSON.stringify([
      ok, { ...ok, to_area: 'sleep' }, { ...ok, from_area: 'mood' }, { ...ok, text: ' ' }, 'x',
      { ...ok, basis: ' ' }, { ...ok, basis: null }, ok,
    ]);
    expect(parseReport(row({ links })).links).toEqual([
      { from: 'sleep', to: 'training', text: '短い日の翌日は少ない', basis: '3日' },
      { from: 'sleep', to: 'training', text: '短い日の翌日は少ない', basis: null },
      { from: 'sleep', to: 'training', text: '短い日の翌日は少ない', basis: null },
    ]);
    expect(parseReport(row({ links: 'nope' })).links).toEqual([]);
  });

  test('review は文があるときだけ。target は meals_goal 以外は null', () => {
    expect(parseReport(row({ review: JSON.stringify({ text: '下げる案', target: 'meals_goal' }) })).review).toEqual({ text: '下げる案', target: 'meals_goal' });
    expect(parseReport(row({ review: JSON.stringify({ text: '下げる案', target: 'sleep_goal' }) })).review).toEqual({ text: '下げる案', target: null });
    expect(parseReport(row({ review: JSON.stringify({ text: '' }) })).review).toBeNull();
    expect(parseReport(row({ review: '[1]' })).review).toBeNull();
    expect(parseReport(row()).review).toBeNull();
  });

  test('つながりの補足は「睡眠 → 筋トレ・2日」、根拠がなければ矢印まで', () => {
    expect(linkCaption({ from: 'sleep', to: 'training', text: 'x', basis: '2日' })).toBe('睡眠 → 筋トレ・2日');
    expect(linkCaption({ from: 'meals', to: 'body', text: 'x', basis: null })).toBe('食事 → からだ');
  });
});

describe('達成を出す期間', () => {
  const r = (kind: ReportRow['kind'], start: string | null, end: string | null) => parseReport(row({ kind, period_start: start, period_end: end }));
  test('日は1日だけ、週は月曜からその週の中、月は31日まで。ほかと期間のないものは出さない', () => {
    expect(achievementScope(r('daily', '2026-11-08', '2026-11-08'))).toEqual({ type: 'day', date: '2026-11-08' });
    expect(achievementScope(r('daily', '2026-11-07', '2026-11-08'))).toBeNull();
    expect(achievementScope(r('weekly', '2026-11-02', '2026-11-08'))).toEqual({ type: 'week', date: '2026-11-02' });
    expect(achievementScope(r('weekly', '2026-11-09', '2026-11-10'))).toEqual({ type: 'week', date: '2026-11-09' });
    // 前の形：今日までの7日（月曜始まりでない）は出さない
    expect(achievementScope(r('weekly', '2026-11-03', '2026-11-09'))).toBeNull();
    expect(achievementScope(r('weekly', '2026-11-02', '2026-11-09'))).toBeNull();
    expect(achievementScope(r('monthly', '2026-10-01', '2026-10-31'))).toEqual({ type: 'month', start: '2026-10-01', end: '2026-10-31' });
    expect(achievementScope(r('monthly', '2026-10-01', '2026-11-01'))).toBeNull();
    expect(achievementScope(r('other', '2026-11-08', '2026-11-08'))).toBeNull();
    expect(achievementScope(r('daily', null, null))).toBeNull();
  });
});

const day = (over: { training?: Partial<DailyAchievement['training']>; meals?: Partial<DailyAchievement['meals']>; sleep?: Partial<DailyAchievement['sleep']> } = {}): DailyAchievement => ({
  date: '2026-11-08',
  training: { volumeKg: 2330, exercises: 2, personalBestExerciseIds: ['bench'], ...over.training },
  meals: { recorded: true, dayType: 'training', kcal: 2480, proteinG: 98, kcalTarget: 2600, proteinTarget: 150, ...over.meals },
  sleep: { asleepMin: 416, goalMin: 420, reached: false, ...over.sleep },
});
const NAMES = new Map([['bench', 'ベンチプレス'], ['squat', 'スクワット'], ['dl', 'デッドリフト']]);

describe('日の達成の行', () => {
  test('図の例：筋トレ（自己ベスト）・kcal は目標の前後10%で達成・たんぱく質は届かず・睡眠は7時間に届かず', () => {
    const rows = dailyAchievementRows(day(), NAMES, 'kg');
    expect(rows.map((r) => [r.label, r.value, r.goal, r.unit, r.mark])).toEqual([
      ['筋トレ（ベンチプレスが自己ベスト）', '2.33', null, 't', 'reached'],
      ['kcal', '2,480', '2,600', '', 'reached'],
      ['たんぱく質', '98', '150', 'g', 'short'],
      ['睡眠（昨夜）', '6:56', '7:00', '', 'short'],
    ]);
    expect(rows[2].ratio).toBeCloseTo(98 / 150);
    expect(rows[0].ratio).toBeNull();
    expect(achievementRowLabel(rows[2])).toBe('たんぱく質、98 g、目標 150 g、まだ届いていない');
    expect(achievementRowLabel(rows[1])).toBe('kcal、2,480、目標 2,600、達成');
  });

  test('kcal は目標を10%より多く超えても、下回っても届いていない。棒は1で止める', () => {
    const over = dailyAchievementRows(day({ meals: { kcal: 2900 } }), NAMES, 'kg')[1];
    expect([over.mark, over.ratio]).toEqual(['short', 1]);
    expect(dailyAchievementRows(day({ meals: { kcal: 2300 } }), NAMES, 'kg')[1].mark).toBe('short');
    expect(dailyAchievementRows(day({ meals: { kcal: 2340 } }), NAMES, 'kg')[1].mark).toBe('reached');
  });

  test('記録がない分野は「記録なし」で印なし。目標がなければ値だけ', () => {
    const rows = dailyAchievementRows(day({
      training: { exercises: 0, volumeKg: 0, personalBestExerciseIds: [] }, meals: { recorded: false }, sleep: { asleepMin: null },
    }), NAMES, 'kg');
    expect(rows.map((r) => [r.label, r.value, r.mark])).toEqual([
      ['筋トレ', '記録なし', 'none'], ['kcal', '記録なし', 'none'], ['たんぱく質', '記録なし', 'none'], ['睡眠（昨夜）', '記録なし', 'none'],
    ]);
    expect(achievementRowLabel(rows[0])).toBe('筋トレ、記録なし');
    const noGoal = dailyAchievementRows(day({ meals: { kcalTarget: null, proteinTarget: null } }), NAMES, 'kg');
    expect(noGoal.slice(1, 3).map((r) => [r.value, r.goal, r.ratio, r.mark])).toEqual([['2,480', null, null, 'none'], ['98', null, null, 'none']]);
  });

  test('自己ベストが3種目以上なら「ほか」でまとめる。名前のない種目は書かない。lb なら k lb', () => {
    const many = dailyAchievementRows(day({ training: { personalBestExerciseIds: ['bench', 'squat', 'dl'] } }), NAMES, 'kg')[0];
    expect(many.label).toBe('筋トレ（ベンチプレスほか2種目が自己ベスト）');
    expect(dailyAchievementRows(day({ training: { personalBestExerciseIds: ['gone'] } }), NAMES, 'kg')[0].label).toBe('筋トレ');
    expect(dailyAchievementRows(day(), NAMES, 'lb')[0]).toMatchObject({ value: '5.14', unit: 'k lb' });
  });
});

const week = (over: Partial<WeeklyAchievement> = {}): WeeklyAchievement => ({
  start: '2026-11-02', end: '2026-11-08',
  training: { days: 4, goal: 3, reached: true }, meals: { days: 6, goal: 5, reached: true },
  protein: { days: 5, goal: 5, reached: true }, sleep: { days: 2, goal: 4, reached: false }, days: [], ...over,
});

describe('週の目標の行', () => {
  test('図の例：4つのうち3つ達成。日数と目標、棒は1で止める', () => {
    const { rows, summary } = weeklyAchievementRows(week());
    expect(summary).toBe('4つのうち 3つ達成');
    expect(rows.map((r) => [r.label, r.value, r.goal, r.unit, r.ratio, r.mark])).toEqual([
      ['筋トレ', '4', '3', '回', 1, 'reached'],
      ['食事を記録した日', '6', '5', '日', 1, 'reached'],
      ['たんぱく質が目標に届いた日', '5', '5', '日', 1, 'reached'],
      ['7時間以上寝た日', '2', '4', '日', 0.5, 'short'],
    ]);
  });

  test('たんぱく質の目標がない・睡眠の目標が切なら、その行を出さない', () => {
    const { rows, summary } = weeklyAchievementRows(week({ protein: null, sleep: { days: 2, goal: null, reached: false } }));
    expect(rows.map((r) => r.key)).toEqual(['training', 'meals']);
    expect(summary).toBe('2つのうち 2つ達成');
  });
});

describe('月の体の変化', () => {
  const daily = (pairs: [string, number | null][]) => pairs.map(([date, weightKg]) => ({ date, weightKg }));

  test('7日の平均（期間の前の記録も入れる）の初めと終わり、目標までの残りと、今のペースでの目安', () => {
    const c = bodyChange(daily([['2026-09-28', 72], ['2026-10-01', 71], ['2026-10-15', 70.5], ['2026-10-31', 70], ['2026-11-02', 60]]), 65, '2026-10-01', '2026-10-31')!;
    expect(c.points.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-15', '2026-10-31']);
    expect(c.first.value).toBeCloseTo(71.5); // 9/28 と 10/1 の平均
    expect(c.last.value).toBeCloseTo(70);
    expect(c.change).toBeCloseTo(-1.5);
    expect(c.remaining).toBeCloseTo(5);
    // 30日で 1.5kg → 5kg は 100日 → 約 3 か月
    expect(c.eta).toBe('約 3 か月');
  });

  test('近いときは週で、目標と逆の向きや目標がないときは目安なし、届いていれば reached', () => {
    expect(bodyChange(daily([['2026-10-01', 66], ['2026-10-31', 65.5]]), 65, '2026-10-01', '2026-10-31')!.eta).toBe('約 5 週');
    expect(bodyChange(daily([['2026-10-01', 70], ['2026-10-31', 71]]), 65, '2026-10-01', '2026-10-31')!.eta).toBeNull();
    const none = bodyChange(daily([['2026-10-01', 70], ['2026-10-31', 71]]), null, '2026-10-01', '2026-10-31')!;
    expect([none.remaining, none.eta, none.reached]).toEqual([null, null, false]);
    expect(bodyChange(daily([['2026-10-01', 66], ['2026-10-31', 65]]), 65, '2026-10-01', '2026-10-31')!).toMatchObject({ reached: true, eta: null });
  });

  test('期間の平均の点が2つ未満なら null', () => {
    expect(bodyChange(daily([['2026-10-05', 70], ['2026-10-06', null]]), 65, '2026-10-01', '2026-10-31')).toBeNull();
  });
});

describe('BIG3 の合計', () => {
  const set = (date: string, exerciseId: string, weightKg: number, reps: number): TrainingSetRow =>
    ({ date, exerciseId, bodyPartId: 'p', weightKg, reps } as TrainingSetRow);
  const LIFTS = { squat: 'squat', bench: 'bench', deadlift: 'dl' };
  const sets = [
    set('2026-09-10', 'squat', 100, 1), set('2026-09-10', 'bench', 80, 1), set('2026-09-10', 'dl', 120, 1),
    set('2026-10-10', 'squat', 110, 1), set('2026-10-12', 'squat', 100, 1), set('2026-10-10', 'bench', 80, 1), set('2026-10-10', 'dl', 120, 1),
  ];
  test('期間の推定1RMのいちばん高い値の合計と、前の同じ長さの期間との差', () => {
    expect(big3Total(sets, LIFTS, '2026-10-01', '2026-10-31')).toEqual({ totalKg: 310, deltaKg: 10 });
  });
  test('割り当てがない・期間にどれかの記録がなければ null。前の期間になければ差は null', () => {
    expect(big3Total(sets, null, '2026-10-01', '2026-10-31')).toBeNull();
    expect(big3Total(sets.filter((s) => s.exerciseId !== 'dl' || s.date < '2026-10-01'), LIFTS, '2026-10-01', '2026-10-31')).toBeNull();
    expect(big3Total(sets.filter((s) => s.date >= '2026-10-01'), LIFTS, '2026-10-01', '2026-10-31')).toEqual({ totalKg: 310, deltaKg: null });
  });
});

describe('まだのまとめの補足', () => {
  const p = (kind: PendingReport['kind'], start: string, end = start): PendingReport => ({ kind, periodStart: start, periodEnd: end, key: `${kind}:${start}` });
  const TODAY = '2026-11-10';
  test('図の例：「先週の分と、11月6日・7日の分」', () => {
    expect(pendingSummary([p('daily', '2026-11-07'), p('daily', '2026-11-06'), p('weekly', '2026-11-02', '2026-11-08')], TODAY))
      .toBe('先週の分と、11月6日・7日の分');
  });
  test('先月・いくつかの週・月をまたぐ日・今日。4日以上は日数だけ', () => {
    expect(pendingSummary([p('monthly', '2026-10-01', '2026-10-31')], TODAY)).toBe('先月の分');
    expect(pendingSummary([p('weekly', '2026-11-02'), p('weekly', '2026-10-26')], TODAY)).toBe('2週分');
    expect(pendingSummary([p('weekly', '2026-10-26')], TODAY)).toBe('1週分');
    expect(pendingSummary([p('daily', '2026-10-31'), p('daily', '2026-11-01'), p('daily', TODAY)], TODAY)).toBe('10月31日・11月1日・今日の分');
    expect(pendingSummary(['03', '04', '05', '06'].map((d) => p('daily', `2026-11-${d}`)), TODAY)).toBe('4日分');
  });
});
