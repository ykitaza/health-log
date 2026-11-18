// 休憩のタイマー。記録の入力でセットを完了にすると数え始め、画面をまたいで1つだけ動く（記録の入力と、その日のトレーニングの画面に同じ帯を出す）。
// 通知は使わないので、アプリが前面にあるあいだだけ数える。裏にあるあいだに 0 を過ぎたら、前面に戻ったときに帯を消すだけ（振動しない）。
// 時刻・振動・前面かどうかは外から渡す（jest で確かめる）。画面の部品は components/RestTimer.tsx

/** 「+30秒」で足す秒数 */
export const REST_EXTEND_SECONDS = 30;

/** 0 になったときの振動（ms。振動・止まる・振動） */
export const REST_DONE_VIBRATION = [0, 400, 200, 400];

export type RestTimerState = { endsAt: number; totalMs: number } | null;

/** 残りの秒（切り上げ。0 未満にしない） */
export function remainingSeconds(state: RestTimerState, now: number): number {
  return state ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : 0;
}

/** 残りの割合（0〜1。帯の下の細い線） */
export function remainingRatio(state: RestTimerState, now: number): number {
  if (!state || state.totalMs <= 0) return 0;
  return Math.min(1, Math.max(0, (state.endsAt - now) / state.totalMs));
}

/** 「1:12」 */
export function formatRest(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** 読み上げの「残り1分12秒」 */
export function spokenRest(seconds: number): string {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `残り${m > 0 ? `${m}分` : ''}${s > 0 || m === 0 ? `${s}秒` : ''}`;
}

type Deps = {
  now: () => number;
  vibrate: (pattern: number[]) => void;
  /** アプリが前面にあるか（裏で 0 を過ぎたときは振動しない） */
  isActive: () => boolean;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
};

/** タイマーを1つ作る（アプリでは components/RestTimer.tsx が1つだけ作って、画面で共有する） */
export function createRestTimer(deps: Deps) {
  let state: RestTimerState = null;
  let tick: unknown = null;
  // 画面に渡す今の様子（知らせるたびに作り直す。知らせるまでは同じものを返す：useSyncExternalStore 向け）
  let snap: { state: RestTimerState; now: number } = { state: null, now: 0 };
  const listeners = new Set<() => void>();
  const emit = () => {
    snap = { state, now: deps.now() };
    for (const l of listeners) l();
  };

  const stop = () => {
    if (tick != null) deps.clearInterval(tick);
    tick = null;
    if (state) { state = null; emit(); }
  };

  /** 1秒ごとと、前面に戻ったときに呼ぶ。0 になっていれば、前面なら振動して帯を消す。裏なら消すだけ */
  const check = () => {
    if (!state) return;
    if (remainingSeconds(state, deps.now()) > 0) { emit(); return; }
    if (deps.isActive()) deps.vibrate(REST_DONE_VIBRATION);
    stop();
  };

  return {
    /** 数え始める（数えている途中なら、新しい秒数で数え直す）。0 秒なら動かさない */
    start(seconds: number) {
      if (!(seconds > 0)) return;
      state = { endsAt: deps.now() + seconds * 1000, totalMs: seconds * 1000 };
      if (tick == null) tick = deps.setInterval(check, 1000);
      emit();
    },
    /** 「+30秒」 */
    extend(seconds = REST_EXTEND_SECONDS) {
      if (!state) return;
      const now = deps.now();
      const left = Math.max(0, state.endsAt - now);
      state = { endsAt: now + left + seconds * 1000, totalMs: Math.max(state.totalMs, left + seconds * 1000) };
      emit();
    },
    /** 「止める」 */
    stop,
    /** 前面に戻ったとき（裏で 0 を過ぎていたら、振動せずに消す） */
    resume() {
      if (state && remainingSeconds(state, deps.now()) === 0) stop();
      else emit();
    },
    check,
    get: (): RestTimerState => state,
    /** 最後に知らせたときの様子（タイマーと、その時刻） */
    snapshot: () => snap,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type RestTimer = ReturnType<typeof createRestTimer>;
