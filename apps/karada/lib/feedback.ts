/** 手ごたえを返す場面。振動（ハプティクス）を足すときは、ここだけを書き換える */
/** select：グラフの棒・点を選んだとき（#327。端末の触覚の設定に従う軽い振動を足すときに使う） */
export type FeedbackKind = 'complete' | 'personalBest' | 'save' | 'select';

/** 完了・自己ベスト・保存の呼び口。今は何もしない（expo-haptics はネイティブなので、アップデートでは届けられない） */
export function onFeedback(kind: FeedbackKind): void {
  void kind;
}
