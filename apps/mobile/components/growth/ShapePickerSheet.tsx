// 「形を選ぶ」のシート（成長を見る画面の右上のボタンから）。選んだ形は呼び出し側が保存する
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SHAPE_LABELS, SHAPE_PREVIEW_PARAMS, shapeOptionLabel } from '@/lib/shapes/labels';
import { SHAPE_KINDS, ShapeKind } from '@/lib/shapes/types';
import { colors, radius, space } from '@/theme';
import { duration } from '@/theme/motion';
import { Icon } from '../Icon';
import { Sheet } from '../motion';
import { T } from '../Text';
import { GrowthShape } from './GrowthShape';

/** 形の小さな絵の箱の大きさ（dp） */
const PREVIEW_W = 72;
const PREVIEW_H = 56;
/** 選んだ印の丸の大きさ（dp） */
const MARK = 24;

/**
 * 形を選ぶシート。SHAPE_KINDS の順に、形の小さな絵（十分育った姿を止めて描く）・名前と説明・選んだ印を並べる。
 * 行はラジオボタン。押すとその形を選んで閉じる
 */
export function ShapePickerSheet({ visible, value, onSelect, onClose }: {
  visible: boolean; value: ShapeKind | null; onSelect: (kind: ShapeKind) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // 形の小さな絵（Skia の Canvas を3つ）は、シートが開ききってから描く（開く動きの間に重い処理を重ねて、カクつかないように）
  const [previews, setPreviews] = useState(false);
  useEffect(() => {
    if (!visible) { setPreviews(false); return; }
    const t = setTimeout(() => setPreviews(true), duration.enter);
    return () => clearTimeout(t);
  }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ padding: space.l, paddingBottom: space.l + insets.bottom, gap: space.m }} testID="shape-picker">
        <View style={{ gap: space.xs }}>
          <T variant="titleL" accessibilityRole="header">形を選ぶ</T>
          <T variant="bodyM" color={colors.sub}>どの形でも、衛星の意味は同じです</T>
        </View>
        <View accessibilityRole="radiogroup" style={{ gap: space.s }}>
          {SHAPE_KINDS.map((kind) => {
            const checked = kind === value;
            return (
              <Pressable
                key={kind}
                accessibilityRole="radio"
                aria-checked={checked}
                accessibilityState={{ checked }}
                accessibilityLabel={shapeOptionLabel(kind)}
                onPress={() => onSelect(kind)}
                style={({ pressed }) => [s.row, checked && s.rowChecked, pressed && { opacity: 0.8 }]}
                testID={`shape-option-${kind}`}
              >
                <View style={s.preview}>
                  {previews && <GrowthShape shape={kind} params={SHAPE_PREVIEW_PARAMS} width={PREVIEW_W} height={PREVIEW_H} paused />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="titleM">{SHAPE_LABELS[kind].name}</T>
                  <T variant="bodyS" color={checked ? colors.onAccentDark : colors.sub}>{SHAPE_LABELS[kind].description}</T>
                </View>
                {checked ? (
                  <View style={[s.mark, { backgroundColor: colors.accent }]}>
                    <Icon name="check" size={16} color={colors.onAccent} />
                  </View>
                ) : (
                  <View style={[s.mark, { borderWidth: 2, borderColor: colors.outline }]} />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.l, minHeight: 72, padding: space.s, paddingRight: space.l,
    borderRadius: radius.l, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.input,
  },
  rowChecked: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  preview: { width: PREVIEW_W, height: PREVIEW_H, borderRadius: radius.m, overflow: 'hidden', backgroundColor: colors.bg },
  mark: { width: MARK, height: MARK, borderRadius: MARK / 2, alignItems: 'center', justifyContent: 'center' },
});
