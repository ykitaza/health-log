/**
 * 時計で進むだけの音のない出力（web と、端末の声の進み具合の目安）。読み上げる文の長さから、かかる時間を見積もる
 */
import type { Output } from './controller';
import { DEFAULT_PACE, ListenPace, paceSeconds } from './pace';
import { sectionsOf, Track } from './types';

export { SECONDS_PER_CHAR } from './pace';
/** 1 語にかかる秒の見積もり（読み方の設定を入れて。既定は速さ 1・くり返し 1・ふつうの間） */
export const estimateSeconds = (t: Pick<Track, 'speech' | 'sections'>, pace: ListenPace = DEFAULT_PACE) => paceSeconds(sectionsOf(t), pace);

/** secondsOf：i 番目にかかる秒（web は準備のときに読んだ読み方で見積もる） */
export function createTimerOutput(tickMs = 250, secondsOf: (t: Track, i: number) => number = (t) => estimateSeconds(t)): Output {
  let timer: ReturnType<typeof setInterval> | null = null;
  let position = 0;
  let duration = 0;
  let events: Parameters<Output['start']>[2] | null = null;
  const clear = () => { if (timer) clearInterval(timer); timer = null; };
  const run = () => {
    clear();
    timer = setInterval(() => {
      position = Math.min(duration, position + tickMs / 1000);
      events?.onProgress(position, duration);
      if (position >= duration) { clear(); events?.onEnd(); }
    }, tickMs);
  };
  return {
    mode: 'speech',
    async prepare() { return true; },
    start(track, i, ev) {
      events = ev;
      position = 0;
      duration = secondsOf(track, i);
      ev.onProgress(0, duration);
      run();
    },
    pause() { clear(); },
    resume() { if (events && position < duration) run(); },
    stop() { clear(); events = null; },
  };
}
