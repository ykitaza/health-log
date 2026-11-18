// 同期でサーバーの変更を端末に当てはめたことを、開いている画面に知らせる（読み直すため）
const listeners = new Set<() => void>();

export function onRemoteChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyRemoteChange() {
  for (const listener of listeners) listener();
}
