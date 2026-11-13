// 画面の外に出た絵（3D の体・育つ形・ケガの印の脈打ち）を止めるための、見えているかの計算（hooks/useOnScreen.ts で使う）

/** 測った時の位置（画面の座標の上の端と高さ）と、その時のスクロールの位置（dp） */
export type Measured = { top: number; height: number; offset: number };
/** スクロールの見えている範囲（画面の座標の上の端と高さ） */
export type Viewport = { top: number; height: number };

/**
 * 今、見えているか。測った後にスクロールした分だけ位置をずらして、見えている範囲と重なるかを見る。
 * 少しでも重なれば見えているとする（はしが見えているのに止まっていると不自然なため）。margin は範囲の上下に足す余白（dp）。
 * まだ測っていない（位置が分からない）ときは、見えているとする（止めすぎない）
 */
export function isOnScreen(box: Measured | null, viewport: Viewport | null, offset: number, margin = 0): boolean {
  if (!box || !viewport) return true;
  const top = box.top - (offset - box.offset);
  return top < viewport.top + viewport.height + margin && top + box.height > viewport.top - margin;
}

/**
 * 3D の体を描き続けるか。画面を離れたら止める。スクロールして見えないときに止めるのは、最初のコマを描いてから
 * （読み込み中の表示と時間切れの計り方は、画面を離れたときだけで決める。下のほうにある図も先に描いておき、スクロールして来たときに読み込み中を出さない）
 */
export function bodyRunning(focused: boolean, onScreen: boolean, ready: boolean): boolean {
  return focused && (onScreen || !ready);
}

/** 画面（Screen）のスクロールの位置と見えている範囲。スクロールの度に知らせる（remeasure なら、中身の位置が変わったかもしれないので測り直す） */
export type ScrollWatch = {
  offset: number;
  viewport: Viewport | null;
  subscribe(fn: (remeasure: boolean) => void): () => void;
  notify(remeasure: boolean): void;
  /** スクロールした（位置を変えて知らせる） */
  scrolled(offset: number): void;
  /** 見えている範囲を測った（高さ 0 は、隠れていて測れないので変えない。中身を測り直させる） */
  measured(viewport: Viewport): void;
};

export function createScrollWatch(): ScrollWatch {
  const listeners = new Set<(remeasure: boolean) => void>();
  return {
    offset: 0,
    viewport: null,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    notify(remeasure) { for (const fn of listeners) fn(remeasure); },
    scrolled(offset) { this.offset = offset; this.notify(false); },
    measured(viewport) { if (viewport.height > 0) this.viewport = viewport; this.notify(true); },
  };
}

/**
 * 1つのビューが見えているかを追う。スクロールの度に計算するが、onChange は入った・出たのときだけ呼ぶ
 * （毎コマ React の state を変えない）。はじめは見えているとする
 */
export function createOnScreenTracker(watch: ScrollWatch, margin: number, onChange: (onScreen: boolean) => void) {
  let box: Measured | null = null;
  let shown = true;
  const update = () => {
    const v = isOnScreen(box, watch.viewport, watch.offset, margin);
    if (v === shown) return;
    shown = v;
    onChange(v);
  };
  return { setBox(b: Measured | null) { box = b; update(); }, update };
}
