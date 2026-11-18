import { router } from 'expo-router';
import { Linking, View } from 'react-native';
import { ConnectorUrl } from '@/components/ConnectorUrl';
import { Button, Header, Screen, SectionTitle, T } from '@/components/ui';
import { colors, space } from '@/theme';

const STEPS = [
  'Claude：設定 → コネクタ → 「カスタムコネクタを追加」に URL を入れます',
  'ChatGPT：設定で開発者モードをオンにしてアプリを作り、URL を入れて、認証に OAuth を選びます',
  'ログインの画面で「パスキーでサインイン」を選び、同意の画面で「許可する」を押します',
];

/** AI とつなぐ（Figma の 8-connect-ai）。ことばの MCP をカスタムコネクタとして足す案内 */
export default function ConnectScreen() {
  return (
    <Screen testID="connect-screen" footer={(
      <View style={{ gap: space.m }}>
        <Button label="Claude を開く" variant="outline" onPress={() => { void Linking.openURL('https://claude.ai/').catch(() => {}); }} />
        <Button label="ChatGPT を開く" variant="outline" onPress={() => { void Linking.openURL('https://chatgpt.com/').catch(() => {}); }} />
      </View>
    )}>
      <Header title="AI とつなぐ" onBack={() => router.back()} right={<Button label="あとで" variant="text" small onPress={() => router.back()} />} />
      <T variant="body" color={colors.sub}>
        声や写真で拾うのは、Claude や ChatGPT の中です。ことばをコネクタとしてつなぐと、話しかけるだけで拾った言葉がここに届きます
      </T>
      <SectionTitle title="コネクタの URL" />
      <ConnectorUrl />
      <SectionTitle title="つなぎ方" />
      {STEPS.map((step, i) => (
        <View key={step} style={{ flexDirection: 'row', gap: space.l, marginBottom: space.m }}>
          <T variant="body" color={colors.sub}>{i + 1}</T>
          <T variant="body" style={{ flex: 1 }}>{step}</T>
        </View>
      ))}
      <T variant="bodyS" color={colors.sub} style={{ marginTop: space.m }}>ログインは KARADA と同じアカウントです。KARADA のコネクタとは別に足します（チャットごとにオン・オフできます）。</T>
    </Screen>
  );
}
