import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json を読み、APP_VARIANT=development のときだけ、開発用のアプリ（KARADA (dev)）に変える。
 * 開発用は今の KARADA と別のアプリとして並べて入れるので、名前・パッケージ名・scheme を変える（docs/dev-client.md）。
 * アイコンは、下に黄色の帯がある開発用のもので見分ける（icon と、アダプティブアイコンの背景）。
 *
 * APP_VARIANT がないとき（preview・production）は、app.json をそのまま返す。
 * 中身が変わると fingerprint の runtimeVersion が変わり、入っている APK に配信が届かなくなるため
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  if (process.env.APP_VARIANT !== 'development') return config as ExpoConfig;
  return {
    ...config,
    name: 'KARADA (dev)',
    slug: config.slug ?? 'torelog',
    scheme: 'torelog-dev',
    icon: './assets/images/icon-dev.png',
    android: {
      ...config.android,
      package: 'com.ykitaza.torelog.dev',
      adaptiveIcon: { ...config.android?.adaptiveIcon, backgroundImage: './assets/images/android-icon-background-dev.png' },
    },
  };
};
