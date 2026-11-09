import { useState } from 'react';
import { createBusyGuard } from '@/lib/busy';

/**
 * 書き込みのボタンを、処理中は押せなくする。busy をボタンの busy（または disabled）に渡し、処理を run で包む。
 * 保存して画面を離れるときは、task の中で stayBusy() を呼ぶ（lib/busy.ts）
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [run] = useState(() => createBusyGuard(setBusy));
  return { busy, run };
}
