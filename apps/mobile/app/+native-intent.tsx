/**
 * アプリに届いたリンクを、画面の道に変える前に見る（Android・iOS だけ。web では使われない）。
 * ログインの戻り（torelog://callback?code=…&state=…）と、Cookie を消したあとの戻り（torelog://signout）は
 * expo-web-browser が受け取るので、画面は動かさない。認可コードを画面の道（履歴）に残さないためでもある。
 * 開発用の KARADA (dev) は scheme が torelog-dev なので、torelog-dev:// も同じに扱う（app.config.ts）
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (/^(torelog(?:-dev)?:\/\/|\/)?callback([/?#]|$)/.test(path)) {
    // アプリが閉じていたときの戻りは、ログインの途中の状態（PKCE の値）がもうないので、アカウントの画面を開くだけにする
    return initial ? '/account' : null;
  }
  if (/^(torelog(?:-dev)?:\/\/|\/)?signout([/?#]|$)/.test(path)) return initial ? '/' : null;
  // チャット（ChatGPT・Claude）の返事に添えてもらう、アプリへ戻るリンク（torelog://meals?date=… など。lib/chat.ts の backLink）
  const back = /^torelog(?:-dev)?:\/\/(meals|training|reports)(\?[^#]*)?$/.exec(path);
  if (back) return `/${back[1]}${back[2] ?? ''}`;
  // ケガ（torelog://injuries）は、筋トレのタブの「ケガ」で開く
  if (/^torelog(?:-dev)?:\/\/injuries$/.test(path)) return '/training?view=injury';
  return path;
}
