import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { colors, fonts } from '@/theme';

type Props = TextProps & {
  size?: number;
  color?: string;
  bold?: boolean;
  /** 数字や英字の見出し（Barlow Condensed） */
  num?: boolean;
  align?: TextStyle['textAlign'];
};

export function T({ size = 14, color = colors.text, bold, num, align, style, ...rest }: Props) {
  const fontFamily = num ? (bold ? fonts.numBold : fonts.num) : bold ? fonts.bold : fonts.regular;
  return (
    <RNText
      {...rest}
      style={[{ fontFamily, fontSize: size, color, textAlign: align, includeFontPadding: false }, style]}
    />
  );
}
