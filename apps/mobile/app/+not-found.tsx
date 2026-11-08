import { Link, Stack } from 'expo-router';
import { View } from 'react-native';
import { T } from '@/components/Text';
import { colors } from '@/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: '見つかりません' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: colors.bg }}>
        <T bold size={18}>画面が見つかりません</T>
        <Link href="/"><T color={colors.accent}>ホームへ</T></Link>
      </View>
    </>
  );
}
