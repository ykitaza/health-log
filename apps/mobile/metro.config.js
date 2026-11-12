// Metro の設定。expo-sqlite を web で動かすための設定だけを足す
// （https://docs.expo.dev/versions/latest/sdk/sqlite/#web-setup）。
// Android と iOS の動きは変わらない。
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite の web 版は SQLite の wasm を読み込む
config.resolver.assetExts.push('wasm');

// ケガの画面の 3D の体（assets/models/body.glb）
config.resolver.assetExts.push('glb');

// three は ES モジュール版だけを読む。require('three')（@react-three/fiber/native の CommonJS 版から）だと three.cjs が選ばれ、
// その頭で Node の process.emitWarning を呼ぶのでアプリが落ちる（2026-11-13、筋トレのタブを開くと落ちた）
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') {
    return { type: 'sourceFile', filePath: require.resolve('three').replace(/three\.cjs$/, 'three.module.js') };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// SharedArrayBuffer を使うために、開発サーバー（npx expo start --web）で COEP と COOP のヘッダーを付ける。
// 書き出したもの（npx expo export --platform web）の配信では、e2e/serve.mjs が同じヘッダーを付ける
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    middleware(req, res, next);
  };
};

module.exports = config;
