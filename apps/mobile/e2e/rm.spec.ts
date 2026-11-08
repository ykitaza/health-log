import { expect, Page, test } from '@playwright/test';
import { button, chooseUnit, openApp, openSettings, see } from './helpers';

async function openRm(page: Page) {
  await openApp(page);
  await button(page, 'RM計算機').click();
  await expect(see(page, '計算式：重量 ×（1 ＋ 回数 ÷ 30）')).toBeVisible();
}

/** 推定1RM の大きな数字 */
const oneRm = (page: Page) => see(page, '推定1RM', { exact: true }).locator('..');

async function input(page: Page, weight: string, reps: string) {
  await page.getByRole('textbox', { name: /^重量（/ }).fill(weight);
  await page.getByRole('textbox', { name: '回数', exact: true }).fill(reps);
}

test('正常な値：推定1RM と割合の表', async ({ page }) => {
  await openRm(page);
  await expect(page.getByRole('tablist')).toBeHidden();
  await input(page, '100', '5');
  // 100 ×（1 ＋ 5 ÷ 30）= 116.67
  await expect(oneRm(page)).toContainText('116.7kg');
  // 95%〜70%
  for (const [pct, w, reps] of [[95, '110.8', 2], [90, '105.0', 4], [85, '99.2', 6], [80, '93.3', 8], [75, '87.5', 10], [70, '81.7', 12]] as const) {
    await expect(see(page, `${pct}%`, { exact: true }).locator('..')).toContainText(`${pct}%${w} kg${reps}回`);
  }
  // 小数の重量
  await input(page, '62.5', '8');
  await expect(oneRm(page)).toContainText('79.2kg'); // 62.5 × 1.2667 = 79.17
});

test('空、0、負の数、回数が小数なら「—」', async ({ page }) => {
  await openRm(page);
  await expect(oneRm(page)).toContainText('—');
  await expect(see(page, '—', { exact: true })).toHaveCount(7); // 大きな数字と表の6行
  for (const [w, r] of [['', '5'], ['100', ''], ['0', '5'], ['100', '0'], ['-100', '5'], ['100', '-5'], ['abc', '5'], ['100', '2.5']]) {
    await input(page, w, r);
    await expect(oneRm(page), `${w} × ${r}`).toContainText('—');
  }
});

test('回数が1のとき（Epley 式のまま 1 ＋ 1 ÷ 30 を掛ける）', async ({ page }) => {
  // 回数が1なら重量そのものを 1RM とする計算機も多い。今は式のまま 103.3 になる（仕様の判断が要るものとして報告）
  await openRm(page);
  await input(page, '100', '1');
  await expect(oneRm(page)).toContainText('103.3kg');
});

test('単位は設定に従う', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await chooseUnit(page, 'lb');
  await button(page, '戻る').click();
  await button(page, 'RM計算機').click();
  await expect(page.getByRole('textbox', { name: '重量（lb）' })).toBeVisible();
  await input(page, '225', '5');
  await expect(oneRm(page)).toContainText('262.5lb');
  await button(page, '戻る').click();
  await expect(see(page, 'トレログ', { exact: true })).toBeVisible();
});
