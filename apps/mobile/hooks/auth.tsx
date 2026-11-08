import * as WebBrowser from 'expo-web-browser';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { createApiClient } from '@/lib/api';
import { apiBaseUrl, authConfig } from '@/lib/auth/config';
import { AuthError, createAuthClient, logoutUrl, NATIVE_LOGOUT_URI } from '@/lib/auth/session';
import { createSecureTokenStore } from '@/lib/auth/tokenStore';

/**
 * ログインの状態をアプリ全体で持つ（次の段階の同期も、ここの getAccessToken と api を使う）。
 * ログインは任意。ログインしていなくても、記録は今までどおり端末にだけ保存する
 */
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthValue = {
  status: AuthStatus;
  /** ログインの期限が切れて、ログインしていない状態に戻ったとき true（画面で知らせる） */
  expired: boolean;
  completeSignIn: (p: { code: string; codeVerifier: string; redirectUri: string }) => Promise<void>;
  signOut: () => Promise<{ revoked: boolean }>;
  api: ReturnType<typeof createApiClient>;
};

const AuthContext = createContext<AuthValue | null>(null);

/**
 * ログインに使ったブラウザ（Custom Tabs）で Cognito の /logout を開き、セッションの Cookie を消す（lib/auth/session.ts の logoutUrl）。
 * /logout はすぐ torelog://signout に戻すので、openAuthSessionAsync がそれを受け取って閉じる（利用者の操作は増えない）。
 * web は戻り先を Cognito に登録していないので、しない（web は E2E と画面の確認だけに使う）
 */
async function clearBrowserSession() {
  if (Platform.OS === 'web') return;
  await WebBrowser.openAuthSessionAsync(logoutUrl(authConfig), NATIVE_LOGOUT_URI);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [expired, setExpired] = useState(false);

  const client = useMemo(() => createAuthClient({ config: authConfig, store: createSecureTokenStore(), clearBrowserSession }), []);

  useEffect(() => {
    let alive = true;
    client.isSignedIn()
      .then((v) => { if (alive) setStatus(v ? 'signedIn' : 'signedOut'); })
      .catch(() => { if (alive) setStatus('signedOut'); }); // 保存先が読めないときは、ログインしていないものとして使い続ける
    return () => { alive = false; };
  }, [client]);

  // 更新でリフレッシュトークンが切れていたら、ログインしていない状態に戻す
  const getAccessToken = useCallback(async (opts?: { force?: boolean }) => {
    try {
      return await client.getAccessToken(opts);
    } catch (e) {
      if (e instanceof AuthError && e.code === 'expired') { setExpired(true); setStatus('signedOut'); }
      throw e;
    }
  }, [client]);

  const api = useMemo(() => createApiClient({ baseUrl: apiBaseUrl, getAccessToken }), [getAccessToken]);

  const completeSignIn = useCallback(async (p: { code: string; codeVerifier: string; redirectUri: string }) => {
    await client.signInWithCode(p);
    setExpired(false);
    setStatus('signedIn');
  }, [client]);

  const signOut = useCallback(async () => {
    const result = await client.signOut();
    setExpired(false);
    setStatus('signedOut');
    return result;
  }, [client]);

  const value = useMemo(() => ({ status, expired, completeSignIn, signOut, api }), [status, expired, completeSignIn, signOut, api]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('AuthProvider の外では使えません');
  return v;
}
