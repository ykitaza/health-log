/** 手ごたえを返す場面。振動（ハプティクス）を足すときは、ここだけを書き換える */
export type FeedbackKind = 'complete' | 'personalBest' | 'save';

/** 完了・自己ベスト・保存の呼び口。今は何もしない（expo-haptics はネイティブなので、アップデートでは届けられない） */
export function onFeedback(kind: FeedbackKind): void {
  void kind;
}
