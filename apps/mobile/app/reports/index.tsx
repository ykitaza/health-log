import { router } from 'expo-router';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LoadError } from '@/components/LoadError';
import { useListMotion } from '@/components/motion';
import { ReportCard } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Card, EmptyState, Header } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { colors } from '@/theme';

const EXAMPLES = ['「今週のまとめを作って」', '「10月の筋トレと食事をふり返って、レポートに残して」', '「ベンチプレスが伸びない理由を分析して保存して」'];

/** レポートの一覧（ホームの「最新のレポート」の「すべて」から開く）。作った日の新しい順 */
export default function ReportsScreen() {
  const { data, error, reload } = useFocusData((r) => r.reports.list());
  const list = useListMotion(data != null);
  const header = <Header title="レポート" onBack={() => router.back()} />;
  if (error) return <Screen>{header}<LoadError onRetry={reload} /></Screen>;
  if (data == null) return <Screen>{header}</Screen>;
  if (data.length === 0) {
    return (
      <Screen>
        {header}
        <EmptyState icon="chart" title="レポートはまだありません" body="チャット（Claude・ChatGPT）で「今週のまとめを作って」と頼むと、ここに出ます。" />
        <Card style={{ gap: 8 }}>
          <T bold size={14} accessibilityRole="header">頼み方の例</T>
          {EXAMPLES.map((e) => <T key={e} size={14}>・{e}</T>)}
        </Card>
      </Screen>
    );
  }
  return (
    <Screen>
      {header}
      <View style={{ gap: 12, marginTop: 4 }}>
        {data.map((r, i) => (
          <Animated.View key={r.id} entering={list.entering(i)} exiting={list.exiting} layout={list.layout}>
            <ReportCard report={r} onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })} />
          </Animated.View>
        ))}
      </View>
      <T size={12} color={colors.sub} style={{ marginTop: 12 }}>チャット（Claude・ChatGPT）で作ったまとめです。新しい順に並びます。</T>
    </Screen>
  );
}
