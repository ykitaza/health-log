import { makeRedirectUri, Prompt, ResponseType, useAuthRequest } from 'expo-auth-session';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { authConfig, NATIVE_REDIRECT_URI } from '@/lib/auth/config';
import { AuthError, endpoints, SCOPES } from '@/lib/auth/session';
import { useAuth } from './auth';

// web は、ログインの画面をポップアップで開き、自分の /callback に戻す（E2E と画面の確認用。Cognito には登録していない）
const redirectUri = Platform.OS === 'web' ? makeRedirectUri({ path: 'callback' }) : NATIVE_REDIRECT_URI;
const discovery = endpoints(authConfig);

/** ログインの失敗：つながらない（offline）か、それ以外（failed）。Figma の 7c・7d */
export type SignInError = 'failed' | 'offline' | null;

export const SIGN_IN_MESSAGES: Record<'failed' | 'offline', string> = {
  failed: 'ログインできませんでした。もう一度ログインしてください。',
  offline: 'ログインのサーバーにつながりませんでした。通信を確かめて、もう一度ログインしてください。',
};

/**
 * パスキーでログイン（KARADA の app/account.tsx と同じ流れ。Cognito のマネージドログイン、認可コード＋PKCE、prompt=login）。
 * 戻ったら認可コードをトークンに換える。onDone はログインできたときに呼ぶ
 */
export function useSignIn(onDone?: () => void) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignInError>(null);
  const [request, response, promptAsync] = useAuthRequest({
    clientId: authConfig.clientId,
    scopes: SCOPES,
    redirectUri,
    responseType: ResponseType.Code,
    usePKCE: true,
    prompt: Prompt.Login,
  }, discovery);

  const handled = useRef<object | null>(null);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;
    if (response.type === 'success') {
      const code = response.params.code;
      if (!code || !request?.codeVerifier) { setError('failed'); return; }
      setBusy(true);
      auth.completeSignIn({ code, codeVerifier: request.codeVerifier, redirectUri })
        .then(() => { setError(null); done.current?.(); })
        .catch((e) => setError(e instanceof AuthError && e.code === 'network' ? 'offline' : 'failed'))
        .finally(() => setBusy(false));
    } else if (response.type === 'error') {
      setError('failed');
    }
  }, [response, request, auth]);

  const signIn = async () => {
    setError(null);
    try {
      await promptAsync();
    } catch {
      setError('failed');
    }
  };

  return { signIn, busy, error, ready: !!request };
}
