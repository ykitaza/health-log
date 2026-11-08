import { ApiError, createApiClient } from '../api';
import { accessTokenSubject, AuthError, createAuthClient, logoutUrl, REFRESH_MARGIN_MS, Tokens, TokenStore } from '../auth/session';
import { createSecureTokenStore } from '../auth/tokenStore';
import { fakeAccessToken } from '@/test-utils/fakeToken';

const config = { clientId: 'client-1', cognitoDomain: 'https://login.example.test' };
const TOKEN_URL = 'https://login.example.test/oauth2/token';
const REVOKE_URL = 'https://login.example.test/oauth2/revoke';

function memoryStore(initial: Tokens | null = null): TokenStore & { value: Tokens | null } {
  const s = {
    value: initial,
    async load() { return s.value; },
    async save(t: Tokens) { s.value = t; },
    async clear() { s.value = null; },
  };
  return s;
}

type Call = { url: string; init: RequestInit; form: Record<string, string> };

/** 呼ばれた URL と本文を残し、順に用意した返事を返す fetch */
function fakeFetch(responses: (Response | Error | (() => Promise<Response>))[]) {
  const calls: Call[] = [];
  const f = jest.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url: String(url), init, form: Object.fromEntries(new URLSearchParams(body)) });
    const next = responses.shift();
    if (!next) throw new Error('想定より多く呼ばれた');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tokenJson = (over: Record<string, unknown> = {}) => json(200, { access_token: 'access-new', refresh_token: 'refresh-new', id_token: 'id-x', expires_in: 900, token_type: 'Bearer', ...over });

const NOW = 1_800_000_000_000;

describe('ログイン（認可コードをトークンに換える）', () => {
  test('トークンを保存する。ID トークンは保存しない。シークレットは送らない', async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeFetch([tokenJson()]);
    const auth = createAuthClient({ config, store, fetch, now: () => NOW });
    await auth.signInWithCode({ code: 'code-1', codeVerifier: 'verifier-1', redirectUri: 'torelog://callback' });

    expect(store.value).toEqual({ accessToken: 'access-new', refreshToken: 'refresh-new', expiresAt: NOW + 900_000 });
    expect(JSON.stringify(store.value)).not.toContain('id-x');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].form).toEqual({
      client_id: 'client-1', grant_type: 'authorization_code', code: 'code-1', code_verifier: 'verifier-1', redirect_uri: 'torelog://callback',
    });
    expect(await auth.isSignedIn()).toBe(true);
  });

  test('断られたら保存しない。エラーの文にコードを入れない', async () => {
    const store = memoryStore();
    const { fetch } = fakeFetch([json(400, { error: 'invalid_grant' })]);
    const auth = createAuthClient({ config, store, fetch });
    const e = await auth.signInWithCode({ code: 'secret-code', codeVerifier: 'v', redirectUri: 'torelog://callback' }).catch((x) => x);
    expect(e).toBeInstanceOf(AuthError);
    expect(String(e.message)).not.toContain('secret-code');
    expect(store.value).toBeNull();
  });

  test('つながらないときは network', async () => {
    const { fetch } = fakeFetch([new TypeError('Network request failed')]);
    const auth = createAuthClient({ config, store: memoryStore(), fetch });
    await expect(auth.signInWithCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).rejects.toMatchObject({ code: 'network' });
  });

  test('返事にリフレッシュトークンがなければ、保存しない', async () => {
    const store = memoryStore();
    const { fetch } = fakeFetch([tokenJson({ refresh_token: undefined })]);
    const auth = createAuthClient({ config, store, fetch });
    await expect(auth.signInWithCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).rejects.toMatchObject({ code: 'server' });
    expect(store.value).toBeNull();
  });
});

describe('ログインのあと、Cognito のセッションの Cookie を消す（torelog:// の横取りの対策）', () => {
  test('/logout の URL は client_id と、登録したログアウトの戻り先（torelog://signout）', () => {
    const u = new URL(logoutUrl(config));
    expect(u.origin + u.pathname).toBe('https://login.example.test/logout');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'client-1', logout_uri: 'torelog://signout' });
  });

  test('トークンに換えて保存したあとに、Cookie を消す', async () => {
    const store = memoryStore();
    const order: string[] = [];
    const { fetch } = fakeFetch([async () => { order.push('token'); return tokenJson(); }]);
    const clearBrowserSession = jest.fn(async () => { order.push(store.value ? 'logout(保存済み)' : 'logout(未保存)'); });
    const auth = createAuthClient({ config, store, fetch, clearBrowserSession });
    await auth.signInWithCode({ code: 'c', codeVerifier: 'v', redirectUri: 'torelog://callback' });
    expect(order).toEqual(['token', 'logout(保存済み)']);
    expect(clearBrowserSession).toHaveBeenCalledTimes(1);
  });

  test('換えられなかったときも、Cookie を消す（エラーはそのまま返す）', async () => {
    const clearBrowserSession = jest.fn(async () => {});
    const { fetch } = fakeFetch([json(400, { error: 'invalid_grant' })]);
    const auth = createAuthClient({ config, store: memoryStore(), fetch, clearBrowserSession });
    await expect(auth.signInWithCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).rejects.toBeInstanceOf(AuthError);
    expect(clearBrowserSession).toHaveBeenCalledTimes(1);
  });

  test('つながらなかったときも、Cookie を消す', async () => {
    const clearBrowserSession = jest.fn(async () => {});
    const { fetch } = fakeFetch([new TypeError('Network request failed')]);
    const auth = createAuthClient({ config, store: memoryStore(), fetch, clearBrowserSession });
    await expect(auth.signInWithCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' })).rejects.toMatchObject({ code: 'network' });
    expect(clearBrowserSession).toHaveBeenCalledTimes(1);
  });

  test('Cookie を消せなくても、ログインは済ませる', async () => {
    const store = memoryStore();
    const { fetch } = fakeFetch([tokenJson()]);
    const auth = createAuthClient({ config, store, fetch, clearBrowserSession: async () => { throw new Error('browser failed'); } });
    await auth.signInWithCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' });
    expect(store.value?.accessToken).toBe('access-new');
  });

  test('トークンの更新とログアウトでは開かない（ブラウザを出さない）', async () => {
    const clearBrowserSession = jest.fn(async () => {});
    const { fetch } = fakeFetch([tokenJson(), new Response('', { status: 200 })]);
    const auth = createAuthClient({ config, store: memoryStore({ accessToken: 'a', refreshToken: 'r', expiresAt: 0 }), fetch, clearBrowserSession, now: () => NOW });
    await auth.getAccessToken();
    await auth.signOut();
    expect(clearBrowserSession).not.toHaveBeenCalled();
  });
});

describe('アクセストークンの更新', () => {
  const saved = (expiresAt: number): Tokens => ({ accessToken: 'access-old', refreshToken: 'refresh-old', expiresAt });

  test('ログインしていなければ null（通信しない）', async () => {
    const { fetch, calls } = fakeFetch([]);
    const auth = createAuthClient({ config, store: memoryStore(), fetch });
    expect(await auth.getAccessToken()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('期限まで余裕があれば、保存したものをそのまま使う', async () => {
    const { fetch, calls } = fakeFetch([]);
    const auth = createAuthClient({ config, store: memoryStore(saved(NOW + REFRESH_MARGIN_MS + 1)), fetch, now: () => NOW });
    expect(await auth.getAccessToken()).toBe('access-old');
    expect(calls).toHaveLength(0);
  });

  test('期限が近ければ（1分前から）更新し、新しいリフレッシュトークンも保存する（ローテーション）', async () => {
    const store = memoryStore(saved(NOW + REFRESH_MARGIN_MS));
    const { fetch, calls } = fakeFetch([tokenJson()]);
    const auth = createAuthClient({ config, store, fetch, now: () => NOW });
    expect(await auth.getAccessToken()).toBe('access-new');
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[0].form).toEqual({ client_id: 'client-1', grant_type: 'refresh_token', refresh_token: 'refresh-old' });
    expect(store.value).toEqual({ accessToken: 'access-new', refreshToken: 'refresh-new', expiresAt: NOW + 900_000 });
  });

  test('返事に新しいリフレッシュトークンがなければ、前のものを使い続ける', async () => {
    const store = memoryStore(saved(NOW - 1));
    const { fetch } = fakeFetch([tokenJson({ refresh_token: undefined })]);
    const auth = createAuthClient({ config, store, fetch, now: () => NOW });
    expect(await auth.getAccessToken()).toBe('access-new');
    expect(store.value?.refreshToken).toBe('refresh-old');
  });

  test('期限の前でも force なら更新する（API が 401 を返したとき）', async () => {
    const { fetch, calls } = fakeFetch([tokenJson()]);
    const auth = createAuthClient({ config, store: memoryStore(saved(NOW + 600_000)), fetch, now: () => NOW });
    expect(await auth.getAccessToken({ force: true })).toBe('access-new');
    expect(calls).toHaveLength(1);
  });

  test('同時に呼んでも、更新は1回だけ送る', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetch, calls } = fakeFetch([async () => { await gate; return tokenJson(); }]);
    const auth = createAuthClient({ config, store: memoryStore(saved(NOW - 1)), fetch, now: () => NOW });
    const all = Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
    await new Promise((r) => setTimeout(r, 0));
    release();
    expect(await all).toEqual(['access-new', 'access-new', 'access-new']);
    expect(calls).toHaveLength(1);
  });

  test('リフレッシュトークンが切れていたら（invalid_grant）、トークンを消して expired', async () => {
    const store = memoryStore(saved(NOW - 1));
    const { fetch } = fakeFetch([json(400, { error: 'invalid_grant' })]);
    const auth = createAuthClient({ config, store, fetch, now: () => NOW });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'expired' });
    expect(store.value).toBeNull();
    expect(await auth.isSignedIn()).toBe(false);
  });

  test('つながらないときは、トークンを消さない（次につながったときに更新する）', async () => {
    const store = memoryStore(saved(NOW - 1));
    const { fetch } = fakeFetch([new TypeError('Network request failed'), tokenJson()]);
    const auth = createAuthClient({ config, store, fetch, now: () => NOW });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'network' });
    expect(store.value?.refreshToken).toBe('refresh-old');
    expect(await auth.getAccessToken()).toBe('access-new');
  });

  test('Cognito の不具合（5xx）でも、トークンを消さない', async () => {
    const store = memoryStore(saved(NOW - 1));
    const { fetch } = fakeFetch([json(503, {})]);
    const auth = createAuthClient({ config, store, fetch, now: () => NOW });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'server' });
    expect(store.value).not.toBeNull();
  });

  test('更新の途中でログアウトしたら、更新の結果を保存しない', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const store = memoryStore(saved(NOW - 1));
    const { fetch } = fakeFetch([async () => { await gate; return tokenJson(); }, json(200, {})]);
    const auth = createAuthClient({ config, store, fetch, now: () => NOW });
    const pending = auth.getAccessToken();
    await new Promise((r) => setTimeout(r, 0));
    await auth.signOut();
    release();
    expect(await pending).toBeNull();
    expect(store.value).toBeNull();
  });
});

describe('ログアウト', () => {
  test('端末のトークンを消してから、リフレッシュトークンを取り消す', async () => {
    const store = memoryStore({ accessToken: 'a', refreshToken: 'refresh-1', expiresAt: NOW });
    let storedWhenRevoked: Tokens | null | undefined;
    const { fetch, calls } = fakeFetch([async () => { storedWhenRevoked = store.value; return new Response('', { status: 200 }); }]);
    const auth = createAuthClient({ config, store, fetch });
    expect(await auth.signOut()).toEqual({ revoked: true });
    expect(storedWhenRevoked).toBeNull();
    expect(store.value).toBeNull();
    expect(calls[0].url).toBe(REVOKE_URL);
    expect(calls[0].form).toEqual({ client_id: 'client-1', token: 'refresh-1' });
  });

  test('取り消しが届かなくても、端末からは消える', async () => {
    const store = memoryStore({ accessToken: 'a', refreshToken: 'r', expiresAt: NOW });
    const { fetch } = fakeFetch([new TypeError('Network request failed')]);
    const auth = createAuthClient({ config, store, fetch });
    expect(await auth.signOut()).toEqual({ revoked: false });
    expect(store.value).toBeNull();
  });

  test('ログインしていなければ、通信しない', async () => {
    const { fetch, calls } = fakeFetch([]);
    const auth = createAuthClient({ config, store: memoryStore(), fetch });
    expect(await auth.signOut()).toEqual({ revoked: true });
    expect(calls).toHaveLength(0);
  });
});

describe('安全な保存先（expo-secure-store）', () => {
  const fakeSecure = () => {
    const m = new Map<string, string>();
    return {
      m,
      getItemAsync: jest.fn(async (k: string) => m.get(k) ?? null),
      setItemAsync: jest.fn(async (k: string, v: string) => { m.set(k, v); }),
      deleteItemAsync: jest.fn(async (k: string) => { m.delete(k); }),
    };
  };

  test('保存・読み出し・消去', async () => {
    const secure = fakeSecure();
    const store = createSecureTokenStore(secure);
    expect(await store.load()).toBeNull();
    await store.save({ accessToken: 'a', refreshToken: 'r', expiresAt: 123 });
    expect(await store.load()).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 123 });
    await store.clear();
    expect(secure.m.size).toBe(0);
    expect(await store.load()).toBeNull();
  });

  test('一部だけ残っていたら、ログインしていないことにする', async () => {
    const secure = fakeSecure();
    const store = createSecureTokenStore(secure);
    await store.save({ accessToken: 'a', refreshToken: 'r', expiresAt: 123 });
    secure.m.delete('auth.accessToken');
    expect(await store.load()).toBeNull();
  });
});

describe('アプリ用の API のクライアント', () => {
  const API = 'https://api.example.test';
  const page = () => json(200, { entries: [], next_cursor: 0, has_more: false });

  test('トークンは Authorization ヘッダーにだけ載せる（URL に載せない）', async () => {
    const { fetch, calls } = fakeFetch([page()]);
    const api = createApiClient({ baseUrl: API, getAccessToken: async () => 'access-1', fetch });
    expect(await api.pullChanges(0, 1)).toEqual({ entries: [], next_cursor: 0, has_more: false });
    expect(calls[0].url).toBe(`${API}/v1/sync/changes?after=0&limit=1`);
    expect(calls[0].url).not.toContain('access-1');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });

  test('401 なら、トークンを1回だけ更新して送り直す', async () => {
    const { fetch, calls } = fakeFetch([json(401, { message: 'Unauthorized' }), page()]);
    const getAccessToken = jest.fn(async (o?: { force?: boolean }) => (o?.force ? 'access-2' : 'access-1'));
    const api = createApiClient({ baseUrl: API, getAccessToken, fetch });
    await api.pullChanges(0, 1);
    expect(getAccessToken).toHaveBeenLastCalledWith({ force: true });
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer access-2');
  });

  test('送り直しても 401 なら signedOut', async () => {
    const { fetch } = fakeFetch([json(401, {}), json(401, {})]);
    const api = createApiClient({ baseUrl: API, getAccessToken: async () => 't', fetch });
    await expect(api.pullChanges(0, 1)).rejects.toMatchObject({ code: 'signedOut' });
  });

  test.each([[403, 'forbidden'], [429, 'throttled'], [500, 'server']])('%i は %s', async (status, code) => {
    const { fetch } = fakeFetch([json(status, {})]);
    const api = createApiClient({ baseUrl: API, getAccessToken: async () => 't', fetch });
    await expect(api.pullChanges(0, 1)).rejects.toMatchObject({ code });
  });

  test('ログインしていなければ、通信せずに signedOut', async () => {
    const { fetch, calls } = fakeFetch([]);
    const api = createApiClient({ baseUrl: API, getAccessToken: async () => null, fetch });
    await expect(api.pullChanges(0, 1)).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(0);
  });

  test('ログインの期限切れ（更新の失敗）は signedOut、つながらないのは network', async () => {
    const expired = createApiClient({ baseUrl: API, getAccessToken: async () => { throw new AuthError('expired', 'x'); }, fetch: fakeFetch([]).fetch });
    await expect(expired.pullChanges(0, 1)).rejects.toMatchObject({ code: 'signedOut' });
    const offline = createApiClient({ baseUrl: API, getAccessToken: async () => 't', fetch: fakeFetch([new TypeError('Network request failed')]).fetch });
    await expect(offline.pullChanges(0, 1)).rejects.toMatchObject({ code: 'network' });
  });
});

describe('ログインの戻りのリンク（+native-intent）', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { redirectSystemPath } = require('../../app/+native-intent') as typeof import('../../app/+native-intent');

  test('アプリを開いているときの戻りは、画面を動かさない（認可コードを道に残さない）', () => {
    expect(redirectSystemPath({ path: 'torelog://callback?code=c&state=s', initial: false })).toBeNull();
    expect(redirectSystemPath({ path: '/callback?code=c', initial: false })).toBeNull();
  });

  test('閉じていたときの戻りは、アカウントの画面を開く', () => {
    expect(redirectSystemPath({ path: 'torelog://callback?code=c&state=s', initial: true })).toBe('/account');
  });

  test('Cookie を消したあとの戻り（torelog://signout）も、画面を動かさない', () => {
    expect(redirectSystemPath({ path: 'torelog://signout', initial: false })).toBeNull();
    expect(redirectSystemPath({ path: 'torelog://signout', initial: true })).toBe('/');
  });

  test('ほかのリンクはそのまま', () => {
    expect(redirectSystemPath({ path: 'torelog://settings', initial: false })).toBe('torelog://settings');
    expect(redirectSystemPath({ path: '/callbacks', initial: false })).toBe('/callbacks');
  });
});

describe('アクセストークンの sub（同期した相手のアカウントを見分ける）', () => {
  test('JWT の本体から sub を読む。読めないものは null', () => {
    expect(accessTokenSubject(fakeAccessToken('11111111-2222-4333-8444-555555555555'))).toBe('11111111-2222-4333-8444-555555555555');
    const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    // base64url の - と _ が入るもの、詰め物（=）がないもの
    expect(accessTokenSubject(`x.${b64url({ sub: 'a>?b', n: '\u00ff\u00ff' })}.y`)).toBe('a>?b');
    for (const bad of ['test-access', 'a..b', 'a.!!!.b', `a.${b64url({ sub: 1 })}.b`, `a.${b64url({ sub: '' })}.b`, `a.${b64url(null)}.b`]) {
      expect(accessTokenSubject(bad)).toBeNull();
    }
  });
});
