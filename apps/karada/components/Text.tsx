import { useEffect } from 'react';
import { AccessibilityInfo, Platform, Text as RNText, TextProps, TextStyle } from 'react-native';
import { CLASSIC_MIN_JA, sizeText, WEB_FONT_SCALE } from '@/lib/textSize';
import { colors, fonts, isHud, type, TypeName } from '@/theme';

/** クラシックの数字はそろえ数字（桁がそろい、帳の右寄せの数字が縦に並ぶ。「クラシックの決まり」） */
const TABULAR: TextStyle | null = isHud ? null : { fontVariant: ['tabular-nums'] };
/** 和文のフォント（クラシックで 12px を下回らせない。HUD は今のまま） */
const JA_FAMILIES = [fonts.regular, fonts.bold] as const;
const SIZE_RULE = { minJa: isHud ? undefined : CLASSIC_MIN_JA, scale: WEB_FONT_SCALE, jaFamilies: JA_FAMILIES };

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
      style={sizeText([
        { fontFamily, fontSize: size ?? v?.size ?? 14, color, textAlign: align, includeFontPadding: false },
        isNum && TABULAR,
        v && size == null && { lineHeight: v.lineHeight },
        style,
      ], SIZE_RULE)}
    />
  );
}

/** 誤りの文の読み上げの props。web は role=alert と aria-live（polite）で、出たとき・変わったときに読み上げる */
export const ERROR_A11Y = {
  accessibilityRole: 'alert',
  // Android は、文と一緒に出てきた live region を読まないことがあるので、下の announceForAccessibility で読ませる（2回読ませない）
  accessibilityLiveRegion: Platform.OS === 'web' ? 'polite' : 'none',
} as const;

/**
 * 入力の誤りの文（赤）。出たとき・文が変わったときに、TalkBack（と VoiceOver）が読み上げる（#323）。
 * 大きさや段階は、今までの T と同じに渡す（見た目は変えない）
 */
export function ErrorText({ children, ...rest }: Omit<Props, 'children' | 'color'> & { children: string }) {
  useEffect(() => {
    if (Platform.OS !== 'web' && children) AccessibilityInfo.announceForAccessibility(children);
  }, [children]);
  return <T {...rest} {...ERROR_A11Y} color={colors.danger}>{children}</T>;
}
