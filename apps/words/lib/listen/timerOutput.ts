/**
 * 時計で進むだけの音のない出力（web と、端末の声の進み具合の目安）。読み上げる文の長さから、かかる時間を見積もる
 */
import type { Output } from './controller';
import type { Track } from './types';

/** 1文字を読むのにかかる秒（日本語の読み上げのおおよそ） */
export const SECONDS_PER_CHAR = 0.13;
export const estimateSeconds = (t: Track) => Math.max(3, Math.round(t.speech.length * SECONDS_PER_CHAR));

export function createTimerOutput(tickMs = 250): Output {
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
    start(track, _i, ev) {
      events = ev;
      position = 0;
      duration = estimateSeconds(track);
      ev.onProgress(0, duration);
      run();
    },
    pause() { clear(); },
    resume() { if (events && position < duration) run(); },
    stop() { clear(); events = null; },
  };
}
