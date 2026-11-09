import { View } from 'react-native';
import { useBusy } from '@/hooks/busy';
import { colors } from '@/theme';
import { Icon } from './Icon';
import { T } from './Text';
import { Button } from './ui';

export const LOAD_ERROR_TITLE = '読み込めませんでした';
export const RETRY_LABEL = 'もう一度読み込む';

/**
 * 読み込みに失敗したときの表示（短い説明と「もう一度読み込む」）。onRetry は読み直し（useFocusData の reload）。
 * 出たときに TalkBack が読み上げる（accessibilityLiveRegion）。読み直している間はボタンを押せない
 */
export function LoadError({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const { busy, run } = useBusy();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, gap: 8 }} testID="load-error">
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.dangerDark, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="close" color={colors.danger} size={30} />
      </View>
      <View accessible accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: 4 }}>
        <T bold size={16}>{LOAD_ERROR_TITLE}</T>
        <T size={14} color={colors.sub} align="center">もう一度読み込んでください。直らないときは、アプリを開き直してください。</T>
      </View>
      <Button
        label={busy ? '読み込んでいます…' : RETRY_LABEL}
        variant="secondary"
        busy={busy}
        onPress={() => run(onRetry)}
        style={{ alignSelf: 'stretch', marginTop: 8 }}
      />
    </View>
  );
}
