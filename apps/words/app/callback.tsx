import * as WebBrowser from 'expo-web-browser';
import { Screen, T } from '@/components/ui';
import { colors } from '@/theme';

// web のログインの戻り先（ポップアップの中で開く）。開いた元の画面に結果を渡して、ポップアップを閉じる。
// Android・iOS では、戻り（kotoba://callback）は +native-intent.tsx でこの画面に来ない
WebBrowser.maybeCompleteAuthSession();

export default function CallbackScreen() {
  return (
    <Screen>
      <T variant="bodyS" color={colors.sub} style={{ marginTop: 24 }}>ログインの画面を閉じています…</T>
    </Screen>
  );
}
