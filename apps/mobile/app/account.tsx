import { makeRedirectUri, Prompt, ResponseType, useAuthRequest } from 'expo-auth-session';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Button, Card, ConfirmDialog, Header, SectionTitle } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { ApiError } from '@/lib/api';
import { authConfig, NATIVE_REDIRECT_URI } from '@/lib/auth/config';
import { AuthError, endpoints, SCOPES } from '@/lib/auth/session';
import { colors } from '@/theme';

// web は、ログインの画面をポップアップで開き、自分の /callback に戻す（E2E と画面の確認用。Cognito には登録していない）
const redirectUri = Platform.OS === 'web' ? makeRedirectUri({ path: 'callback' }) : NATIVE_REDIRECT_URI;
const discovery = endpoints(authConfig);
// Expo Go では torelog:// の戻りを受け取れないので、ログインできない（開発ビルドか APK で使う）
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const configured = !!authConfig.clientId && !!authConfig.cognitoDomain;

const signInErrorMessage = (e: unknown) => {
  if (e instanceof AuthError && e.code === 'network') return 'ログインのサーバーにつながりませんでした。通信を確かめて、もう一度ログインしてください。';
  return 'ログインできませんでした。もう一度ログインしてください。';
};

const apiErrorMessage = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : 'server';
  return {
    signedOut: 'ログインの期限が切れました。',
    forbidden: 'サーバーに断られました（権限が足りません）。ログアウトして、ログインし直してください。',
    throttled: 'サーバーが混んでいます。少し待ってから確かめてください。',
    network: 'サーバーにつながりませんでした。通信を確かめてください。',
    server: 'サーバーで問題が起きました。少し待ってから確かめてください。',
  }[code];
};

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

type Check = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok'; at: Date } | { kind: 'error'; message: string };

export default function AccountScreen() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ kind: 'idle' });
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 認可の画面の URL（state と PKCE の値）を先に作っておく（web で、押してからポップアップを開くまでを短くするため）。
  // 毎回ログインの画面を出す（prompt=login）：ブラウザに残った Cognito のセッションだけで、別のアプリが torelog:// の戻りを受け取れないように
  const [request, response, promptAsync] = useAuthRequest({
    clientId: authConfig.clientId,
    scopes: SCOPES,
    redirectUri,
    responseType: ResponseType.Code,
    usePKCE: true,
    prompt: Prompt.Login,
  }, discovery);

  const runCheck = useCallback(async () => {
    setCheck({ kind: 'checking' });
    try {
      await auth.api.checkConnection();
      setCheck({ kind: 'ok', at: new Date() });
    } catch (e) {
      setCheck({ kind: 'error', message: apiErrorMessage(e) });
    }
  }, [auth.api]);

  // 認可の画面から戻ったら、認可コードをトークンに換える（state は expo-auth-session が確かめている）
  const handled = useRef<object | null>(null);
  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;
    if (response.type === 'success') {
      const code = response.params.code;
      if (!code || !request?.codeVerifier) { setError(signInErrorMessage(null)); return; }
      setBusy(true);
      auth.completeSignIn({ code, codeVerifier: request.codeVerifier, redirectUri })
        .then(() => setError(null))
        .catch((e) => setError(signInErrorMessage(e)))
        .finally(() => setBusy(false));
    } else if (response.type === 'error') {
      // 中身（error_description など）は出さない。Cognito の画面で中止したときもここに来る
      setError(signInErrorMessage(null));
    }
    // dismiss・cancel（自分で閉じた）は知らせない
  }, [response, request, auth]);

  // ログインしたら、確認として API を1回呼ぶ
  useEffect(() => {
    if (auth.status === 'signedIn') { if (check.kind === 'idle') runCheck(); }
    else setCheck({ kind: 'idle' });
  }, [auth.status, check.kind, runCheck]);

  const signIn = async () => {
    setError(null);
    setNotice(null);
    try {
      await promptAsync();
    } catch {
      setError('ログインの画面を開けませんでした。');
    }
  };

  const signOut = async () => {
    setConfirmSignOut(false);
    setBusy(true);
    try {
      const { revoked } = await auth.signOut();
      setNotice(revoked ? 'ログアウトしました。' : 'ログアウトしました（この端末のログインの情報は消しました。サーバーへの取り消しは届きませんでした）。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="アカウント" onBack={() => router.back()} />

      {auth.status === 'signedIn' ? (
        <>
          <SectionTitle title="ログイン" />
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T bold size={16} style={{ flex: 1 }}>ログインしています</T>
              <Badge label="ログイン中" />
            </View>
            <T size={12} color={colors.sub}>パスキーでログインしています。記録は今までどおり端末に保存します（サーバーとの同期は次の段階で入ります）。</T>
          </Card>

          <SectionTitle title="サーバーとのつながり" />
          <Card style={{ gap: 12 }}>
            {check.kind === 'checking' && <T size={14} color={colors.sub}>確かめています…</T>}
            {check.kind === 'ok' && <T bold size={14} color={colors.accent}>{`つながりました（${hhmm(check.at)} に確認）`}</T>}
            {check.kind === 'error' && <T size={13} color={colors.danger}>{check.message}</T>}
            <Button label="もう一度確かめる" variant="secondary" small onPress={runCheck} disabled={check.kind === 'checking'} />
          </Card>

          <Button label="ログアウト" variant="danger" onPress={() => setConfirmSignOut(true)} disabled={busy} style={{ marginTop: 24 }} />
        </>
      ) : (
        <>
          <SectionTitle title="ログイン" />
          <Card style={{ gap: 12 }}>
            <T bold size={16}>ログインしていません</T>
            <T size={12} color={colors.sub} style={{ lineHeight: 18 }}>
              ログインは任意です。ログインしなくても、今までどおりこの端末だけで使えます。ログインすると、次の段階で記録をサーバーと同期できるようになります。
            </T>
            {auth.expired && <T size={13} color={colors.danger}>ログインの期限が切れました。もう一度ログインしてください。</T>}
            {error && <T size={13} color={colors.danger}>{error}</T>}
            {notice && <T size={13} color={colors.sub}>{notice}</T>}
            {inExpoGo && <T size={12} color={colors.sub}>Expo Go ではログインできません。開発ビルドか、配った APK で使ってください。</T>}
            {!configured && <T size={12} color={colors.sub}>ログインの設定（app.json の extra.torelog）がありません。</T>}
            <Button
              label={busy ? 'ログインしています…' : 'パスキーでログイン'}
              onPress={signIn}
              disabled={!request || busy || inExpoGo || !configured || auth.status === 'loading'}
            />
          </Card>
          <T size={12} color={colors.sub} style={{ marginTop: 8 }}>
            ログインの画面（Cognito）がブラウザで開きます。トークンはこの端末の安全な保存先にだけ置きます。
          </T>
        </>
      )}

      <ConfirmDialog
        visible={confirmSignOut}
        title="ログアウトしますか？"
        body="この端末のログインの情報を消し、サーバーでも取り消します。記録は消えません。"
        confirmLabel="ログアウト"
        onConfirm={signOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Screen>
  );
}
