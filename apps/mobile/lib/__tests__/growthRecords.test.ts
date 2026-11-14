// 「成長を見る」の下の「成長の記録」のカードの計算（lib/growthRecords.ts と、lib/growth.ts に足した関数）
import { addDays } from '../date';
import { GrowthDay, growthScore, longestTrainingStreak, personalBestEvents, scoreDetail, weeklyScores } from '../growth';
import {
  big3CardLabel, big3Growth, bodyCardLabel, bodyChange, bodyDatesNote, carsCount, partsCardLabel, partsNote, pbRowText, pbTimeline,
  pctText, recordsSpan, scoreCardLabel, scoreDetailLines, signedText, topPart, totals, totalsCardLabel, volumeText, weekBarsEnds,
} from '../growthRecords';
import { BALANCE_PARTS, partBalance, partBalanceBetween } from '../partBalance';
import type { TrainingSetRow } from '../training';

const day = (date: string, p: Partial<GrowthDay> = {}): GrowthDay => ({
  date, trained: (p.volumeKg ?? 0) > 0, volumeKg: 0, mealRecorded: false, mealGoalReached: false, sleepMin: null, ...p,
});
const set = (date: string, exerciseId: string, weightKg: number | null, reps: number, bodyPartId = 'chest'): TrainingSetRow => ({
  date, exerciseId, bodyPartId, weightKg, reps,
});
const TODAY = '2026-11-11';

describe('見出しの1行', () => {
  test('始めた日から今日までの日数は、始めた日を1日目と数える', () => {
    expect(recordsSpan('2026-06-07', TODAY)).toEqual({
      text: '始めたとき（6月7日）→ 今日（11月11日）・158日', label: '成長の記録、6月7日から今日まで158日',
    });
    expect(recordsSpan(TODAY, TODAY)?.text).toBe('始めたとき（11月11日）→ 今日（11月11日）・1日');
    expect(recordsSpan(null, TODAY)).toBeNull();
  });
});

describe('① 成長スコアの内訳', () => {
  test('週ごとの点数：今日で終わる7日を7日ずつさかのぼる。158日なら23本、古い順、最後の週の終わりは今日', () => {
    const days = [day('2026-06-07', { volumeKg: 1000 }), day(TODAY, { volumeKg: 1000 })];
    const w = weeklyScores(days, TODAY, 3);
    expect(w).toHaveLength(23);
    expect(w[w.length - 1]).toMatchObject({ start: '2026-11-05', end: TODAY });
    expect(w[0].end >= '2026-06-07').toBe(true);
    expect(w[0].start <= '2026-06-07').toBe(true);
    // どの週も7日ずつ
    for (let i = 1; i < w.length; i++) expect(w[i].end).toBe(addDays(w[i - 1].end, 7));
    // 最後の週はホームの成長スコアと同じ
    expect(w[w.length - 1].total).toBe(growthScore(days, TODAY, 3).total);
  });

  test('週ごとの点数：記録が0件なら空、今日だけなら1本', () => {
    expect(weeklyScores([], TODAY)).toEqual([]);
    const w = weeklyScores([day(TODAY, { volumeKg: 100 })], TODAY);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ start: '2026-11-05', end: TODAY });
  });

  test('棒の両はし：左は最初の週（始まりは最初の記録の日）、右は今', () => {
    const w = [{ start: '2026-06-03', end: '2026-06-09', total: 42 }, { start: '2026-06-10', end: '2026-06-16', total: 78 }];
    expect(weekBarsEnds(w, '2026-06-07')).toEqual({ left: '6月7日の週　42', right: '今　78' });
    expect(weekBarsEnds([], null)).toBeNull();
  });

  test('柱ごとの数え方：回数・負荷量・食事・睡眠', () => {
    const days = [
      // 前4週（負荷量の基準）：週平均 1000kg
      day('2026-10-10', { volumeKg: 4000 }),
      day('2026-11-06', { volumeKg: 400, mealRecorded: true, mealGoalReached: true, sleepMin: 360 }),
      day('2026-11-08', { volumeKg: 300, mealRecorded: true, mealGoalReached: false, sleepMin: 386 }),
      day('2026-11-10', { mealRecorded: true, mealGoalReached: true }),
    ];
    const d = scoreDetail(days, TODAY, 3);
    expect(d).toEqual({
      trainDays: 2, weeklyTarget: 3, countPoints: expect.closeTo(40 / 3, 9), volumeRatio: 0.7, volumePoints: 14,
      mealDays: 3, mealGoalDays: 2, sleepAvgMin: 373,
    });
    const s = growthScore(days, TODAY, 3);
    expect(s.training.points).toBeCloseTo(d.countPoints + d.volumePoints, 9);
    expect(scoreDetailLines(d, s)).toEqual({
      training: '回数 2 / 3日 → 13点　＋　負荷量 前4週の週平均の70% → 14点',
      meal: '食事を記録した3日のうち、目標に届いた日 2日 → 20点',
      sleep: '記録した日の平均 6時間13分 ÷ 7時間 → 27点',
    });
  });

  test('前4週に負荷量がない・食事も睡眠もないときの言葉。週の目標が未設定なら3日', () => {
    const days = [day(TODAY, { volumeKg: 100 })];
    const d = scoreDetail(days, TODAY, null);
    expect(d.weeklyTarget).toBe(3);
    expect(d.volumeRatio).toBeNull();
    expect(scoreDetailLines(d, growthScore(days, TODAY, null))).toEqual({
      training: '回数 1 / 3日 → 7点　＋　負荷量 前4週の記録なし（回数の割合で） → 7点',
      meal: '直近7日に食事の記録がありません',
      sleep: '直近7日に睡眠の記録がありません',
    });
  });

  test('読み上げ：点・先週との差・柱・週の数', () => {
    const days = [day('2026-10-30', { volumeKg: 100 }), day(TODAY, { volumeKg: 100 })];
    const s = growthScore(days, TODAY, 1);
    const w = weeklyScores(days, TODAY, 1);
    expect(scoreCardLabel(s, w)).toBe(
      `成長スコアの内訳。成長スコア ${s.total}点、直近7日。先週と同じ。筋トレ 40点、40点満点。食事 記録なし。睡眠 記録なし。週ごとの点数 2週、最初 ${w[0].total}点、今 ${w[1].total}点`,
    );
    expect(scoreCardLabel(null, [])).toBe('成長スコアの内訳。まだ記録がありません');
  });
});

describe('② 強くなった（BIG3）', () => {
  const big3 = { bench: 'b', squat: 's' };
  test('始めたとき＝その種目を最初に記録した日の推定1RM、今＝今日までの最高。伸び率は四捨五入', () => {
    const sets = [
      set('2026-06-09', 'b', 60, 1), set('2026-06-09', 'b', 50, 5),
      set('2026-09-14', 'b', 75, 3), set('2026-10-01', 'b', 70, 3), // 82.5 が最高。その後の低い値は今に入らない
      set('2026-06-11', 's', 80, 1), set('2026-10-25', 's', 115, 1),
      set('2026-11-20', 's', 200, 1), // 今日より後は見ない
      set('2026-06-13', 'd', 100, 1), // 割り当てのない種目は出さない
    ];
    expect(big3Growth(sets, big3, TODAY)).toEqual([
      { role: 'bench', name: 'ベンチプレス', startDate: '2026-06-09', startKg: 60, nowKg: 82.5, pct: 38 },
      { role: 'squat', name: 'スクワット', startDate: '2026-06-11', startKg: 80, nowKg: 115, pct: 44 },
    ]);
    expect(big3CardLabel(big3Growth(sets, big3, TODAY), 'kg')).toBe(
      '強くなった、BIG3 の推定1RM。ベンチプレス 60kg から 82.5kg、38%増。スクワット 80kg から 115kg、44%増',
    );
  });

  test('1日だけの記録は ±0%。割り当てがない・回数だけの記録しかないときは空', () => {
    expect(big3Growth([set(TODAY, 'b', 60, 5)], big3, TODAY)).toEqual([
      { role: 'bench', name: 'ベンチプレス', startDate: TODAY, startKg: 70, nowKg: 70, pct: 0 },
    ]);
    expect(big3Growth([set(TODAY, 'b', 60, 5)], {}, TODAY)).toEqual([]);
    expect(big3Growth([set(TODAY, 'b', null, 10)], big3, TODAY)).toEqual([]);
    expect(big3CardLabel([], 'kg')).toBe('強くなった、BIG3 の推定1RM。まだ記録がありません');
  });

  test('伸び率の文字', () => {
    expect(pctText(38)).toEqual({ dir: 'up', text: '↑ +38%', spoken: '38%増' });
    expect(pctText(-5)).toEqual({ dir: 'down', text: '↓ −5%', spoken: '5%減' });
    expect(pctText(0)?.text).toBe('±0%');
    expect(pctText(null)).toBeNull();
  });
});

describe('③ 体の変化', () => {
  test('いちばん古い記録と新しい記録。今日より後は見ない。なければ null、1件なら差 0', () => {
    const w = bodyChange([
      { date: '2026-11-10', value: 68.4 }, { date: '2026-06-07', value: 72 }, { date: '2026-11-12', value: 60 },
    ], TODAY);
    expect(w).toEqual({ from: { date: '2026-06-07', value: 72 }, to: { date: '2026-11-10', value: 68.4 }, diff: expect.closeTo(-3.6, 9) });
    expect(bodyChange([], TODAY)).toBeNull();
    expect(bodyChange([{ date: TODAY, value: 70 }], TODAY)?.diff).toBe(0);
  });

  test('差の文字と注記（日が違えば項目ごと）。読み上げは増・減で、色の良し悪しは付けない', () => {
    expect(signedText(-3.6)).toBe('−3.6');
    expect(signedText(0.4)).toBe('+0.4');
    expect(signedText(0.01)).toBe('±0');
    const w = bodyChange([{ date: '2026-06-07', value: 72 }, { date: TODAY, value: 68.4 }], TODAY);
    const f = bodyChange([{ date: '2026-06-07', value: 22 }, { date: TODAY, value: 17.5 }], TODAY);
    const f2 = bodyChange([{ date: '2026-06-09', value: 22 }, { date: '2026-11-10', value: 17.5 }], TODAY);
    expect(bodyDatesNote(w, f)).toBe('始めたとき 6月7日・今 11月11日（それぞれいちばん古い・新しい記録）');
    expect(bodyDatesNote(w, f2)).toBe('体重 6月7日 → 11月11日、体脂肪率 6月9日 → 11月10日（それぞれいちばん古い・新しい記録）');
    expect(bodyDatesNote(null, f2)).toBe('始めたとき 6月9日・今 11月10日（それぞれいちばん古い・新しい記録）');
    expect(bodyDatesNote(null, null)).toBeNull();
    expect(bodyCardLabel(w, f, 'kg')).toBe('体の変化。体重 72.0kg から 68.4kg、3.6kg 減。体脂肪率 22.0% から 17.5%、4.5ポイント 減');
    expect(bodyCardLabel(null, null, 'kg')).toBe('体の変化。体重と体脂肪率の記録がまだありません');
  });
});

describe('④ 積み重ね', () => {
  test('いちばん長く続いた連続：筋トレした日が暦の上で続いた最長の日数', () => {
    expect(longestTrainingStreak([], TODAY)).toBe(0);
    expect(longestTrainingStreak([TODAY], TODAY)).toBe(1);
    // 同じ日が何度あっても1日。月をまたいでも続く。1日空くと切れる
    expect(longestTrainingStreak(['2026-10-30', '2026-10-31', '2026-10-31', '2026-11-01', '2026-11-03', '2026-11-04'], TODAY)).toBe(3);
    // 並びの順は問わない。今日より後は見ない
    expect(longestTrainingStreak(['2026-11-12', TODAY, '2026-11-10', '2026-11-13'], TODAY)).toBe(2);
  });

  test('総負荷量（ホームと同じ setVolume の合計）、車の台数（1台 1.5t）、筋トレした日、食事の数', () => {
    const sets = [
      set('2026-11-01', 'b', 100, 10), set('2026-11-01', 'b', 100, 10), set('2026-11-02', 'b', 50, 10),
      { ...set('2026-11-03', 'p', null, 10), bodyweightLoadKg: 70 }, set('2026-11-20', 'b', 100, 10),
    ];
    const t = totals(sets, 412, TODAY);
    expect(t).toEqual({ volumeKg: 3200, cars: 3200 / 1500, trainingDays: 3, meals: 412, longestStreak: 3 });
    expect(volumeText(412_600, 'kg')).toEqual({ value: '412.6', unit: 't' });
    expect(carsCount(275.07)).toBe('275');
    expect(carsCount(0.4)).toBe('0.4');
    expect(totalsCardLabel(t, 'kg')).toBe('積み重ね、これまで。総負荷量 3.2トン、乗用車 2台分。筋トレした日 3日、記録した食事 412食、いちばん長く続いた連続 3日');
    expect(totals([], 0, TODAY)).toEqual({ volumeKg: 0, cars: 0, trainingDays: 0, meals: 0, longestStreak: 0 });
  });
});

describe('⑤ 部位の積み重ね', () => {
  const names: Record<string, string> = { chest: '胸', legs: '脚', abs: '腹筋' };
  const nameOf = (id: string) => names[id] ?? '';
  const rows = [
    ...Array.from({ length: 10 }, () => set('2026-06-07', 'b', 50, 10, 'chest')),
    ...Array.from({ length: 4 }, () => set('2026-11-05', 'q', 50, 10, 'legs')),
    set('2026-11-06', 'c', 50, 10, 'abs'),
  ];
  test('これまで（from が null）は最初の記録から数える。直近2週は partBalance と同じ', () => {
    const all = partBalanceBetween(rows, nameOf, null, TODAY);
    expect(all.sets[BALANCE_PARTS.indexOf('胸')]).toBe(10);
    expect(all.total).toBe(15);
    expect(partBalanceBetween(rows, nameOf, '2026-10-29', TODAY)).toEqual(partBalance(rows, nameOf, TODAY));
  });

  test('外周の部位と一言・読み上げ。記録がなければ一言なし', () => {
    const all = partBalanceBetween(rows, nameOf, null, TODAY);
    const recent = partBalance(rows, nameOf, TODAY);
    expect(topPart(all)).toBe('胸');
    expect(topPart(recent)).toBe('脚');
    expect(partsNote(all, recent)).toBe('外周は、その期間でいちばん多い部位（これまでは胸、直近2週は脚）');
    expect(partsNote(all, all)).toBe('外周は、その期間でいちばん多い部位（どちらも胸）');
    const none = partBalance([], nameOf, TODAY);
    expect(partsNote(all, none)).toBe('外周は、その期間でいちばん多い部位（これまでは胸。直近2週は記録なし）');
    expect(partsNote(none, none)).toBeNull();
    // 推移の 28日（ホームの PARTS から来たとき）は期間の名前を変える
    expect(partsNote(all, recent, { all: '直近28日', recent: '前の28日' })).toBe('外周は、その期間でいちばん多い部位（直近28日は胸、前の28日は脚）');
    const list = (b: typeof all) => BALANCE_PARTS.map((p, i) => `${p} ${b.sets[i]}`).join('、');
    expect(partsCardLabel(all, recent)).toBe(`部位の積み重ね、これまでの部位ごとのセット数。${list(all)}。直近2週は ${list(recent)}`);
    expect(partsCardLabel(none, none)).toBe('部位の積み重ね。まだ記録がありません');
  });
});

describe('⑥ 自己ベストの年表', () => {
  test('自己ベストを更新した日（初回は数えない・同じ値は数えない）を、新しい順に5件。重量×回数はその日の最高のセット', () => {
    const sets = [
      set('2026-06-01', 'b', 60, 1), // 初回
      set('2026-06-08', 'b', 60, 1), // 同じ値
      set('2026-06-15', 'b', 60, 5), set('2026-06-15', 'b', 62.5, 1), // 70 が最高
      set('2026-06-22', 'b', 65, 5),
      set('2026-06-02', 's', 80, 1), set('2026-07-01', 's', 90, 1), set('2026-08-01', 's', 100, 3), set('2026-09-01', 's', 105, 3),
      set('2026-11-20', 's', 200, 1), // 今日より後
    ];
    const ev = personalBestEvents(sets, TODAY);
    expect(ev.map((e) => [e.date, e.exerciseId])).toEqual([
      ['2026-06-15', 'b'], ['2026-06-22', 'b'], ['2026-07-01', 's'], ['2026-08-01', 's'], ['2026-09-01', 's'],
    ]);
    expect(ev[0]).toEqual({ date: '2026-06-15', exerciseId: 'b', weightKg: 60, reps: 5, e1rm: 70 });
    const t = pbTimeline(sets, TODAY);
    expect(t.map((e) => e.date)).toEqual(['2026-09-01', '2026-08-01', '2026-07-01', '2026-06-22', '2026-06-15']);
    expect(pbTimeline(sets, TODAY, 2).map((e) => e.date)).toEqual(['2026-09-01', '2026-08-01']);
    expect(pbTimeline([], TODAY)).toEqual([]);
    expect(pbTimeline([set(TODAY, 'b', 60, 1)], TODAY)).toEqual([]);
  });

  test('1行の文字と読み上げ（lb でも）', () => {
    const e = { date: '2026-11-08', exerciseId: 'd', weightKg: 120, reps: 5, e1rm: 140 };
    expect(pbRowText(e, 'デッドリフト', 'kg')).toEqual({
      set: '120 kg × 5', e1rm: '推定1RM 140.0 kg', label: '11月8日、デッドリフト、120kg 5回、推定1RM 140.0 kg',
    });
    expect(pbRowText(e, 'デッドリフト', 'lb').set).toBe('264.55 lb × 5');
  });
});
