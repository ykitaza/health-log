import { ComponentProps, ComponentRef, ReactNode, useRef } from 'react';
import { Pressable, StyleProp, TextInput, TextStyle, View, ViewStyle } from 'react-native';
import { sizeText, WEB_FONT_SCALE } from '@/lib/textSize';
import { MIN_TOUCH } from '@/lib/touch';
import { placeholderColor } from '@/theme';

/**
 * 入力欄の既定のスタイル。Android では、固定の高さと Noto Sans JP / Barlow Condensed の組み合わせで、
 * フォントの余白（includeFontPadding）と既定の上下の余白のせいで文字が上下に切れる。それを防ぐ
 */
export const INPUT_BASE: TextStyle = { includeFontPadding: false, textAlignVertical: 'center', paddingVertical: 0 };

const SCALE = { scale: WEB_FONT_SCALE, jaFamilies: [] };

/**
 * アプリの入力欄。TextInput はこれを通して使う（画面ごとの style は INPUT_BASE の上に重ねる）。ヒントの色は theme の placeholderColor。
 * web の E2E で端末の文字の大きさをまねるときだけ、文字を大きくする（lib/textSize の WEB_FONT_SCALE。ふだんは何もしない）
 */
export function Input({ style, ...rest }: ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={placeholderColor} {...rest} style={sizeText([INPUT_BASE, style], SCALE)} />;
}

/** 見た目の高さ（食事の欄の 44） */
export const ROOM_INPUT_HEIGHT = 44;
/** 見た目 44 の欄の外を、上下に広げる分（押せる範囲を 48 にする。並びは外の margin で打ち消して今のまま） */
export const INPUT_ROOM = { paddingVertical: (MIN_TOUCH - ROOM_INPUT_HEIGHT) / 2, marginVertical: -(MIN_TOUCH - ROOM_INPUT_HEIGHT) / 2 } as const;

/**
 * 見た目の高さ 44 の入力欄を、押せる範囲だけ 48 にしたもの（#323。Android の 48dp）。欄の見た目と並びは変えない。
 * 外側の広げた所を押しても欄を選ぶ。外側は読み上げ・キーボードの止まる所にしない（欄だけが止まる）。
 * box を渡すと、欄と after（単位の文字など）を囲む箱ごと広げる。room は外側の style（行の中の flex など）
 */
export function RoomInput({ box, after, room, ...input }: ComponentProps<typeof TextInput> & {
  box?: StyleProp<ViewStyle>; after?: ReactNode; room?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const field = <Input ref={ref} {...input} />;
  return (
    <Pressable onPress={() => ref.current?.focus()} accessible={false} focusable={false} tabIndex={-1} style={[INPUT_ROOM, room]}>
      {box != null || after != null ? <View style={box}>{field}{after}</View> : field}
    </Pressable>
  );
}
