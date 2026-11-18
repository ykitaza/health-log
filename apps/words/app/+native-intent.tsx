/**
 * アプリに届いたリンクを、画面の道に変える前に見る（Android・iOS だけ）。
 * ログインの戻り（kotoba://callback?code=…）と、Cookie を消したあとの戻り（kotoba://signout）は
 * expo-web-browser が受け取るので、画面は動かさない（認可コードを画面の道に残さない）。開発用は kotoba-dev://
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (/^(kotoba(?:-dev)?:\/\/|\/)?callback([/?#]|$)/.test(path)) return initial ? '/account' : null;
  if (/^(kotoba(?:-dev)?:\/\/|\/)?signout([/?#]|$)/.test(path)) return initial ? '/' : null;
  return path;
}
