import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { EmptySlot, HandCard } from '@/components/HandCard';
import { Icon } from '@/components/Icon';
import { Button, Header, Screen, T } from '@/components/ui';
import { useData } from '@/hooks/data';
import { reviewDay } from '@/lib/date';
import { dueCount } from '@/lib/schedule';
import { HAND_LIMIT } from '@/lib/types';
import { colors, space } from '@/theme';

/** 手札（Figma の 3-hand）。10個の枠、段階と期限の印。空いた枠は「拾ったから選ぶ」。上に「聞く」 */
export default function HandScreen() {
  const { data } = useData(async (r) => ({ hand: await r.words.hand(), sources: await r.catalog.sources(), counts: await r.words.placeCounts() }));
  const hand = data?.hand ?? [];
  const today = reviewDay(new Date());
  const due = dueCount(hand, today);
  const empty = Math.max(0, HAND_LIMIT - hand.length);

  return (
    <Screen inTab testID="hand-screen">
      <Header
        title="手札"
        count={`${hand.length} / ${HAND_LIMIT}`}
        right={(
          <Pressable accessibilityRole="link" accessibilityLabel={`自分の言葉 ${data?.counts.own ?? 0}`} onPress={() => router.push({ pathname: '/collected', params: { filter: 'own' } })}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }} testID="open-own">
            <T variant="body" color={colors.sub}>自分の言葉 {data?.counts.own ?? 0}</T>
            <Icon name="chevronRight" size={20} color={colors.sub} />
          </Pressable>
        )}
      />
      {hand.length > HAND_LIMIT && (
        <T variant="bodyS" style={{ marginBottom: space.s }} testID="hand-over">手札が{hand.length}個あります。1つ戻してください</T>
      )}
      <T variant="body" color={colors.sub} testID="hand-due">
        {hand.length === 0 ? '使いたい言葉を、拾ったから入れましょう' : due > 0 ? `そろそろの ${due} 枚から、聞くに出します` : '手札の言葉は、聞くで耳から確かめられます'}
      </T>
      {hand.length > 0 && (
        <Button label="聞く" icon="headphones" onPress={() => router.navigate('/listen')} style={{ marginTop: space.l }} testID="start-listen" />
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.m, marginTop: space.xl }}>
        {hand.map((e) => <HandCard key={e.id} e={e} sources={data?.sources ?? []} today={today} />)}
        {Array.from({ length: empty }, (_, i) => <EmptySlot key={`empty-${i}`} onPress={() => router.push('/pick')} />)}
      </View>
    </Screen>
  );
}
