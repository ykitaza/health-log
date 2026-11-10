// 画面の計算と入力の確かめ。E2E（e2e/*.spec.ts）で画面を通して確かめていたものを、画面が使う関数で確かめる。
// 画面の流れ（記録→保存→表示、Android 特有の動き）は E2E に残している（e2e/README.md の「テストの分け方」）
import { migrate } from '@/db/migrations';
import { SEED_BODY_PARTS, SEED_EXERCISES } from '@/db/seed';
import { memoryDb, repos, testDeps } from '@/test-utils/nodeDb';
import { weightOverview } from '../body';
import { workoutCsv } from '../csv';
import { addDays } from '../date';
import { searchExercises } from '../exercises';
import { formatSetLong, formatSigned, tonnes } from '../format';
import { copyOf, draftFromSet, prepareSave, SetDraft, toSetInputs } from '../sets';
import {
  changeOver, exerciseDailySeries, filterSince, periodStart, periodTotals, personalBests, rmFromInput, rmTable,
  TrainingSetRow, trainingDates, daysInMonth, vehicleRatio, weeklySummary, weeklyVolumeByBodyPart, weeklyVolumes,
} from '../training';
import { fmt1, kgToUnit } from '../units';

const TODAY = '2026-11-08'; // E2E と同じ「今日」（日曜）

describe('記録の入力：保存のボタンを押したとき（workout.spec.ts から）', () => {
  const d = (weight: string, reps: string, memo = ''): SetDraft => ({ key: 'a', weight, reps, memo, done: false });
  const save = (drafts: SetDraft[], type: 'weight_reps' | 'reps_only' = 'weight_reps') => prepareSave(drafts, type, 'kg');

  test.each([
    ['重量が空', '', '8', { weight: '重量を入れてください' }],
    ['重量が 0', '0', '8', { weight: '重量は 500kg までの正の数で入れてください' }],
    ['重量が負の数', '-5', '8', { weight: '重量は 500kg までの正の数で入れてください' }],
    ['重量が数字でない', 'abc', '8', { weight: '重量は 500kg までの正の数で入れてください' }],
    ['重量が指数の書き方', '1e3', '8', { weight: '重量は 500kg までの正の数で入れてください' }],
    ['重量が 500kg を超える', '500.5', '1', { weight: '重量は 500kg までの正の数で入れてください' }],
    ['回数が空', '80', '', { reps: '回数を入れてください' }],
    ['回数が 0', '80', '0', { reps: '回数を入れてください' }],
    ['回数が小数', '80', '8.5', { reps: '回数は整数で入れてください' }],
    ['回数が 10000 回を超える', '80', '10001', { reps: '回数は 10000 回までで入れてください' }],
  ])('%sなら保存しない', (_name, weight, reps, error) => {
    const r = save([d(weight, reps)]);
    expect(r.errors.get('a')).toEqual(error);
    expect(r.formError).toBe('入力を確かめてください');
    expect(r.sets).toEqual([]);
  });

  test('重量も回数も空ならセットがない。メモだけの行は、重量と回数の両方が要る', () => {
    expect(save([d('', ''), { ...d('', ''), key: 'b' }])).toMatchObject({ formError: 'セットを1つ以上入れてください', sets: [] });
    expect(save([d('', '', 'メモだけ')]).errors.get('a')).toEqual({ weight: '重量を入れてください', reps: '回数を入れてください' });
  });

  test('小数、全角の数字、「,」の小数点、上限の 500kg、回数 10000 回は受ける', () => {
    const drafts = [['62.5', '8'], ['６０', '１０'], ['57,5', '3'], ['500', '1'], ['80', '10000']].map(([w, r], i) => ({ ...d(w, r), key: `k${i}` }));
    const r = save(drafts);
    expect(r.formError).toBeNull();
    expect(r.sets.map((s) => formatSetLong(s.weightKg, s.reps, 'kg'))).toEqual([
      '62.5 kg × 8 回', '60.0 kg × 10 回', '57.5 kg × 3 回', '500.0 kg × 1 回', '80.0 kg × 10000 回',
    ]);
  });

  test('回数だけの種目：重量は見ず、回数 0 は断る。負荷量は 0', () => {
    expect(save([d('', '')], 'reps_only').formError).toBe('セットを1つ以上入れてください');
    expect(save([d('', '0')], 'reps_only').errors.get('a')).toEqual({ reps: '回数を入れてください' });
    const ok = save([d('', '12')], 'reps_only');
    expect(ok.sets).toEqual([{ id: undefined, weightKg: null, reps: 12, memo: '', done: false }]);
    expect(formatSetLong(null, 12, 'kg')).toBe('12 回');
    expect(tonnes(0)).toBe('0.00');
  });

  test('lb の表示：範囲は kg に直して確かめ、lb で出す（500kg = 1102.31lb）', () => {
    expect(prepareSave([d('1102.4', '1')], 'weight_reps', 'lb').errors.get('a')).toEqual({ weight: '重量は 1102.3lb までの正の数で入れてください' });
    expect(prepareSave([d('1102.3', '1')], 'weight_reps', 'lb').formError).toBeNull();
  });
});

describe('lb の表示で開いて保存しても、kg の値は変わらない（settings.spec.ts から）', () => {
  const saved = { id: 's1', weightKg: 80, reps: 8, memo: '前回のメモ', done: true };

  test('記録を開いて変えずに保存する', () => {
    const draft = draftFromSet(saved, 'lb', 'k1');
    expect(draft).toEqual({ key: 'k1', id: 's1', weight: '176.37', weightKg: 80, reps: '8', memo: '前回のメモ', done: true });
    expect(toSetInputs([draft], 'weight_reps', 'lb')[0]).toEqual({ id: 's1', weightKg: 80, reps: 8, memo: '前回のメモ', done: true });
  });

  test('「前回をコピー」してから「上のセットをコピー」して保存する。メモと完了は写さない', () => {
    const copied = copyOf(draftFromSet(saved, 'lb', ''), 'k1');
    expect(copied).toEqual({ key: 'k1', weight: '176.37', weightKg: 80, reps: '8', memo: '', done: false });
    const sets = prepareSave([copied, copyOf(copied, 'k2')], 'weight_reps', 'lb').sets;
    expect(sets.map((s) => [s.weightKg, s.reps, s.memo, s.done])).toEqual([[80, 8, '', false], [80, 8, '', false]]);
    expect(draftFromSet({ ...saved, weightKg: null }, 'kg', 'k').weight).toBe('');
  });
});

describe('CSV の書き出し（settings.spec.ts から）', () => {
  const HEADER = '日付,部位,種目,セット,重量(kg),回数,メモ,完了\r\n';
  const BENCH = SEED_EXERCISES[0].id;
  const id = (name: string) => SEED_EXERCISES.find((e) => e.name === name)!.id;

  test('記録がなければ見出しだけ', () => {
    expect(workoutCsv([])).toBe(HEADER);
  });

  test('メモの「,」と「"」はくくり、外した記録は出さず、完了は 1。重さは kg のまま', async () => {
    const db = memoryDb();
    const deps = testDeps();
    await migrate(db, deps.now);
    const r = repos(db, deps);
    await r.workouts.saveEntry({ date: TODAY, exerciseId: BENCH, sets: [
      { weightKg: 80, reps: 8, memo: 'フォーム "良い", 重い', done: true },
      { weightKg: 82.5, reps: 5, memo: '', done: false },
    ] });
    await r.workouts.saveEntry({ date: TODAY, exerciseId: id('懸垂'), sets: [{ weightKg: null, reps: 10, memo: '', done: false }] });
    const squat = await r.workouts.saveEntry({ date: TODAY, exerciseId: id('スクワット'), sets: [{ weightKg: 100, reps: 5, memo: '', done: false }] });
    await r.workouts.saveEntry({ date: TODAY, exerciseId: id('デッドリフト'), sets: [{ weightKg: 45.359237, reps: 5, memo: '', done: false }] });
    await r.workouts.deleteEntry(squat);
    expect(workoutCsv(await r.workouts.exportRows())).toBe(
      HEADER +
      '2026-11-08,胸,ベンチプレス,1,80,8,"フォーム ""良い"", 重い",1\r\n' +
      '2026-11-08,胸,ベンチプレス,2,82.5,5,,0\r\n' +
      '2026-11-08,背中,懸垂,1,,10,,0\r\n' +
      '2026-11-08,背中,デッドリフト,1,45.359237,5,,0\r\n',
    );
  });
});

describe('RM計算機（rm.spec.ts から）', () => {
  test('推定1RM と割合の表。小数の重量', () => {
    const oneRm = rmFromInput('100', '5'); // 100 ×（1 ＋ 5 ÷ 30）
    expect(fmt1(oneRm)).toBe('116.7');
    expect(rmTable(oneRm).map((r) => `${r.pct}% ${fmt1(r.weight)} ${r.reps}回`)).toEqual([
      '95% 110.8 2回', '90% 105.0 4回', '85% 99.2 6回', '80% 93.3 8回', '75% 87.5 10回', '70% 81.7 12回',
    ]);
    expect(fmt1(rmFromInput('62.5', '8'))).toBe('79.2');
  });

  test('空、0、負の数、数字でない、回数が小数なら 0（画面は「—」）', () => {
    for (const [w, r] of [['', '5'], ['100', ''], ['0', '5'], ['100', '0'], ['-100', '5'], ['100', '-5'], ['abc', '5'], ['100', '2.5']]) {
      expect(rmFromInput(w, r)).toBe(0);
    }
  });

  test('回数が1なら重量そのもの。2回からは Epley 式。lb のまま計算する', () => {
    expect(rmFromInput('100', '1')).toBe(100);
    expect(fmt1(rmTable(100)[0].weight)).toBe('95.0');
    expect(fmt1(rmFromInput('100', '2'))).toBe('106.7');
    expect(fmt1(rmFromInput('225', '5'))).toBe('262.5');
  });
});

/** ホームと履歴の E2E のデータを、集計の行にしたもの */
const row = (date: string, exerciseId: string, bodyPartId: string, weightKg: number | null, reps: number): TrainingSetRow =>
  ({ date, exerciseId, bodyPartId, weightKg, reps });

describe('ホームの数字（home.spec.ts から）', () => {
  // 10/1 デッドリフト 120×5、10/20 ベンチ 75×8×2、11/3 スクワット 100×5×3、11/8 ベンチ 80×8・80×8・70×10 と懸垂 10回
  const rows = [
    row('2026-10-01', 'dl', 'back', 120, 5),
    row('2026-10-20', 'bench', 'chest', 75, 8), row('2026-10-20', 'bench', 'chest', 75, 8),
    ...[1, 2, 3].map(() => row('2026-11-03', 'squat', 'legs', 100, 5)),
    row(TODAY, 'bench', 'chest', 80, 8), row(TODAY, 'bench', 'chest', 80, 8), row(TODAY, 'bench', 'chest', 70, 10),
    row(TODAY, 'chin', 'back', null, 10),
  ];

  test('総負荷量（7日・28日・総合計）と乗り物のたとえ', () => {
    const t = periodTotals(rows, TODAY);
    expect(t).toEqual({ last7: 3480, last28: 4680, total: 5280 });
    expect([tonnes(t.last7), tonnes(t.last28), tonnes(t.total)]).toEqual(['3.48', '4.68', '5.28']);
    expect(fmt1(vehicleRatio(t.last7, 'car'))).toBe('2.3');
    expect(fmt1(vehicleRatio(t.last28, 'bus'))).toBe('0.3');
    expect(fmt1(vehicleRatio(t.total, 'jumbo'))).toBe('0.0');
    expect(tonnes(640, 'lb')).toBe('1.41'); // 80kg × 8 を lb で：1.41k lb
  });

  test('週ごとの棒（今週から）と、トレーニングした日数', () => {
    // 週は月曜始まり：11/3 は今日（11/8・日曜）と同じ週
    expect(weeklyVolumes(rows, TODAY, 5)).toEqual([3480, 0, 1200, 0, 0]);
    const dates = trainingDates(rows);
    expect(dates).toHaveLength(4);
    expect(daysInMonth(dates, 2026, 11)).toBe(2);
  });
});

describe('履歴の数字（history.spec.ts から）', () => {
  // 9/15 ベンチ 60×10、10/20 スクワット 100×5、11/5 ベンチ 80×8×2、11/8 ベンチ 85×5 と懸垂 10回
  const rows = [
    row('2026-09-15', 'bench', 'chest', 60, 10),
    row('2026-10-20', 'squat', 'legs', 100, 5),
    row('2026-11-05', 'bench', 'chest', 80, 8), row('2026-11-05', 'bench', 'chest', 80, 8),
    row(TODAY, 'bench', 'chest', 85, 5), row(TODAY, 'chin', 'back', null, 10),
  ];
  const series = exerciseDailySeries(rows, 'bench');
  const change = (period: '1m' | '3m' | 'all', value: (p: (typeof series)[number]) => number) =>
    changeOver(filterSince(series, periodStart(TODAY, period)), value);

  test('グラフ：期間ごとの増減（総負荷量と最大RM）', () => {
    expect(filterSince(series, periodStart(TODAY, '3m')).map((p) => p.date)).toEqual(['2026-09-15', '2026-11-05', TODAY]);
    expect(change('3m', (p) => p.volume)).toBe(425 - 600);
    expect(formatSigned(change('3m', (p) => p.max1RM)!)).toBe('+19.2'); // 99.17 − 80
    expect(change('1m', (p) => p.volume)).toBe(425 - 1280);
    expect(formatSigned(change('1m', (p) => p.max1RM)!)).toBe('−2.2'); // 99.17 − 101.33
    expect(change('all', (p) => p.volume)).toBe(-175);
    // 1日しかない種目は、グラフにしない（1 日）
    expect(exerciseDailySeries(rows, 'squat')).toHaveLength(1);
    // 回数だけの種目は、推移の点に重さがない
    expect(exerciseDailySeries(rows, 'chin').every((p) => p.volume === 0 && p.max1RM === 0)).toBe(true);
  });

  test('「すべて」：週ごとの総負荷量の見出しと、自己ベストの順', () => {
    const weeks = weeklyVolumeByBodyPart(rows, TODAY, 8);
    const s = weeklySummary(weeks);
    // 週は月曜始まり：11/5 は今日（11/8・日曜）と同じ週
    expect(s).toEqual({ thisWeek: 1705, lastWeek: 0, avg: (600 + 500 + 1705) / 8 });
    expect([(s.thisWeek / 1000).toFixed(1), (s.avg / 1000).toFixed(1), ((s.thisWeek - s.lastWeek) / 1000).toFixed(1)]).toEqual(['1.7', '0.4', '1.7']);
    // 凡例に出す部位：記録のある部位だけ（回数だけの懸垂の背中は出ない）
    expect(new Set(weeks.flatMap((w) => Object.keys(w.byPart)))).toEqual(new Set(['chest', 'legs']));
    const pbs = [...personalBests(rows).values()].sort((a, b) => b.e1rm - a.e1rm);
    expect(pbs.map((p) => [p.exerciseId, fmt1(p.e1rm)])).toEqual([['squat', '116.7'], ['bench', '101.3']]);
  });

  test('回数だけの記録しかないとき：自己ベストはなく、週の数字は 0', () => {
    const only = [row(TODAY, 'chin', 'back', null, 10)];
    expect(personalBests(only).size).toBe(0);
    expect(weeklySummary(weeklyVolumeByBodyPart(only, TODAY, 8))).toEqual({ thisWeek: 0, lastWeek: 0, avg: 0 });
  });
});

describe('体組成の目標体重と体重の推移（body.spec.ts から）', () => {
  const day = (offset: number, weightKg: number | null) => ({ date: addDays(TODAY, offset), weightKg });

  test('目標がない・体重がないときはカードを出さない', () => {
    expect(weightOverview([day(0, 68.4)], null, TODAY).progress).toBeNull();
    expect(weightOverview([day(0, null)], 65, TODAY).progress).toBeNull();
    expect(weightOverview([], 65, TODAY).progress).toBeNull();
  });

  test('残りと、記録が1つならペースなし', () => {
    const o = weightOverview([day(0, 68.4)], 65, TODAY);
    expect(o.pace).toBeNull();
    expect(o.progress).toMatchObject({ direction: 'lose', weeks: null });
    expect(fmt1(o.progress!.remaining)).toBe('3.4');
  });

  test('14日前に 70.0：ペース −0.8kg／週、約5週。増やす目標なら週数を出さない。届いたとき', () => {
    const daily = [day(-14, 70), day(0, 68.4)];
    const o = weightOverview(daily, 65, TODAY);
    expect(formatSigned(o.pace!)).toBe('−0.8');
    expect(o.progress?.weeks).toBe(5); // 3.4 ÷ 0.8 = 4.25 → 5
    expect(weightOverview(daily, 72, TODAY).progress).toMatchObject({ direction: 'gain', weeks: null });
    expect(weightOverview(daily, 68.4, TODAY).progress).toMatchObject({ direction: 'reached', remaining: 0 });
  });

  test('開いている日に体重がなくても、今日までのいちばん新しい体重で見る。先の日の記録は使わない', () => {
    const o = weightOverview([day(-1, 66), day(0, null), day(1, 60)], 65, TODAY);
    expect(fmt1(o.progress!.remaining)).toBe('1.0');
  });

  test('1か月の増減：1か月より前の記録は入れない', () => {
    // 10/1 70.5（範囲の外）、10/25 70.0、11/8 68.4
    const o = weightOverview([day(-38, 70.5), day(-14, 70), day(0, 68.4)], null, TODAY);
    expect(o.from).toBe('2026-10-08');
    expect(o.recent.map((p) => p.date)).toEqual(['2026-10-25', TODAY]);
    expect(formatSigned(o.monthChange!)).toBe('−1.6');
    expect(weightOverview([day(0, 68.4)], null, TODAY).monthChange).toBeNull();
    expect(formatSigned(0)).toBe('+0.0');
  });
});

describe('種目の選択の絞り込み（catalog.spec.ts から）', () => {
  const part = (name: string) => SEED_BODY_PARTS.find((p) => p.name === name)!.id;
  const names = (partId: string | null, query: string) => searchExercises(SEED_EXERCISES, partId, query).map((e) => e.name);

  test('名前に含むもの。前後の空白は無視する', () => {
    expect(names(null, 'プレス')).toEqual(['ベンチプレス', 'インクラインダンベルプレス', 'ショルダープレス', 'レッグプレス', 'トライセプスプレスダウン']);
    expect(names(null, '  スクワット ')).toEqual(['スクワット']);
    expect(names(null, '')).toHaveLength(SEED_EXERCISES.length);
  });

  test('部位のチップと合わせる。一致がなければ空', () => {
    expect(names(part('肩'), 'プレス')).toEqual(['ショルダープレス']);
    expect(names(part('腹筋'), 'プレス')).toEqual([]);
    expect(names(null, '存在しない種目')).toEqual([]);
  });
});
