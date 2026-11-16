// 見た目の種類（HUD・クラシック）。theme/appearance.ts（ネイティブ）と theme/appearance.web.ts が共有する。何も import しない

/** 'hud' は今の見た目（初期値）、'classic' は飾りの少ない見た目 */
export type Look = 'hud' | 'classic';

/** 端末に覚える場所の名前（ネイティブは同期しない sync_meta の key、web は localStorage の key） */
export const LOOK_KEY = 'appearance.look';

/** 'classic' 以外（覚えていない・壊れた値・ほかの版が書いた値）は 'hud' */
export const parseLook = (v: unknown): Look => (v === 'classic' ? 'classic' : 'hud');
