import { makeRedirectUri, Prompt, ResponseType, useAuthRequest } from 'expo-auth-session';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { BodyInfoCard } from '@/components/BodyInfo';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { PressableScale, Sheet } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Button, Card, ConfirmDialog, Header, ListRow, SectionTitle } from '@/components/ui';
import type { AccountSwitch } from '@/db/repositories/sync';
import { useAuth } from '@/hooks/auth';
import { useProfile } from '@/hooks/profile';
import { useSync } from '@/hooks/sync';
import { authConfig, NATIVE_REDIRECT_URI } from '@/lib/auth/config';
import { AuthError, endpoints, SCOPES } from '@/lib/auth/session';
import { accountTitle, DISPLAY_NAME_MAX, loginStatusText, PROFILE_NOTE } from '@/lib/profile';
import type { SyncErrorCode } from '@/lib/sync/engine';
import { colors, radius, space } from '@/theme';

// web は、ログインの画面をポップアップで開き、自分の /callback に戻す（E2E と画面の確認用。Cognito には登録していない）
const redirectUri = Platform.OS === 'web' ? makeRedirectUri({ path: 'callback' }) : NATIVE_REDIRECT_URI;
const discovery = endpoints(authConfig);
// Expo Go では torelog:// の戻りを受け取れないので、ログインできない（開発ビルドか APK で使う）
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const configured = !!authConfig.clientId && !!authConfig.cognitoDomain;

/** 写真の大きさ（いちばん上） */
const PHOTO_SIZE = 96;

const signInErrorMessage = (e: unknown) => {
  if (e instanceof AuthError && e.code === 'network') return 'ログインのサーバーにつながりませんでした。通信を確かめて、もう一度ログインしてください。';
  return 'ログインできませんでした。もう一度ログインしてください。';
};

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
/** 同期した時刻（端末の時刻で「11/8 10:05」） */
const formatSyncedAt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * アカウントの画面：写真と表示名（端末だけ）、体の情報、ログインと同期、別のアカウントにする、ログアウト。
 * 記録はアカウントごとに分けない（前と違うアカウントでログインしたときは、端末の記録をどうするかを聞く）
 */
export default function AccountScreen() {
  const auth = useAuth();
  const sync = useSync();
  const profile = useProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ログアウトの確認。switch は「別のアカウントにする」（ログアウトしてから、ログインの画面を開く）
  const [confirmSignOut, setConfirmSignOut] = useState<'signOut' | 'switch' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<AccountSwitch | null>(null);
  const [switchError, setSwitchError] = useState(false);
  // 表示名の欄。打っているあいだだけ持ち、保存したら置いた値（profile.displayName）に戻す
  const [name, setName] = useState<string | null>(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const signedIn = auth.status === 'signedIn';

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
    const then = confirmSignOut;
    setConfirmSignOut(null);
    setBusy(true);
    try {
      const { revoked } = await auth.signOut();
      setNotice(revoked ? 'ログアウトしました。' : 'ログアウトしました（この端末のログインの情報は消しました。サーバーへの取り消しは届きませんでした）。');
    } finally {
      setBusy(false);
    }
    // 別のアカウントにする：ログアウトできたら、続けてログインの画面を開く
    if (then === 'switch') await signIn();
  };

  const switchAccount = async (mode: AccountSwitch) => {
    setConfirmSwitch(null);
    setBusy(true);
    setSwitchError(false);
    try {
      await sync.switchAccount(mode);
    } catch {
      setSwitchError(true);
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    if (name == null) return;
    await profile.setDisplayName(name);
    setName(null);
  };

  // 写真を選ぶ・外すのは、シートを閉じてから（端末の写真の画面をシートの上に重ねない）
  const pickPhoto = async () => {
    setPhotoSheet(false);
    setPhotoError(null);
    try {
      await profile.pickPhoto();
    } catch {
      setPhotoError('写真を置けませんでした。もう一度選んでください。');
    }
  };
  const removePhoto = async () => {
    setPhotoSheet(false);
    setPhotoError(null);
    try {
      await profile.removePhoto();
    } catch {
      setPhotoError('写真を外せませんでした。もう一度試してください。');
    }
  };

  return (
    <Screen>
      <Header title="アカウント" onBack={() => router.back()} />

      <View style={s.head}>
        <PressableScale
          accessibilityRole="button" accessibilityLabel="アカウントの写真。押すと写真を選ぶ" scaleTo={0.96}
          onPress={() => setPhotoSheet(true)} testID="account-photo"
        >
          <Avatar uri={profile.photoUri} size={PHOTO_SIZE} />
          <View style={s.editMark}><Icon name="pencil" size={16} color={colors.onAccentDark} /></View>
        </PressableScale>
        <T variant="headlineS" align="center" numberOfLines={1} testID="account-name">{accountTitle(profile.displayName)}</T>
        <T variant="bodyM" color={colors.sub} align="center" testID="account-status">{loginStatusText(signedIn)}</T>
        {photoError && <T variant="bodyS" color={colors.danger} align="center">{photoError}</T>}
      </View>

      {signedIn && sync.error === 'accountChanged' && (
        <>
          <SectionTitle title="アカウントが変わりました" />
          {/* どれかを選ぶまで同期しない（端末の記録を、前と違うアカウントに勝手に送らない）。アカウントの ID は出さない */}
          <Card style={{ gap: 12 }}>
            <T bold size={16}>前と違うアカウントでログインしました</T>
            <T size={12} color={colors.sub} style={{ lineHeight: 18 }}>
              この端末の記録は、前に同期したアカウントのものです。どうするかを選ぶまで、同期を止めています。
            </T>
            {switchError && <T size={13} color={colors.danger}>切り替えられませんでした。通信を確かめて、もう一度選んでください。</T>}
            <Button label="この端末の記録を新しいアカウントに送る" variant="secondary" small onPress={() => setConfirmSwitch('send')} disabled={busy} />
            <Button label="端末の記録を消して、新しいアカウントから受け取り直す" variant="secondary" small onPress={() => setConfirmSwitch('replace')} disabled={busy} />
            <Button label="ログアウトする" variant="secondary" small onPress={() => setConfirmSignOut('signOut')} disabled={busy} />
          </Card>
        </>
      )}

      <SectionTitle title="プロフィール" />
      <Card style={{ gap: space.l }}>
        {/* 置いた表示名を読み終えてから出す（読み終える前に打つと、あとから届いた値で上書きされる） */}
        {profile.loaded && (
          <Field
            label="表示名" value={name ?? profile.displayName ?? ''} shake={0} onChange={setName} onDone={saveName}
            keyboardType="default" maxLength={DISPLAY_NAME_MAX}
          />
        )}
        <T variant="bodyS" color={colors.sub}>{PROFILE_NOTE}</T>
      </Card>

      <SectionTitle title="体の情報" />
      <BodyInfoCard />

      <SectionTitle title="ログインと同期" />
      {signedIn ? (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T size={14} color={colors.sub} style={{ flex: 1 }}>ログインの状態</T>
            <Badge label="ログイン中" />
          </View>
          <T size={12} color={colors.sub} style={{ lineHeight: 18 }}>
            パスキーでログインしています。記録は先に端末に保存し、サーバーと同期します。チャット（MCP）で記録したものもここに届きます。
          </T>
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
      ) : (
        <>
          <Card style={{ gap: 12 }}>
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

      {signedIn && (
        <>
          <Card style={{ padding: 0, marginTop: space.l }}>
            <ListRow
              first
              title="別のアカウントにする"
              subtitle="ログアウトして、別のアカウントでログインし直します"
              onPress={() => setConfirmSignOut('switch')}
            />
          </Card>
          <Button label="ログアウト" variant="danger" onPress={() => setConfirmSignOut('signOut')} disabled={busy} style={{ marginTop: 24 }} />
        </>
      )}

      <ConfirmDialog
        visible={confirmSignOut != null}
        title="ログアウトしますか？"
        body={confirmSignOut === 'switch'
          ? 'この端末のログインの情報を消し、サーバーでも取り消します。記録は消えません。ログアウトしたら、ログインの画面を開きます。'
          : 'この端末のログインの情報を消し、サーバーでも取り消します。記録は消えません。'}
        confirmLabel="ログアウト"
        onConfirm={signOut}
        onCancel={() => setConfirmSignOut(null)}
      />
      <ConfirmDialog
        visible={confirmSwitch === 'send'}
        title="この端末の記録を送りますか？"
        body="この端末にある記録（前のアカウントから受け取ったものも含む）を、今ログインしているアカウントに送ります。前のアカウントのサーバーの記録は、そのまま残ります。"
        confirmLabel="送る"
        danger={false}
        onConfirm={() => void switchAccount('send')}
        onCancel={() => setConfirmSwitch(null)}
      />
      <ConfirmDialog
        visible={confirmSwitch === 'replace'}
        title="端末の記録を消しますか？"
        body={`この端末の記録を消して、今ログインしているアカウントの記録を受け取ります。前のアカウントにまだ送っていない変更（${sync.pending}件）も消えます。前のアカウントのサーバーの記録は、そのまま残ります。`}
        confirmLabel="消して受け取る"
        onConfirm={() => void switchAccount('replace')}
        onCancel={() => setConfirmSwitch(null)}
      />
      <PhotoSheet
        visible={photoSheet} hasPhoto={profile.photoUri != null}
        onPick={pickPhoto} onRemove={removePhoto} onClose={() => setPhotoSheet(false)}
      />
    </Screen>
  );
}

/** 写真を選ぶシート（下から出る）：写真を選ぶ・写真を外す（置いているときだけ）・やめる */
function PhotoSheet({ visible, hasPhoto, onPick, onRemove, onClose }: {
  visible: boolean; hasPhoto: boolean; onPick: () => void; onRemove: () => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ padding: space.l, paddingBottom: space.l + insets.bottom, gap: space.m }} testID="photo-sheet">
        <View style={{ gap: space.xs }}>
          <T variant="titleL" accessibilityRole="header">アカウントの写真</T>
          <T variant="bodyM" color={colors.sub}>この端末の中だけに置きます。サーバーには送りません</T>
        </View>
        <View style={s.group}>
          <ListRow first title="写真を選ぶ" subtitle="端末の写真から1枚選び、正方形に切り抜きます" chevron={false} onPress={onPick} />
          {hasPhoto && <ListRow title="写真を外す（アプリのアイコンに戻す）" chevron={false} onPress={onRemove} />}
        </View>
        <Button label="やめる" variant="text" small onPress={onClose} />
      </View>
    </Sheet>
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

const s = StyleSheet.create({
  head: { alignItems: 'center', gap: space.xs, marginTop: space.s },
  // 写真の右下の編集の印（地の色で縁どる）
  editMark: {
    position: 'absolute', right: 0, bottom: 0, width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.accentDark, borderWidth: 2, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center',
  },
  group: { backgroundColor: colors.input, borderRadius: radius.card, overflow: 'hidden' },
});
