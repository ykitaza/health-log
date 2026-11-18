import { router } from 'expo-router';
import { space } from '@/theme';
import { IconButton } from './ui';

/**
 * 見出しの右の端に置く、小さな設定の入口（歯車）。ホーム・拾った・手札・聞くのどのタブからでも、設定（と記録）へ行けるように。
 * ほかの見出しのアイコン（探す）と同じ細い線・墨の色で、少しだけ小さくする。
 * タブの画面は裏でも消えずに残るので、testID はタブごとに分ける（home-settings など）
 */
export function SettingsButton({ testID }: { testID: string }) {
  return (
    <IconButton
      name="settings" label="設定" size={22}
      onPress={() => router.push('/settings')} testID={testID} style={{ marginRight: -space.m }}
    />
  );
}
