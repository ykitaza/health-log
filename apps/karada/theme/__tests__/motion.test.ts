import {
  BAR_STAGGER_TOTAL_MS, barDelay, duration, EASE_IN, HOLD_MS, EASE_OUT, motionDuration, PRESS_SCALE, springs, STAGGER_MS, STAGGER_TOTAL_MS, staggerDelay, tabIndicatorDuration,
} from '../motion';

describe('動きの長さ（CLAUDE.local の決まり）', () => {
  test('シートは開く 250ms・閉じる 150ms。開くほうが長い', () => {
    expect(duration.enter).toBe(250);
    expect(duration.exit).toBe(150);
    expect(duration.enter).toBeGreaterThan(duration.exit);
  });

  test('行き帰りがあるもの（切り替えの印、画面の横すべり）は 250ms、文字の差し替えは 150ms', () => {
    expect(duration.toggle).toBe(250);
    expect(duration.text).toBe(150);
  });

  test('下のタブ：印は 200ms で広がって現れ、150ms で消える。画面の切り替えは行き帰り同じ 250ms', () => {
    expect(tabIndicatorDuration(true, false)).toBe(200);
    expect(tabIndicatorDuration(false, false)).toBe(150);
    expect(tabIndicatorDuration(true, false)).toBeGreaterThan(tabIndicatorDuration(false, false));
  });

  test('出てくる動きは 250ms 以下', () => {
    for (const ms of [duration.press, duration.enter, duration.listItem, duration.text, duration.indicator]) expect(ms).toBeLessThanOrEqual(250);
  });

  test('出てくる動きは ease-out、閉じる動きは ease-in の曲線', () => {
    expect(EASE_OUT).toEqual([0.22, 1, 0.36, 1]);
    expect(EASE_IN).toEqual([0.4, 0, 1, 1]);
  });

  test('押したときは少しだけ縮む', () => {
    expect(PRESS_SCALE).toBeGreaterThanOrEqual(0.95);
    expect(PRESS_SCALE).toBeLessThan(1);
  });

  test('はね返りは、行き過ぎるように減衰を弱くしてある（臨界より小さい）', () => {
    for (const s of Object.values(springs)) expect(s.damping).toBeLessThan(2 * Math.sqrt(s.stiffness * s.mass));
  });
});

describe('動きを減らす設定', () => {
  test('オンなら長さは 0', () => {
    expect(motionDuration(duration.enter, true)).toBe(0);
    expect(motionDuration(duration.exit, true)).toBe(0);
  });

  test('オフならそのまま', () => {
    expect(motionDuration(duration.enter, false)).toBe(250);
  });

  test('オンなら下のタブの印もすぐ切り替える（長さ 0）', () => {
    expect(tabIndicatorDuration(true, true)).toBe(0);
    expect(tabIndicatorDuration(false, true)).toBe(0);
  });

  test('オンならずらしも 0', () => {
    expect(staggerDelay(3, true)).toBe(0);
  });
});

describe('並んだものを順に出すときのずらし', () => {
  test('1つにつき 40ms ずらす', () => {
    expect(STAGGER_MS).toBe(40);
    expect([0, 1, 2].map((i) => staggerDelay(i, false))).toEqual([0, 40, 80]);
  });

  test('最後の行が出終わるまでが 300ms 以内（後ろの行は一緒に出す）', () => {
    for (let i = 0; i < 30; i++) expect(staggerDelay(i, false) + duration.listItem).toBeLessThanOrEqual(STAGGER_TOTAL_MS);
    expect(staggerDelay(10, false)).toBe(STAGGER_TOTAL_MS - duration.listItem);
  });
});

describe('グラフ', () => {
  test('線は 600ms で描く。はね返りは付けない（ease-out の曲線だけ）', () => {
    expect(duration.draw).toBe(600);
  });

  test('レーダーは気づける長さ（1200ms）でゆっくり広げる', () => {
    expect(duration.radar).toBe(1200);
  });

  test('棒は 40ms ずつずらす', () => {
    expect([0, 1, 2, 3].map((i) => barDelay(i, 4, false))).toEqual([0, 40, 80, 120]);
  });

  test('本数が多いときは、ずらしを小さくして、最後の棒が伸び始めるまでを 300ms に収める', () => {
    expect(barDelay(19, 20, false)).toBeLessThanOrEqual(BAR_STAGGER_TOTAL_MS);
    expect(barDelay(19, 20, false)).toBeCloseTo(300);
    expect(barDelay(1, 20, false)).toBeLessThan(40);
  });

  test('動きを減らす設定なら、ずらしは 0', () => {
    expect(barDelay(3, 8, true)).toBe(0);
  });
});

test('わざと待つのは 80ms まで（レポートの調子のアイコン、変化の矢印）', () => {
  expect(HOLD_MS).toBeLessThanOrEqual(80);
});
