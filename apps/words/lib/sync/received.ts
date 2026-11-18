/**
 * 同期で受け取った表現の数（「3 語届きました」）。同期の動きは変えず、受け取った変更を数えるだけ。
 * 数えるのは、新しく作られた（op が create）表現だけ。自分の端末から送ったもの（device_id が自分）は数えない。
 * 初めての同期のスナップショットは数えない
 */
export type Received = number;

type Entry = { change: unknown; state: { entity_type: string; deleted: boolean } };

export function countReceived(entries: Entry[], deviceId: string): Received {
  let n = 0;
  for (const { change, state } of entries) {
    const c = (change ?? {}) as { op?: unknown; device_id?: unknown };
    if (c.op !== 'create' || c.device_id === deviceId || state.deleted) continue;
    if (state.entity_type === 'expression') n++;
  }
  return n;
}

export function receivedMessage(n: Received): string | null {
  return n > 0 ? `${n} 語届きました` : null;
}
