import { BrowserContext, Page } from '@playwright/test';

// ログインの偽物（本物の Cognito には当てない）。e2e/account.spec.ts の説明を参照。
// web のログインはポップアップで開くが、E2E の配信は COOP: same-origin なので、window.open を差し替えて
// 「ポップアップが戻り先（/callback?…）に着いて、元の画面に URL を送った」ところを作る

type Opened = { url: string };

/** ログインの画面を開いたら、すぐに戻り先へ back の値を付けて戻ったことにする */
export async function fakeLoginPopup(page: Page, back: Record<string, string>) {
  await page.addInitScript((backParams) => {
    const w = window as unknown as { __opened: { url: string }[] };
    w.__opened = [];
    window.open = ((url: string) => {
      w.__opened.push({ url });
      const authorize = new URL(url);
      const state = authorize.searchParams.get('state') ?? '';
      const to = new URL(authorize.searchParams.get('redirect_uri')!);
      for (const [k, v] of Object.entries(backParams)) to.searchParams.set(k, v);
      to.searchParams.set('state', state);
      const popup = { closed: false, focus() {}, close() { popup.closed = true; } };
      setTimeout(() => window.postMessage({ url: to.toString(), expoSender: state }, window.location.origin), 100);
      return popup as unknown as Window;
    }) as typeof window.open;
  }, back);
}
export const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: Opened[] }).__opened);

/** Cognito とアプリ用の API への通信を止め、/oauth2/token だけ token の返事を返す。送った本文を残す */
export async function fakeCognito(context: BrowserContext, token?: { status: number; body: unknown }) {
  const tokenRequests: URLSearchParams[] = [];
  await context.route(/^https:\/\/[^/]+\.amazoncognito\.com\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/oauth2/token' && token) {
      tokenRequests.push(new URLSearchParams(route.request().postData() ?? ''));
      await route.fulfill({ status: token.status, contentType: 'application/json', body: JSON.stringify(token.body), headers: { 'Access-Control-Allow-Origin': '*' } });
    } else {
      await route.abort();
    }
  });
  await context.route(/^https:\/\/[^/]+\.execute-api\.[^/]+\.amazonaws\.com\//, (route) => route.abort());
  return tokenRequests;
}
