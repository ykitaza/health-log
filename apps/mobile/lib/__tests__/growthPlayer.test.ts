import { GrowthParams, Highlight, Subtitle } from '../growth';
import {
  approachTotal, canPlay, claimsDrag, dateAt, dayIndexAt, dpPerDay, dragDays, dragIndex, formatFullDate, growthTotals, highlightsInRange,
  indexAtX, isTap, lastPosition, lerpParams, MARK_HIT_DP, ratioAt, remainingMs, scrubberLabels, secondsAt, seekIndexAtX,
  showsTimelapseHint, startsAtEdge, subtitleOn, subtitlePassed, totalKeys, totalsLabel, totalsText, totalValues,
} from '../growthPlayer';
import { fmt1 } from '../units';

const P = (volumeKg: number, foodDays: number, sleepDays: number, days: number): GrowthParams => ({ volumeKg, foodDays, sleepDays, days });
const hl = (date: string, priority: number, text = date): Highlight => ({ date, kind: 'goalStreak', text, priority });

describe('再生の位置', () => {
  test('再生できるのは、記録が2日以上で、動きを減らす設定がオフのとき', () => {
    expect(canPlay(0, false)).toBe(false);
    expect(canPlay(1, false)).toBe(false);
    expect(canPlay(2, false)).toBe(true);
    expect(canPlay(100, true)).toBe(false);
  });
  test('位置 → 再生の秒（等速。最後の位置が再生の長さ）', () => {
    // 100日：50秒を最長 30秒に
    expect(lastPosition(100)).toBe(99);
    expect(lastPosition(0)).toBe(0);
    expect(secondsAt(99, 100)).toBeCloseTo(30);
    expect(secondsAt(49.5, 100)).toBeCloseTo(15);
  });
  test('残りの時間：途中からは残りの分だけ。最後なら 0', () => {
    expect(remainingMs(0, 100)).toBeCloseTo(30000);
    expect(remainingMs(49.5, 100)).toBeCloseTo(15000);
    expect(remainingMs(99, 100)).toBe(0);
    expect(remainingMs(120, 100)).toBe(0);
  });
  test('位置 → 日の番号は切り捨てで、範囲に収める', () => {
    expect(dayIndexAt(0, 10)).toBe(0);
    expect(dayIndexAt(3.99, 10)).toBe(3);
    expect(dayIndexAt(4 - 1e-9, 10)).toBe(4); // 小数の誤差で前の日にしない
    expect(dayIndexAt(9, 10)).toBe(9);
    expect(dayIndexAt(12, 10)).toBe(9);
    expect(dayIndexAt(-1, 10)).toBe(0);
    expect(dayIndexAt(3, 0)).toBe(0);
  });
  test('日の番号 → 日付（0 が最初の記録の日）', () => {
    expect(dateAt('2026-06-07', 0)).toBe('2026-06-07');
    expect(dateAt('2026-06-07', 99)).toBe('2026-09-14');
  });
});

describe('lerpParams（前後の日の値をつなぐ）', () => {
  const series = [P(0, 0, 0, 1), P(1000, 1, 0, 2), P(1000, 2, 1, 3)];
  test('日の上ではその日の値。間は進み具合でまっすぐにつなぐ', () => {
    expect(lerpParams(series, 1)).toEqual(series[1]);
    expect(lerpParams(series, 0.25)).toEqual(P(250, 0.25, 0, 1.25));
    expect(lerpParams(series, 1.5)).toEqual(P(1000, 1.5, 0.5, 2.5));
  });
  test('範囲の外は端の値。記録がなければ全部 0（種）', () => {
    expect(lerpParams(series, -3)).toEqual(series[0]);
    expect(lerpParams(series, 7)).toEqual(series[2]);
    expect(lerpParams([], 0)).toEqual(P(0, 0, 0, 0));
  });
});

describe('字幕', () => {
  const items = [hl('2026-11-02', 2, '自己ベスト'), hl('2026-11-02', 4, 'BIG3'), hl('2026-11-05', 1, '連続')];
  test('その日の字幕は、優先度のいちばん高いもの。なければ null', () => {
    expect(subtitleOn(items, '2026-11-02')?.text).toBe('BIG3');
    expect(subtitleOn(items, '2026-11-05')?.text).toBe('連続');
    expect(subtitleOn(items, '2026-11-03')).toBeNull();
  });
  test('再生で通った日（from は含まず to は含む）の字幕。2つあれば後のもの', () => {
    const subs: Subtitle[] = [{ ...hl('2026-11-02', 4, 'A'), atSec: 1 }, { ...hl('2026-11-05', 1, 'B'), atSec: 4 }];
    const start = '2026-11-01';
    expect(subtitlePassed(subs, start, 0, 1)?.text).toBe('A');
    expect(subtitlePassed(subs, start, 1, 3)).toBeNull();
    expect(subtitlePassed(subs, start, 0, 4)?.text).toBe('B');
    // 最初からもう一度（-1 から）は、最初の日の字幕も拾う
    expect(subtitlePassed([{ ...hl(start, 1, 'C'), atSec: 0 }], start, -1, 0)?.text).toBe('C');
  });
  test('範囲の外（最初の記録の日より前・今日より後）のハイライトは外す', () => {
    const all = [hl('2026-10-30', 5), hl('2026-11-01', 1), hl('2026-11-08', 1), hl('2026-11-09', 1)];
    expect(highlightsInRange(all, '2026-11-01', '2026-11-08').map((h) => h.date)).toEqual(['2026-11-01', '2026-11-08']);
    expect(highlightsInRange(all, null, '2026-11-08')).toEqual([]);
  });
});

describe('下の線', () => {
  test('横の位置 → いちばん近い日（1日単位）。範囲に収める', () => {
    expect(indexAtX(0, 300, 101)).toBe(0);
    expect(indexAtX(150, 300, 101)).toBe(50);
    expect(indexAtX(151, 300, 101)).toBe(50);
    expect(indexAtX(153, 300, 101)).toBe(51);
    expect(indexAtX(400, 300, 101)).toBe(100);
    expect(indexAtX(-20, 300, 101)).toBe(0);
    // 1日以下・幅が分からないときは左はし
    expect(indexAtX(200, 300, 1)).toBe(0);
    expect(indexAtX(200, 0, 10)).toBe(0);
  });
  test('日の番号 → 割合', () => {
    expect(ratioAt(0, 101)).toBe(0);
    expect(ratioAt(50, 101)).toBe(0.5);
    expect(ratioAt(100, 101)).toBe(1);
    expect(ratioAt(3, 1)).toBe(0);
    expect(ratioAt(3, 0)).toBe(0);
  });
  test('帯を押した位置 → いちばん近い点の日。点から遠ければ押した位置の日', () => {
    // 幅 300・101日：日 10 の点は x=30、日 12 の点は x=36、日 80 の点は x=240
    const marks = [10, 12, 80];
    expect(seekIndexAtX(31, 300, 101, marks)).toBe(10);
    expect(seekIndexAtX(34, 300, 101, marks)).toBe(12); // 近いほう
    expect(seekIndexAtX(240 + MARK_HIT_DP, 300, 101, marks)).toBe(80); // ちょうど届く距離
    expect(seekIndexAtX(240 + MARK_HIT_DP + 1, 300, 101, marks)).toBe(88); // 届かない → 押した位置の日（265 → 88.3）
    expect(seekIndexAtX(150, 300, 101, [])).toBe(50);
  });
  test('左右の日付。最初の記録の日が今日か、記録がなければ「今日」だけ', () => {
    expect(scrubberLabels('2026-06-07', '2026-11-11')).toEqual({ left: '6月7日', right: '11月11日' });
    expect(scrubberLabels('2026-11-11', '2026-11-11')).toEqual({ left: '今日', right: null });
    expect(scrubberLabels(null, '2026-11-11')).toEqual({ left: '今日', right: null });
  });
});

describe('画面全体の指の操作', () => {
  test('タップは縦横とも 10dp 未満で放したとき', () => {
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(9, -9)).toBe(true);
    expect(isTap(10, 0)).toBe(false);
    expect(isTap(0, -10)).toBe(false);
  });
  test('日を移す動きとして受けるのは、横に 10dp 以上で、縦以上のとき', () => {
    expect(claimsDrag(10, 0)).toBe(true);
    expect(claimsDrag(-30, 20)).toBe(true);
    expect(claimsDrag(9, 0)).toBe(false);
    expect(claimsDrag(20, 30)).toBe(false);
  });
  test('左右の端（24dp）から始まる指は使わない', () => {
    expect(startsAtEdge(0, 412)).toBe(true);
    expect(startsAtEdge(23, 412)).toBe(true);
    expect(startsAtEdge(24, 412)).toBe(false);
    expect(startsAtEdge(388, 412)).toBe(false);
    expect(startsAtEdge(389, 412)).toBe(true);
  });
  test('感度：画面の幅で全期間を基本に、1日あたり 3〜40dp に収める', () => {
    expect(dpPerDay(400, 101)).toBe(4); // 400dp で 100日
    expect(dpPerDay(412, 3)).toBe(40); // 日が少ないときは 1日 40dp
    expect(dpPerDay(412, 366)).toBe(3); // 日が多いときは 1日 3dp（全期間は幅より長い）
    expect(dpPerDay(412, 1)).toBe(40);
  });
  test('指の動き → 日数（右が先の日。1日単位）。押し始めの日から動かし、範囲に収める', () => {
    expect(dragDays(0, 400, 101)).toBe(0);
    expect(dragDays(5, 400, 101)).toBe(1);
    expect(dragDays(-1, 400, 101)).toBe(0);
    expect(dragDays(-41, 400, 101)).toBe(-10);
    expect(dragIndex(50, 41, 400, 101)).toBe(60);
    expect(dragIndex(50, -1000, 400, 101)).toBe(0);
    expect(dragIndex(50, 1000, 400, 101)).toBe(100);
    expect(dragIndex(0, 100, 400, 1)).toBe(0);
  });
});

describe('初回のヒント', () => {
  test('まだ見せていなくて、それまでに触っていないときだけ出す', () => {
    expect(showsTimelapseHint(false, false)).toBe(true);
    expect(showsTimelapseHint(true, false)).toBe(false); // 2回目からは出さない
    expect(showsTimelapseHint(false, true)).toBe(false); // なぞってから止めた・触ってから終わった
  });
});

describe('数え上がる累計', () => {
  /** 本当の値に届くまで approachTotal を繰り返した、途中の値 */
  const run = (from: number, to: number, step: number) => {
    const out: number[] = [];
    let v = from;
    for (let k = 0; k < 1000 && v !== to; k++) {
      v = approachTotal(v, to, step);
      out.push(v);
    }
    return out;
  };

  test('差が1単位以内なら、本当の値にぴったり合わせる', () => {
    expect(approachTotal(1, 1.05, 0.1)).toBe(1.05);
    expect(approachTotal(3, 4, 1)).toBe(4);
    expect(approachTotal(4, 3, 1)).toBe(3);
    expect(approachTotal(5, 5, 1)).toBe(5);
  });
  test('小さい差は1単位ずつ全部見える（0.0 → 0.8 t、日数の +1）', () => {
    expect(run(0, 0.8, 0.1).map((v) => fmt1(v))).toEqual(['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8']);
    expect(run(3, 4, 1)).toEqual([4]);
    expect(run(3, 6, 1)).toEqual([4, 5, 6]);
  });
  test('大きい差は速く進み、近づくほどゆっくり。行き過ぎず、本当の値で止まる', () => {
    const steps = run(0, 412.6, 0.1);
    expect(steps.length).toBeLessThan(80);
    expect(steps.at(-1)).toBe(412.6);
    for (const v of steps) expect(v).toBeLessThanOrEqual(412.6);
    const moves = steps.map((v, k) => v - (k === 0 ? 0 : steps[k - 1]));
    for (let k = 1; k < moves.length; k++) expect(moves[k]).toBeLessThanOrEqual(moves[k - 1] + 1e-9);
    // 最初の1フレームは差の 18% を 0.1 単位に切り捨て
    expect(steps[0]).toBeCloseTo(74.2);
  });
  test('減る向きも同じ（もう一度で最初に戻るとき）', () => {
    const steps = run(96, 0, 1);
    expect(steps.at(-1)).toBe(0);
    for (const v of steps) expect(v).toBeGreaterThanOrEqual(0);
    expect(steps[0]).toBe(79); // 96 − floor(96 × 0.18)
    expect(run(0.8, 0, 0.1).map((v) => fmt1(v))).toEqual(['0.7', '0.6', '0.5', '0.4', '0.3', '0.2', '0.1', '0.0']);
  });
  test('本当の値が日の途中の値でも、行き過ぎずにぴったり止まる', () => {
    const steps = run(2, 2.35, 0.1);
    expect(steps.at(-1)).toBe(2.35);
    expect(steps.map((v) => fmt1(v))).toEqual(['2.1', '2.2', '2.3', '2.4']);
  });
  test('文字にする値：負荷量は 0.1 単位の四捨五入、日数は切り捨て。fmt1 と同じ文字', () => {
    const k = totalKeys(totalValues(P(287_049, 58.7, 44, 100), 1));
    expect(k).toEqual({ volume: 2870, food: 58, sleep: 44 });
    expect(totalsText(k, 'kg')).toEqual({ volume: '287.0', volumeUnit: 't', foodDays: '58', sleepDays: '44' });
    for (const kg of [0, 49, 50, 149, 150, 1234, 98_765, 287_060]) {
      expect(totalsText(totalKeys(totalValues(P(kg, 0, 0, 1), 1)), 'kg').volume).toBe(fmt1(kg / 1000));
    }
  });
});

describe('文字', () => {
  test('日付は年と曜日つき', () => {
    expect(formatFullDate('2026-09-14')).toBe('2026年9月14日（月）');
    expect(formatFullDate('2026-11-11')).toBe('2026年11月11日（水）');
  });
  test('累計：負荷量はトンで小数1桁（四捨五入）、lb なら千ポンド。食事・睡眠は日数', () => {
    expect(growthTotals(P(287_049, 58, 44, 100), 'kg')).toEqual({ volume: '287.0', volumeUnit: 't', foodDays: '58', sleepDays: '44' });
    expect(growthTotals(P(287_060, 0, 0, 1), 'kg').volume).toBe('287.1');
    expect(growthTotals(P(0, 0, 0, 0), 'kg')).toEqual({ volume: '0.0', volumeUnit: 't', foodDays: '0', sleepDays: '0' });
    // 日と日のあいだの値：日数は次の日に届くまで切り捨てる
    expect(growthTotals(lerpParams([P(1000, 3, 2, 1), P(2000, 4, 2, 2)], 0.5), 'kg')).toEqual({ volume: '1.5', volumeUnit: 't', foodDays: '3', sleepDays: '2' });
    // 1000 kg ≒ 2204.6 lb → 2.2 k lb
    expect(growthTotals(P(1000, 0, 0, 1), 'lb')).toMatchObject({ volume: '2.2', volumeUnit: 'k lb' });
  });
  test('累計の1行の読み上げ', () => {
    expect(totalsLabel(growthTotals(P(1300, 2, 1, 3), 'kg'), 'kg')).toBe('累計。筋トレの負荷量 1.3 トン、食事の目標に届いた日 2日、7時間以上眠った日 1日');
    expect(totalsLabel(growthTotals(P(1000, 0, 0, 1), 'lb'), 'lb')).toContain('2.2 千ポンド');
  });
});
