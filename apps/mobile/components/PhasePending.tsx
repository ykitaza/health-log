// フェーズの進み具合・フェーズの設定の仮の画面（準備中）。中身は次の PR で作り、この部品ごと差し替える
import { View } from 'react-native';
import { colors, space } from '@/theme';
import { Screen } from './Screen';
import { T } from './Text';
import { Card, Header } from './ui';

export function PhasePending({ title, onBack, testID }: { title: string; onBack: () => void; testID: string }) {
  return (
    <Screen>
      <Header title={title} onBack={onBack} />
      <View testID={testID}>
        <Card style={{ marginTop: space.l, gap: space.s }}>
          <T variant="titleM">準備中</T>
          <T variant="bodyM" color={colors.sub}>この画面は次の版で使えるようになります。</T>
        </Card>
      </View>
    </Screen>
  );
}
