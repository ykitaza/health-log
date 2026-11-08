/**
 * アプリ用の API（docs/api/app-api.yaml）を呼ぶ小さなクライアント。トークンは Authorization ヘッダーにだけ載せる（URL に載せない）。
 * 401 のときは、トークンを1回だけ更新して送り直す（端末の時計がずれていて、期限の前に切れたときのため）
 */
import { AuthError, fetchWithTimeout } from './auth/session';

/**
 * - signedOut：ログインしていない、ログインの期限が切れた
 * - forbidden：要る scope がない（403）
 * - throttled：流量の制限（429）
 * - network：つながらない・時間切れ
 * - server：そのほか（5xx、思っていない返事）
 */
export type ApiErrorCode = 'signedOut' | 'forbidden' | 'throttled' | 'network' | 'server';

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

  const send = async (path: string, accessToken: string) => {
    try {
      return await fetchWithTimeout(f, `${baseUrl}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
    } catch {
      throw new ApiError('network');
    }
  };

  const get = async <T>(path: string): Promise<T> => {
    let res = await send(path, await token(false));
    if (res.status === 401) res = await send(path, await token(true));
    if (res.status === 401) throw new ApiError('signedOut', 401);
    if (res.status === 403) throw new ApiError('forbidden', 403);
    if (res.status === 429) throw new ApiError('throttled', 429);
    if (!res.ok) throw new ApiError('server', res.status);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError('server', res.status);
    }
  };

  return {
    /**
     * ログインの確認：本人の変更を1件だけ読む（同期の受け取りと同じルート。書き込みはしない）。
     * 返すのは、サーバーに本人の記録があるかどうかだけ（中身は使わない）
     */
    async checkConnection(): Promise<{ hasData: boolean }> {
      const page = await get<{ entries?: unknown[]; has_more?: boolean }>('/v1/sync/changes?after=0&limit=1');
      if (!Array.isArray(page.entries)) throw new ApiError('server', 200);
      return { hasData: page.entries.length > 0 };
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
