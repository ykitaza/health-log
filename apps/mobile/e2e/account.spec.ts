import { expect, Page, test } from '@playwright/test';
import { button, openApp, openSettings, see } from './helpers';
import { fakeCognito, fakeLoginPopup, opened } from './login';

// ログインの画面。本物の Cognito には当てない。
// web のログインはポップアップで開くが、E2E の配信は COOP: same-origin（expo-sqlite に要る）なので、
// 別のオリジン（Cognito）を開いたポップアップからは、元の画面に結果を返せない。そこで window.open を差し替えて、
// 「ポップアップが戻り先（/callback?…）に着いて、元の画面に URL を送った」ところ（expo-web-browser の maybeCompleteAuthSession と同じ形）を作る。
// /oauth2/token とアプリ用の API への通信は、テストの中で返事を作る（Android では Chrome Custom Tabs と torelog://callback を使う）

async function openAccount(page: Page) {
  await openApp(page);
  await openSettings(page);
  await page.getByRole('button', { name: /^ログイン ログインしていません（任意）/ }).click();
  await expect(see(page, 'ログインしていません', { exact: true })).toBeVisible();
}

test('ログイン前：設定から開け、端末だけで使えることを出す', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await expect(see(page, 'ログインしていません（任意）', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^ログイン ログインしていません（任意）/ }).click();
  await expect(see(page, 'ログインしていません', { exact: true })).toBeVisible();
  await expect(see(page, /ログインしなくても、今までどおりこの端末だけで使えます/)).toBeVisible();
  await expect(button(page, 'パスキーでログイン')).toBeEnabled();
  await expect(button(page, 'ログアウト')).toHaveCount(0);
  await button(page, '戻る').click();
  await expect(see(page, '重さの単位', { exact: true })).toBeVisible();
});

test('ログインの画面で中止・エラーになったら、エラーを出す。認可の要求は PKCE と prompt=login で、scope は API の4つだけ', async ({ page, context }) => {
  await fakeCognito(context);
  await fakeLoginPopup(page, { error: 'access_denied' });
  await openAccount(page);
  await button(page, 'パスキーでログイン').click();
  await expect(see(page, 'ログインできませんでした。もう一度ログインしてください。')).toBeVisible();
  await expect(see(page, 'ログインしていません', { exact: true })).toBeVisible();

  const [{ url }] = await opened(page);
  const q = new URL(url).searchParams;
  expect(url.startsWith('https://')).toBe(true);
  expect(new URL(url).pathname).toBe('/oauth2/authorize');
  expect(q.get('client_id')).toBeTruthy();
  expect(q.get('response_type')).toBe('code');
  expect(q.get('code_challenge_method')).toBe('S256');
  expect(q.get('code_challenge')).toBeTruthy();
  expect(q.get('state')).toBeTruthy();
  expect(q.get('prompt')).toBe('login');
  expect(q.get('scope')!.split(' ').sort()).toEqual([
    'torelog-api/meals.read', 'torelog-api/meals.write', 'torelog-api/training.read', 'torelog-api/training.write',
  ]);
});

test('認可コードをトークンに換えられなかったら、エラーを出し、ログインしていないまま', async ({ page, context }) => {
  const tokenRequests = await fakeCognito(context, { status: 400, body: { error: 'invalid_grant' } });
  await fakeLoginPopup(page, { code: 'test-code' });
  await openAccount(page);
  await button(page, 'パスキーでログイン').click();
  await expect(see(page, 'ログインできませんでした。もう一度ログインしてください。')).toBeVisible();
  await expect(see(page, 'ログインしていません', { exact: true })).toBeVisible();

  // 認可コードと PKCE の値を本文で送る。シークレットは送らない
  expect(tokenRequests).toHaveLength(1);
  const body = tokenRequests[0];
  expect(body.get('grant_type')).toBe('authorization_code');
  expect(body.get('code')).toBe('test-code');
  expect(body.get('code_verifier')).toBeTruthy();
  expect(body.has('client_secret')).toBe(false);
});

test('ログインの画面を開けなかったら（ポップアップを止められたなど）、エラーを出す', async ({ page, context }) => {
  await fakeCognito(context);
  await page.addInitScript(() => { window.open = () => null; });
  await openAccount(page);
  await button(page, 'パスキーでログイン').click();
  await expect(see(page, 'ログインの画面を開けませんでした。')).toBeVisible();
});
