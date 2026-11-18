/**
 * web の聞く（E2E と画面の確認だけに使う）。音は出さず、時計で進める（並び・操作・聞いたの記録を確かめるため）。
 * 端末では engine.ts（expo-audio の再生の並びと、端末の声）
 */
import { createController } from './controller';
import { createTimerOutput } from './timerOutput';
import type { FetchAudio, ListenEngine } from './types';

export function createEngine(_fetchAudio: FetchAudio): ListenEngine {
  return createController(createTimerOutput());
}
