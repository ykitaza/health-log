import { Stack } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { colors } from '@/theme';

/** 拾ったのタブの中の画面（一覧 → 探す → 場面で）。下のタブは出したまま */
export default function CollectedLayout() {
  const reduced = useReducedMotion();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper }, animation: reduced ? 'fade' : 'ios_from_right', animationDuration: reduced ? 150 : 250 }} />
  );
}
