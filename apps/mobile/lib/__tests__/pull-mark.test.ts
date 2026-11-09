import {
  markPose, PULSE_DASH, PULSE_LENGTH, pulseDrawOffset, pulseLoopOffset, pullMarkMotion, reachedThreshold, MARK_DROP,
} from '../sync/pullMark';

/** strokeDashoffset と点線の形から、線のうち見えている区間（path の始めからの長さ）。見えなければ null */
function visible(offset: number): [number, number] | null {
  const [dash, gap] = PULSE_DASH;
  const period = dash + gap;
  // 点線は -offset から dash の長さ、period ごとにくり返す。線（0〜PULSE_LENGTH）に重なる区間を集める
  const parts: [number, number][] = [];
  for (let k = -2; k <= 2; k++) {
    const a = Math.max(0, -offset + k * period), b = Math.min(PULSE_LENGTH, -offset + k * period + dash);
    if (b > a + 1e-6) parts.push([a, b]);
  }
  if (parts.length === 0) return null;
  expect(parts).toHaveLength(1);
  return parts[0];
}

describe('しきい値', () => {
  test('引っぱった量が 1（しきい値）まで来たら、同期すると決まる', () => {
    expect(reachedThreshold(0)).toBe(false);
    expect(reachedThreshold(0.99)).toBe(false);
    expect(reachedThreshold(1)).toBe(true);
    expect(reachedThreshold(1.3)).toBe(true);
  });
});

describe('引っぱった量 → マークと心拍の線', () => {
  test('心拍の線の長さは、path の区間の長さの合計（約 481）', () => {
    expect(PULSE_LENGTH).toBeCloseTo(481.2, 0);
  });

  test('0 では線は見えない（丸い端も線の外）。量に合わせて左から描かれ、1 で描き終わる', () => {
    expect(visible(pulseDrawOffset(0))).toBeNull();
    const [a, b] = visible(pulseDrawOffset(0.5))!;
    expect(a).toBe(0);
    expect(b).toBeGreaterThan(PULSE_LENGTH * 0.4);
    expect(b).toBeLessThan(PULSE_LENGTH * 0.6);
    expect(visible(pulseDrawOffset(1))).toEqual([0, PULSE_LENGTH]);
    // 行き過ぎても、それ以上は動かない
    expect(pulseDrawOffset(1.5)).toBe(pulseDrawOffset(1));
    expect(pulseDrawOffset(-1)).toBe(pulseDrawOffset(0));
  });

  test('丸い端が見えないよう、隠した線は太さの半分より外に出す', () => {
    // 描く前：見える区間の終わりが、線の始めより丸い端の分（20）以上前
    expect(-pulseDrawOffset(0) + PULSE_DASH[0]).toBeLessThanOrEqual(-20);
  });

  test('マークは上から下りてきて、薄い状態から濃くなる', () => {
    expect(markPose(0)).toEqual({ translateY: -MARK_DROP, opacity: 0.2 });
    expect(markPose(0.5).translateY).toBeCloseTo(-MARK_DROP / 2);
    expect(markPose(1)).toEqual({ translateY: 0, opacity: 1 });
  });
});

describe('同期のあいだの心拍の線', () => {
  test('描き終わった形から始め、前半で左から消え、後半で左からまた描かれる。周期の始めと終わりは同じ形', () => {
    expect(visible(pulseLoopOffset(0))).toEqual([0, PULSE_LENGTH]);
    const [a, b] = visible(pulseLoopOffset(0.25))!;
    expect(a).toBeGreaterThan(PULSE_LENGTH * 0.4);
    expect(b).toBe(PULSE_LENGTH);
    expect(visible(pulseLoopOffset(0.5))).toBeNull();
    expect(visible(pulseLoopOffset(0.75))![0]).toBe(0);
    expect(pulseLoopOffset(1)).toBeCloseTo(pulseLoopOffset(0));
  });
});

describe('動きを減らす設定', () => {
  test('オンなら、線を描く・光る・はずむ動きはせず、マークを出して消すだけ（長さ 0）', () => {
    expect(pullMarkMotion(true)).toEqual({ enterMs: 0, exitMs: 0, loop: false, pop: false });
  });

  test('オフなら、出る 250ms、消える 150ms（消えるほうが短い）。同期中はくり返し動く', () => {
    expect(pullMarkMotion(false)).toEqual({ enterMs: 250, exitMs: 150, loop: true, pop: true });
  });
});
