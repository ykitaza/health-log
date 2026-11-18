import { TextInput, TextInputProps, TextStyle } from 'react-native';
import { placeholderColor } from '@/theme';

/**
 * 入力欄の既定のスタイル。Android では、固定の高さと Noto Sans JP / Barlow Condensed の組み合わせで、
 * フォントの余白（includeFontPadding）と既定の上下の余白のせいで文字が上下に切れる。それを防ぐ
 */
export const INPUT_BASE: TextStyle = { includeFontPadding: false, textAlignVertical: 'center', paddingVertical: 0 };

/** アプリの入力欄。TextInput はこれを通して使う（画面ごとの style は INPUT_BASE の上に重ねる）。ヒントの色は theme の placeholderColor */
export function Input({ style, ...rest }: TextInputProps) {
  return <TextInput placeholderTextColor={placeholderColor} {...rest} style={[INPUT_BASE, style]} />;
}
