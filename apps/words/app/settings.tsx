import { router } from 'expo-router';
import { Platform, View } from 'react-native';
import { Button, Chip, Header, LinkRow, Screen, SectionTitle, T, Toggle } from '@/components/ui';
import { useAuth } from '@/hooks/auth';
import { useData } from '@/hooks/data';
import { useListen } from '@/hooks/listen';
import { useNotifications } from '@/hooks/notifications';
import { useSync } from '@/hooks/sync';
import { formatMinutes, formatMonthDay, jstDate, jstMinutes } from '@/lib/date';
import { PAUSE_LABEL, PAUSES, REPEAT_LABEL, REPEATS, SPEED_LABEL, SPEEDS } from '@/lib/listen/pace';
import { notifyMinutes } from '@/lib/notifyPlan';
import { colors, space } from '@/theme';

/** 聞くの読み方の1行（見出しと、選ぶチップ） */
function Choice<V extends string | number>({ title, options, value, label, onChange, testID }: {
  title: string; options: readonly V[]; value: V; label: (v: V) => string; onChange: (v: V) => void; testID: string;
}) {
  return (
    <View style={{ gap: space.s, marginTop: space.l }} accessibilityRole="radiogroup" accessibilityLabel={title}>
      <T variant="body">{title}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {options.map((o) => (
          <Chip key={String(o)} label={label(o)} variant={o === value ? 'selected' : 'default'} accessibilityLabel={`${title}：${label(o)}`}
            onPress={() => onChange(o)} testID={`${testID}-${o}`} />
        ))}
      </View>
    </View>
  );
}

/** 設定（各タブの見出しの歯車から）。アカウント、記録、AI とつなぐ、同期の状態、聞くの声と読み方、通知の許可と時刻の目安、出会った場所とタグ */
export default function SettingsScreen() {
  const auth = useAuth();
  const sync = useSync();
  const notifications = useNotifications();
  // 自然な声は聞くと同じ値を見る（切り替えたら、聞くを開き直さなくても次の表現から効く）
  const listen = useListen();
  const { data } = useData(async (r) => ({ opens: await r.local.opens(Date.now() - 14 * 86_400_000) }));
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
          <T variant="label" color={colors.sub}>オフは端末の読み上げ（通信なし）。オンはサーバーで作った声を使います（通信します。保存はしません。使えないときは端末の声に戻し、聞くに理由を出します）</T>
        </View>
        <Toggle value={listen.naturalVoice} onChange={(v) => { void listen.setNaturalVoice(v); }} label="自然な声（Polly）" testID="natural-voice" />
      </View>
      {/* 読み方：変えると、聞くを開き直さなくても次に準備する言葉から効く */}
      <Choice title="読む速さ" options={SPEEDS} value={listen.pace.speed} label={(v) => SPEED_LABEL[v]} onChange={(speed) => { void listen.setPace({ speed }); }} testID="pace-speed" />
      <Choice title="1 語ごとのくり返し" options={REPEATS} value={listen.pace.repeat} label={(v) => REPEAT_LABEL[v]} onChange={(repeat) => { void listen.setPace({ repeat }); }} testID="pace-repeat" />
      <Choice title="区切りのあいだの間" options={PAUSES} value={listen.pace.pause} label={(v) => PAUSE_LABEL[v]} onChange={(pause) => { void listen.setPace({ pause }); }} testID="pace-pause" />
      <T variant="label" color={colors.sub} style={{ marginTop: space.s }}>
        変えると、次に準備する言葉から効きます。間は、表現・読み・説明などの区切りのあいだと、くり返しのあいだ・言葉のあとに空けます（自然な声では、区切りのあいだはサーバーの声のままです）
      </T>

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
