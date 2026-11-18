import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ConnectorUrl } from '@/components/ConnectorUrl';
import { Icon } from '@/components/Icon';
import { Button, ConfirmDialog, Header, InfoRow, LinkRow, Notice, Screen, SectionTitle, T } from '@/components/ui';
import type { AccountSwitch } from '@/db/repositories/sync';
import { useAuth } from '@/hooks/auth';
import { SIGN_IN_MESSAGES, useSignIn } from '@/hooks/signIn';
import { useSync } from '@/hooks/sync';
import type { SyncErrorCode } from '@/lib/sync/engine';
import { colors, space } from '@/theme';

const syncErrorMessage = (code: SyncErrorCode) => ({
  accountChanged: '前に同期したのと違うアカウントでログインしたので、同期を止めています。',
  signedOut: 'ログインの期限が切れました。もう一度ログインしてください。',
  forbidden: 'サーバーに断られました（権限が足りません）。ログアウトして、ログインし直してください。',
  throttled: 'サーバーが混んでいます。少し待ってから、自動でやり直します。',
  network: 'サーバーにつながりませんでした。つながるようになったら、自動でやり直します。',
  rejected: 'サーバーに断られました。',
  server: 'サーバーで問題が起きました。少し待ってから、自動でやり直します。',
}[code]);

const pad = (n: number) => String(n).padStart(2, '0');
const formatSyncedAt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** アカウント（Figma の 9-account）。ログインと同期の状態、AI とつなぐ、別のアカウントにする、ログアウト */
export default function AccountScreen() {
  const auth = useAuth();
  const sync = useSync();
  const { signIn, busy: signingIn, error: signInError } = useSignIn();
  const [busy, setBusy] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState<'signOut' | 'switch' | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<AccountSwitch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const signedIn = auth.status === 'signedIn';

  const signOut = async () => {
    const then = confirmSignOut;
    setConfirmSignOut(null);
    setBusy(true);
    try {
      const { revoked } = await auth.signOut();
      setNotice(revoked ? 'ログアウトしました。' : 'ログアウトしました（サーバーへの取り消しは届きませんでした）。');
    } finally {
      setBusy(false);
    }
    if (then === 'switch') await signIn();
  };

  const switchAccount = async (mode: AccountSwitch) => {
    setConfirmSwitch(null);
    setBusy(true);
    try {
      await sync.switchAccount(mode);
    } catch {
      setNotice('切り替えられませんでした。通信を確かめて、もう一度選んでください。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="account-screen" footer={notice ? <Notice message={notice} /> : undefined}>
      <Header title="アカウント" onBack={() => router.back()} />
      <View style={s.head}>
        <View style={s.avatar}><Icon name="user" size={32} color={colors.sub} /></View>
        <T variant="body" color={colors.sub} testID="account-status">{signedIn ? 'ログインしています' : 'ログインしていません'}</T>
      </View>

      {!signedIn && (
        <View style={{ gap: space.m, marginTop: space.xl }}>
          {signInError && (
            <View style={{ flexDirection: 'row', gap: space.m }} accessibilityRole="alert" testID="signin-error">
              {signInError === 'offline' && <Icon name="wifiOff" size={24} color={colors.sub} />}
              <T variant="body" style={{ flex: 1 }}>{SIGN_IN_MESSAGES[signInError]}</T>
            </View>
          )}
          {auth.expired && <T variant="body">ログインの期限が切れました。もう一度ログインしてください。</T>}
          <Button label={signInError ? 'もう一度ログイン' : 'パスキーでログイン'} onPress={signIn} busy={signingIn} testID="signin" />
          <T variant="bodyS" color={colors.sub} style={{ textAlign: 'center' }}>KARADA と同じアカウント。同じパスキーでそのまま入れます</T>
          <T variant="bodyS" color={colors.sub} style={{ textAlign: 'center' }}>ログインしなくても、この端末だけで使えます</T>
        </View>
      )}

      {signedIn && (
        <>
          <SectionTitle title="ログイン" right={<T variant="bodyS" color={colors.sub}>KARADA と同じアカウント</T>} />
          <InfoRow label="ログインの方法" value="パスキー" />
          <InfoRow label="最後に同期した時刻" value={sync.lastSyncedAt ? formatSyncedAt(sync.lastSyncedAt) : 'まだ'} testID="sync-last" />
          <InfoRow label="送っていない変更" value={`${sync.pending}件`} testID="sync-pending" />
          {sync.rejected > 0 && <InfoRow label="断られた変更" value={`${sync.rejected}件`} testID="sync-rejected" />}
          {!sync.configured && <T variant="bodyS" color={colors.sub} testID="sync-unconfigured">同期の先（ことばのサーバー）がまだありません。記録はこの端末に残り、できたら送ります。</T>}
          {sync.error && <T variant="bodyS" style={{ marginTop: space.s }} testID="sync-error">{syncErrorMessage(sync.error)}</T>}
          {sync.configured && <Button label={sync.syncing ? '同期しています' : '今すぐ同期'} variant="plain" small onPress={sync.syncNow} disabled={sync.syncing} style={{ marginTop: space.m }} testID="sync-now" />}

          {sync.error === 'accountChanged' && (
            <View style={{ gap: space.s, marginTop: space.l }}>
              <T variant="body" bold>前と違うアカウントでログインしました</T>
              <T variant="bodyS" color={colors.sub}>この端末の記録は、前に同期したアカウントのものです。どうするかを選ぶまで、同期を止めています。</T>
              <Button label="この端末の記録を新しいアカウントに送る" variant="plain" small onPress={() => setConfirmSwitch('send')} disabled={busy} />
              <Button label="端末の記録を消して、新しいアカウントから受け取り直す" variant="plain" small onPress={() => setConfirmSwitch('replace')} disabled={busy} />
            </View>
          )}
        </>
      )}

      <SectionTitle title="AI とつなぐ" />
      <ConnectorUrl />
      <LinkRow title="つなぎ方を見る" onPress={() => router.push('/connect')} testID="open-connect" />

      {signedIn && (
        <>
          <View style={{ marginTop: space.xl }}>
            <LinkRow title="別のアカウントにする" sub="ログアウトして、別のアカウントでログインし直します" onPress={() => setConfirmSignOut('switch')} />
          </View>
          <Button label="ログアウト" variant="plain" onPress={() => setConfirmSignOut('signOut')} disabled={busy} style={{ marginTop: space.l }} testID="signout" />
          <T variant="bodyS" color={colors.sub} style={{ textAlign: 'center', marginTop: space.s }}>ログアウトしても、拾った言葉は消えません</T>
        </>
      )}

      <ConfirmDialog
        visible={confirmSignOut != null}
        title={confirmSignOut === 'switch' ? '別のアカウントにしますか？' : 'ログアウトしますか？'}
        message="この端末の記録は消えません。送っていない変更は、次にログインしたときに送ります。"
        confirmLabel={confirmSignOut === 'switch' ? 'ログアウトして続ける' : 'ログアウト'}
        onConfirm={signOut}
        onCancel={() => setConfirmSignOut(null)}
      />
      <ConfirmDialog
        visible={confirmSwitch != null}
        title={confirmSwitch === 'replace' ? '端末の記録を消しますか？' : '新しいアカウントに送りますか？'}
        message={confirmSwitch === 'replace' ? 'この端末の拾った言葉を消し、新しいアカウントの記録を受け取り直します。' : 'この端末の拾った言葉を、新しいアカウントに送ります。'}
        confirmLabel={confirmSwitch === 'replace' ? '消して受け取る' : '送る'}
        onConfirm={() => confirmSwitch && switchAccount(confirmSwitch)}
        onCancel={() => setConfirmSwitch(null)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { alignItems: 'center', gap: space.m, marginTop: space.l },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
