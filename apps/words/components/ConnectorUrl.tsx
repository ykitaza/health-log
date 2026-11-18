import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { mcpServerUrl } from '@/lib/auth/config';
import { colors, radius, space } from '@/theme';
import { Icon } from './Icon';
import { T } from './ui';

/**
 * コネクタの URL の札（Figma の 8・9）。文字は選んで写せる。右のボタンは、web ではクリップボードに写し、
 * 端末では共有のシート（「コピー」がある）を開く（クリップボードのネイティブのモジュールは足さない）。
 * URL がまだないとき（ことばの MCP をまだデプロイしていない）は、準備中と出す
 */
export function ConnectorUrl() {
  if (!mcpServerUrl) {
    return (
      <View style={s.box} testID="connector-url">
        <T variant="bodyS" color={colors.sub} style={{ flex: 1 }}>ことばのコネクタは準備中です。サーバーができたら、ここに URL が出ます。</T>
      </View>
    );
  }
  const copy = async () => {
    try {
      if (Platform.OS === 'web') await navigator.clipboard.writeText(mcpServerUrl);
      else await Share.share({ message: mcpServerUrl });
    } catch {
      // 写せなくても、文字を選んで写せる
    }
  };
  return (
    <View style={s.box} testID="connector-url">
      <T variant="bodyS" selectable style={{ flex: 1 }}>{mcpServerUrl}</T>
      <Pressable accessibilityRole="button" accessibilityLabel="URL を写す" onPress={copy} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="copy" size={22} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1,
    borderColor: colors.line, paddingLeft: space.l, paddingVertical: space.s, minHeight: 64,
  },
});
