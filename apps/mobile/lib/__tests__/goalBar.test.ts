import { goalProgress, MILESTONE_STEP_KG, nextMilestoneKg } from '../goalBar';

describe('nextMilestoneKg（次の節目：10kg刻み）', () => {
  test('増量：今より上で目標より下の最小の10の倍数（69.8kg→目標80kg なら 70kg）', () => {
    expect(nextMilestoneKg(69.8, 80)).toBe(70);
    expect(nextMilestoneKg(70.1, 80)).toBe(80); // 次の境界は目標そのもの
    expect(nextMilestoneKg(61, 85)).toBe(70);
  });
  test('ちょうど境界の上にいるときは、その境界は節目にしない（厳密に上）', () => {
    expect(nextMilestoneKg(70, 80)).toBe(80);
  });
  test('境界が目標未満にないときは節目＝目標', () => {
    expect(nextMilestoneKg(79.9, 80)).toBe(80);
    expect(nextMilestoneKg(72, 75)).toBe(75);
  });
  test('減量：今より下で目標より上の最大の10の倍数。なければ目標', () => {
    expect(nextMilestoneKg(75, 60)).toBe(70);
    expect(nextMilestoneKg(65, 62)).toBe(62);
  });
  test('届いているときは目標そのもの', () => {
    expect(nextMilestoneKg(80, 80)).toBe(80);
    expect(nextMilestoneKg(79.98, 80)).toBe(80);
  });
  test('刻みは MILESTONE_STEP_KG = 10', () => {
    expect(MILESTONE_STEP_KG).toBe(10);
  });
});

describe('goalProgress（目標バー）', () => {
  test('例：現在 69.8kg（7日移動平均）・目標 80kg なら、あと 10.2kg、節目 70kg まであと 0.2kg', () => {
    const p = goalProgress({ currentKg: 69.8, goalKg: 80 });
    expect(p.remainingKg).toBe(10.2);
    expect(p.milestoneKg).toBe(70);
    expect(p.toMilestoneKg).toBe(0.2);
    expect(p.reached).toBe(false);
  });
  test('割合：初めの体重があれば（現在−初め）／（目標−初め）。0〜1 に丸める', () => {
    expect(goalProgress({ currentKg: 69.8, goalKg: 80, startKg: 68 }).ratio).toBeCloseTo(1.8 / 12, 6);
    expect(goalProgress({ currentKg: 65, goalKg: 80, startKg: 68 }).ratio).toBe(0); // 後退は 0
    expect(goalProgress({ currentKg: 82, goalKg: 80, startKg: 68 }).ratio).toBe(1); // 超えは 1 に丸める
  });
  test('割合：初めがほぼ目標なら、届いていれば 1・届いていなければ 0（現在／目標にしない）', () => {
    // 減量中：月の初めは目標どおりだったが、今は目標を上回っている。現在／目標（66/60）だと満杯になってしまう
    expect(goalProgress({ currentKg: 66, goalKg: 60, startKg: 60 }).ratio).toBe(0);
    expect(goalProgress({ currentKg: 60.4, goalKg: 60, startKg: 60.02 }).ratio).toBe(0);
    expect(goalProgress({ currentKg: 74, goalKg: 80, startKg: 80 }).ratio).toBe(0); // 増量でも同じ
    const reached = goalProgress({ currentKg: 60.02, goalKg: 60, startKg: 60 });
    expect(reached.ratio).toBe(1);
    expect(reached.reached).toBe(true);
    // 節目は今から目標までの位置（75→60 の間の 70kg は左から 1/3）
    const p = goalProgress({ currentKg: 75, goalKg: 60, startKg: 60 });
    expect(p.milestoneKg).toBe(70);
    expect(p.milestoneRatio).toBeCloseTo(5 / 15, 6);
  });
  test('割合：初めがなければ 現在／目標', () => {
    expect(goalProgress({ currentKg: 40, goalKg: 80 }).ratio).toBeCloseTo(0.5, 6);
  });
  test('節目の位置：初め〜目標の間の割合（マーカー用）', () => {
    const p = goalProgress({ currentKg: 69.8, goalKg: 80, startKg: 68 });
    expect(p.milestoneRatio).toBeCloseTo((70 - 68) / (80 - 68), 6);
  });
  test('届いたら remaining 0・ratio 1・reached true（差 0.05kg 未満。bodyChange と同じ）', () => {
    const p = goalProgress({ currentKg: 79.98, goalKg: 80, startKg: 70 });
    expect(p.reached).toBe(true);
    expect(p.remainingKg).toBe(0);
    expect(p.ratio).toBe(1);
  });
  test('減量でも残りと節目までの残りは正の数', () => {
    const p = goalProgress({ currentKg: 75, goalKg: 60, startKg: 78 });
    expect(p.remainingKg).toBe(15);
    expect(p.milestoneKg).toBe(70);
    expect(p.toMilestoneKg).toBe(5);
    expect(p.ratio).toBeCloseTo((75 - 78) / (60 - 78), 6);
  });
});
