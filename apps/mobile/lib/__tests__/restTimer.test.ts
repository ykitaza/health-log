import { createRestTimer, formatRest, remainingRatio, remainingSeconds, REST_DONE_VIBRATION, spokenRest } from '../restTimer';

function setup() {
  let now = 1_000_000;
  let active = true;
  const vibrations: number[][] = [];
  let tick: (() => void) | null = null;
  const timer = createRestTimer({
    now: () => now,
    vibrate: (p) => vibrations.push(p),
    isActive: () => active,
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { tick = null; },
  });
  return {
    timer, vibrations,
    advance(ms: number) { now += ms; tick?.(); },
    setActive(v: boolean) { active = v; },
    ticking: () => tick != null,
    get now() { return now; },
  };
}

test('表示の形', () => {
  expect(formatRest(72)).toBe('1:12');
  expect(formatRest(5)).toBe('0:05');
  expect(formatRest(120)).toBe('2:00');
  expect(spokenRest(72)).toBe('残り1分12秒');
  expect(spokenRest(120)).toBe('残り2分');
  expect(spokenRest(0)).toBe('残り0秒');
});

test('残りの秒は切り上げ、割合は 0〜1', () => {
  const st = { endsAt: 10_500, totalMs: 90_000 };
  expect(remainingSeconds(st, 0)).toBe(11);
  expect(remainingSeconds(st, 20_000)).toBe(0);
  expect(remainingRatio({ endsAt: 45_000, totalMs: 90_000 }, 0)).toBe(0.5);
  expect(remainingRatio(null, 0)).toBe(0);
});

test('0 秒なら動かさない。数えて 0 になったら振動して消える', () => {
  const t = setup();
  t.timer.start(0);
  expect(t.timer.get()).toBeNull();
  t.timer.start(90);
  expect(remainingSeconds(t.timer.get(), t.now)).toBe(90);
  t.advance(89_000);
  expect(remainingSeconds(t.timer.get(), t.now)).toBe(1);
  t.advance(1_000);
  expect(t.timer.get()).toBeNull();
  expect(t.vibrations).toEqual([REST_DONE_VIBRATION]);
  expect(t.ticking()).toBe(false);
});

test('+30秒、止める、数え直し', () => {
  const t = setup();
  t.timer.start(60);
  t.advance(50_000);
  t.timer.extend();
  expect(remainingSeconds(t.timer.get(), t.now)).toBe(40);
  expect(remainingRatio(t.timer.get(), t.now)).toBeCloseTo(40 / 60, 6); // 線は残りの分だけ伸びる
  t.timer.start(90); // 次のセットを完了にしたら数え直す
  expect(remainingSeconds(t.timer.get(), t.now)).toBe(90);
  t.timer.stop();
  expect(t.timer.get()).toBeNull();
  t.advance(100_000);
  expect(t.vibrations).toEqual([]);
});

test('裏にあるあいだに 0 を過ぎたら、振動せずに消す。まだ残っていれば前面に戻っても続ける', () => {
  const t = setup();
  t.timer.start(60);
  t.setActive(false);
  t.advance(30_000);
  t.setActive(true);
  t.timer.resume();
  expect(remainingSeconds(t.timer.get(), t.now)).toBe(30);
  t.setActive(false);
  t.advance(31_000); // 裏で動いた1秒ごとの確かめ
  expect(t.timer.get()).toBeNull();
  expect(t.vibrations).toEqual([]);
});

test('前面に戻ったとき、もう過ぎていれば消すだけ', () => {
  let now = 0;
  const vib: number[][] = [];
  const timer = createRestTimer({ now: () => now, vibrate: (p) => vib.push(p), isActive: () => true, setInterval: () => 1, clearInterval: () => {} });
  timer.start(60);
  now = 120_000; // 裏にあるあいだ（確かめは動いていない）
  timer.resume();
  expect(timer.get()).toBeNull();
  expect(vib).toEqual([]);
});

test('聞き手に知らせる', () => {
  const t = setup();
  const seen: number[] = [];
  const off = t.timer.subscribe(() => seen.push(remainingSeconds(t.timer.get(), t.now)));
  t.timer.start(3);
  t.advance(1_000);
  t.advance(1_000);
  t.advance(1_000);
  off();
  expect(seen).toEqual([3, 2, 1, 0]);
});
