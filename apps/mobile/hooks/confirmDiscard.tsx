import { usePreventRemove } from 'expo-router';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui';

/**
 * 保存していない変更があるときに、画面を離れる前に「入力をやめますか？」と確かめる。
 * expo-router の usePreventRemove で、戻る方法（画面の戻るボタン、Android の戻るボタンとジェスチャー）によらず止める。
 * 返す dialog を画面に置く。保存して離れるときは、離れる前に allowLeave() を呼ぶ
 */
export function useConfirmDiscard(dirty: boolean, body: string) {
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const allowLeave = usePreventRemove(dirty, ({ repeat }) => setLeave(() => repeat));
  const dialog = (
    <ConfirmDialog
      visible={leave != null}
      title="入力をやめますか？"
      body={body}
      confirmLabel="やめる"
      onCancel={() => setLeave(null)}
      onConfirm={() => {
        const go = leave;
        setLeave(null);
        go?.();
      }}
    />
  );
  return { dialog, allowLeave };
}
