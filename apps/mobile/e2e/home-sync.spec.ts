import { BrowserContext, expect, Page, test } from '@playwright/test';
import { createFakeSyncServer, FakeSyncServer } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { button, homeCard, openApp, openSettings, see, tab, TODAY } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// ホームの、同期で受け取るものに関わる部品：今週やること（週のまとめの次の一歩）と、取り込みの知らせ。
// サーバーは偽物（test-utils/fakeSyncServer.ts）。件数の数え方・週のまとめの選び方は jest（lib/__tests__/sync-received.test.ts、home.test.ts）

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };
const AT = '2026-11-08T01:00:00.000Z';
const mcp = { parent_id: null, changed_at: AT, origin: 'mcp' as const, device_id: null };

async function connect(page: Page, context: BrowserContext, server: FakeSyncServer) {
  await fakeCognito(context, { status: 200, body: { access_token: fakeAccessToken('user-a'), refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' } });
  await fakeLoginPopup(page, { code: 'test-code' });
  await context.route(/^https:\/\/[^/]+\.execute-api\.[^/]+\.amazonaws\.com\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS }); return; }
    const res = server.handle(req.method(), req.url(), req.postData() ? JSON.parse(req.postData()!) : undefined);
    await route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body), headers: CORS });
  });
}

async function signInAndSync(page: Page) {
  await openSettings(page);
  await page.getByRole('button', { name: /^ログイン ログイン/ }).click();
  await button(page, 'パスキーでログイン').click();
  await expect(page.getByTestId('sync-pending').filter({ visible: true })).toHaveText('0件');
  await button(page, '戻る').click();
  await button(page, '戻る').click();
}

/** ほかのアプリ（ChatGPT など）に切り替えて、hlog に戻る（web では画面の見え方の変化が AppState になる） */
async function leaveAndReturn(page: Page) {
  for (const state of ['hidden', 'visible']) {
    await page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  }
}

test('今週やること：週のまとめの次の一歩にチェックを付けると、取り消し線と件数。再読み込みしても残る', async ({ page, context }) => {
  const server = createFakeSyncServer({ clock: () => AT });
  server.append([{ ...mcp, change_id: crypto.randomUUID(), entity_type: 'report', entity_id: 'aaaaaaaa-0000-4000-8000-000000000001', op: 'create', fields: {
    title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: TODAY, overall_tone: 'good', headline: '脚の日が増えた',
    highlights: [], next_steps: ['脚の日を2回入れる', 'たんぱく質を毎日 120g とる', '平日は 23時半までに寝る'], body: '',
  } }]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);

  const card = page.getByTestId('weekly-todo').filter({ visible: true });
  await expect(card).toBeVisible();
  await expect(see(card, '今週やること', { exact: true })).toBeVisible();
  await expect(see(card, '0／3', { exact: true })).toBeVisible();
  const first = card.getByRole('checkbox', { name: '脚の日を2回入れる' });
  await expect(first).toHaveAttribute('aria-checked', 'false');
  await first.click();
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await expect(see(card, '1／3', { exact: true })).toBeVisible();
  await expect(see(card, '脚の日を2回入れる', { exact: true })).toHaveCSS('text-decoration-line', 'line-through');

  // 最新のレポートの上に出る
  const todoBox = await card.boundingBox();
  const reportBox = await page.getByTestId('latest-report').filter({ visible: true }).boundingBox();
  expect(todoBox!.y).toBeLessThan(reportBox!.y);

  await page.reload();
  await expect(card.getByRole('checkbox', { name: '脚の日を2回入れる' })).toHaveAttribute('aria-checked', 'true');
  await expect(see(card, '1／3', { exact: true })).toBeVisible();
});

test('取り込みの知らせ：MCP で記録して戻ると「食事を2件、筋トレを1件取り込みました」。見るでその日の食事', async ({ page, context }) => {
  const server = createFakeSyncServer({ clock: () => AT });
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  await expect(homeCard(page, 'training')).toBeVisible();
  await expect(page.getByTestId('received-notice')).toHaveCount(0);

  // ChatGPT で食事を2件と、筋トレ（1日に2種目）を記録した
  // 種目の ID は数え方に関わらない（端末にない種目なら、当てはめは種目が届くまで待つ）
  const exerciseId = 'ffffffff-0000-4000-8000-000000000001';
  const meal = (id: string, slot: string) => ({ ...mcp, change_id: crypto.randomUUID(), entity_type: 'meal', entity_id: id, op: 'create' as const,
    fields: { date: '2026-11-07', slot, time: null, description: slot === 'lunch' ? '鮭定食' : 'カレー', source: 'text', basis: null } });
  const entry = (id: string, order: number) => ({ ...mcp, change_id: crypto.randomUUID(), entity_type: 'workout_entry', entity_id: id, op: 'create' as const,
    fields: { date: TODAY, exercise_id: exerciseId, sort_order: order } });
  const item = (mealId: string) => ({ ...mcp, change_id: crypto.randomUUID(), entity_type: 'meal_item', entity_id: 'i1', parent_id: mealId, op: 'create' as const,
    fields: { name: '品目', amount: 1, unit: '個', kcal: 500, protein_g: 20, fat_g: 10, carbs_g: 60, confidence: 'medium', sort_order: 0 } });
  server.append([
    meal('dddddddd-0000-4000-8000-000000000001', 'lunch'), meal('dddddddd-0000-4000-8000-000000000002', 'dinner'),
    item('dddddddd-0000-4000-8000-000000000001'), item('dddddddd-0000-4000-8000-000000000002'),
    entry('eeeeeeee-0000-4000-8000-000000000001', 0), entry('eeeeeeee-0000-4000-8000-000000000002', 1),
  ]);
  await leaveAndReturn(page);

  const notice = page.getByTestId('received-notice').filter({ visible: true });
  await expect(notice).toContainText('食事を2件、筋トレを1件取り込みました');
  await button(page, '食事を2件、筋トレを1件取り込みました。見る').click();
  await expect(tab(page, '食事')).toHaveAttribute('aria-selected', 'true');
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  await expect(see(page, '鮭定食', { exact: true })).toBeVisible();
});
