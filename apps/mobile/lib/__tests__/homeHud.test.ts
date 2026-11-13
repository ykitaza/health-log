import {
  big3Gauge, fuelGauge, latestSession, loadGauge, logCellLabel, logFrom, logGrid, monthSummary, partInitial, partsRadar, partStates,
  sleepGauge, volumeLevel,
} from '../homeHud';
import type { PartRecovery } from '../recoveryMap';
import type { TrainingSetRow } from '../training';

const TODAY = '2026-11-08'; // 日曜。今週は 11/2〜11/8
const row = (date: string, exerciseId: string, weightKg: number | null, reps: number, bodyPartId = 'chest'): TrainingSetRow =>
  ({ date, exerciseId, bodyPartId, weightKg, reps });
const PART_NAMES: Record<string, string> = { chest: '胸', back: '背中', legs: '脚', tri: '上腕三頭筋', sh: '肩' };
const partName = (id: string) => PART_NAMES[id] ?? '';

describe('LATEST：直近のトレーニング', () => {
  test('今日までのいちばん新しい日の種目・セット・負荷量・自己ベスト', () => {
    const rows = [
      row('2026-11-01', 'bench', 80, 8),
      row('2026-11-06', 'bench', 85, 8), // 自己ベストを更新
      row('2026-11-06', 'bench', 80, 8),
      row('2026-11-06', 'dips', 20, 10),
      row('2026-11-09', 'bench', 200, 1), // 未来は見ない
    ];
    const s = latestSession(rows, TODAY)!;
    expect(s.date).toBe('2026-11-06');
    expect(s.exercises).toBe(2);
    expect(s.sets).toBe(3);
    expect(s.volumeKg).toBe(85 * 8 + 80 * 8 + 200);
    // dips はその種目の最初の日なので数えない
    expect(s.prs.map((p) => p.exerciseId)).toEqual(['bench']);
  });
  test('記録がなければ null', () => {
    expect(latestSession([], TODAY)).toBeNull();
  });
});

describe('BIG3：B・S・D と 28 日前からの差、16 週の線', () => {
  const assigned = { bench: 'bench', squat: 'squat', deadlift: 'dl' };
  test('28 日より前に記録があれば、28 日前の合計との差', () => {
    const rows = [
      row('2026-09-01', 'bench', 100, 1),
      row('2026-09-01', 'squat', 120, 1),
      row('2026-11-05', 'squat', 130, 1),
    ];
    const g = big3Gauge(rows, assigned, TODAY)!;
    expect(g.lifts).toEqual([{ role: 'bench', kg: 100 }, { role: 'squat', kg: 130 }, { role: 'deadlift', kg: null }]);
    expect(g.totalKg).toBe(230);
    expect(g.deltaBase).toBe('28D');
    expect(g.deltaKg).toBe(10);
    // 線は 0〜1 の中で、最後が今。自己ベストは今と同じ点
    expect(g.points[0].x).toBeGreaterThan(0);
    expect(g.points[g.now].x).toBe(1);
    expect(g.best).toBe(g.now);
  });
  test('記録が 28 日に満たなければ、最初の点との差（START）', () => {
    const rows = [row('2026-11-01', 'bench', 100, 1), row('2026-11-06', 'bench', 105, 1)];
    const g = big3Gauge(rows, assigned, TODAY)!;
    expect(g.deltaBase).toBe('START');
    expect(g.deltaKg).toBe(5);
  });
  test('1 種目も記録がなければ null', () => {
    expect(big3Gauge([row('2026-11-01', 'other', 100, 1)], assigned, TODAY)).toBeNull();
    expect(big3Gauge([], {}, TODAY)).toBeNull();
  });
});

describe('LOAD：今週 7 日と先週、先週の同じ曜日までとの比', () => {
  test('月曜から今日まで。先週の同じ分と比べる', () => {
    const rows = [
      row('2026-11-02', 'b', 100, 10), // 今週の月曜 1000
      row('2026-11-08', 'b', 100, 5), //  今日 500
      row('2026-10-26', 'b', 100, 10), // 先週の月曜 1000
      row('2026-10-30', 'b', 50, 10), //  先週の金曜 500
    ];
    const g = loadGauge(rows, TODAY);
    expect(g.thisWeek).toEqual([1000, 0, 0, 0, 0, 0, 500]);
    expect(g.lastWeek).toEqual([1000, 0, 0, 0, 500, 0, 0]);
    expect(g.totalKg).toBe(1500);
    expect(g.vsLastWeekPct).toBe(0);
  });
  test('今日より後は null。先週のその分が 0 なら比は null', () => {
    const g = loadGauge([row('2026-11-04', 'b', 100, 1)], '2026-11-04');
    expect(g.thisWeek).toEqual([0, 0, 100, null, null, null, null]);
    expect(g.vsLastWeekPct).toBeNull();
  });
  test('先週の同じ曜日までより多ければ +', () => {
    const g = loadGauge([row('2026-11-03', 'b', 110, 10), row('2026-10-27', 'b', 100, 10), row('2026-10-31', 'b', 999, 10)], '2026-11-03');
    expect(g.vsLastWeekPct).toBe(10);
  });
});

describe('SLEEP：昨夜と 7 日', () => {
  test('今日に起きた分が昨夜。平均は記録のある日だけ', () => {
    const g = sleepGauge([{ date: '2026-11-08', asleepMin: 420 }, { date: '2026-11-06', asleepMin: 360 }, { date: '2026-11-01', asleepMin: 600 }], TODAY);
    expect(g.lastNightMin).toBe(420);
    expect(g.days.map((d) => d.min)).toEqual([null, null, null, null, 360, null, 420]);
    expect(g.averageMin).toBe(390);
    expect(g.goalMin).toBe(420);
  });
  test('記録がなければ null', () => {
    const g = sleepGauge([], TODAY);
    expect(g.lastNightMin).toBeNull();
    expect(g.averageMin).toBeNull();
  });
});

describe('LOG：週ごとの方眼', () => {
  test('部位の頭文字', () => {
    expect(partInitial('背中')).toBe('背');
    expect(partInitial('上腕三頭筋')).toBe('腕');
    expect(partInitial('腹筋')).toBe('腹');
    expect(partInitial('ふくらはぎ')).toBe('ふ');
  });
  test('塗りの段は、いちばん多い日を 3 として 3 等分', () => {
    expect(volumeLevel(0, 900)).toBe(0);
    expect(volumeLevel(300, 900)).toBe(1);
    expect(volumeLevel(301, 900)).toBe(2);
    expect(volumeLevel(600, 900)).toBe(2);
    expect(volumeLevel(900, 900)).toBe(3);
  });

  const meal = (date: string, kcal: number, protein: number) => ({
    date, meals: [{}] as never[], total: { kcal, protein_g: protein, fat_g: 0, carbs_g: 0 },
    target: { kcal: 2000, protein_g: 100, fat_g: null, carbs_g: null },
  });

  test('直近 4 週（月曜始まり）。今週がいちばん下で、未来の日は空', () => {
    const today = '2026-11-05'; // 木曜
    expect(logFrom(today)).toBe('2026-10-12');
    const weeks = logGrid({
      rows: [
        row('2026-11-02', 'b', 100, 9, 'back'), // 900 → 3
        row('2026-10-14', 'b', 100, 3, 'legs'), // 300 → 1
        row('2026-10-14', 't', 10, 10, 'tri'),
        row('2026-10-01', 'b', 999, 9, 'chest'), // 方眼より前は見ない
      ],
      partName,
      meals: [meal('2026-11-02', 1900, 95), meal('2026-11-03', 1000, 100)],
      weighed: new Set(['2026-11-03']),
      injured: new Set(['2026-10-14']),
      suggest: '胸',
    }, today);
    expect(weeks.map((w) => w.label)).toEqual(['W1', 'W2', 'W3', 'W4']);
    expect(weeks.map((w) => w.current)).toEqual([false, false, false, true]);
    expect(weeks[0].cells[0].date).toBe('2026-10-12');
    const cell = (d: string) => weeks.flatMap((w) => w.cells).find((c) => c.date === d)!;
    expect(cell('2026-11-02')).toMatchObject({ level: 3, part: '背中', initial: '背', mealGoal: true, weighed: false, injury: false });
    expect(cell('2026-10-14')).toMatchObject({ level: 2, part: '脚', initial: '脚', injury: true }); // 300 + 100 = 400 / 900
    expect(cell('2026-11-03')).toMatchObject({ level: 0, part: null, mealGoal: false, weighed: true });
    // 今日はまだ記録がないので、おすすめの部位
    expect(cell(today)).toMatchObject({ today: true, level: 0, part: '胸', initial: '胸', suggested: true });
    expect(cell('2026-11-06')).toMatchObject({ future: true, part: null, weighed: false });
  });

  test('今日に記録があれば、おすすめではなくその日の部位', () => {
    const weeks = logGrid({ rows: [row(TODAY, 'b', 50, 10, 'legs')], partName, meals: [], weighed: new Set(), injured: new Set(), suggest: '胸' }, TODAY);
    expect(weeks[3].cells[6]).toMatchObject({ today: true, level: 3, part: '脚', suggested: false });
  });

  test('読み上げ', () => {
    const weeks = logGrid({
      rows: [row(TODAY, 'b', 50, 10, 'legs')], partName, meals: [meal(TODAY, 2000, 100)], weighed: new Set([TODAY]), injured: new Set([TODAY]), suggest: null,
    }, TODAY);
    expect(logCellLabel(weeks[3].cells[6], '11月8日（日）', '0.50トン')).toBe('11月8日（日） 今日、筋トレ 0.50トン 脚、食事の目標を達成、体重を測った、ケガ');
    expect(logCellLabel(weeks[3].cells[5], '11月7日（土）', '')).toBe('11月7日（土）、筋トレなし');
  });

  test('今月の日数と合計負荷量', () => {
    const rows = [row('2026-11-01', 'b', 100, 10), row('2026-11-01', 'b', 100, 10), row('2026-11-06', 'b', 100, 5), row('2026-10-31', 'b', 100, 10)];
    expect(monthSummary(rows, TODAY)).toEqual({ month: 'NOV', days: 2, volumeKg: 2500 });
  });
});

describe('PARTS：今の 28 日と前の 28 日', () => {
  test('2 つの期間を同じ最大でそろえ、増減と少ない部位', () => {
    const rows = [
      ...Array.from({ length: 4 }, () => row('2026-11-01', 'b', 100, 5, 'chest')), // 今：胸 4
      row('2026-11-01', 'b', 100, 5, 'back'), // 今：背中 1
      ...Array.from({ length: 16 }, () => row('2026-10-01', 'b', 100, 5, 'chest')), // 前：胸 16（10/1 は 29〜56 日前）
      row('2026-09-01', 'b', 100, 5, 'legs'), // 56 日より前は見ない
    ];
    const r = partsRadar(rows, partName, TODAY);
    // 軸：胸・肩・背中・腕・脚・腹
    expect(r.sets).toEqual([4, 0, 1, 0, 0, 0]);
    expect(r.prevSets).toEqual([16, 0, 0, 0, 0, 0]);
    expect(r.prevRatios[0]).toBe(1);
    expect(r.ratios[0]).toBeCloseTo(0.5);
    expect(r.trend).toEqual(['down', 'flat', 'up', 'flat', 'flat', 'flat']);
    expect(r.low).toBe('肩');
  });
  test('記録がなければ low は null', () => {
    expect(partsRadar([], partName, TODAY).low).toBeNull();
  });
  test('軸ごとの状態：ケガが先、回復中は暖色', () => {
    const p = (name: string, level: number) => ({ name, level } as PartRecovery);
    const list = [p('胸', 0.5), p('上腕三頭筋', 0.3), p('背中', 0), p('脚', 0.4)];
    expect(partStates(list, (x) => x.name === '脚')).toEqual(['recovering', null, null, 'recovering', 'injury', null]);
  });
});

describe('FUEL：今日の kcal と PFC', () => {
  test('摂った量と目標、割合', () => {
    const f = fuelGauge({
      dayType: 'training', total: { kcal: 1500, protein_g: 100, fat_g: 50, carbs_g: 150 },
      target: { kcal: 2800, protein_g: 150, fat_g: 80, carbs_g: 380 },
    });
    expect(f.kcal).toBe(1500);
    expect(f.kcalTarget).toBe(2800);
    expect(f.ratio!.p).toBeCloseTo((400 / 1450) * 100);
    expect(f.grams).toEqual([{ key: 'P', g: 100, target: 150 }, { key: 'F', g: 50, target: 80 }, { key: 'C', g: 150, target: 380 }]);
  });
  test('目標がなく、食べていなければ割合は null', () => {
    const f = fuelGauge({ dayType: 'rest', total: { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }, target: null });
    expect(f.kcalTarget).toBeNull();
    expect(f.ratio).toBeNull();
    expect(f.grams[0].target).toBeNull();
  });
});
