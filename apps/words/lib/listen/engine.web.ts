/**
 * web の聞く（E2E と画面の確認だけに使う）。音は出さず、時計で進める（並び・操作・聞いたの記録を確かめるため）。
 * 自然な声がオンなら、端末と同じく1つごとにサーバーの音声（POST /v1/audio）を取りにいく（鳴らさない。声の選び方と、戻した理由を確かめるため）。
 * 読み方（速さ・くり返し・間）は、1つを準備するときに読み、その長さだけ時計で進める（端末と同じく、変えたら次に準備する語から効く）。
 * 端末では engine.ts（expo-audio の再生の並びと、端末の声）
 */
import { createController } from './controller';
import type { ListenPace } from './pace';
import { createTimerOutput, estimateSeconds } from './timerOutput';
import type { FetchAudio, ListenEngine } from './types';

export function createEngine(fetchAudio: FetchAudio, pace: () => ListenPace): ListenEngine {
  /** 準備のときに見積もった秒（位置ごと） */
  const planned = new Map<number, number>();
  const output = createTimerOutput(250, (t, i) => planned.get(i) ?? estimateSeconds(t));
  return createController({
    ...output,
    async prepare(track, i) {
      planned.set(i, estimateSeconds(track, pace()));
      await fetchAudio(track.id).catch(() => null);
      return output.prepare(track, i);
    },
  });
}
