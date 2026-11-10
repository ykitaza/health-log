import { BrowserContext, expect, Page, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { createFakeSyncServer, FakeSyncServer, ServerChange } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { button, goTab, homeCard, openApp, openSettings, openTrainingTrend, recordToday, see, trendDay } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// 同期。本物の API には当てない。アプリ用の API（execute-api）への通信は、テストの中の偽のサーバー
// （test-utils/fakeSyncServer.ts。当てはめの決まりはサーバーと同じことを jest と pytest で確かめている）が返す。
// MCP で記録したものは、サーバーの pytest が作った受け取りのページ（testdata/sync/mcp_pull.json）を、偽のサーバーに入れて作る。
// ここは画面の流れ（ログイン → 同期 → 表示、記録 → 送信、件数とエラーの表示）だけを確かめる。衝突の決まり・分け方・やり直しなどは jest

const MCP_PULL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'testdata', 'sync', 'mcp_pull.json'), 'utf8'));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };

type Mode = 'ok' | 'offline';

/** アプリ用の API への通信を、偽のサーバーにつなぐ。mode.current を offline にすると、つながらない */
async function routeSyncServer(context: BrowserContext, server: FakeSyncServer, mode: { current: Mode } = { current: 'ok' }) {
  const seen: { method: string; url: string; authorization?: string }[] = [];
  await context.route(/^https:\/\/[^/]+\.execute-api\.[^/]+\.amazonaws\.com\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS }); return; }
    seen.push({ method: req.method(), url: req.url(), authorization: req.headers().authorization });
    if (mode.current === 'offline') { await route.abort(); return; }
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    const res = server.handle(req.method(), req.url(), body);
    await route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body), headers: CORS });
  });
  return seen;
}

const ACCESS = fakeAccessToken('user-a');

/** ログインの偽物。返すトークンは token.body を書き換えると変わる（別のアカウントでログインし直すとき） */
async function signIn(page: Page, context: BrowserContext, accessToken = ACCESS) {
  const token = { status: 200, body: { access_token: accessToken, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'Bearer' } };
  await fakeCognito(context, token);
  await fakeLoginPopup(page, { code: 'test-code' });
  return token;
}

async function openAccount(page: Page) {
  await openSettings(page);
  await page.getByRole('button', { name: /^ログイン ログイン/ }).click();
  await expect(see(page, 'アカウント', { exact: true }).first()).toBeVisible();
}

const homeAlert = (page: Page) => page.getByTestId('sync-alert').filter({ visible: true });
const status = (page: Page, id: 'sync-last' | 'sync-pending' | 'sync-rejected') => page.getByTestId(id).filter({ visible: true });

/** MCP で記録したものが入ったサーバー */
function serverWithMcpRecords() {
  const server = createFakeSyncServer({ clock: () => '2026-11-08T01:00:00.000Z' });
  for (const { change } of MCP_PULL.page.entries as { change: ServerChange }[]) {
    server.setClock(() => change.received_at);
    server.append([change]);
  }
  server.setClock(() => new Date().toISOString());
  return server;
}

test('ログインすると同期し、MCP で記録した筋トレと体組成が出る。アプリで記録したものはサーバーに届く', async ({ page, context }) => {
  const server = serverWithMcpRecords();
  await signIn(page, context);
  const seen = await routeSyncServer(context, server);
  await openApp(page);
  await openAccount(page);
  await button(page, 'パスキーでログイン').click();
  await expect(see(page, 'ログインしています', { exact: true })).toBeVisible();
  await expect(status(page, 'sync-last')).toHaveText('11/8 10:00');
  await expect(status(page, 'sync-pending')).toHaveText('0件');
  await expect(status(page, 'sync-rejected')).toHaveCount(0);

  // MCP の記録（2026-11-07）が、筋トレの推移と体組成に出る
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await openTrainingTrend(page);
  await expect(trendDay(page, '2026-11-07')).toContainText('ベンチプレス');
  await expect(trendDay(page, '2026-11-07')).toContainText('懸垂');
  await goTab(page, 'からだ');
  await button(page, '前の日').click();
  await expect(page.getByTestId('body-weight').filter({ visible: true })).toContainText('71.3');

  // アプリで記録すると、少し待ってサーバーへ送る
  await goTab(page, 'ホーム');
  await recordToday(page, [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }, { weight: '105', reps: '3' }] }]);
  await expect.poll(() => server.states('workout_set').filter((s) => s.fields.weight_kg === 105).length, { timeout: 15_000 }).toBe(1);
  const entry = server.states('workout_entry').find((s) => s.fields.date === '2026-11-08')!;
  expect(entry.fields.exercise_id).toBe('a902b077-031a-4de6-814b-9ffb69b96778');
  expect(server.states('workout_set').filter((s) => s.fields.entry_id === entry.entity_id).map((s) => [s.fields.weight_kg, s.fields.reps]).sort())
    .toEqual([[100, 5], [105, 3]]);
  // トークンは Authorization ヘッダーだけに載せる
  expect(seen.every((r) => r.authorization === `Bearer ${ACCESS}` && !r.url.includes(ACCESS))).toBe(true);
  await openSettings(page);
  await expect(see(page, '記録はこの端末に保存し、サーバーと同期します。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /^ログイン ログイン/ }).click();
  await expect(status(page, 'sync-pending')).toHaveText('0件');
});

test('つながらないときは、送っていない件数とエラーを出す。つながったら「今すぐ同期」で送れる', async ({ page, context }) => {
  const server = createFakeSyncServer();
  const mode = { current: 'offline' as Mode };
  await signIn(page, context);
  await routeSyncServer(context, server, mode);
  await openApp(page);
  // ログインの前に記録したものも、あとで送る
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '60', reps: '10' }] }]);
  await openAccount(page);
  await button(page, 'パスキーでログイン').click();
  await expect(see(page, 'ログインしています', { exact: true })).toBeVisible();
  await expect(see(page, 'サーバーにつながりませんでした。つながるようになったら、自動でやり直します。')).toBeVisible();
  await expect(status(page, 'sync-pending')).toHaveText('2件');
  await expect(status(page, 'sync-last')).toHaveText('まだ同期していません');

  mode.current = 'ok';
  await button(page, '今すぐ同期').click();
  await expect(status(page, 'sync-pending')).toHaveText('0件');
  await expect(see(page, 'サーバーにつながりませんでした。', { exact: false })).toHaveCount(0);
  await expect(status(page, 'sync-last')).toHaveText('11/8 10:00');
  expect(server.states('workout_set').map((s) => [s.fields.weight_kg, s.fields.reps])).toEqual([[60, 10]]);
});

test('サーバーに断られた変更の件数と説明を出す（飛ばしてほかを送る決まりは jest の db/__tests__/sync.test.ts）', async ({ page, context }) => {
  const server = createFakeSyncServer();
  await signIn(page, context);
  await routeSyncServer(context, server);
  // 設定の変更だけを断るサーバー
  const handle = server.handle;
  server.handle = (method, url, body) => {
    const b = body as { changes?: { change_id: string; entity_type: string }[] } | undefined;
    if (method !== 'POST' || !b?.changes?.some((c) => c.entity_type === 'setting')) return handle(method, url, body);
    const rest = b.changes.filter((c) => c.entity_type !== 'setting');
    const ok = rest.length ? (handle(method, url, { ...b, changes: rest }).body as { results: unknown[] }).results : [];
    const bad = b.changes.filter((c) => c.entity_type === 'setting')
      .map((c) => ({ change_id: c.change_id, status: 'rejected', seq: null, error: { code: 'invalid_fields', message: '項目の形が違います' } }));
    return { status: 200, body: { results: [...bad, ...ok], cursor: server.head } };
  };
  await openApp(page);
  await openSettings(page);
  await button(page, 'lb').click();
  await page.getByRole('button', { name: /^ログイン ログイン/ }).click();
  await button(page, 'パスキーでログイン').click();
  await expect(see(page, 'ログインしています', { exact: true })).toBeVisible();
  await expect(status(page, 'sync-rejected')).toHaveText('1件');
  await expect(see(page, 'サーバーが受け付けなかった変更です。', { exact: false })).toBeVisible();
  await expect(status(page, 'sync-pending')).toHaveText('0件');
});

test('別のアカウントでログインし直すと、同期を止めて、端末の記録をどうするかを聞く（選んだあとの決まりは jest の db/__tests__/sync.test.ts）', async ({ page, context }) => {
  const server = createFakeSyncServer();
  const token = await signIn(page, context);
  const seen = await routeSyncServer(context, server);
  await openApp(page);
  await openAccount(page);
  await button(page, 'パスキーでログイン').click();
  await expect(status(page, 'sync-last')).toHaveText('11/8 10:00');
  await expect(see(page, '前と違うアカウントでログインしました')).toHaveCount(0);

  await button(page, 'ログアウト').click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).last().click();
  await expect(see(page, 'ログインしていません', { exact: true })).toBeVisible();

  // ログアウトのあいだに記録したものは、別のアカウントには送らない
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '60', reps: '10' }] }]);
  token.body.access_token = fakeAccessToken('user-b');
  const before = seen.length;
  await openAccount(page);
  await button(page, 'パスキーでログイン').click();
  await expect(see(page, '前と違うアカウントでログインしました')).toBeVisible();
  await expect(see(page, '同期を止めています。', { exact: false }).first()).toBeVisible();
  await expect(button(page, 'この端末の記録を新しいアカウントに送る')).toBeVisible();
  await expect(button(page, '端末の記録を消して、新しいアカウントから受け取り直す')).toBeVisible();
  await expect(button(page, 'ログアウトする')).toBeVisible();
  await expect(status(page, 'sync-pending')).toHaveText('2件');
  expect(seen.slice(before)).toEqual([]);
  expect(server.states('workout_set')).toEqual([]);
  // アカウントの ID は画面に出さない
  await expect(see(page, 'user-', { exact: false })).toHaveCount(0);

  // ホームにも、1回目から知らせを出す。押すとアカウントの画面で確かめる
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await expect(homeAlert(page)).toHaveText('同期できませんでした確かめる');
  await button(page, '同期できませんでした。確かめる').click();
  await expect(see(page, '前と違うアカウントでログインしました')).toBeVisible();
});

/** アプリを背景に回す・前面に戻す（web では document の visibilityState。React Native Web の AppState がこれを見る） */
async function setVisible(page: Page, visible: boolean) {
  await page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'visible' : 'hidden') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}

const homeTitle = (page: Page) => page.getByRole('heading', { name: 'hlog' }).filter({ visible: true });

// web では下に引っぱる操作（RefreshControl）が動かないので、ホームに同期の状態の行が出ないことと、失敗の知らせの出し方を確かめる。
// 引っぱったときの決まり（ログインしていなければ同期しない、など）とマークの動きの値は jest の lib/__tests__/sync-status.test.ts・pull-mark.test.ts
test('ホーム：ふだんは同期の状態を出さない（ログインしていない・同期できたとき）。時刻と件数はアカウントの画面', async ({ page, context }) => {
  await signIn(page, context);
  await routeSyncServer(context, createFakeSyncServer());
  await openApp(page);
  await expect(homeTitle(page)).toBeVisible();
  await expect(homeAlert(page)).toHaveCount(0);
  await expect(see(page, 'ログインすると同期できます')).toHaveCount(0);

  await openAccount(page);
  await button(page, 'パスキーでログイン').click();
  await expect(status(page, 'sync-last')).toHaveText('11/8 10:00');
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await expect(homeTitle(page)).toBeVisible();
  await expect(homeAlert(page)).toHaveCount(0);
  await expect(see(page, '同期 ', { exact: false })).toHaveCount(0);
});

test('ホーム：自動の同期が続けて失敗したときだけ知らせ、押すとやり直す。前面に戻ると、MCP で記録した食事を受け取ってホームに出る', async ({ page, context }) => {
  const server = createFakeSyncServer();
  const mode = { current: 'offline' as Mode };
  await signIn(page, context);
  const seen = await routeSyncServer(context, server, mode);
  await openApp(page);
  await openAccount(page);
  await button(page, 'パスキーでログイン').click();
  await expect(see(page, 'ログインしています', { exact: true })).toBeVisible();
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  // 1回の失敗では出さない（自動でやり直す）
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  await expect(homeTitle(page)).toBeVisible();
  await expect(homeAlert(page)).toHaveCount(0);
  // 前面に戻ったときの同期も失敗すると、続けて 2 回なので出す
  await setVisible(page, false);
  await setVisible(page, true);
  await expect(homeAlert(page)).toHaveText('同期できませんでしたやり直す');
  mode.current = 'ok';
  await button(page, '同期できませんでした。やり直す').click();
  await expect(homeAlert(page)).toHaveCount(0);
  await expect(homeCard(page, 'meals')).not.toContainText('160 kcal');

  // ChatGPT に切り替えて MCP で記録し、hlog に戻る
  await setVisible(page, false);
  const meal = 'cccccccc-0000-4000-8000-000000000001';
  const at = '2026-11-08T01:30:00.000Z';
  server.setClock(() => at);
  server.append([
    { change_id: crypto.randomUUID(), entity_type: 'meal', entity_id: meal, parent_id: null, op: 'create', changed_at: at, origin: 'mcp', device_id: null,
      fields: { date: '2026-11-08', slot: 'breakfast', time: null, description: '鮭定食', source: 'text', basis: null } },
    { change_id: crypto.randomUUID(), entity_type: 'meal_item', entity_id: 'i1', parent_id: meal, op: 'create', changed_at: at, origin: 'mcp', device_id: null,
      fields: { name: '鮭', amount: 80, unit: 'g', kcal: 160, protein_g: 18, fat_g: 9, carbs_g: 0, confidence: 'medium', sort_order: 0 } },
  ]);
  await setVisible(page, true);
  await expect(homeCard(page, 'meals')).toContainText('160 kcal');
  await expect(homeAlert(page)).toHaveCount(0);
});
