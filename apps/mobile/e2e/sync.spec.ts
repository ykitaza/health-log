import { BrowserContext, expect, Page, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { createFakeSyncServer, FakeSyncServer, ServerChange } from '../test-utils/fakeSyncServer';
import { button, goTab, openApp, openSettings, recordToday, see } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// 同期。本物の API には当てない。アプリ用の API（execute-api）への通信は、テストの中の偽のサーバー
// （test-utils/fakeSyncServer.ts。当てはめの決まりはサーバーと同じことを jest と pytest で確かめている）が返す。
// MCP で記録したものは、サーバーの pytest が作った受け取りのページ（testdata/sync/mcp_pull.json）を、偽のサーバーに入れて作る

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

async function signIn(page: Page, context: BrowserContext) {
  await fakeCognito(context, { status: 200, body: { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, token_type: 'Bearer' } });
  await fakeLoginPopup(page, { code: 'test-code' });
}

async function openAccount(page: Page) {
  await openSettings(page);
  await page.getByRole('button', { name: /^ログイン ログイン/ }).click();
  await expect(see(page, 'アカウント', { exact: true }).first()).toBeVisible();
}

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

  // MCP の記録（2026-11-07）が、履歴と体組成に出る
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await goTab(page, '履歴／分析');
  await expect(see(page, '11月7日（土） ベンチプレス')).toBeVisible();
  await expect(see(page, '11月7日（土） 懸垂')).toBeVisible();
  await goTab(page, '体組成');
  await button(page, '前の日').click();
  await expect(page.getByRole('textbox', { name: '体重', exact: true }).filter({ visible: true })).toHaveValue('71.3');

  // アプリで記録すると、少し待ってサーバーへ送る
  await goTab(page, 'ホーム');
  await recordToday(page, [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }, { weight: '105', reps: '3' }] }]);
  await expect.poll(() => server.states('workout_set').filter((s) => s.fields.weight_kg === 105).length, { timeout: 15_000 }).toBe(1);
  const entry = server.states('workout_entry').find((s) => s.fields.date === '2026-11-08')!;
  expect(entry.fields.exercise_id).toBe('a902b077-031a-4de6-814b-9ffb69b96778');
  expect(server.states('workout_set').filter((s) => s.fields.entry_id === entry.entity_id).map((s) => [s.fields.weight_kg, s.fields.reps]).sort())
    .toEqual([[100, 5], [105, 3]]);
  // トークンは Authorization ヘッダーだけに載せる
  expect(seen.every((r) => r.authorization === 'Bearer test-access' && !r.url.includes('test-access'))).toBe(true);
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

test('サーバーに断られた変更は、件数を出して飛ばし、ほかの変更は送る', async ({ page, context }) => {
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

  // ほかの変更は届く
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '60', reps: '10' }] }]);
  await expect.poll(() => server.states('workout_set').length, { timeout: 15_000 }).toBe(1);
});
