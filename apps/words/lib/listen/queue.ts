/**
 * 聞くの再生のための小さな決まり（並びは lib/schedule.ts の listenQueue、読む文は lib/speech.ts の buildScript）。
 */

/** 先に書き出しておく数（いま聞いているものの次。一時ファイルは「いま」と「次」の2つまで） */
export const PREFETCH_AHEAD = 1;
/** これだけ聞いたら「聞いた」に数える（最後まで聞かずに次へ送ったときの目安） */
export const LISTENED_RATIO = 0.6;

/** いま聞いている位置から、先に書き出しておくものの位置 */
export function prefetchTargets(current: number, length: number, ahead = PREFETCH_AHEAD): number[] {
  const out: number[] = [];
  for (let i = current + 1; i < length && out.length < ahead; i++) out.push(i);
  return out;
}

/** 聞いたに数えるか（最後まで聞いた、または 6 割以上） */
export function countsAsListened(position: number, duration: number, finished: boolean): boolean {
  if (finished) return true;
  return duration > 0 && position / duration >= LISTENED_RATIO;
}

/** 進み具合の線（0〜1） */
export const progressOf = (position: number, duration: number) => (duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0);
