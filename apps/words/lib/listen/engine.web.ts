/**
 * web の聞く（E2E と画面の確認だけに使う）。音は出さず、時計で進める（並び・操作・聞いたの記録を確かめるため）。
 * 自然な声がオンなら、端末と同じく1つごとにサーバーの音声（POST /v1/audio）を取りにいく（鳴らさない。声の選び方と、戻した理由を確かめるため）。
 * 端末では engine.ts（expo-audio の再生の並びと、端末の声）
 */
import { createController } from './controller';
import { createTimerOutput } from './timerOutput';
import type { FetchAudio, ListenEngine } from './types';

export function createEngine(fetchAudio: FetchAudio): ListenEngine {
  const output = createTimerOutput();
  return createController({
    ...output,
    async prepare(track, i) {
      await fetchAudio(track.id).catch(() => null);
      return output.prepare(track, i);
    },
  });
}
