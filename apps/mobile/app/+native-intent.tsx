/**
 * アプリに届いたリンクを、画面の道に変える前に見る（Android・iOS だけ。web では使われない）。
 * ログインの戻り（torelog://callback?code=…&state=…）と、Cookie を消したあとの戻り（torelog://signout）は
 * expo-web-browser が受け取るので、画面は動かさない。認可コードを画面の道（履歴）に残さないためでもある
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (/^(torelog:\/\/|\/)?callback([/?#]|$)/.test(path)) {
    // アプリが閉じていたときの戻りは、ログインの途中の状態（PKCE の値）がもうないので、アカウントの画面を開くだけにする
    return initial ? '/account' : null;
  }
  if (/^(torelog:\/\/|\/)?signout([/?#]|$)/.test(path)) return initial ? '/' : null;
  return path;
}
