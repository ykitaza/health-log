// 3D の形（.glb）を import したときの型。Metro は資産の番号（require と同じ）を返す（metro.config.js の assetExts）
declare module '*.glb' {
  const asset: number;
  export default asset;
}
