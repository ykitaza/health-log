import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { colors, fonts, type, TypeName } from '@/theme';

type Props = TextProps & {
  /** 文字の段階（theme の type）。size・bold・num を個別に指定すると、そちらが優先 */
  variant?: TypeName;
  size?: number;
  color?: string;
  bold?: boolean;
  /** 数字や英字の見出し（Barlow Condensed） */
  num?: boolean;
  align?: TextStyle['textAlign'];
};

export function T({ variant, size, color = colors.text, bold, num, align, style, ...rest }: Props) {
  const v = variant ? type[variant] : undefined;
  const isNum = num ?? (v != null && 'num' in v ? v.num : false);
  const isBold = bold ?? v?.bold ?? false;
  const fontFamily = isNum ? (isBold ? fonts.numBold : fonts.num) : isBold ? fonts.bold : fonts.regular;
  return (
    <RNText
      {...rest}
      style={[
        { fontFamily, fontSize: size ?? v?.size ?? 14, color, textAlign: align, includeFontPadding: false },
        v && size == null && { lineHeight: v.lineHeight },
        style,
      ]}
    />
  );
}
