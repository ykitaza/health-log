import { makeRedirectUri, Prompt, ResponseType, useAuthRequest } from 'expo-auth-session';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Button, Card, ConfirmDialog, Header, SectionTitle } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { useSync } from '@/hooks/sync';
import type { ApiErrorCode } from '@/lib/api';
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

const syncErrorMessage = (code: ApiErrorCode) => ({
  signedOut: 'ログインの期限が切れました。もう一度ログインしてください。',
  forbidden: 'サーバーに断られました（権限が足りません）。ログアウトして、ログインし直してください。',
  throttled: 'サーバーが混んでいます。少し待ってから、自動でやり直します。',
  network: 'サーバーにつながりませんでした。つながるようになったら、自動でやり直します。',
  rejected: 'サーバーに断られました。',
  server: 'サーバーで問題が起きました。少し待ってから、自動でやり直します。',
}[code]);

const pad = (n: number) => String(n).padStart(2, '0');
/** 同期した時刻（端末の時刻で「11/8 10:05」） */
const formatSyncedAt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function AccountScreen() {
  const auth = useAuth();
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
            <T size={12} color={colors.sub} style={{ lineHeight: 18 }}>
              パスキーでログインしています。記録は先に端末に保存し、サーバーと同期します。チャット（MCP）で記録したものもここに届きます。
            </T>
          </Card>

          <SectionTitle title="同期" />
          <Card style={{ gap: 12 }}>
            <StatusRow label="最後に同期した時刻" value={sync.lastSyncedAt ? formatSyncedAt(sync.lastSyncedAt) : 'まだ同期していません'} testID="sync-last" />
            <StatusRow label="送っていない変更" value={`${sync.pending}件`} testID="sync-pending" />
            {sync.rejected > 0 && (
              <>
                <StatusRow label="サーバーに断られた変更" value={`${sync.rejected}件`} color={colors.danger} testID="sync-rejected" />
                <T size={12} color={colors.sub} style={{ lineHeight: 18 }}>
                  サーバーが受け付けなかった変更です。送り直しはしません。端末の記録はそのまま残ります。
                </T>
              </>
            )}
            {sync.error && !sync.syncing && <T size={13} color={colors.danger}>{syncErrorMessage(sync.error)}</T>}
            <Button
              label={sync.syncing ? '同期しています…' : '今すぐ同期'}
              variant="secondary"
              small
              onPress={sync.syncNow}
              disabled={sync.syncing}
            />
          </Card>

          <Button label="ログアウト" variant="danger" onPress={() => setConfirmSignOut(true)} disabled={busy} style={{ marginTop: 24 }} />
        </>
      ) : (
        <>
          <SectionTitle title="ログイン" />
          <Card style={{ gap: 12 }}>
            <T bold size={16}>ログインしていません</T>
            <T size={12} color={colors.sub} style={{ lineHeight: 18 }}>
              ログインは任意です。ログインしなくても、今までどおりこの端末だけで使えます。ログインすると、記録をサーバーと同期し、チャット（MCP）からも読み書きできるようになります。
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

function StatusRow({ label, value, color = colors.text, testID }: { label: string; value: string; color?: string; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <T size={14} color={colors.sub} style={{ flex: 1 }}>{label}</T>
      <T bold size={14} color={color} testID={testID}>{value}</T>
    </View>
  );
}
