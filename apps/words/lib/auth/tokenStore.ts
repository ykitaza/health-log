import * as SecureStore from 'expo-secure-store';
import { Tokens, TokenStore } from './session';

// 端末の安全な保存先（Android は Keystore の鍵で暗号化した値）。自動バックアップからは外す（app.json の expo-secure-store の設定）。
// 1つの値は 2048 バイトまでが目安なので、トークンごとに分けて置く
const KEYS = { access: 'auth.accessToken', refresh: 'auth.refreshToken', expiresAt: 'auth.expiresAt' } as const;
// この端末でだけ、ロックを解いているあいだだけ読める（iOS。Android では効かない）
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

type SecureStoreLike = Pick<typeof SecureStore, 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'>;

export function createSecureTokenStore(store: SecureStoreLike = SecureStore): TokenStore {
  return {
    async load() {
      const [accessToken, refreshToken, expiresAt] = await Promise.all(
        [KEYS.access, KEYS.refresh, KEYS.expiresAt].map((k) => store.getItemAsync(k, OPTIONS)),
      );
      // どれかが欠けていれば（保存の途中で止まったなど）、ログインしていないことにする
      if (!accessToken || !refreshToken || !expiresAt || !Number.isFinite(Number(expiresAt))) return null;
      return { accessToken, refreshToken, expiresAt: Number(expiresAt) };
    },
    async save(t: Tokens) {
      await store.setItemAsync(KEYS.refresh, t.refreshToken, OPTIONS);
      await store.setItemAsync(KEYS.access, t.accessToken, OPTIONS);
      await store.setItemAsync(KEYS.expiresAt, String(t.expiresAt), OPTIONS);
    },
    async clear() {
      await Promise.all(Object.values(KEYS).map((k) => store.deleteItemAsync(k, OPTIONS)));
    },
  };
}
