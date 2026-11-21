import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** 手ごたえを返す場面。触覚（ハプティクス）はここだけで鳴らす */
/** select：グラフの棒・点・食事の受け皿を選んだとき（#327）／ lift：食事を長押しで持ち上げたとき（#328） */
export type FeedbackKind = 'complete' | 'personalBest' | 'save' | 'select' | 'lift';

/**
 * 手ごたえの呼び口。select と lift だけ触覚を鳴らす（完了・自己ベスト・保存は今は何もしない）。
 * web では鳴らさない。端末の触覚の設定が切れていれば OS が鳴らさない。鳴らせなくても画面の動きは止めない
 */
export function onFeedback(kind: FeedbackKind): void {
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'select') void Haptics.selectionAsync().catch(() => {});
    else if (kind === 'lift') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch { /* 触覚が使えない端末では鳴らさない */ }
}
