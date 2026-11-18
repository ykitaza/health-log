// フェーズの計算。testdata/training/phases.json はサーバー（services/training/tests/test_shared_testdata.py）と同じもの
import * as fs from 'fs';
import * as path from 'path';
import {
  baseEndFor, currentPhase, effectiveEnd, effectiveGoalWeight, endDateFor, Phase, phaseLabel, phaseProgress, pauses, planPolylines,
  recoveryUntil, successMetrics, TargetChange,
} from '../phases';

type RawPhase = {
  id: string; kind: Phase['kind']; direction: Phase['direction']; name: string; start_date: string; end_date: string | null;
  target_weight_kg: number | null; meal_targets: Phase['mealTargets']; snapshot: Phase['snapshot']; status: Phase['status'];
  paused_phase_id: string | null; target_history: TargetChange[]; ended_on: string | null; created_at: string;
};

const toPhase = (r: RawPhase): Phase => ({
  id: r.id, kind: r.kind, direction: r.direction, name: r.name, startDate: r.start_date, endDate: r.end_date, targetWeightKg: r.target_weight_kg,
  mealTargets: r.meal_targets, snapshot: r.snapshot, status: r.status, pausedPhaseId: r.paused_phase_id, targetHistory: r.target_history,
  endedOn: r.ended_on, createdAt: r.created_at,
});

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'testdata', 'training', 'phases.json'), 'utf8')) as {
  groups: {
    name: string; phases: RawPhase[]; weights: [string, number][];
    checks: { phase_id: string; as_of: string; expected: Record<string, unknown> }[];
    current: { as_of: string; current: string | null; paused: string | null }[];
  }[];
};

describe('phases.json：サーバーと同じ計算（何週目・終わり・残り・療養・予定・ペース・今のフェーズ）', () => {
  test.each(data.groups.map((g) => [g.name, g] as const))('%s', (_, g) => {
    const phases = g.phases.map(toPhase);
    const weights = g.weights.map(([date, kg]) => ({ date, kg }));
    for (const c of g.checks) {
      const p = phases.find((x) => x.id === c.phase_id)!;
      const pp = phaseProgress(p, phases, weights, c.as_of);
      const pace = pp.pace && {
        status: pp.pace.status, reason: pp.pace.reason, weigh_ins: pp.pace.weighIns, week_avg_kg: pp.pace.weekAvgKg, plan_kg: pp.pace.planKg,
        diff_kg: pp.pace.diffKg,
      };
      expect([c.phase_id, c.as_of, {
        label: phaseLabel(p), paused: pp.paused, week: pp.week, weeks_total: pp.weeksTotal, effective_end: pp.effectiveEnd,
        remaining_days: pp.remainingDays, rehab_days: pp.rehabDays, plan_kg: pp.planKg, pace,
      }]).toEqual([c.phase_id, c.as_of, c.expected]);
    }
    for (const c of g.current) {
      const { current, paused } = currentPhase(phases, c.as_of);
      expect([c.as_of, current?.id ?? null, paused?.id ?? null]).toEqual([c.as_of, c.current, c.paused]);
    }
  });
});

const base = (over: Partial<Phase> = {}): Phase => ({
  id: 'p1', kind: 'normal', direction: 'bulk', name: '', startDate: '2026-11-02', endDate: endDateFor('2026-11-02', 16), targetWeightKg: 80,
  mealTargets: null, snapshot: { weight_kg: 72, body_fat_pct: 15, big3: { bench: 100, squat: 120, deadlift: 150 }, growth_score: 60 },
  status: 'active', pausedPhaseId: null, targetHistory: [], endedOn: null, createdAt: '2026-11-02T00:00:00.000Z', ...over,
});
const rehab = (over: Partial<Phase> = {}): Phase => base({
  id: 'r1', kind: 'rehab', direction: null, endDate: null, targetWeightKg: null, snapshot: null, startDate: '2026-11-10',
  pausedPhaseId: 'p1', status: 'ended', endedOn: '2026-11-17', createdAt: '2026-11-10T00:00:00.000Z', ...over,
});

describe('期間と予定の線', () => {
  test('終了日は開始日＋7×週数−1。16週は 2/21 まで', () => {
    expect(endDateFor('2026-11-02', 16)).toBe('2027-02-21');
    expect(endDateFor('2026-11-02', 1)).toBe('2026-11-08');
  });

  test('延長の画面で選んだ実際の終わりから、保存する終了日（止まった日を含まない）を出す', () => {
    const phases = [base(), rehab()];
    const spans = pauses(phases[0], phases, '2026-12-01');
    expect(effectiveEnd(phases[0], spans)).toBe('2027-02-28');
    expect(baseEndFor(phases[0], spans, '2027-03-28')).toBe('2027-03-21');
  });

  test('予定の線：止まった日は平らで、目標を変えた日から新しい線。前の線も残す', () => {
    const history: TargetChange[] = [
      { date: '2026-11-02', target_weight_kg: 80, end_date: '2027-02-21', weight_kg: 72 },
      { date: '2026-11-30', target_weight_kg: 78, end_date: '2027-02-21', weight_kg: 73 },
    ];
    const phases = [base({ targetWeightKg: 78, targetHistory: history }), rehab()];
    const lines = planPolylines(phases[0], pauses(phases[0], phases, '2026-12-01'));
    expect(lines.map((l) => [l.from, l.current])).toEqual([['2026-11-02', false], ['2026-11-30', true]]);
    const first = lines[0].points;
    expect(first.map((p) => p.date)).toEqual(['2026-11-02', '2026-11-10', '2026-11-17', '2027-02-28']);
    expect(first[1].kg).toBeCloseTo(first[2].kg); // 止まっているあいだは平ら
    expect(first[3].kg).toBe(80);
    expect(lines[1].points).toEqual([{ date: '2026-11-30', kg: 73 }, { date: '2027-02-28', kg: 78 }]);
  });

  test('開始時の体重がなければ、線は引けない', () => {
    const p = base({ snapshot: null });
    expect(planPolylines(p, [])).toEqual([]);
  });

  test('療養から戻って14日は、判定しない最後の日を返す', () => {
    const phases = [base(), rehab()];
    expect(recoveryUntil(phases[0], phases, '2026-11-20')).toBe('2026-11-30');
    expect(recoveryUntil(phases[0], phases, '2026-12-01')).toBeNull();
    expect(recoveryUntil(phases[0], [phases[0]], '2026-11-20')).toBeNull();
  });
});

describe('目標体重：フェーズ実施中はフェーズの目標、なければ設定の目標体重', () => {
  test.each([
    ['フェーズがない', [], 75, { kg: 75, source: 'setting' }],
    ['フェーズがなく、設定もない', [], null, { kg: null, source: null }],
    ['実施中', [base()], 75, { kg: 80, source: 'phase' }],
    ['療養で止まっていても、止めた通常のフェーズの目標', [base(), rehab({ status: 'active', endedOn: null })], 75, { kg: 80, source: 'phase' }],
    ['止めたフェーズのない療養だけ', [rehab({ status: 'active', endedOn: null, pausedPhaseId: null })], 75, { kg: 75, source: 'setting' }],
    ['終えた', [base({ status: 'ended', endedOn: '2026-11-10' })], 75, { kg: 75, source: 'setting' }],
    ['これから始まる', [base({ startDate: '2026-12-01' })], 75, { kg: 75, source: 'setting' }],
  ] as const)('%s', (_, phases, setting, expected) => {
    expect(effectiveGoalWeight([...phases], setting, '2026-11-20')).toEqual(expected);
  });
});

describe('成功の指標（向きごと。ウエストは使わない。体脂肪率は参考）', () => {
  const now = (over = {}) => ({ weightKg: 74, bodyFatPct: 16, big3: { bench: 105, squat: 125, deadlift: 150 }, growthScore: 65, ...over });
  const summary = (r: ReturnType<typeof successMetrics>) => [r.metrics.map((m) => [m.key, m.delta, m.ok, m.reference]), r.achieved];

  test('増量：体重↑と BIG3↑なら達成。体脂肪率は判定に使わない', () => {
    expect(summary(successMetrics(base(), now()))).toEqual([[
      ['weight', 2, true, false], ['big3', 10, true, false], ['body_fat', 1, null, true],
    ], true]);
    expect(successMetrics(base(), now({ big3: { bench: 100, squat: 120, deadlift: 150 } })).achieved).toBe(false);
  });

  test('減量：体重↓で、BIG3 の減りが3%以内なら達成', () => {
    const cut = base({ direction: 'cut', targetWeightKg: 68 });
    // 開始時の合計 370、3% は 11.1
    expect(successMetrics(cut, now({ weightKg: 70, big3: { bench: 95, squat: 115, deadlift: 149 } })).achieved).toBe(true);
    expect(successMetrics(cut, now({ weightKg: 70, big3: { bench: 90, squat: 115, deadlift: 150 } })).achieved).toBe(false);
    expect(successMetrics(cut, now({ weightKg: 73 })).achieved).toBe(false);
  });

  test('維持（リコンプ）：体重 ±1kg、BIG3↑、成長スコア↑', () => {
    const keep = base({ direction: 'maintain', targetWeightKg: 72 });
    expect(summary(successMetrics(keep, now({ weightKg: 72.8 })))).toEqual([[
      ['weight', 0.8, true, false], ['big3', 10, true, false], ['growth_score', 5, true, false], ['body_fat', 1, null, true],
    ], true]);
    expect(successMetrics(keep, now({ weightKg: 73.2 })).achieved).toBe(false);
    expect(successMetrics(keep, now({ growthScore: 60 })).achieved).toBe(false);
  });

  test('BIG3 は開始時と今の両方にある役だけを比べる。比べられなければ全体は null', () => {
    const p = base({ snapshot: { weight_kg: 72, body_fat_pct: null, big3: { bench: 100, squat: null, deadlift: null }, growth_score: null } });
    const r = successMetrics(p, now({ big3: { bench: 102, squat: 200, deadlift: null } }));
    expect(r.metrics.find((m) => m.key === 'big3')).toMatchObject({ start: 100, now: 102, ok: true });
    expect(successMetrics(p, now({ big3: null })).achieved).toBeNull();
  });

  test('療養は判定しない', () => {
    expect(successMetrics(rehab(), now())).toEqual({ metrics: [], achieved: null });
  });
});
