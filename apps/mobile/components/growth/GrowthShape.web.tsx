// web（E2E で使うだけ）では形を描かない。Skia の web 版は CanvasKit（wasm）を別に読み込む必要があり、
// E2E の書き出しを重くするので、同じ大きさの場所と読み上げの名前だけを置く
import { View } from 'react-native';
import type { GrowthShapeProps } from './GrowthShape';

export type { GrowthShapeProps, SatStates } from './GrowthShape';

export function GrowthShape({ width, height, accessibilityLabel }: GrowthShapeProps) {
  return (
    <View
      style={{ width, height }}
      pointerEvents="none"
      accessible={accessibilityLabel != null}
      accessibilityRole={accessibilityLabel != null ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
