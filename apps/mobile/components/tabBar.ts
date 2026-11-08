import { colors } from '@/theme';

/** 下のタブのバーの、アイコンとラベルの部分の高さ */
export const TAB_BAR_HEIGHT = 72;

/**
 * 下のタブのバーのスタイル。Android は edge-to-edge なので、ジェスチャーナビゲーションのバーに重ならないよう、
 * セーフエリアの下の幅（bottomInset）を高さと下の余白に足す
 */
export function tabBarStyle(bottomInset: number) {
  return {
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    height: TAB_BAR_HEIGHT + bottomInset,
    paddingTop: 8,
    paddingBottom: bottomInset,
  };
}
