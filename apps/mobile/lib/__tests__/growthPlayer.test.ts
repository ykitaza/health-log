import { GrowthDay, GrowthParams, Highlight, Subtitle } from '../growth';
import {
  canPlay, dateAt, dayIndexAt, formatFullDate, growthTotals, highlightsInRange, indexAtX, lastPosition, lerpParams, nextSpeed, NO_SATS,
  playLabel, ratioAt, remainingMs, SatStates, satsByIndex, satsLabel, satWindowDays, scrubberLabels, secondsAt, smoothSats, speedLabel,
  subtitleOn, subtitlePassed,
} from '../growthPlayer';

const P = (volumeKg: number, foodDays: number, sleepDays: number, days: number): GrowthParams => ({ volumeKg, foodDays, sleepDays, days });
const hl = (date: string, priority: number, text = date): Highlight => ({ date, kind: 'goalStreak', text, priority });
const sats = (training: SatStates['training'], food: SatStates['food'] = 'none', sleep: SatStates['sleep'] = 'none'): SatStates => ({ training, food, sleep });

describe('速さと再生の位置', () => {
  test('速さは 1x → 2x → 4x → 1x', () => {
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(4);
    expect(nextSpeed(4)).toBe(1);
  });
  test('再生できるのは、記録が2日以上で、動きを減らす設定がオフのとき', () => {
    expect(canPlay(0, false)).toBe(false);
    expect(canPlay(1, false)).toBe(false);
    expect(canPlay(2, false)).toBe(true);
    expect(canPlay(100, true)).toBe(false);
  });
  test('位置 → 再生の秒（等速。最後の位置が再生の長さ）', () => {
    // 100日：1x は 30秒（50秒を最長 30秒に）、2x は 15秒
    expect(lastPosition(100)).toBe(99);
    expect(lastPosition(0)).toBe(0);
    expect(secondsAt(99, 100, 1)).toBeCloseTo(30);
    expect(secondsAt(49.5, 100, 1)).toBeCloseTo(15);
    expect(secondsAt(99, 100, 2)).toBeCloseTo(15);
  });
  test('残りの時間：途中からは残りの分だけ。最後なら 0', () => {
    expect(remainingMs(0, 100, 1)).toBeCloseTo(30000);
    expect(remainingMs(49.5, 100, 4)).toBeCloseTo(3750);
    expect(remainingMs(99, 100, 1)).toBe(0);
    expect(remainingMs(120, 100, 1)).toBe(0);
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

describe('衛星', () => {
  const day = (date: string, p: Partial<GrowthDay> = {}): GrowthDay => ({
    date, trained: false, volumeKg: 0, mealRecorded: false, mealGoalReached: false, sleepMin: null, ...p,
  });
  test('日ごとの衛星。lib/growth.ts の meal を food に写し、記録のない日はなし', () => {
    const s = satsByIndex([
      day('2026-11-01', { trained: true, mealRecorded: true }),
      day('2026-11-03', { mealRecorded: true, mealGoalReached: true, sleepMin: 480 }),
    ], '2026-11-01', 3);
    expect(s).toEqual([sats('bright', 'dim'), NO_SATS, sats('none', 'bright', 'bright')]);
    expect(satsByIndex([], null, 0)).toEqual([]);
  });
  test('ならす日数は再生の約1秒ぶん（少なくとも1日）', () => {
    // 100日・1x は 30秒 → 99 ÷ 30 ≒ 3日。4x は 7.5秒 → 13日
    expect(satWindowDays(100, 1)).toBe(3);
    expect(satWindowDays(100, 4)).toBe(13);
    // 10日・1x は 8秒 → 9 ÷ 8 ≒ 1日
    expect(satWindowDays(10, 1)).toBe(1);
  });
  test('半分以上の日で明るければ明るい、1日でも記録があれば薄い、なければなし', () => {
    const list = [sats('bright', 'dim'), sats('none', 'none', 'dim'), sats('bright'), sats('none'), sats('none')];
    // 0〜2 日：筋トレ 2/3 明るい、食事 薄い1日、睡眠 薄い1日
    expect(smoothSats(list, 2, 3)).toEqual(sats('bright', 'dim', 'dim'));
    // 2〜4 日：筋トレ 1/3 → 薄い
    expect(smoothSats(list, 4, 3)).toEqual(sats('dim'));
    // 1〜4 日：筋トレ 1/4 → 薄い。ちょうど半分（2〜3 日で 1/2）は明るい
    expect(smoothSats(list, 4, 4)).toEqual(sats('dim', 'none', 'dim'));
    expect(smoothSats(list, 3, 2)).toEqual(sats('bright'));
    // 1日だけなら、その日のまま。最初の日より前は数えない
    expect(smoothSats(list, 0, 1)).toEqual(list[0]);
    expect(smoothSats(list, 0, 5)).toEqual(list[0]);
    expect(smoothSats([], 0, 3)).toEqual(NO_SATS);
  });
  test('読み上げ', () => {
    expect(satsLabel(sats('bright', 'dim', 'none'))).toBe('筋トレ あり、食事 記録あり、睡眠 なし');
    expect(satsLabel(sats('none', 'bright', 'bright'))).toBe('筋トレ なし、食事 目標に届いた、睡眠 7時間以上');
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

describe('つまみ', () => {
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
  test('左右の日付。最初の記録の日が今日か、記録がなければ「今日」だけ', () => {
    expect(scrubberLabels('2026-06-07', '2026-11-11')).toEqual({ left: '6月7日', right: '11月11日' });
    expect(scrubberLabels('2026-11-11', '2026-11-11')).toEqual({ left: '今日', right: null });
    expect(scrubberLabels(null, '2026-11-11')).toEqual({ left: '今日', right: null });
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
    // 1000 kg ≒ 2204.6 lb → 2.2 k lb
    expect(growthTotals(P(1000, 0, 0, 1), 'lb')).toMatchObject({ volume: '2.2', volumeUnit: 'k lb' });
  });
  test('ボタンの読み上げ。使えないときは理由を入れる', () => {
    expect(speedLabel(1)).toBe('再生の速さ 1倍。押すと2倍');
    expect(speedLabel(4)).toBe('再生の速さ 4倍。押すと1倍');
    expect(playLabel({ playing: true, dayCount: 10, reduced: false })).toBe('一時停止');
    expect(playLabel({ playing: false, dayCount: 10, reduced: false })).toBe('再生');
    expect(playLabel({ playing: false, dayCount: 0, reduced: false })).toContain('記録がまだない');
    expect(playLabel({ playing: false, dayCount: 1, reduced: false })).toContain('2日以上');
    expect(playLabel({ playing: false, dayCount: 10, reduced: true })).toContain('動きを減らす設定');
  });
});
