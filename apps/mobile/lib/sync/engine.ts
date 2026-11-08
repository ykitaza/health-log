/**
 * 同期の1回分：送る（POST /v1/sync/changes）→ 受け取る（初めてならスナップショット、そのあと GET /v1/sync/changes を最後まで）
 * → 端末に当てはめる。衝突の決まりはサーバーだけが持ち、端末はサーバーが返した状態で上書きする（docs/sync-design.md）。
 * まだ送っていない変更は、上書きのあとも端末の値を残す（db/repositories/sync.ts の applyStates）
 */
import { ApiClient, ApiError, ApiErrorCode, PushChange } from '@/lib/api';
import { OutboxRow, SyncStore, toPushChange } from '@/db/repositories/sync';

/** サーバーが1回に受け付ける件数（services/sync の MAX_PUSH） */
export const MAX_PUSH = 25;
/** 1回に送る本文の大きさの上限。サーバーの上限（64KB）より少し小さくする */
export const MAX_PUSH_BYTES = 60 * 1024;
const PULL_LIMIT = 500;

/**
 * 同期の失敗。accountChanged は、前に同期したのと違うアカウントでログインしている（選ぶまで同期しない。
 * docs/sync-design.md の「アカウントが変わったとき」）
 */
export type SyncErrorCode = ApiErrorCode | 'accountChanged';

export type SyncOutcome =
  | { ok: true; applied: number; sent: number; rejected: number }
  | { ok: false; error: SyncErrorCode; retry: boolean };

/** UTF-8 にしたときのバイト数 */
export function utf8Length(text: string): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

const bodySize = (deviceId: string, changes: PushChange[]) => utf8Length(JSON.stringify({ device_id: deviceId, changes }));

type Deps = { store: SyncStore; api: ApiClient; now?: () => Date };

export function createSyncEngine({ store, api, now = () => new Date() }: Deps) {
  /** 送る。断られた変更は印を付けて飛ばす（outbox で止まり続けないように） */
  async function push(): Promise<{ sent: number; rejected: number }> {
    const deviceId = await store.deviceId();
    let sent = 0;
    let rejected = 0;
    // 本文ごと断られたら（400 など）、どの変更が悪いかを知るため、この回は1件ずつ送る
    let single = false;
    for (;;) {
      const rows = await store.pending(single ? 1 : MAX_PUSH);
      if (rows.length === 0) break;
      const batch: { row: OutboxRow; change: PushChange }[] = [];
      for (const row of rows) {
        const change = toPushChange(row);
        if (bodySize(deviceId, [...batch.map((b) => b.change), change]) > MAX_PUSH_BYTES) break;
        batch.push({ row, change });
      }
      if (batch.length === 0) { // 1件だけで上限を超える（ふつうは起きない）
        await store.settle([], [{ changeId: rows[0].change_id, code: 'too_large' }]);
        rejected++;
        continue;
      }
      let results;
      try {
        ({ results } = await api.pushChanges({ device_id: deviceId, changes: batch.map((b) => b.change) }));
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'rejected') throw e;
        if (batch.length > 1) { single = true; continue; }
        await store.settle([], [{ changeId: batch[0].row.change_id, code: `http_${e.status}` }]);
        rejected++;
        continue;
      }
      const byId = new Map(results.map((r) => [r.change_id.toLowerCase(), r]));
      const done: string[] = [];
      const bad: { changeId: string; code: string }[] = [];
      for (const { row } of batch) {
        const r = byId.get(row.change_id.toLowerCase());
        if (r?.status === 'accepted' || r?.status === 'duplicate') done.push(row.change_id);
        else if (r?.status === 'rejected') bad.push({ changeId: row.change_id, code: r.error?.code ?? 'rejected' });
      }
      // 返事に1件も入っていなければ、同じものを送り続けないよう、サーバーの不具合として止める
      if (done.length + bad.length === 0) throw new ApiError('server', 200);
      await store.settle(done, bad);
      sent += done.length;
      rejected += bad.length;
    }
    return { sent, rejected };
  }

  /** 受け取って当てはめる。初めての端末はスナップショットから */
  async function pull(): Promise<number> {
    let applied = 0;
    let cursor = Number(await store.getMeta('cursor') ?? NaN);
    if (!Number.isFinite(cursor)) {
      let token: string | null = null;
      let start: number | null = null;
      do {
        const page = await api.snapshot(token);
        start ??= page.cursor;
        token = page.next_page_token;
        // 全部読み終えたら、最初のページの cursor から変更を読む（途中の変更は changes でもう一度届く）
        applied += await store.applyStates(page.states, token ? {} : { cursor: String(start) });
      } while (token);
      cursor = start!;
    }
    for (;;) {
      const page = await api.pullChanges(cursor, PULL_LIMIT);
      if (page.has_more && page.next_cursor <= cursor) throw new ApiError('server', 200); // 進まない
      applied += await store.applyStates(page.entries.map((e) => e.state), { cursor: String(page.next_cursor) });
      cursor = page.next_cursor;
      if (!page.has_more) break;
    }
    return applied;
  }

  return {
    async run(): Promise<SyncOutcome> {
      try {
        // 送る前に、同期した相手と同じアカウントかを確かめる。違えば、端末の記録を送らずに止める
        const sub = await api.account();
        if (!sub) return { ok: false, error: 'server', retry: false }; // トークンに sub がない（ふつうは起きない）
        const known = await store.account();
        if (known && known !== sub) return { ok: false, error: 'accountChanged', retry: false };
        if (!known) await store.rememberAccount(sub);
        const { sent, rejected } = await push();
        const applied = await pull();
        await store.setMeta('last_synced_at', now().toISOString());
        return { ok: true, applied, sent, rejected };
      } catch (e) {
        const error: ApiErrorCode = e instanceof ApiError ? e.code : 'server';
        // ログインの期限切れはログインの層に任せる（ログインし直すまで同期しない）
        return { ok: false, error, retry: error !== 'signedOut' };
      }
    },
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
