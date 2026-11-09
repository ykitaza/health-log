import { colors } from '@/theme';

/** 下のタブのバー（M3 の navigation bar）の、アイコンとラベルの部分の高さ */
export const TAB_BAR_HEIGHT = 80;

/**
 * 下のタブのバーのスタイル。Android は edge-to-edge なので、ジェスチャーナビゲーションのバーに重ならないよう、
 * セーフエリアの下の幅（bottomInset）を高さと下の余白に足す
 */
export function tabBarStyle(bottomInset: number) {
  return {
    backgroundColor: colors.card,
    borderTopWidth: 0,
    height: TAB_BAR_HEIGHT + bottomInset,
    paddingTop: 12,
    paddingBottom: bottomInset,
  };
}
