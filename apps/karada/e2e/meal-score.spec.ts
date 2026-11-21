import { BrowserContext, expect, Page, test } from '@playwright/test';
import { createFakeSyncServer, FakeSyncServer } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { button, goTab, openApp, openSettings, see, TODAY } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// 食事のスコア（#331）。MCP で AI が推定を付けて記録した食事を同期で受け取り、食事のタブにその日の点・前の日との差・内訳・
// いちばん伸ばしやすい項目を出す（計算は端末。点の数字そのものは jest と pytest が同じテストのデータで確かめている）。
// 量を変えると推定も同じ割合で変わって点が動くこと、手で入れた品目がある日はバランスが「記録なし」になることを確かめる。
// SHOT_DIR を渡すと、360 の幅で HUD とクラシックの画面を撮る（<SHOT_DIR>/meal-score-{hud,classic}.png）

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };
const YESTERDAY = '2026-11-07';

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

const NONE = { sv_staple: 0, sv_side: 0, sv_main: 0, sv_dairy: 0, sv_fruit: 0, fiber_g: 0, salt_g: 0, alcohol_g: 0, is_snack_or_sweet_drink: false };

/** MCP で記録した 2 日分の食事（どの品目にも推定がある）と、目標（休みの日 2000kcal、たんぱく質 70kg × 2g） */
function seed() {
  const at = '2026-11-08T01:00:00.000Z';
  const server = createFakeSyncServer({ clock: () => at });
  const base = { changed_at: at, origin: 'mcp' as const, device_id: null, op: 'create' as const };
  const c = (entity_type: string, entity_id: string, fields: Record<string, unknown>, parent_id: string | null = null) =>
    ({ ...base, parent_id, change_id: crypto.randomUUID(), entity_type, entity_id, fields });
  const meal = (id: string, date: string, slot: string, description: string) =>
    c('meal', id, { date, slot, time: null, description, source: 'photo', basis: '写真から推定' });
  const item = (meal: string, id: string, order: number, f: Record<string, unknown>) =>
    c('meal_item', id, { confidence: 'medium', sort_order: order, ...NONE, ...f }, meal);
  const y = 'aaaaaaaa-0000-4000-8000-0000000000a1', b = 'aaaaaaaa-0000-4000-8000-0000000000b1', l = 'aaaaaaaa-0000-4000-8000-0000000000c1';
  server.append([
    c('nutrition_goal', 'current', {
      policy: 'maintain', body_weight_kg: 70, protein_per_kg: 2, eating_style: null, target_weight_kg: null,
      targets: { training_day: { kcal: 2400, fat_g: 60, carbs_g: 300 }, rest_day: { kcal: 2000, fat_g: 55, carbs_g: 250 } },
    }),
    meal(y, YESTERDAY, 'dinner', 'ラーメンとビール'),
    item(y, 'ramen', 0, { name: 'ラーメン', amount: 1, unit: '杯', kcal: 900, protein_g: 30, fat_g: 35, carbs_g: 110, sv_staple: 2, sv_side: 1, sv_main: 1, fiber_g: 4, salt_g: 6 }),
    item(y, 'beer', 1, { name: 'ビール', amount: 500, unit: 'ml', kcal: 200, protein_g: 1.5, fat_g: 0, carbs_g: 15, alcohol_g: 20 }),
    meal(b, TODAY, 'breakfast', 'ヨーグルトとバナナ'),
    item(b, 'yogurt', 0, { name: 'ヨーグルト', amount: 100, unit: 'g', kcal: 160, protein_g: 9, fat_g: 3, carbs_g: 12, sv_dairy: 1, salt_g: 0.1 }),
    item(b, 'banana', 1, { name: 'バナナ', amount: 1, unit: '個', kcal: 90, protein_g: 1, fat_g: 0.2, carbs_g: 22, sv_fruit: 1, fiber_g: 1.1 }),
    meal(l, TODAY, 'lunch', '鮭定食'),
    item(l, 'rice', 0, { name: '白米', amount: 200, unit: 'g', kcal: 312, protein_g: 5, fat_g: 0.6, carbs_g: 74, sv_staple: 1.5, fiber_g: 0.6 }),
    item(l, 'salmon', 1, { name: '鮭', amount: 80, unit: 'g', kcal: 160, protein_g: 18, fat_g: 9, carbs_g: 0, sv_main: 2, salt_g: 1.2 }),
    item(l, 'soup', 2, { name: 'みそ汁', amount: 1, unit: '杯', kcal: 46, protein_g: 4, fat_g: 2, carbs_g: 3, sv_side: 0.5, fiber_g: 1, salt_g: 1.5 }),
    item(l, 'greens', 3, { name: 'ほうれん草のおひたし', amount: 1, unit: '個', kcal: 30, protein_g: 3, fat_g: 0.5, carbs_g: 3, sv_side: 1, fiber_g: 2, salt_g: 0.5 }),
  ]);
  return server;
}

const card = (page: Page) => page.getByTestId('meal-score').filter({ visible: true });

async function signInAndOpenMeals(page: Page, context: BrowserContext) {
  await connect(page, context, seed());
  await openApp(page);
  await openSettings(page);
  await page.getByTestId('settings-account').click();
  await button(page, 'パスキーでログイン').click();
  // 当てはめを書き終えたあとに入る、最後に同期した時刻を待つ
  await expect(page.getByTestId('sync-last').filter({ visible: true })).toHaveText(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await goTab(page, '食事');
}

test('AI が記録した食事から、その日の点・前の日との差・内訳・伸ばしやすい項目を出す。量を変えると点が動き、手で足すとバランスは記録なし', async ({ page, context }) => {
  await signInAndOpenMeals(page, context);
  await expect(card(page)).toBeVisible();
  // 読み上げは 1 つの文：点（今日は「ここまで」）、前の日との差、4 つの内訳、伸ばしやすい項目。
  // 今日は途中なので、エネルギーとたんぱく質は「1日の終わりに付く」として数えず、食べるよう勧めない
  await expect(card(page)).toHaveAttribute('aria-label',
    /^食事のスコア（ここまで） \d+点、前の日(より \d+点(高い|低い)|と同じ)。内訳：エネルギー 1日の終わりに付く、たんぱく質 1日の終わりに付く、バランス \d+点、控えたいもの \d+点。伸ばしやすいのは、.+で \+\d+点$/);
  await expect(card(page)).toContainText('1日の終わりに付く');
  await expect(page.getByTestId('meal-score-next').filter({ visible: true })).not.toContainText('エネルギー');
  await expect(page.getByTestId('meal-score-diff').filter({ visible: true })).toContainText('前の日より');
  await expect(page.getByTestId('meal-score-next').filter({ visible: true })).toBeVisible();
  await expect(card(page)).not.toContainText('記録なし');
  const before = await page.getByTestId('meal-score-value').filter({ visible: true }).textContent();

  if (process.env.SHOT_DIR) {
    await page.setViewportSize({ width: 360, height: 800 });
    await card(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const look = await page.evaluate(() => localStorage.getItem('appearance.look'));
    await page.screenshot({ path: `${process.env.SHOT_DIR}/meal-score-${look === 'classic' ? 'classic' : 'hud'}.png`, fullPage: false });
    await page.setViewportSize({ width: 412, height: 915 });
  }

  // 白米を倍にすると、エネルギーと主食の「つ」が増えて点が変わる（推定も同じ割合で変わる）
  await button(page, '鮭定食を開く').click();
  await page.getByRole('textbox', { name: '白米の量', exact: true }).filter({ visible: true }).fill('400');
  await button(page, '保存').click();
  await expect(card(page)).toBeVisible();
  await expect(page.getByTestId('meal-score-value').filter({ visible: true })).not.toHaveText(before ?? '');
  await expect(card(page)).not.toContainText('記録なし');

  // 手で数字だけ入れた食事（推定なし）を足すと、バランスと食塩などは記録なしになり、そのわけを添える
  await button(page, '間食を記録').click();
  await button(page, 'kcal と PFC だけ').click();
  await page.getByRole('textbox', { name: '品目1の品名', exact: true }).filter({ visible: true }).fill('おやつ');
  await page.getByRole('textbox', { name: '品目1のエネルギー', exact: true }).filter({ visible: true }).fill('100');
  await button(page, '記録する').click();
  await expect(card(page)).toHaveAttribute('aria-label', /バランス 記録なし/);
  await expect(card(page)).toContainText('手で入れた品目がある日は「記録なし」');
});

test('食事のない日は点を出さない', async ({ page, context }) => {
  await signInAndOpenMeals(page, context);
  await expect(card(page)).toBeVisible();
  await button(page, '前の日').click();
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  // 前の日（11/7）は記録があり、その前の日（11/6）は記録がないので、差は出さない。過ぎた日は 4 つの内訳で数える
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveAttribute('aria-label', /^食事のスコア \d+点。内訳：エネルギー \d+点、たんぱく質 \d+点、/);
  await expect(card(page)).not.toContainText('1日の終わりに付く');
  await expect(page.getByTestId('meal-score-diff').filter({ visible: true })).toHaveCount(0);
  await button(page, '前の日').click();
  await expect(see(page, '11月6日（金）', { exact: true })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('クラシックでも出す（SHOT_DIR を渡すと撮る）', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('appearance.look', 'classic'));
  await signInAndOpenMeals(page, context);
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('食事のスコア');
  await expect(card(page)).toContainText('いちばん伸ばしやすいこと');
  if (process.env.SHOT_DIR) {
    await page.setViewportSize({ width: 360, height: 800 });
    await card(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${process.env.SHOT_DIR}/meal-score-classic.png` });
  }
});
