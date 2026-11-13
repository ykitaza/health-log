// 見えていない絵を止めるための、見えているかの計算（lib/onScreen.ts。hooks/useOnScreen.ts と Screen が使う）
import { bodyRunning, createOnScreenTracker, createScrollWatch, isOnScreen } from '../onScreen';

// 画面の座標：スクロールの見えている範囲は 100〜900（高さ 800）
const VIEW = { top: 100, height: 800 };

describe('isOnScreen', () => {
  test('まだ測っていない（位置か範囲が分からない）ときは、見えているとする', () => {
    expect(isOnScreen(null, VIEW, 0)).toBe(true);
    expect(isOnScreen({ top: 5000, height: 100, offset: 0 }, null, 0)).toBe(true);
  });

  test('範囲の中・はしだけ重なる・外', () => {
    expect(isOnScreen({ top: 300, height: 100, offset: 0 }, VIEW, 0)).toBe(true);
    // 下のはしが 1dp だけ見えている／上のはしが 1dp だけ見えている
    expect(isOnScreen({ top: 899, height: 100, offset: 0 }, VIEW, 0)).toBe(true);
    expect(isOnScreen({ top: 1, height: 100, offset: 0 }, VIEW, 0)).toBe(true);
    // ちょうど接しているだけ・離れている
    expect(isOnScreen({ top: 900, height: 100, offset: 0 }, VIEW, 0)).toBe(false);
    expect(isOnScreen({ top: 0, height: 100, offset: 0 }, VIEW, 0)).toBe(false);
    expect(isOnScreen({ top: 2000, height: 100, offset: 0 }, VIEW, 0)).toBe(false);
  });

  test('測った後にスクロールした分だけずらす', () => {
    // 測ったときは見えていた（offset 0 で top 300）。下へ 400 スクロールすると top -100 で、高さ 150 なら下のはしが 50 だけ見える
    const box = { top: 300, height: 150, offset: 0 };
    expect(isOnScreen(box, VIEW, 300)).toBe(true);
    expect(isOnScreen(box, VIEW, 400)).toBe(false);
    // 測ったときに下の外（top 1000、offset 200）。上へ戻すと外のまま、下へ 101 進めると入る
    const below = { top: 1000, height: 100, offset: 200 };
    expect(isOnScreen(below, VIEW, 0)).toBe(false);
    expect(isOnScreen(below, VIEW, 301)).toBe(true);
  });

  test('余白（margin）の分だけ、範囲の外の近くも見えているとする', () => {
    expect(isOnScreen({ top: 950, height: 100, offset: 0 }, VIEW, 0, 64)).toBe(true);
    expect(isOnScreen({ top: 970, height: 100, offset: 0 }, VIEW, 0, 64)).toBe(false);
  });
});

describe('3D の体を描き続けるか', () => {
  test.each([
    // focused, onScreen, ready → 描く
    [true, true, true, true],
    [true, false, true, false], // 描いたあと、スクロールして見えない → 止める
    [true, false, false, true], // まだ描いていない（読み込み中）→ 見えなくても描く（時間切れで 2D に戻すのを誤らせない）
    [false, true, true, false], // 画面を離れた → 止める
    [false, false, false, false],
  ])('画面にいる %s・見えている %s・描いた %s → %s', (focused, onScreen, ready, want) => {
    expect(bodyRunning(focused, onScreen, ready)).toBe(want);
  });
});

describe('スクロールの知らせと、入った・出たの追跡', () => {
  test('入った・出たのときだけ onChange を呼ぶ（スクロールの度には呼ばない）', () => {
    const watch = createScrollWatch();
    const changes: boolean[] = [];
    const tracker = createOnScreenTracker(watch, 0, (v) => changes.push(v));
    const off = watch.subscribe((remeasure) => { if (!remeasure) tracker.update(); });
    watch.measured(VIEW);
    tracker.setBox({ top: 300, height: 200, offset: 0 });
    expect(changes).toEqual([]);
    for (let y = 0; y <= 1000; y += 10) watch.scrolled(y);
    expect(changes).toEqual([false]);
    for (let y = 1000; y >= 0; y -= 10) watch.scrolled(y);
    expect(changes).toEqual([false, true]);
    off();
    watch.scrolled(1000);
    expect(changes).toEqual([false, true]);
  });

  test('見えている範囲を測った・中身の大きさが変わったときは、測り直すよう知らせる。高さ 0（隠れている）は範囲を変えない', () => {
    const watch = createScrollWatch();
    const got: boolean[] = [];
    watch.subscribe((remeasure) => got.push(remeasure));
    watch.measured(VIEW);
    watch.measured({ top: 0, height: 0 });
    watch.scrolled(50);
    expect(got).toEqual([true, true, false]);
    expect(watch.viewport).toEqual(VIEW);
    expect(watch.offset).toBe(50);
  });

  test('測れなかった（位置が分からない）ときは、見えているに戻す', () => {
    const watch = createScrollWatch();
    const changes: boolean[] = [];
    const tracker = createOnScreenTracker(watch, 0, (v) => changes.push(v));
    watch.measured(VIEW);
    tracker.setBox({ top: 2000, height: 100, offset: 0 });
    tracker.setBox(null);
    expect(changes).toEqual([false, true]);
  });
});
