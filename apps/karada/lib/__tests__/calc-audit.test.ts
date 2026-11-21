// #326 計算の見直し：手で計算できる小さなデータで、推移・集計の数字を確かめる（実装の式をなぞらず、答えは手で出した数）
import { goalReachedShown, goalProgress } from '../body';
import { periodRecords, sinceNote } from '../chart';
import { addDays } from '../date';
import { average, sleepAverageLabel } from '../health';
import { goalLine } from '../home';
import { loadGauge } from '../homeHud';
import { pfcPercents, pfcRatio } from '../meals';
import { localDate, sleepMinutes } from '../healthConnect/importer';
import { metricNote } from '../phaseView';
import type { SuccessMetric } from '../phases';
import { gramsLeftText } from '../reports';
import { periodStart, TrainingSetRow, weekDeltaText } from '../training';

const TODAY = '2026-11-21'; // 土曜

describe('推移の期間（1・3・6 か月・1 年）で、平均の母数が変わる', () => {
  // 2025-11-01 から毎日の記録。値は「月」で決める（11月 = 400、10月 = 410、…）ので、期間ごとの平均を手で出せる
  const days: { date: string; v: number }[] = [];
  for (let d = '2025-11-01'; d <= TODAY; d = addDays(d, 1)) {
    const month = Number(d.slice(5, 7));
    const year = Number(d.slice(0, 4));
    // 2026-11 は 400、2026-10 は 410、2026-09 は 420 … と 1 か月さかのぼるごとに 10 ずつ増やす
    const back = (2026 - year) * 12 + (11 - month);
    days.push({ date: d, v: 400 + back * 10 });
  }
  const avgOf = (p: '1m' | '3m' | '6m' | '1y') => average(periodRecords(days, periodStart(TODAY, p)!, TODAY).items.map((d) => d.v));

  test('期間の始まり：1か月は 10/21、3か月は 8/21、6か月は 5/21、1年は 2025-11-21（両端を含む）', () => {
    expect(['1m', '3m', '6m', '1y'].map((p) => periodStart(TODAY, p as '1m'))).toEqual(['2026-10-21', '2026-08-21', '2026-05-21', '2025-11-21']);
  });

  test('1か月：10/21〜10/31 の 11 日（410）と 11/1〜11/21 の 21 日（400）。平均は (11×410 + 21×400) ÷ 32', () => {
    const r = periodRecords(days, '2026-10-21', TODAY);
    expect(r.count).toBe(32);
    expect(avgOf('1m')).toBeCloseTo((11 * 410 + 21 * 400) / 32, 9);
  });

  test('3か月・6か月・1年の平均はそれぞれ違い、期間が長いほど古い（大きい）値が入る', () => {
    // 3か月：8/21〜8/31 の 11 日（430）、9月 30 日（420）、10月 31 日（410）、11/1〜21 の 21 日（400）
    expect(avgOf('3m')).toBeCloseTo((11 * 430 + 30 * 420 + 31 * 410 + 21 * 400) / 93, 9);
    const all = [avgOf('1m'), avgOf('3m'), avgOf('6m'), avgOf('1y')];
    expect(new Set(all.map((a) => a!.toFixed(6))).size).toBe(4);
    for (let i = 1; i < 4; i++) expect(all[i]!).toBeGreaterThan(all[i - 1]!);
    // 1年より前（2025-11-01〜11-20）の記録があるので、どの期間も「記録は M/D から」は出さない
    for (const p of ['1m', '3m', '6m', '1y'] as const) expect(periodRecords(days, periodStart(TODAY, p)!, TODAY).since).toBeNull();
  });

  test('記録が 11/1 からしかないとき：どの期間も同じ 21 日・同じ平均になり、「記録は 11/1 から」を出す（本番の睡眠の 20 晩と同じ形）', () => {
    const short = days.filter((d) => d.date >= '2026-11-01');
    for (const p of ['1m', '3m', '6m', '1y'] as const) {
      const r = periodRecords(short, periodStart(TODAY, p)!, TODAY);
      expect(r.count).toBe(21);
      expect(r.since).toBe('2026-11-01');
      expect(average(r.items.map((d) => d.v))).toBe(400);
    }
    expect(sinceNote('2026-11-01')).toBe('（記録は 11/1 から）');
    expect(sinceNote(null)).toBe('');
  });

  test('記録のない日は母数に入れない（3 日の記録で 7 日の期間なら、3 で割る）', () => {
    const sparse = [{ date: '2026-11-15', v: 300 }, { date: '2026-11-18', v: 420 }, { date: '2026-11-21', v: 480 }];
    const r = periodRecords(sparse, '2026-11-15', TODAY);
    expect(r.count).toBe(3);
    expect(average(r.items.map((d) => d.v))).toBe(400);
  });

  test('期間の始まりの日にちょうど最初の記録があれば、記録は期間を満たしている（since は出さない）', () => {
    expect(periodRecords([{ date: '2026-10-21' }, { date: TODAY }], '2026-10-21', TODAY).since).toBeNull();
  });

  test('今日より後の記録は期間に入れない', () => {
    expect(periodRecords([{ date: TODAY }, { date: addDays(TODAY, 1) }], '2026-10-21', TODAY).count).toBe(1);
  });
});

describe('睡眠の推移の平均の読み上げ', () => {
  test('419.6 分は画面の「7:00」と同じく「7時間」と読む（「6時間60分」と読まない）', () => {
    expect(sleepAverageLabel('1か月', 419.6)).toBe('1か月の平均 7時間');
    expect(sleepAverageLabel('3か月', 415.9)).toBe('3か月の平均 6時間56分');
    expect(sleepAverageLabel('1年', 59.5)).toBe('1年の平均 1時間');
  });
});

describe('目標体重までの残り：表示が 0.0 になるなら「目標に届きました」', () => {
  test('65.04 kg で目標 65 kg：残り 0.04 は「あと 0.0 kg」と出さず、届いた', () => {
    expect(goalLine(65.04, 65, 'kg')).toBe('目標に届きました');
    expect(goalLine(64.96, 65, 'kg')).toBe('目標に届きました');
  });

  test('残り 0.06 kg は小数1桁で 0.1（まだ）。ポンドでは 0.06 kg ≒ 0.13 lb で 0.1', () => {
    expect(goalLine(65.06, 65, 'kg')).toBe('目標まで あと 0.1 kg');
    expect(goalLine(65.06, 65, 'lb')).toBe('目標まで あと 0.1 lb');
  });

  test('ポンドで 0.0 になる 0.02 kg（≒ 0.044 lb）も届いた', () => {
    expect(goalReachedShown(goalProgress(65.02, 65, null), 'lb')).toBe(true);
    expect(goalReachedShown(goalProgress(68.4, 65, null), 'kg')).toBe(false);
  });

  test('サーバーと同じ goalProgress の数（direction・weeks）は変えない', () => {
    expect(goalProgress(65.04, 65, -0.5).direction).toBe('lose');
  });
});

describe('筋トレの推移の「先週より」は、ホームの LOAD の先週比と同じく先週の同じ曜日までと比べる', () => {
  const row = (date: string, weightKg: number, reps: number): TrainingSetRow => ({ date, exerciseId: 'bench', bodyPartId: 'chest', weightKg, reps });
  // 今日は 11/18（水）。今週：月 11/16 に 100kg×10 = 1000。先週：月 11/9 に 100kg×10 = 1000、金 11/13 に 100kg×20 = 2000
  const rows = [row('2026-11-16', 100, 10), row('2026-11-09', 100, 10), row('2026-11-13', 100, 20)];
  const g = loadGauge(rows, '2026-11-18');

  test('先週の同じ曜日まで（11/9〜11/11）は 1000 kg。先週全体（3000 kg）とは比べない', () => {
    expect(g.totalKg).toBe(1000);
    expect(g.lastWeekToDateKg).toBe(1000);
    expect(g.vsLastWeekPct).toBe(0);
    expect(weekDeltaText(g.totalKg, g.lastWeekToDateKg, (kg) => kg)).toBe('+0.0');
  });

  test('差が小数1桁で 0.0 なら「+0.0」（「−0.0」と出さない）。それ以外は符号つき', () => {
    expect(weekDeltaText(1000, 1020, (kg) => kg)).toBe('+0.0');
    expect(weekDeltaText(1000, 1060, (kg) => kg)).toBe('−0.1');
    expect(weekDeltaText(2700, 1000, (kg) => kg)).toBe('+1.7');
  });
});

describe('PFC の割合の % は合計 100', () => {
  test('P 33.4・F 33.3・C 33.3 は 34・33・33（四捨五入の 33・33・33 で 99% にしない）', () => {
    expect(pfcPercents({ p: 33.4, f: 33.3, c: 33.3 })).toEqual({ p: 34, f: 33, c: 33 });
  });

  test('四捨五入で 101% になる 20.5・30.5・49.0 は 21・30・49 か 20・31・49 のどちらか（合計 100）', () => {
    const r = pfcPercents({ p: 20.5, f: 30.5, c: 49 });
    expect(r.p + r.f + r.c).toBe(100);
    expect(r.c).toBe(49);
  });

  test('たんぱく質 100g・脂質 50g・炭水化物 250g：400・450・1000 kcal で 21.6・24.3・54.1 % → 22・24・54', () => {
    const ratio = pfcRatio({ protein_g: 100, fat_g: 50, carbs_g: 250 })!;
    expect(ratio.p).toBeCloseTo(400 / 1850 * 100, 9);
    expect(pfcPercents(ratio)).toEqual({ p: 22, f: 24, c: 54 });
  });

  test('いろいろな割合で、いつも合計 100 で、もとの値から 1 未満しか離れない', () => {
    for (let p = 0; p <= 60; p += 3.7) {
      for (let f = 0; f <= 100 - p; f += 6.1) {
        const c = 100 - p - f;
        const r = pfcPercents({ p, f, c });
        expect(r.p + r.f + r.c).toBe(100);
        for (const [a, b] of [[r.p, p], [r.f, f], [r.c, c]]) expect(Math.abs(a - b)).toBeLessThan(1);
      }
    }
  });
});

describe('残りが表示の丸めで 0 になるときの言い方', () => {
  test('日のまとめのたんぱく質：149.6g と目標 150g は「あと1g」（「あと0g」と出さない）。ふだんは四捨五入', () => {
    expect(gramsLeftText(150, 149.6)).toBe('あと1g');
    expect(gramsLeftText(150, 137.8)).toBe('あと12g');
    expect(gramsLeftText(150, 100)).toBe('あと50g');
  });

  test('フェーズの成功の指標：増量で目標 80kg、今 79.97kg は「目標に届いた」（「あと 0.0 kg」と出さない）', () => {
    const fmt = (kg: number) => `${kg.toFixed(1)} kg`;
    const m = (now: number): SuccessMetric => ({ key: 'weight', label: '体重', start: 75, now, delta: now - 75, ok: false, reference: false });
    expect(metricNote(m(79.97), 'bulk', 80, fmt)).toBe('目標に届いた');
    expect(metricNote(m(79.9), 'bulk', 80, fmt)).toBe('目標まで あと 0.1 kg');
    expect(metricNote(m(80.2), 'bulk', 80, fmt)).toBe('目標に届いた');
  });
});

describe('日本時間の日の区切り（Health Connect の時刻に付いた時差で日付を決める）', () => {
  const JST = { totalSeconds: 9 * 3600 };
  test('UTC 11/20 22:30 は日本時間 11/21 7:30：起きた日は 11/21', () => {
    expect(localDate('2026-11-20T22:30:00Z', JST)).toBe('2026-11-21');
  });
  test('日本時間 23:59 は その日、0:00 は 次の日（UTC 14:59 と 15:00）', () => {
    expect(localDate('2026-11-20T14:59:00Z', JST)).toBe('2026-11-20');
    expect(localDate('2026-11-20T15:00:00Z', JST)).toBe('2026-11-21');
  });
  test('月末・年末・うるう日をまたぐ', () => {
    expect(localDate('2026-12-31T15:00:00Z', JST)).toBe('2027-01-01');
    expect(localDate('2028-02-28T15:30:00Z', JST)).toBe('2028-02-29');
  });
  test('日をまたぐ睡眠（23:00〜7:00 の 8 時間）のうち、起きていた段階 30 分と、終わりからはみ出した段階の中の 10 分を除いて 440 分（はみ出した 20 分は数えない）', () => {
    expect(sleepMinutes({
      startTime: '2026-11-20T14:00:00Z', endTime: '2026-11-20T22:00:00Z',
      stages: [
        { startTime: '2026-11-20T18:00:00Z', endTime: '2026-11-20T18:30:00Z', stage: 1 }, // 起きていた
        { startTime: '2026-11-20T21:50:00Z', endTime: '2026-11-20T22:20:00Z', stage: 1 }, // 終わりから 20 分はみ出す：10 分だけ
        { startTime: '2026-11-20T15:00:00Z', endTime: '2026-11-20T17:00:00Z', stage: 5 }, // 深い睡眠
      ],
    })).toEqual({ asleepMin: 440, awakeMin: 40 });
  });
});
