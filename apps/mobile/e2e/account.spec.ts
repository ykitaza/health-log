import { expect, Page, test } from '@playwright/test';
import { button, enter, homeIcon, openAccountFromSettings, openApp, openSettings, see } from './helpers';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { fakeCognito, fakeLoginPopup, opened } from './login';

// ログインの画面。本物の Cognito には当てない。
// web のログインはポップアップで開くが、E2E の配信は COOP: same-origin（expo-sqlite に要る）なので、
// 別のオリジン（Cognito）を開いたポップアップからは、元の画面に結果を返せない。そこで window.open を差し替えて、
// 「ポップアップが戻り先（/callback?…）に着いて、元の画面に URL を送った」ところ（expo-web-browser の maybeCompleteAuthSession と同じ形）を作る。
// /oauth2/token とアプリ用の API への通信は、テストの中で返事を作る（Android では Chrome Custom Tabs と torelog://callback を使う）

async function openAccount(page: Page) {
  await openApp(page);
  await openAccountFromSettings(page);
  await expect(see(page, 'ログインしていません', { exact: true })).toBeVisible();
}

const accountRow = (page: Page) => page.getByTestId('settings-account').filter({ visible: true });

test('ログイン前：設定から開け、端末だけで使えることを出す', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await expect(see(page, 'ログインしていません（任意）', { exact: true })).toBeVisible();
  await accountRow(page).click();
  await expect(see(page, 'ログインしていません', { exact: true })).toBeVisible();
  await expect(see(page, /ログインしなくても、今までどおりこの端末だけで使えます/)).toBeVisible();
  await expect(button(page, 'パスキーでログイン')).toBeEnabled();
  await expect(button(page, 'ログアウト')).toHaveCount(0);
  await expect(button(page, '別のアカウントにする')).toHaveCount(0);
  await button(page, '戻る').click();
  await expect(see(page, '重さの単位', { exact: true })).toBeVisible();
});

test('ホームの左上の写真を押すとアカウントの画面。写真がなければアプリのアイコン', async ({ page }) => {
  await openApp(page);
  await expect(homeIcon(page)).toHaveAccessibleName('アカウント。押すとアカウントの画面');
  await expect(homeIcon(page).getByTestId('avatar-icon')).toBeVisible();
  await homeIcon(page).click();
  await expect(see(page, 'プロフィール', { exact: true })).toBeVisible();
  await expect(page.getByTestId('account-name').filter({ visible: true })).toHaveText('アカウント');
  await expect(page.getByTestId('account-status').filter({ visible: true })).toHaveText('ログインしていません');
  await button(page, '戻る').click();
  await expect(homeIcon(page)).toBeVisible();
});

test('表示名を変えると、アカウントの画面と設定の行に出る。再読み込みしても残り、空にすると消える', async ({ page }) => {
  await openApp(page);
  await homeIcon(page).click();
  await expect(see(page, '表示名と写真は、この端末の中だけに置きます。サーバーには送りません。')).toBeVisible();
  await enter(page, '表示名', '  たろう ');
  await expect(page.getByTestId('account-name').filter({ visible: true })).toHaveText('たろう');
  await expect(page.getByRole('textbox', { name: '表示名' })).toHaveValue('たろう');
  // ホームに戻ってから設定を開くと、行に表示名が出る
  await button(page, '戻る').click();
  await expect(homeIcon(page)).toBeVisible();
  await openSettings(page);
  await expect(accountRow(page)).toContainText('たろう');
  await page.reload();
  await expect(accountRow(page)).toContainText('たろう');

  await accountRow(page).click();
  await enter(page, '表示名', '');
  await expect(page.getByTestId('account-name').filter({ visible: true })).toHaveText('アカウント');
  await button(page, '戻る').click();
  await expect(accountRow(page)).not.toContainText('たろう');
});

test('体の情報はアカウントの画面にあり、設定の画面にはない。性別と生まれた年も保存する', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await expect(see(page, '体の情報', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '身長' })).toHaveCount(0);
  await accountRow(page).click();
  await expect(see(page, '体の情報', { exact: true })).toBeVisible();
  await expect(see(page, '性別と生まれた年はこの端末の中だけに置き、サーバーには送りません。')).toBeVisible();
  await enter(page, '身長', '170');
  await button(page, '女性').click();
  await enter(page, '生まれた年', '1990');
  await button(page, '少し動く').click();
  await expect(button(page, '女性')).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, '少し動く')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '身長' })).toHaveValue('170');
  await expect(page.getByRole('textbox', { name: '生まれた年' })).toHaveValue('1990');
  await expect(button(page, '女性')).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, '少し動く')).toHaveAttribute('aria-selected', 'true');
});

test('写真を押すと「アカウントの写真」のシートが開き、「やめる」で閉じる（選ぶ操作は jest）', async ({ page }) => {
  await openApp(page);
  await homeIcon(page).click();
  await button(page, 'アカウントの写真。押すと写真を選ぶ').click();
  const sheet = page.getByTestId('photo-sheet');
  await expect(sheet).toBeVisible();
  await expect(see(sheet, 'この端末の中だけに置きます。サーバーには送りません')).toBeVisible();
  await expect(button(sheet, '写真を選ぶ 端末の写真から1枚選び、正方形に切り抜きます')).toBeVisible();
  // 写真を置いていないので、外す行は出さない
  await expect(see(sheet, '写真を外す（アプリのアイコンに戻す）')).toHaveCount(0);
  await button(sheet, 'やめる').click();
  await expect(sheet).toHaveCount(0);
  await expect(see(page, 'プロフィール', { exact: true })).toBeVisible();
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

test('「別のアカウントにする」：ログアウトの確認のあと、ログアウトしてからログインの画面を開く。表示名は消さない', async ({ page, context }) => {
  await fakeCognito(context, { status: 200, body: { access_token: fakeAccessToken('user-a'), refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' } });
  // アプリ用の API（同期）には当てない
  await context.route(/^https:\/\/[^/]+\.execute-api\.[^/]+\.amazonaws\.com\//, (route) => route.abort());
  await fakeLoginPopup(page, { code: 'test-code' });
  await openAccount(page);
  await enter(page, '表示名', 'たろう');
  await button(page, 'パスキーでログイン').click();
  await expect(page.getByTestId('account-status').filter({ visible: true })).toHaveText('ログインしています');
  await expect(see(page, 'ログイン中', { exact: true })).toBeVisible();
  expect(await opened(page)).toHaveLength(1);

  await button(page, '別のアカウントにする ログアウトして、別のアカウントでログインし直します').click();
  await expect(see(page, 'ログアウトしますか？')).toBeVisible();
  // やめると何もしない
  await page.getByRole('button', { name: 'やめる', exact: true }).last().click();
  await expect(page.getByTestId('account-status').filter({ visible: true })).toHaveText('ログインしています');
  expect(await opened(page)).toHaveLength(1);

  await button(page, '別のアカウントにする ログアウトして、別のアカウントでログインし直します').click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).last().click();
  // ログインの画面をもう一度開く（偽物はすぐ同じアカウントで戻るので、ログインし直した状態になる）
  await expect.poll(async () => (await opened(page)).length).toBe(2);
  await expect(page.getByTestId('account-status').filter({ visible: true })).toHaveText('ログインしています');
  await expect(page.getByTestId('account-name').filter({ visible: true })).toHaveText('たろう');
});
