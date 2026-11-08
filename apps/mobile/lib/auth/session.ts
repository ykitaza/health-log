/**
 * ログイン（Cognito のマネージドログイン、認可コード＋PKCE）のトークンの扱い。画面や保存先に依存しない（テストで差し替える）。
 *
 * - 認可の画面を開くところ（PKCE・state）は expo-auth-session に任せ、ここは /oauth2/token と /oauth2/revoke を呼ぶ
 * - クライアントはパブリック（torelog-app）なので、シークレットは送らない
 * - トークンはログ・エラーの文・URL に出さない。送るのは本文（application/x-www-form-urlencoded）とヘッダーだけ
 * - ID トークンは使わないので、受け取っても保存しない
 */

export type AuthConfig = {
  clientId: string;
  /** Cognito のドメイン（https://<prefix>.auth.<region>.amazoncognito.com） */
  cognitoDomain: string;
};

export const endpoints = (config: AuthConfig) => ({
  authorizationEndpoint: `${config.cognitoDomain}/oauth2/authorize`,
  tokenEndpoint: `${config.cognitoDomain}/oauth2/token`,
  revocationEndpoint: `${config.cognitoDomain}/oauth2/revoke`,
});

/** Cognito に登録したログアウトの戻り先（cdk/lib/infra-stack.ts の torelog-app の logoutUrls） */
export const NATIVE_LOGOUT_URI = 'torelog://signout';

/**
 * マネージドログインのセッションの Cookie を消す URL（/logout）。
 * Cookie が生きているあいだ（最後に画面でログインしてから1時間）は、/oauth2/authorize が画面なしでコードを出すので、
 * 同じ torelog:// を登録した別のアプリが、自分の PKCE でコードを受け取ってトークンに換えられてしまう。
 * 正規のアプリの prompt=login は、そのアプリの要求には効かないため、ログインのたびにすぐ消す
 */
export const logoutUrl = (config: AuthConfig, logoutUri = NATIVE_LOGOUT_URI) =>
  `${config.cognitoDomain}/logout?${new URLSearchParams({ client_id: config.clientId, logout_uri: logoutUri }).toString()}`;

/**
 * 求める scope。アプリ用の API（同期）のルートが必須にする4つだけ。
 * ID トークンもユーザー情報も使わないので openid は求めない（アクセストークンとリフレッシュトークンだけを受け取る）
 */
export const SCOPES = [
  'torelog-api/training.read',
  'torelog-api/training.write',
  'torelog-api/meals.read',
  'torelog-api/meals.write',
];

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  /** アクセストークンが切れる時刻（ミリ秒） */
  expiresAt: number;
};

/** トークンの保存先（端末では expo-secure-store） */
export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

/**
 * - expired：リフレッシュトークンが切れた・取り消された（保存していたトークンは消した。ログインし直す）
 * - rejected：Cognito が断った（認可コードが古いなど）
 * - network：つながらない・時間切れ（保存していたトークンは残す）
 * - server：Cognito の不具合
 */
export type AuthErrorCode = 'expired' | 'rejected' | 'network' | 'server';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** アクセストークンの期限のこの時間前から、切れたものとして更新する（端末の時計のずれと通信の時間の分） */
export const REFRESH_MARGIN_MS = 60_000;
/** Cognito への通信の待ち時間の上限 */
export const REQUEST_TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;

type Deps = {
  config: AuthConfig;
  store: TokenStore;
  fetch?: Fetch;
  now?: () => number;
  /**
   * 認可の画面を開いたブラウザ（Android は Chrome Custom Tabs）で logoutUrl を開き、Cognito の Cookie を消す。
   * 認可コードをトークンに換えたあと、うまくいってもいかなくても呼ぶ。失敗してもログインの結果は変えない
   */
  clearBrowserSession?: () => Promise<void>;
};

/** 待ち時間の上限つきの fetch。時間切れも、つながらないのと同じに扱う */
export async function fetchWithTimeout(f: Fetch, url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await f(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createAuthClient({ config, store, fetch: f = (...a) => fetch(...a), now = Date.now, clearBrowserSession }: Deps) {
  const { tokenEndpoint, revocationEndpoint } = endpoints(config);
  // 更新は1つずつ。リフレッシュトークンは使うたびに新しくなる（ローテーション）ので、同時に2回送らない
  let refreshing: Promise<string | null> | null = null;

  const postForm = async (url: string, body: Record<string, string>) => {
    try {
      return await fetchWithTimeout(f, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(body).toString(),
      });
    } catch {
      throw new AuthError('network', 'ログインのサーバーにつながりませんでした');
    }
  };

  const requestTokens = async (body: Record<string, string>, previousRefreshToken?: string): Promise<Tokens> => {
    const startedAt = now();
    const res = await postForm(tokenEndpoint, { client_id: config.clientId, ...body });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      // 中身（トークンやコード）は文に入れない。Cognito の error の名前だけを見る
      if (res.status >= 500) throw new AuthError('server', 'ログインのサーバーで問題が起きました');
      if (json?.error === 'invalid_grant') throw new AuthError('expired', 'ログインの期限が切れました');
      throw new AuthError('rejected', 'ログインを受け付けてもらえませんでした');
    }
    const accessToken = json?.access_token;
    const expiresIn = json?.expires_in;
    // ローテーションで新しいリフレッシュトークンが来る。来なければ前のものを使い続ける
    const refreshToken = json?.refresh_token ?? previousRefreshToken;
    if (typeof accessToken !== 'string' || typeof expiresIn !== 'number' || typeof refreshToken !== 'string') {
      throw new AuthError('server', 'ログインのサーバーの返事の形が違います');
    }
    return { accessToken, refreshToken, expiresAt: startedAt + expiresIn * 1000 };
  };

  // ログアウトのたびに増やす。ログアウトの前に始まった更新の結果は保存しない（消したログインを戻さない）
  let generation = 0;

  const refresh = async (seen: Tokens): Promise<string | null> => {
    const started = generation;
    const current = await store.load();
    if (!current) return null;
    // 待つあいだに、ほかの呼び出しが更新を済ませていれば、それを使う（古いリフレッシュトークンで送り直さない）
    if (current.refreshToken !== seen.refreshToken) return current.accessToken;
    let next: Tokens;
    try {
      next = await requestTokens({ grant_type: 'refresh_token', refresh_token: current.refreshToken }, current.refreshToken);
    } catch (e) {
      // 切れた・取り消されたリフレッシュトークンは、残しても使えないので消す
      if (e instanceof AuthError && (e.code === 'expired' || e.code === 'rejected')) {
        if (started === generation) await store.clear();
        throw new AuthError('expired', 'ログインの期限が切れました');
      }
      throw e;
    }
    if (started !== generation) return null;
    await store.save(next);
    return next.accessToken;
  };

  return {
    /** 認可コードをトークンに換えて保存する（ログインの最後） */
    async signInWithCode({ code, codeVerifier, redirectUri }: { code: string; codeVerifier: string; redirectUri: string }) {
      try {
        const tokens = await requestTokens({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri });
        await store.save(tokens);
      } finally {
        await clearBrowserSession?.().catch(() => undefined);
      }
    },

    /** ログインしているか（保存したトークンがあるか）。期限は確かめない */
    async isSignedIn() {
      return (await store.load()) != null;
    },

    /**
     * 使えるアクセストークンを返す。期限が近ければリフレッシュトークンで更新する。ログインしていなければ null。
     * force は、API が 401 を返したとき（端末の時計がずれているなど）に、期限の前でも更新するため
     */
    async getAccessToken({ force = false }: { force?: boolean } = {}): Promise<string | null> {
      const current = await store.load();
      if (!current) return null;
      if (!force && current.expiresAt - REFRESH_MARGIN_MS > now()) return current.accessToken;
      refreshing ??= refresh(current).finally(() => { refreshing = null; });
      return refreshing;
    },

    /**
     * ログアウト：先に端末のトークンを消し、そのあと Cognito でリフレッシュトークンを取り消す（そこから出たアクセストークンも使えなくなる）。
     * 取り消しが届かなくても、端末からは消えている。届いたかを返す
     */
    async signOut(): Promise<{ revoked: boolean }> {
      generation++;
      const current = await store.load();
      await store.clear();
      if (!current) return { revoked: true };
      try {
        const res = await postForm(revocationEndpoint, { client_id: config.clientId, token: current.refreshToken });
        return { revoked: res.ok };
      } catch {
        return { revoked: false };
      }
    },
  };
}

export type AuthClient = ReturnType<typeof createAuthClient>;
