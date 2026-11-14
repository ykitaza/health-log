import { Phase, successMetrics, SuccessNow } from '../phases';
import {
  achievement, achievementText, cutJustBefore, endedPhases, lastEnded, nextOptions, readyToEndRehab, rehabInjuries, rehabWatch, weightProgress,
} from '../phaseReview';

const TODAY = '2026-11-08';
const phase = (o: Partial<Phase> = {}): Phase => ({
  id: 'p1', kind: 'normal', direction: 'bulk', name: '', startDate: '2026-07-06', endDate: '2026-10-25', targetWeightKg: 80, mealTargets: null,
  snapshot: { weight_kg: 76, body_fat_pct: 18.2, big3: { bench: 100, squat: 120, deadlift: 142.5 }, growth_score: 70 },
  status: 'ended', pausedPhaseId: null, targetHistory: [], endedOn: '2026-10-26', createdAt: '2026-07-06T00:00:00Z', ...o,
});
const now = (o: Partial<SuccessNow> = {}): SuccessNow => ({
  weightKg: 79.6, bodyFatPct: 19.6, big3: { bench: 105, squat: 135, deadlift: 152 }, growthScore: 82, ...o,
});
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)} kg`;

describe('達成の度合い', () => {
  const judge = (p: Phase, n: SuccessNow) => achievement(p.direction!, successMetrics(p, n).metrics, p.targetWeightKg);

  test('増量：目標の 9 割＋BIG3 が伸びた → ほぼ届いた。棒は 0.9', () => {
    const p = phase();
    const a = judge(p, now());
    expect(a.tier).toBe('almost');
    expect(a.ratio).toBeCloseTo(0.9, 5);
    expect(achievementText('bulk', successMetrics(p, now()).metrics, 80, signed)).toBe('体重は目標の 90%（+3.6 kg / +4.0 kg）・BIG3 は伸びた');
  });
  test('増量：目標に届き BIG3 も伸びた → 届いた。届いても BIG3 が伸びなければ ほぼ届いた。8 割未満は 届かなかった', () => {
    expect(judge(phase(), now({ weightKg: 80.2 })).tier).toBe('reached');
    expect(judge(phase(), now({ weightKg: 80.2, big3: { bench: 90, squat: 110, deadlift: 140 } })).tier).toBe('almost');
    expect(judge(phase(), now({ weightKg: 78 })).tier).toBe('missed');
    expect(judge(phase(), now({ weightKg: 79.6, big3: { bench: 90, squat: 110, deadlift: 140 } })).tier).toBe('missed');
    // 棒は 1 で止める
    expect(judge(phase(), now({ weightKg: 81 })).ratio).toBe(1);
  });
  test('減量：目標に届き BIG3 を −3% 以内で保った → 届いた。BIG3 が −3% より減ったら ほぼ届いた', () => {
    const cut = phase({ direction: 'cut', targetWeightKg: 78, snapshot: { weight_kg: 82, body_fat_pct: 21, big3: { bench: 100, squat: 140, deadlift: 152 }, growth_score: 82 } });
    expect(judge(cut, now({ weightKg: 77.9, big3: { bench: 98, squat: 138, deadlift: 152 } })).tier).toBe('reached');
    expect(judge(cut, now({ weightKg: 77.9, big3: { bench: 90, squat: 120, deadlift: 140 } })).tier).toBe('almost');
    expect(achievementText('cut', successMetrics(cut, now({ weightKg: 77.9, big3: { bench: 98, squat: 138, deadlift: 152 } })).metrics, 78, signed))
      .toBe('体重は目標に届いた（−4.1 kg）・BIG3 は保てた');
  });
  test('維持：全部かなえば 届いた、1 つかなわなければ ほぼ届いた、2 つ以上は 届かなかった', () => {
    const m = phase({ direction: 'maintain', targetWeightKg: 76 });
    expect(judge(m, now({ weightKg: 76.5 })).tier).toBe('reached');
    expect(judge(m, now({ weightKg: 78 })).tier).toBe('almost');
    expect(judge(m, now({ weightKg: 78, growthScore: 60 })).tier).toBe('missed');
    expect(judge(m, now({ weightKg: 76.5 })).ratio).toBe(1);
  });
  test('比べられない指標があれば度合いは出さない（体脂肪率は参考なので関係ない）', () => {
    expect(judge(phase(), now({ big3: null })).tier).toBeNull();
    expect(judge(phase(), now({ weightKg: null })).tier).toBeNull();
    expect(judge(phase(), now({ bodyFatPct: null })).tier).toBe('almost');
    expect(achievementText('bulk', successMetrics(phase(), now({ weightKg: null, big3: null })).metrics, 80, signed))
      .toBe('体重は比べる記録がない・BIG3 は比べる記録がない');
  });
  test('目標までの進み：開始と目標が同じ・ないときは null', () => {
    expect(weightProgress(76, 78, 80)).toBe(0.5);
    expect(weightProgress(80, 78, 80)).toBeNull();
    expect(weightProgress(null, 78, 80)).toBeNull();
  });
});

describe('終えたフェーズ・次のフェーズ', () => {
  const list = [
    phase({ id: 'a', startDate: '2026-01-05', status: 'ended', direction: 'cut' }),
    phase({ id: 'b', startDate: '2026-04-06', status: 'aborted' }),
    phase({ id: 'c', startDate: '2026-07-06', status: 'ended' }),
    phase({ id: 'r', kind: 'rehab', direction: null, startDate: '2026-08-01', status: 'ended' }),
  ];
  test('振り返れるのは終えた通常のフェーズだけ（中断・療養は入れない）。新しい順', () => {
    expect(endedPhases(list).map((p) => p.id)).toEqual(['c', 'a']);
  });
  test('ホームの 1 行：いちばん新しい通常のフェーズが終えたものなら、それ。中断なら出さない', () => {
    expect(lastEnded(list)?.id).toBe('c');
    expect(lastEnded([...list, phase({ id: 'd', startDate: '2026-10-01', status: 'aborted' })])).toBeNull();
    expect(lastEnded([])).toBeNull();
  });
  test('減量を終えて 28 日以内なら、増量の前に維持を挟む案を出す', () => {
    const cut = phase({ direction: 'cut', status: 'ended', endedOn: '2026-10-20' });
    expect(cutJustBefore([cut], TODAY)?.id).toBe('p1');
    // 28 日前（10/11）までは出す、その前の日は出さない
    expect(cutJustBefore([phase({ direction: 'cut', endedOn: '2026-10-11' })], TODAY)).not.toBeNull();
    expect(cutJustBefore([phase({ direction: 'cut', endedOn: '2026-10-10' })], TODAY)).toBeNull();
    expect(cutJustBefore([cut, phase({ id: 'm', direction: 'maintain', startDate: '2026-10-20', status: 'ended', endedOn: '2026-11-01' })], TODAY)).toBeNull();
    expect(cutJustBefore([phase({ direction: 'cut', status: 'aborted', endedOn: '2026-11-01' })], TODAY)).toBeNull();
    expect(cutJustBefore([phase({ direction: 'bulk', endedOn: '2026-11-01' })], TODAY)).toBeNull();
  });
  test('次のフェーズの選択肢：維持 4 週がおすすめで先頭', () => {
    const o = nextOptions('cut');
    expect(o[0]).toMatchObject({ direction: 'maintain', weeks: 4, recommended: true });
    expect(o.map((x) => x.title)).toEqual(['維持 4週', '減量をもう一度', '増量']);
  });
});

describe('療養', () => {
  const rehab = phase({ id: 'r1', kind: 'rehab', direction: null, startDate: '2026-11-01', status: 'active', endedOn: null, pausedPhaseId: 'p1' });
  const inj = (id: string, occurredOn: string, status: 'fixing' | 'fixed', fixedOn: string | null = null) => ({ id, occurredOn, status, fixedOn });
  test('対象のケガ：療養の始まりに直している途中だったもの・療養中に痛めたもの。前に直せたもの・あとで痛めたものは入れない', () => {
    const list = [
      inj('a', '2026-10-20', 'fixing'), inj('b', '2026-10-01', 'fixed', '2026-10-15'), inj('c', '2026-10-25', 'fixed', '2026-11-05'),
      inj('d', '2026-11-03', 'fixing'), inj('e', '2026-11-10', 'fixing'),
    ];
    expect(rehabInjuries(list, rehab, TODAY).map((i) => i.id)).toEqual(['a', 'c', 'd']);
  });
  test('「療養を終えますか」は、対象のケガが 1 つ以上あってすべて直せたときだけ。療養中でなければ出さない', () => {
    expect(readyToEndRehab([inj('c', '2026-10-25', 'fixed', '2026-11-05')], rehab, TODAY)).toBe(true);
    expect(readyToEndRehab([inj('c', '2026-10-25', 'fixed', '2026-11-05'), inj('a', '2026-10-20', 'fixing')], rehab, TODAY)).toBe(false);
    expect(readyToEndRehab([], rehab, TODAY)).toBe(false);
    expect(readyToEndRehab([inj('b', '2026-10-01', 'fixed', '2026-10-15')], rehab, TODAY)).toBe(false);
    expect(readyToEndRehab([inj('c', '2026-10-25', 'fixed', '2026-11-05')], { ...rehab, status: 'ended', endedOn: TODAY }, TODAY)).toBe(false);
  });
  test('療養中に見るもの：睡眠の平均・食事の目標に届いた日・ケガの振り返り（療養に入ってから）', () => {
    const days = [
      { date: '2026-10-31', sleepMin: 300, mealRecorded: true, mealGoalReached: true },
      { date: '2026-11-01', sleepMin: 420, mealRecorded: true, mealGoalReached: true },
      { date: '2026-11-02', sleepMin: null, mealRecorded: true, mealGoalReached: false },
      { date: '2026-11-03', sleepMin: 445, mealRecorded: false, mealGoalReached: false },
    ];
    const reviews = [{ date: '2026-10-30', result: 'pain' as const }, { date: '2026-11-05', result: 'fixed' as const }, { date: '2026-11-03', result: 'not_yet' as const }];
    expect(rehabWatch(days, reviews, rehab, TODAY)).toEqual({
      sleepAvgMin: 433, sleepDays: 2, mealDays: 2, mealReached: 1, reviews: 2, latestReview: { date: '2026-11-05', result: 'fixed' },
    });
    expect(rehabWatch([], [], rehab, TODAY)).toMatchObject({ sleepAvgMin: null, reviews: 0, latestReview: null });
  });
});
