import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { EmptyState } from '@/components/ui';
import { View } from 'react-native';

/** 食事は第2段階（サーバーと同期してから） */
export default function MealsScreen() {
  return (
    <Screen tab>
      <View style={{ paddingVertical: 12 }}><T bold size={26}>食事</T></View>
      <EmptyState icon="meal" title="準備中です" body={'食事の記録は、次の段階で\nサーバーとつないでから使えるようになります'} />
    </Screen>
  );
}
