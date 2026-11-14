// フェーズの計画の編集（始める・直す・計画を変える）の決まりと、進み具合の目盛り（16 個）
import {
  changeError, changeFields, correctError, correctFields, earliestStart, editRange, minWeeksFor, planChanges, startError,
} from '../phaseEdit';
import { Phase, PHASE_TICKS, phaseTicks, planPolylines, planValue, tickState } from '../phases';

const TODAY = '2026-11-08'; // 日曜

const phase = (o: Partial<Phase> = {}): Phase => ({
  id: 'p1', kind: 'normal', direction: 'bulk', name: '', startDate: '2026-11-01', endDate: '2027-02-20', targetWeightKg: 80, mealTargets: null,
  snapshot: { weight_kg: 72, body_fat_pct: null, big3: null, growth_score: null },
  status: 'active', pausedPhaseId: null,
  targetHistory: [{ date: '2026-11-01', target_weight_kg: 80, end_date: '2027-02-20', weight_kg: 72 }],
  endedOn: null, createdAt: '2026-11-01T00:00:00Z', ...o,
});
const ended = (o: Partial<Phase>): Phase => phase({ id: 'old', status: 'ended', ...o });
const rehab = (o: Partial<Phase>): Phase => phase({
  id: 'r1', kind: 'rehab', direction: null, endDate: null, targetWeightKg: null, targetHistory: [], pausedPhaseId: 'p1', ...o,
});

describe('進み具合の目盛り：16 個で、期間に比例して進む', () => {
  const weeks = (n: number, start = '2026-11-01') => phase({ startDate: start, endDate: addWeeks(start, n) });
  const addWeeks = (start: string, n: number) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n * 7 - 1);
    return d.toISOString().slice(0, 10);
  };
  const at = (p: Phase, day: string) => phaseTicks(p, [], day);

  test('16 週は 1 週で 1 つ（今までの週の区切りと同じ）', () => {
    const p = weeks(16);
    expect(at(p, '2026-11-01')).toEqual({ done: 0, current: 0 });
    expect(at(p, '2026-11-07')).toEqual({ done: 0, current: 0 });
    expect(at(p, '2026-11-08')).toEqual({ done: 1, current: 1 });
    expect(at(p, '2027-02-20')).toEqual({ done: 15, current: 15 });
  });
  test('8 週は 1 週で 2 つ（3.5 日で 1 つ）。2 週目の始めは 3 つ目', () => {
    const p = weeks(8);
    expect(at(p, '2026-11-04')).toEqual({ done: 0, current: 0 });
    expect(at(p, '2026-11-05')).toEqual({ done: 1, current: 1 });
    expect(at(p, '2026-11-08')).toEqual({ done: 2, current: 2 });
    expect(at(p, '2026-12-26')).toEqual({ done: 15, current: 15 });
  });
  test('1 週は 1 日で 2〜3 つ。4 週は 1 週で 4 つ', () => {
    expect(at(weeks(1), '2026-11-02')).toEqual({ done: 2, current: 2 });
    expect(at(weeks(1), '2026-11-07')).toEqual({ done: 13, current: 13 });
    expect(at(weeks(4), '2026-11-15')).toEqual({ done: 8, current: 8 });
  });
  test('24 週は 1 つが 10.5 日（1.5 週）、104 週は 1 つが 45.5 日', () => {
    const p = weeks(24);
    expect(at(p, '2026-11-11')).toEqual({ done: 0, current: 0 }); // 10 日目
    expect(at(p, '2026-11-12')).toEqual({ done: 1, current: 1 }); // 11 日目（10.5 を超えた）
    expect(at(weeks(104), '2027-01-01')).toEqual({ done: 1, current: 1 }); // 61 日目
  });
  test('止まった日（療養）は進まない。開始日より前は 0、実際の終わりを過ぎたら全部過ぎた', () => {
    const p = weeks(8);
    // 11/5〜11/11 の 7 日止まった：11/12 の時計は 4 日目 → 2 つ目
    expect(phaseTicks(p, [['2026-11-05', '2026-11-12']], '2026-11-12')).toEqual({ done: 1, current: 1 });
    expect(at(p, '2026-10-30')).toEqual({ done: 0, current: 0 });
    expect(at(p, '2026-12-27')).toEqual({ done: PHASE_TICKS, current: null });
  });
  test('目盛りの状態', () => {
    expect([0, 1, 2, 3].map((i) => tickState({ done: 2, current: 2 }, i))).toEqual(['done', 'done', 'current', 'todo']);
    expect(tickState({ done: 16, current: null }, 15)).toBe('done');
    expect(tickState(null, 0)).toBe('todo');
  });
});

describe('開始日の範囲', () => {
  test('ほかの通常のフェーズを終えた日からでないと始められない（中断も数える。療養と自分は数えない）', () => {
    const list = [ended({ id: 'a', endedOn: '2026-10-20' }), ended({ id: 'b', status: 'aborted', endedOn: '2026-10-25' }),
      rehab({ status: 'ended', endedOn: '2026-11-03' }), phase()];
    expect(earliestStart(list, 'p1')).toBe('2026-10-25');
    expect(earliestStart([])).toBeNull();
  });
  test('始める：今日より後・重なる日・終わりが今日より前になる週数は断る。過去の日（始め忘れ）はよい', () => {
    const list = [ended({ endedOn: '2026-11-02' })];
    expect(startError(list, TODAY, { startDate: '2026-11-09', weeks: 8, targetWeightKg: 80 })).toBe('開始日は今日より後にできません');
    expect(startError(list, TODAY, { startDate: '2026-11-01', weeks: 8, targetWeightKg: 80 })).toBe('開始日は、前のフェーズを終えた日（11/02）より前にできません');
    expect(startError(list, TODAY, { startDate: '2026-11-02', weeks: 8, targetWeightKg: 80 })).toBeNull();
    // 11/1 から 1 週は 11/7 まで（今日より前）なので 2 週から
    expect(startError([], TODAY, { startDate: '2026-11-01', weeks: 1, targetWeightKg: 80 })).toBe('期間は2週より短くできません（終わりが今日より前になります）');
    expect(minWeeksFor('2026-11-01', 0, TODAY)).toBe(2);
    expect(minWeeksFor('2026-11-02', 0, TODAY)).toBe(1);
    expect(minWeeksFor('2026-10-01', 7, TODAY)).toBe(5); // 今日までの 39 日 − 止まった 7 日 = 32 日 → 5 週
  });
});

describe('直す（訂正）：最初からこの計画だったことにする', () => {
  test('開始日を変えたら、線は新しい開始日から 1 本。開始時の記録は渡したもの（新しい開始日までの記録）に入れ替える', () => {
    const p = phase({
      startDate: '2026-11-08', endDate: '2027-02-27', snapshot: { weight_kg: 72.6, body_fat_pct: null, big3: null, growth_score: null },
      targetHistory: [{ date: '2026-11-08', target_weight_kg: 80, end_date: '2027-02-27', weight_kg: 72.6 }],
    });
    const snapshot = { weight_kg: 72, body_fat_pct: 18, big3: null, growth_score: 50 };
    const f = correctFields(p, { startDate: '2026-11-01', weeks: 16, targetWeightKg: 80, snapshot });
    expect(f).toEqual({
      startDate: '2026-11-01', endDate: '2027-02-20', targetWeightKg: 80, snapshot,
      targetHistory: [{ date: '2026-11-01', target_weight_kg: 80, end_date: '2027-02-20', weight_kg: 72 }],
    });
    // 新しい開始日に予定の線は開始時の体重から始まる
    expect(planValue({ ...p, ...f }, [], '2026-11-01')).toBe(72);
  });
  test('開始日を変えないなら開始時の記録はそのまま。計画を変えた線も消え、目標と期間は最初から', () => {
    const p = phase({
      targetWeightKg: 79, endDate: '2027-03-20',
      targetHistory: [
        { date: '2026-11-01', target_weight_kg: 80, end_date: '2027-02-20', weight_kg: 72 },
        { date: '2026-11-05', target_weight_kg: 79, end_date: '2027-03-20', weight_kg: 72.5 },
      ],
    });
    expect(planChanges(p)).toBe(1);
    const f = correctFields(p, { startDate: '2026-11-01', weeks: 12, targetWeightKg: 78, snapshot: null });
    expect(f.snapshot).toEqual(p.snapshot);
    expect(f.targetHistory).toEqual([{ date: '2026-11-01', target_weight_kg: 78, end_date: '2027-01-23', weight_kg: 72 }]);
    expect(planPolylines({ ...p, ...f }, [])).toHaveLength(1);
    expect(planChanges({ ...p, ...f })).toBe(0);
  });
  test('開始日の前に体重がなければ、開始時の体重は空（予定の線は引けない）', () => {
    const f = correctFields(phase(), { startDate: '2026-10-25', weeks: 16, targetWeightKg: 80, snapshot: { weight_kg: null, body_fat_pct: null, big3: null, growth_score: null } });
    expect(f.targetHistory[0].weight_kg).toBeNull();
    expect(planValue({ ...phase(), ...f }, [], TODAY)).toBeNull();
  });
  test('範囲：今日より後・重なる日・終わりが今日より前・週数と目標の範囲。止まった日は終わりを後ろにずらすので数える', () => {
    const p = phase();
    const list = [p, ended({ endedOn: '2026-10-28' })];
    const input = { startDate: '2026-11-01', weeks: 16, targetWeightKg: 80, snapshot: null };
    expect(correctError(p, list, TODAY, input)).toBeNull();
    expect(correctError(p, list, TODAY, { ...input, startDate: '2026-11-09' })).toBe('開始日は今日より後にできません');
    expect(correctError(p, list, TODAY, { ...input, startDate: '2026-10-27' })).toMatch('（10/28）より前にできません');
    expect(correctError(p, list, TODAY, { ...input, startDate: '2026-10-28', weeks: 1 })).toBe('期間は2週より短くできません（終わりが今日より前になります）');
    expect(correctError(p, list, TODAY, { ...input, weeks: 105 })).toBe('期間は1〜104週で入れてください');
    expect(correctError(p, list, TODAY, { ...input, targetWeightKg: 10 })).toMatch('目標体重は');
    expect(correctError({ ...p, status: 'ended' }, list, TODAY, input)).toBe('終えたフェーズは変えられません');
    // 10/18 から 10/25〜11/1 の 7 日止まっていたら、時計は 22 − 7 = 15 日 → 3 週から
    const paused = [p, rehab({ startDate: '2026-10-25', status: 'ended', endedOn: '2026-11-01' })];
    expect(editRange(p, paused, TODAY).minWeeksFrom('2026-10-18')).toBe(3);
    expect(correctError(p, paused, TODAY, { ...input, startDate: '2026-10-18', weeks: 3 })).toBeNull();
  });
});

describe('計画を変える（変更）：今日から線を引き直す', () => {
  test('目標を上げる：今日から今の週平均で新しい線。前の線は残る', () => {
    const f = changeFields(phase(), { weeks: 16, targetWeightKg: 82, weekAvgKg: 72.8 }, TODAY)!;
    expect(f.targetHistory).toEqual([
      { date: '2026-11-01', target_weight_kg: 80, end_date: '2027-02-20', weight_kg: 72 },
      { date: '2026-11-08', target_weight_kg: 82, end_date: '2027-02-20', weight_kg: 72.8 },
    ]);
    expect(f).toMatchObject({ startDate: '2026-11-01', targetWeightKg: 82, endDate: '2027-02-20' });
  });
  test('期間だけ：延ばす・縮める。線は前の線の今日の値から（体重は入れない）', () => {
    const longer = changeFields(phase(), { weeks: 20, targetWeightKg: 80, weekAvgKg: 72.8 }, TODAY)!;
    expect(longer.endDate).toBe('2027-03-20');
    expect(longer.targetHistory[1]).toEqual({ date: '2026-11-08', target_weight_kg: 80, end_date: '2027-03-20', weight_kg: null });
    const shorter = changeFields(phase(), { weeks: 8, targetWeightKg: 80, weekAvgKg: null }, TODAY)!;
    expect(shorter.endDate).toBe('2026-12-26');
    // 予定の線は今日の値（72 → 80 の 7/111）から 12/26 の 80 へ
    const next = { ...phase(), ...shorter };
    expect(planValue(next, [], TODAY)).toBeCloseTo(72 + (8 * 7) / 111, 5);
    expect(planValue(next, [], '2026-12-26')).toBe(80);
  });
  test('範囲：縮めても終わりは今日より前にしない（止まった日の分は後ろにずれる）', () => {
    const p = phase({ startDate: '2026-10-11' }); // 今日は 29 日目
    expect(changeError(p, [p], TODAY, { weeks: 4, targetWeightKg: 80, weekAvgKg: null })).toBe('期間は5週より短くできません（終わりが今日より前になります）');
    expect(changeError(p, [p], TODAY, { weeks: 5, targetWeightKg: 80, weekAvgKg: null })).toBeNull();
    const paused = [p, rehab({ startDate: '2026-10-20', status: 'ended', endedOn: '2026-10-27' })];
    expect(changeError(p, paused, TODAY, { weeks: 4, targetWeightKg: 80, weekAvgKg: null })).toBeNull();
    expect(editRange(p, paused, TODAY).minWeeks).toBe(4);
  });
  test('履歴が上限を超えるなら null', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ date: `2026-10-${String(i % 28 + 1).padStart(2, '0')}`, target_weight_kg: 80, end_date: '2027-02-20', weight_kg: null }));
    expect(changeFields(phase({ targetHistory: many }), { weeks: 16, targetWeightKg: 81, weekAvgKg: null }, TODAY)).toBeNull();
  });
});
