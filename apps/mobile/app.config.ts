import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json を読み、APP_VARIANT=development のときだけ、開発用のアプリ（hlog (dev)）に変える。
 * 開発用は今の hlog と別のアプリとして並べて入れるので、名前・パッケージ名・scheme を変える（docs/dev-client.md）。
 *
 * APP_VARIANT がないとき（preview・production）は、app.json をそのまま返す。
 * 中身が変わると fingerprint の runtimeVersion が変わり、入っている APK に配信が届かなくなるため
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  if (process.env.APP_VARIANT !== 'development') return config as ExpoConfig;
  return {
    ...config,
    name: 'hlog (dev)',
    slug: config.slug ?? 'torelog',
    scheme: 'torelog-dev',
    android: { ...config.android, package: 'com.ykitaza.torelog.dev' },
  };
};
