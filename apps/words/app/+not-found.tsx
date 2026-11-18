import { router } from 'expo-router';
import { Button, Screen, T } from '@/components/ui';
import { space } from '@/theme';

export default function NotFoundScreen() {
  return (
    <Screen>
      <T variant="wordS" style={{ marginTop: space.xxl }}>この画面は見つかりませんでした</T>
      <Button label="書き留めるへ" variant="outline" onPress={() => router.replace('/')} style={{ marginTop: space.xl }} />
    </Screen>
  );
}
