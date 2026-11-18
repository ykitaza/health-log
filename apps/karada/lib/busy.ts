/**
 * 書き込み（保存・追加・削除）を1つずつにする。走っている間に届いた2回目以降は、何もしない。
 * 押せなくする状態（busy）は描き直すまで効かないので、続けて届いた2回目はここで止める（筋トレの記録の入力と同じやり方）。
 * 保存して画面を離れるときは、task の中で stayBusy() を呼ぶ。終わっても押せないままにして、離れる動きの間の2回目を止める
 */
export function createBusyGuard(setBusy: (busy: boolean) => void) {
  let running = false;
  return async function run(task: (stayBusy: () => void) => Promise<unknown> | unknown): Promise<void> {
    if (running) return;
    running = true;
    setBusy(true);
    let stay = false;
    try {
      await task(() => { stay = true; });
    } finally {
      // 失敗したときは、もう一度押せるように戻す
      if (!stay) {
        running = false;
        setBusy(false);
      }
    }
  };
}

