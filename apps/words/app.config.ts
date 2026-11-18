import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json を読み、APP_VARIANT=development のときだけ、開発用のアプリ（ことば (dev)）に変える（KARADA の app.config.ts と同じ作り）。
 * 開発用は本番と並べて入れるので、名前・パッケージ名・scheme を変える。
 *
 * EAS のプロジェクト ID（extra.eas.projectId）と EAS Update の URL（updates.url）は app.json に入っている
 * （KARADA とは別の EAS のプロジェクト）。JS の変更は、main への push で preview のチャンネルに配信される
 * （.github/workflows/eas-update-words.yml）。
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
