import { openDatabaseSync } from 'expo-sqlite';
import { DB_NAME } from '@/db/name';
import { LOOK_KEY, Look, parseLook } from './look';

export { LOOK_KEY, parseLook };
export type { Look };

/**
 * 見た目を、theme/index.ts が最初に評価されるとき（画面の StyleSheet.create より前）に同期で読む。
 * SQLiteProvider（app/_layout.tsx）が DB を開く前なので、同じファイル（DB_NAME・既定の場所・既定のオプション）を別の接続で開き、
 * 同期しない sync_meta から 1 行だけ読んで閉じる。初めての起動（表がまだない）など、どんなエラーでも 'hud'
 */
export function readLook(): Look {
  try {
    const db = openDatabaseSync(DB_NAME, { useNewConnection: true });
    try {
      return parseLook(db.getFirstSync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [LOOK_KEY])?.value);
    } finally {
      try {
        db.closeSync();
      } catch {
        // 閉じられなくても、読めた値を使う
      }
    }
  } catch {
    return 'hud';
  }
}

/** web だけ localStorage にも写す（theme/appearance.web.ts）。ネイティブは sync_meta だけで足りるので何もしない */
export function mirrorLook(_look: Look): void {}
