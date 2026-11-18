import { Tokens, TokenStore } from './session';

// web（E2E と画面の確認だけに使う）には安全な保存先がないので、トークンはメモリーにだけ置く。
// localStorage には置かない（ほかのスクリプトから読めるため）。再読み込みでログインは消える
export function createSecureTokenStore(): TokenStore {
  let tokens: Tokens | null = null;
  return {
    async load() { return tokens; },
    async save(t) { tokens = t; },
    async clear() { tokens = null; },
  };
}
