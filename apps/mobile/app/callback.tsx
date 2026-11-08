import * as WebBrowser from 'expo-web-browser';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { colors } from '@/theme';

// web のログインの戻り先（ポップアップの中で開く）。開いた元の画面に結果を渡して、ポップアップを閉じる。
// Android・iOS では、戻り（torelog://callback）は +native-intent.tsx でこの画面に来ない
WebBrowser.maybeCompleteAuthSession();

export default function CallbackScreen() {
  return (
    <Screen>
      <T size={13} color={colors.sub} style={{ marginTop: 24 }}>ログインの画面を閉じています…</T>
    </Screen>
  );
}
