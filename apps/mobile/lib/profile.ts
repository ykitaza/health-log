// アカウントの画面の表示名と写真の決まり（画面や保存先に依存しない。写真を選ぶ・置く処理は差し替えて jest で確かめる）

/** 表示名の長さの上限（文字） */
export const DISPLAY_NAME_MAX = 20;

/** 写真の長辺（px）。これより大きければ縮めてから置く */
export const PHOTO_MAX_SIZE = 512;

/** 表示名と写真は端末だけに置く（アカウントの画面の補足） */
export const PROFILE_NOTE = '表示名と写真は、この端末の中だけに置きます。サーバーには送りません。';

/** ホームの左上の写真の読み上げ */
export const HOME_ACCOUNT_LABEL = 'アカウント。押すとアカウントの画面';

/** 入れた表示名を、置く形にする。前後の空白を除き、上限で切る。空なら null（表示名なし） */
export function normalizeDisplayName(text: string): string | null {
  const t = [...text.trim()].slice(0, DISPLAY_NAME_MAX).join('').trim();
  return t === '' ? null : t;
}

/** 表示名がないときの見出し（アカウントの画面と、設定の行の題） */
export const accountTitle = (name: string | null) => name ?? 'アカウント';

/** ログインの状態の1行。メールアドレスは今のログイン（scope に openid なし）では受け取らないので出さない */
export const loginStatusText = (signedIn: boolean) => (signedIn ? 'ログインしています' : 'ログインしていません');

/** 写真の URI。空なら null（アプリのアイコンを出す） */
export const photoOrNull = (uri: string | null | undefined): string | null => (uri != null && uri.trim() !== '' ? uri : null);

/** 写真を縮める大きさ。長辺が max 以下なら null（縮めない）。縦横の比は保つので、長いほうだけを返す */
export function shrinkSize(width: number, height: number, max = PHOTO_MAX_SIZE): { width: number } | { height: number } | null {
  if (width <= max && height <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

/** 写真を選んで置くのに使う処理（端末では expo-image-picker・expo-image-manipulator・expo-file-system） */
export type PhotoDeps = {
  /** 端末の写真から1枚選ぶ。やめたら null */
  pick: () => Promise<{ uri: string; width: number; height: number } | null>;
  /** 縮めて、一時ファイルの URI を返す */
  shrink: (uri: string, size: { width: number } | { height: number } | null) => Promise<string>;
  /** アプリの中の保存場所にコピーし、その URI を返す（毎回ちがう名前。画像のキャッシュで古い写真が出ないように） */
  save: (uri: string) => Promise<string>;
  /** 置いた写真を消す（なければ何もしない） */
  remove: (uri: string) => Promise<void>;
};

/**
 * 写真を選んで、縮めて、アプリの中にコピーし、その URI を put で覚える。やめたら false（今の写真はそのまま）。
 * 覚えてから前の写真のファイルを消す（先に消すと、覚え直すまでのあいだ消えたファイルを指すため。消せなくても新しい写真は使う）。
 * 覚えられなかったら、コピーしたファイルを消して、エラーを投げる
 */
export async function choosePhoto(deps: PhotoDeps, current: string | null, put: (uri: string) => Promise<void>): Promise<boolean> {
  const picked = await deps.pick();
  if (!picked) return false;
  const small = await deps.shrink(picked.uri, shrinkSize(picked.width, picked.height));
  const saved = await deps.save(small);
  try {
    await put(saved);
  } catch (e) {
    await deps.remove(saved).catch(() => {});
    throw e;
  }
  if (current) await deps.remove(current).catch(() => {});
  return true;
}

/** 置いた写真を外す。値を消してから（アプリのアイコンに戻す）ファイルを消す。ファイルを消せなくても、値は消したまま */
export async function removePhoto(deps: Pick<PhotoDeps, 'remove'>, current: string | null, put: (uri: null) => Promise<void>): Promise<void> {
  await put(null);
  if (current) await deps.remove(current).catch(() => {});
}
