// 食事を同じ日の別の区分へ移す（#328）。長押しのメニューの「〜へ移す」と、長押しで持ち上げて区分の上へドラッグして離す。
// 移したら「元に戻す」の知らせ。開き直しても新しい区分のまま。同期の本文（食事の slot だけの update）は jest の db/__tests__/meals.test.ts と、
// サーバーの services/meals/tests/sync/test_app_move.py。読み上げの操作（accessibilityActions）は web では出ないので jest で確かめる。
// SHOT_DIR を渡すと、HUD とクラシックで、持ち上げたところと移したあとの知らせを撮る（meal-move-<見た目>-{lifted,moved}.png）
import { expect, Page, test } from '@playwright/test';
import { button, goTab, openApp, see } from './helpers';

const field = (page: Page, label: string) => page.getByRole('textbox', { name: label, exact: true }).filter({ visible: true });
const slotOf = (page: Page, slot: string) => page.getByTestId(`meal-slot-${slot}`).filter({ visible: true });
const notice = (page: Page) => page.getByTestId('meal-moved-notice').filter({ visible: true });

/** 区分の「＋」から「kcal と PFC だけ」で記録する */
async function recordNumbers(page: Page, slot: string, name: string, kcal: string) {
  await button(page, `${slot}を記録`).click();
  await button(page, '品目を入力').click();
  await field(page, '品目1の品名').fill(name);
  await field(page, '品目1の量').fill('1');
  await field(page, '品目1のエネルギー').fill(kcal);
  await button(page, '記録する').click();
  await expect(button(page, `${name}を開く`)).toBeVisible();
}

/** 行を長押しする（マウスを押したまま、持ち上がるまで待つ） */
async function press(page: Page, name: string) {
  // 下のボタンの帯に隠れないよう、画面のまん中までスクロールしてから押す
  await button(page, name).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  const box = (await button(page, name).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  return box;
}

/** 長押しで持ち上げて、区分の上まで動かす（離さない） */
async function liftTo(page: Page, name: string, slot: string) {
  const from = await press(page, name);
  const to = (await slotOf(page, slot).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, { steps: 12 });
}

async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

test('長押しのメニューから別の区分へ移す → 元に戻す → もう一度移すと、開き直しても新しい区分のまま', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await recordNumbers(page, '夕食', 'プロテインバー', '200');
  await expect(slotOf(page, 'dinner').getByRole('button', { name: 'プロテインバーを開く' })).toBeVisible();

  // 動かさずに離すと、メニュー。今の区分（夕食）のほかの 3 つ
  await press(page, 'プロテインバーを開く');
  await page.mouse.up();
  await expect(page.getByTestId('meal-move-sheet').filter({ visible: true })).toBeVisible();
  await expect(button(page, '朝食へ移す')).toBeVisible();
  await expect(button(page, '昼食へ移す')).toBeVisible();
  await expect(button(page, '夕食へ移す')).toHaveCount(0);
  await button(page, '間食へ移す').click();

  await expect(slotOf(page, 'snack').getByRole('button', { name: 'プロテインバーを開く' })).toBeVisible();
  await expect(see(page, '夕食はまだ記録していません')).toBeVisible();
  await expect(notice(page)).toContainText('「プロテインバー」を間食へ移しました');

  // 元に戻す
  await button(page, '「プロテインバー」を間食へ移しました。元に戻す').click();
  await expect(slotOf(page, 'dinner').getByRole('button', { name: 'プロテインバーを開く' })).toBeVisible();
  await expect(see(page, '間食はまだ記録していません')).toBeVisible();
  await expect(notice(page)).toHaveCount(0);

  // もう一度移して、開き直す
  await press(page, 'プロテインバーを開く');
  await page.mouse.up();
  await button(page, '間食へ移す').click();
  await expect(slotOf(page, 'snack').getByRole('button', { name: 'プロテインバーを開く' })).toBeVisible();
  // 知らせは書いて読み直したあとに出る（書き終える前に開き直さない）
  await expect(notice(page)).toBeVisible();
  await page.reload();
  await goTab(page, '食事');
  await expect(slotOf(page, 'snack').getByRole('button', { name: 'プロテインバーを開く' })).toBeVisible();
  await expect(see(page, '夕食はまだ記録していません')).toBeVisible();
});

test('メニューの「開いて直す」で詳細を開く。押すだけなら（長押しでなければ）詳細を開き、移さない', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await recordNumbers(page, '朝食', 'バナナ', '90');
  await press(page, 'バナナを開く');
  await page.mouse.up();
  await button(page, '開いて直す').click();
  await expect(button(page, 'この食事を消す')).toBeVisible();
});

for (const look of ['hud', 'classic'] as const) {
  test(`ドラッグ（${look === 'hud' ? 'HUD' : 'クラシック'}）：長押しで持ち上げて区分の上へ動かすと受け皿が光り、離すと移る。元の区分の上で離すと移さない`, async ({ page }) => {
    if (look === 'classic') await page.addInitScript(() => localStorage.setItem('appearance.look', 'classic'));
    await openApp(page);
    await goTab(page, '食事');
    await recordNumbers(page, '朝食', 'ヨーグルト', '120');
    await recordNumbers(page, '夕食', 'ナッツ', '180');

    // 元の区分の上で離すと移さない
    await liftTo(page, 'ナッツを開く', 'dinner');
    await expect(page.getByTestId('meal-drop-target')).toHaveCount(0);
    await page.mouse.up();
    await expect(slotOf(page, 'dinner').getByRole('button', { name: 'ナッツを開く' })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);

    // 間食の上へ。受け皿が光る
    await liftTo(page, 'ナッツを開く', 'snack');
    await expect(slotOf(page, 'snack').getByTestId('meal-drop-target')).toBeVisible();
    await shot(page, `meal-move-${look}-lifted`);
    await page.mouse.up();
    await expect(slotOf(page, 'snack').getByRole('button', { name: 'ナッツを開く' })).toBeVisible();
    await expect(see(page, '夕食はまだ記録していません')).toBeVisible();
    await expect(notice(page)).toContainText('「ナッツ」を間食へ移しました');
    await expect(page.getByTestId('meal-drop-target')).toHaveCount(0);
    await shot(page, `meal-move-${look}-moved`);

    // 上の区分（朝食）へも動かせる。合計は変わらない（移すだけ）
    await liftTo(page, 'ナッツを開く', 'breakfast');
    await page.mouse.up();
    await expect(slotOf(page, 'breakfast').getByRole('button', { name: 'ナッツを開く' })).toBeVisible();
    await expect(slotOf(page, 'breakfast')).toContainText('300 kcal');
  });
}
