/** web（E2E と画面の確認だけに使う）には端末の通知がないので、何もしない（許可していないものとして扱う） */
import type { Notifier } from './reschedule';

export const notifier: Notifier = {
  async permitted() { return false; },
  async request() { return false; },
  async schedule() {},
  async cancel() {},
  onOpen() { return () => {}; },
};
