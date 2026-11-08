import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Badge, Button, Card, ConfirmDialog, Header, ListRow, SectionTitle } from '@/components/ui';
import { HealthConnectError, useHealthConnect } from '@/hooks/healthConnect';
import { colors } from '@/theme';

const errorMessage = (e: HealthConnectError) => ({
  unavailable: 'この端末では Health Connect を使えません。',
  updateRequired: 'Health Connect を更新してください（Play ストア）。',
  denied: '権限がもらえなかったので、連携していません。',
  failed: 'Health Connect から読めませんでした。少し待ってから、もう一度試してください。',
}[e]);

const pad = (n: number) => String(n).padStart(2, '0');
const formatAt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 設定の「Health Connect」：連携する・切る、最後に取り込んだ時刻、今すぐ取り込む */
export default function HealthConnectScreen() {
  const hc = useHealthConnect();
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } finally { setBusy(false); } };

  return (
    <Screen>
      <Header title="Health Connect" onBack={() => router.back()} />

      <SectionTitle title="連携" />
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T bold size={16} style={{ flex: 1 }}>{hc.connected ? '連携しています' : '連携していません'}</T>
          {hc.connected && <Badge label="連携中" />}
        </View>
        <T size={12} color={colors.sub} style={{ lineHeight: 18 }}>
          体重計・ウォッチなどが Health Connect に書いた体重・体脂肪率・睡眠・心拍を、アプリを開いたときに読み込みます。読むだけで、書き込みはしません。
        </T>
        {!hc.supported && <T size={13} color={colors.sub} testID="hc-unsupported">Health Connect は Android だけで使えます。</T>}
        {hc.error && <T size={13} color={colors.danger}>{errorMessage(hc.error)}</T>}
        {hc.connected ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T size={14} color={colors.sub} style={{ flex: 1 }}>最後に取り込んだ時刻</T>
              <T bold size={14} testID="hc-last">{hc.lastImportAt ? formatAt(hc.lastImportAt) : 'まだ取り込んでいません'}</T>
            </View>
            <Button label={hc.importing ? '取り込んでいます…' : '今すぐ取り込む'} variant="secondary" small onPress={hc.importNow} disabled={hc.importing || busy} />
            <Button label="連携を切る" variant="danger" small onPress={() => setConfirmOff(true)} disabled={busy} />
          </>
        ) : (
          <Button label="連携する" small onPress={() => act(hc.connect)} disabled={!hc.supported || busy} />
        )}
      </Card>

      <SectionTitle title="記録の扱い" />
      <Card style={{ padding: 0 }}>
        <ListRow first title="読むもの・送る先・見られる人" subtitle="サーバーと MCP（Claude・ChatGPT）での扱い" onPress={() => router.push('/health-privacy')} />
      </Card>
      <T size={12} color={colors.sub} style={{ marginTop: 8, lineHeight: 18 }}>
        同じ日に手で入れた値と取り込んだ値があるときは、手で入れた値を出します。
      </T>

      <ConfirmDialog
        visible={confirmOff}
        title="連携を切りますか？"
        body="取り込みをやめ、Health Connect の権限を取り消します（取り消しは、アプリを起動し直したときに効きます）。取り込んだ記録は消えません。"
        confirmLabel="連携を切る"
        onConfirm={() => { setConfirmOff(false); void act(hc.disconnect); }}
        onCancel={() => setConfirmOff(false)}
      />
    </Screen>
  );
}
