import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, Header, SectionTitle } from '@/components/ui';
import { mcpServerUrl } from '@/lib/auth/config';
import { CHAT_APP_NAMES, CHAT_APPS, ChatApp, openChat, openFailedMessage } from '@/lib/chat';
import { colors, radius, space } from '@/theme';

const STEPS = [
  'Claude：設定 → コネクタ → 「カスタムコネクタを追加」に URL を入れます。',
  'ChatGPT：設定で開発者モードをオンにしてアプリを作り、URL を入れて、認証に OAuth を選びます。',
  'ログインの画面で「パスキーでサインイン」を選び、同意の画面で「許可する」を押します。',
];

/** 設定の「チャットとの連携」：コネクタのつなぎ方と、ChatGPT・Claude を開くボタン */
export default function ChatScreen() {
  const [failed, setFailed] = useState<ChatApp | null>(null);
  const open = async (app: ChatApp) => { setFailed(null); if (!(await openChat(app))) setFailed(app); };

  return (
    <Screen>
      <Header title="チャットとの連携" onBack={() => router.back()} />
      <T variant="bodyM" color={colors.sub}>
        Claude・ChatGPT に hlog をコネクタとしてつなぐと、写真から食事を記録したり、まとめ（レポート）を作ったりできます。
      </T>

      <SectionTitle title="コネクタのつなぎ方" />
      <Card style={{ gap: space.m }}>
        <T variant="titleM">MCP サーバーの URL</T>
        {mcpServerUrl ? (
          <>
            {/* 長押しで選んでコピーできる */}
            <View style={{ backgroundColor: colors.input, borderRadius: radius.input, padding: space.m }}>
              <T variant="bodyM" selectable testID="mcp-url">{mcpServerUrl}</T>
            </View>
            <T variant="bodyS" color={colors.sub}>長押しで選んでコピーできます。</T>
          </>
        ) : (
          <T variant="bodyM" color={colors.sub}>cdk deploy の出力 MealsMcpServerUrl（末尾が /mcp）を使います。</T>
        )}
        {STEPS.map((step, i) => (
          <View key={step} style={{ flexDirection: 'row', gap: space.s }}>
            <T variant="bodyM" color={colors.sub}>{i + 1}.</T>
            <T variant="bodyM" style={{ flex: 1 }}>{step}</T>
          </View>
        ))}
      </Card>

      <SectionTitle title="アプリを開く" />
      <View style={{ gap: space.s }}>
        {CHAT_APPS.map((app) => (
          <Button key={app} label={`${CHAT_APP_NAMES[app]} を開く`} icon="external" variant="outline" small onPress={() => open(app)} />
        ))}
      </View>
      {failed && (
        <T variant="bodyS" color={colors.danger} accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ marginTop: space.s }}>
          {openFailedMessage(failed)}
        </T>
      )}
    </Screen>
  );
}
