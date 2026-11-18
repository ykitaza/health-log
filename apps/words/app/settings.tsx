import { router } from 'expo-router';
import { Platform, View } from 'react-native';
import { Button, Header, LinkRow, Screen, SectionTitle, T, Toggle } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { useData, useRepos } from '@/hooks/data';
import { useNotifications } from '@/hooks/notifications';
import { useSync } from '@/hooks/sync';
import { formatMinutes, formatMonthDay, jstDate, jstMinutes } from '@/lib/date';
import { notifyMinutes } from '@/lib/notifyPlan';
import { colors, space } from '@/theme';

/** 設定（拾ったの「…」から）。アカウント、AI とつなぐ、同期の状態、通知の許可と時刻の目安、出会った場所とタグ */
export default function SettingsScreen() {
  const auth = useAuth();
  const sync = useSync();
  const notifications = useNotifications();
  const repos = useRepos();
  const { data } = useData(async (r) => ({ opens: await r.local.opens(Date.now() - 14 * 86_400_000), natural: await r.local.naturalVoice() }));
  const minutes = notifyMinutes(data?.opens ?? [], new Date());
  const plan = notifications.plan;

  return (
    <Screen testID="settings-screen">
      <Header title="設定" onBack={() => router.back()} />
      <LinkRow title="アカウント" sub={auth.status === 'signedIn' ? 'ログインしています（KARADA と同じアカウント）' : 'ログインしていません'} onPress={() => router.push('/account')} testID="settings-account" />
      <LinkRow title="記録" sub="拾った・使えた・聞いた" onPress={() => router.push('/records')} testID="settings-records" />
      <LinkRow title="AI とつなぐ" sub="Claude・ChatGPT のコネクタ" onPress={() => router.push('/connect')} testID="settings-connect" />

      <SectionTitle title="同期" />
      <T variant="bodyS" color={colors.sub} testID="settings-sync">
        {auth.status !== 'signedIn' ? 'ログインすると、ほかの端末と Claude に同期します'
          : !sync.configured ? '同期の先がまだありません'
            : sync.syncing ? '同期しています'
              : sync.error ? '同期できませんでした（アカウントで確かめる）'
                : `送っていない変更 ${sync.pending}件`}
      </T>

      <SectionTitle title="聞く" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.l }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="body">自然な声（Polly）</T>
          <T variant="label" color={colors.sub}>オフは端末の読み上げ（通信なし）。オンはサーバーで作った声を使います（通信します。保存はしません）</T>
        </View>
        <Toggle value={data?.natural ?? false} onChange={(v) => { void repos.local.setNaturalVoice(v); }} label="自然な声（Polly）" testID="natural-voice" />
      </View>

      <SectionTitle title="通知" />
      <T variant="bodyS" color={colors.sub}>
        手札の言葉が3つ以上たまったときだけ、週に2回まで知らせます。時刻は、ふだんアプリを開く時刻（いまは {formatMinutes(minutes)} ごろ）です。
      </T>
      {Platform.OS === 'web' ? (
        <T variant="bodyS" color={colors.sub} style={{ marginTop: space.s }}>この画面（web）では通知を使えません</T>
      ) : notifications.permitted ? (
        <T variant="bodyS" style={{ marginTop: space.s }} testID="notify-next">
          {plan ? `次は ${formatMonthDay(jstDate(plan.at))} ${formatMinutes(jstMinutes(plan.at))} ごろ` : '今は予定がありません'}
        </T>
      ) : (
        <Button label="通知を許可する" variant="plain" small onPress={() => { void notifications.request(); }} style={{ marginTop: space.m }} testID="notify-allow" />
      )}

      <SectionTitle title="一覧" />
      <View>
        <LinkRow title="出会った場所" sub="足す・名前を変える・並べ替える・隠す" onPress={() => router.push('/sources')} testID="settings-sources" />
        <LinkRow title="タグ" sub="使う場面と気持ち" onPress={() => router.push('/tags')} testID="settings-tags" />
      </View>
    </Screen>
  );
}
