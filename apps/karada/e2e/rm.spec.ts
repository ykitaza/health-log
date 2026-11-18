import { expect, Page, test } from '@playwright/test';
import { button, chooseUnit, goTab, openApp, openRm, openSettings, see, tab } from './helpers';

// 推定1RM と割合の表の計算は jest（lib/__tests__/screen-logic.test.ts の「RM計算機」）。ここは画面に出ることと単位

/** 推定1RM の大きな数字 */
const oneRm = (page: Page) => see(page, '推定1RM', { exact: true }).locator('..');

async function input(page: Page, weight: string, reps: string) {
  await page.getByRole('textbox', { name: /^重量（/ }).fill(weight);
  await page.getByRole('textbox', { name: '回数', exact: true }).fill(reps);
}

test('推定1RM と割合の表、不正な値は「—」。単位は設定に従う', async ({ page }) => {
  await openApp(page);
  // 入口は筋トレのタブの右上
  await openRm(page);
  await expect(see(page, '計算式：重量 ×（1 ＋ 回数 ÷ 30）。1回なら重量そのもの')).toBeVisible();
  await expect(page.getByRole('tablist')).toBeHidden();
  await expect(see(page, '—', { exact: true })).toHaveCount(7); // 大きな数字と表の6行

  await input(page, '100', '5');
  // 100 ×（1 ＋ 5 ÷ 30）= 116.67
  await expect(oneRm(page)).toContainText('116.7kg');
  await expect(see(page, '95%', { exact: true }).locator('..')).toContainText('95%110.8 kg2回');
  await expect(see(page, '70%', { exact: true }).locator('..')).toContainText('70%81.7 kg12回');
  await input(page, '100', '2.5');
  await expect(oneRm(page)).toContainText('—');

  await button(page, '戻る').click();
  await openSettings(page);
  await chooseUnit(page, 'lb');
  await button(page, '戻る').click();
  // 単位の保存が終わってから開き直す（ホームの負荷量が lb になる）
  await goTab(page, 'ホーム');
  await expect(page.getByTestId('volume-week').filter({ visible: true })).toContainText('k lb');
  await openRm(page);
  await expect(page.getByRole('textbox', { name: '重量（lb）' })).toBeVisible();
  await input(page, '225', '5');
  await expect(oneRm(page)).toContainText('262.5lb');
  await button(page, '戻る').click();
  await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');
});
