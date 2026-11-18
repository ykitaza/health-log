import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json を読み、APP_VARIANT=development のときだけ、開発用のアプリ（ことば (dev)）に変える（KARADA の app.config.ts と同じ作り）。
 * 開発用は本番と並べて入れるので、名前・パッケージ名・scheme を変える。
 *
 * TODO（初めてのビルドの前に、手で行う）：`npx eas init` で EAS のプロジェクトを作ると、app.json の extra.eas.projectId に ID が入る。
 * 今は空のまま（KARADA とは別の EAS のプロジェクトにするため、KARADA の ID は使わない）。
 * EAS Update はまだ使わない（updates.url はない）。使い始めるときに `npx eas update:configure` で足す。
 *
 * APP_VARIANT がないとき（preview・production）は、app.json をそのまま返す。
 * 中身が変わると fingerprint の runtimeVersion が変わるため
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  if (process.env.APP_VARIANT !== 'development') return config as ExpoConfig;
  return {
    ...config,
    name: 'ことば (dev)',
    slug: config.slug ?? 'kotoba',
    scheme: 'kotoba-dev',
    android: { ...config.android, package: 'com.ykitaza.kotoba.dev' },
  };
};
