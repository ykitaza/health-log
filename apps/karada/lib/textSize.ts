import { Platform, StyleProp, StyleSheet, TextStyle } from 'react-native';

/** クラシックの和文の最小の大きさ（M3 の bodyS。これより小さい和文は読みにくい。#323） */
export const CLASSIC_MIN_JA = 12;

/**
 * web（E2E の写し）だけで使う、端末の文字の大きさの倍率。Android は文字（sp）を OS が大きくするが、web の書き出しは px のままなので、
 * E2E が page.addInitScript で globalThis.__KARADA_FONT_SCALE__ に 1.3・2 を入れて、文字と入力欄の文字を同じ倍率で大きくする。
 * ふだん（値がない）と Android・iOS は 1（何もしない）。グラフの軸の文字（SvgText）は大きくしない（Android も大きくならない）
 */
export const WEB_FONT_SCALE: number = (() => {
  if (Platform.OS !== 'web') return 1;
  const v = Number((globalThis as { __KARADA_FONT_SCALE__?: unknown }).__KARADA_FONT_SCALE__);
  return Number.isFinite(v) && v > 0 ? v : 1;
})();

/**
 * 文字の大きさの決まりを、最後の style（size・variant・画面の style を重ねたあと）に当てる。
 * - minJa：和文（Noto Sans JP）がこれより小さければ、この大きさにする（行の高さも同じ割合で広げる）。数字・英字（Barlow Condensed）は変えない
 * - scale：文字と行の高さを掛ける（web の E2E の写しだけ）
 * どちらも当たらなければ、渡した style をそのまま返す（HUD のふだんの表示は何も変わらない）
 */
export function sizeText<S extends TextStyle>(style: StyleProp<S>, { minJa, scale = 1, jaFamilies }: {
  minJa?: number; scale?: number; jaFamilies: readonly string[];
}): StyleProp<S> {
  if (minJa == null && scale === 1) return style;
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const size = flat?.fontSize;
  if (flat == null || size == null) return style;
  let next = size;
  if (minJa != null && size < minJa && flat.fontFamily != null && jaFamilies.includes(flat.fontFamily)) next = minJa;
  next *= scale;
  if (next === size) return style;
  const ratio = next / size;
  return [style, { fontSize: next, ...(typeof flat.lineHeight === 'number' ? { lineHeight: flat.lineHeight * ratio } : null) }] as StyleProp<S>;
}
