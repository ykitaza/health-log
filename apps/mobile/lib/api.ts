/**
 * アプリ用の API（docs/api/app-api.yaml）を呼ぶ小さなクライアント。同期の送信・受け取り・スナップショットだけ。トークンは Authorization ヘッダーにだけ載せる（URL に載せない）。
 * 401 のときは、トークンを1回だけ更新して送り直す（端末の時計がずれていて、期限の前に切れたときのため）
 */
import { accessTokenSubject, AuthError, fetchWithTimeout } from './auth/session';

/**
 * - signedOut：ログインしていない、ログインの期限が切れた
 * - forbidden：要る scope がない（403）
 * - throttled：流量の制限（429）
 * - network：つながらない・時間切れ
 * - rejected：送った本文を断られた（POST の 400・409・413・422。送り直しても同じ）
 * - server：そのほか（5xx、思っていない返事）
 */
export type ApiErrorCode = 'signedOut' | 'forbidden' | 'throttled' | 'network' | 'rejected' | 'server';

/** 同期の API の形（docs/api/app-api.yaml） */
export type PushChange = {
  change_id: string;
  entity_type: string;
  entity_id: string;
  /** 食事の品目（meal_item）だけ：親の食事の ID */
  parent_id?: string;
  op: 'create' | 'update' | 'delete' | 'restore';
  fields?: Record<string, unknown>;
  changed_at: string;
  origin: 'app' | 'import';
};
export type PushResult = {
  change_id: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  seq: number | null;
  error: { code: string; message: string } | null;
};
export type EntityState = {
  entity_type: string;
  entity_id: string;
  parent_id: string | null;
  fields: Record<string, unknown>;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  seq: number;
};
export type ChangesPage = { entries: { change: unknown; state: EntityState }[]; next_cursor: number; has_more: boolean };
export type SnapshotPage = { states: EntityState[]; cursor: number; next_page_token: string | null };

const REJECTED = new Set([400, 409, 413, 422]);

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode, readonly status?: number) {
    super(`app api error: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'ApiError';
  }
}

type Deps = {
  baseUrl: string;
  getAccessToken: (opts?: { force?: boolean }) => Promise<string | null>;
  fetch?: typeof fetch;
};

export function createApiClient({ baseUrl, getAccessToken, fetch: f = (...a) => fetch(...a) }: Deps) {
  const token = async (force: boolean) => {
    try {
      const t = await getAccessToken({ force });
      if (!t) throw new ApiError('signedOut');
      return t;
    } catch (e) {
      if (e instanceof AuthError) throw new ApiError(e.code === 'expired' ? 'signedOut' : e.code === 'network' ? 'network' : 'server');
      throw e;
    }
  };

  const send = async (method: 'GET' | 'POST', path: string, accessToken: string, body?: unknown) => {
    try {
      return await fetchWithTimeout(f, `${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`, Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError('network');
    }
  };

  const request = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    let res = await send(method, path, await token(false), body);
    if (res.status === 401) res = await send(method, path, await token(true), body);
    if (res.status === 401) throw new ApiError('signedOut', 401);
    if (res.status === 403) throw new ApiError('forbidden', 403);
    if (res.status === 429) throw new ApiError('throttled', 429);
    if (method === 'POST' && REJECTED.has(res.status)) throw new ApiError('rejected', res.status);
    if (!res.ok) throw new ApiError('server', res.status);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError('server', res.status);
    }
  };

  return {
    /** ログインしているアカウント（アクセストークンの sub）。読めなければ null。画面やログには出さない */
    async account(): Promise<string | null> {
      return accessTokenSubject(await token(false));
    },

    /** 端末の変更を送る（25件まで）。1件ごとの結果を送った順に返す */
    async pushChanges(body: { device_id: string; changes: PushChange[] }): Promise<{ results: PushResult[]; cursor: number }> {
      const res = await request<{ results?: PushResult[]; cursor?: number }>('POST', '/v1/sync/changes', body);
      if (!Array.isArray(res.results)) throw new ApiError('server', 200);
      return res as { results: PushResult[]; cursor: number };
    },

    /** after より後の変更（seq の順） */
    async pullChanges(after: number, limit = 500): Promise<ChangesPage> {
      const page = await request<ChangesPage>('GET', `/v1/sync/changes?after=${after}&limit=${limit}`);
      if (!Array.isArray(page.entries) || typeof page.next_cursor !== 'number') throw new ApiError('server', 200);
      return page;
    },

    /** 今の状態の全部（初めての端末）。page_token を付けて続きを読む */
    async snapshot(pageToken: string | null): Promise<SnapshotPage> {
      const q = new URLSearchParams({ limit: '500', ...(pageToken ? { page_token: pageToken } : {}) });
      const page = await request<SnapshotPage>('GET', `/v1/sync/snapshot?${q.toString()}`);
      if (!Array.isArray(page.states) || typeof page.cursor !== 'number') throw new ApiError('server', 200);
      return page;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
