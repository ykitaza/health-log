import { LOOK_KEY, Look, parseLook } from './look';

export { LOOK_KEY, parseLook };
export type { Look };

/**
 * 見た目を、theme/index.ts が最初に評価されるときに同期で読む（ネイティブは theme/appearance.ts）。
 * web の SQLite は非同期でしか開けないので、localStorage に写した値を読む。使えないときは 'hud'
 */
export function readLook(): Look {
  try {
    return parseLook(localStorage.getItem(LOOK_KEY));
  } catch {
    return 'hud';
  }
}

/** 見た目を変えたときに localStorage にも写す（次に開いたときに readLook が読む）。使えないときは何もしない */
export function mirrorLook(look: Look): void {
  try {
    localStorage.setItem(LOOK_KEY, look);
  } catch {
    // 写せなくても、sync_meta には残る
  }
}
