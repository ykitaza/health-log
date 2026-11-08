import { expect, test } from '@playwright/test';
import { button, openApp, openBody, openSettings, see } from './helpers';

// 取り込みのロジック（差分・トークン・ID・手入力が先・範囲）は jest（db/__tests__/healthConnect.test.ts）。
// web では Health Connect を使わないので、ここは画面が壊れずに開けて、Android だけと出ることだけを見る

test('Health Connect の画面：web では「Android だけ」と出て、連携できない。説明の画面が開ける', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await openBody(page);
  await openSettings(page);
  await page.getByRole('button', { name: /^Health Connect/ }).click();
  await expect(see(page, '連携していません')).toBeVisible();
  await expect(page.getByTestId('hc-unsupported')).toHaveText('Health Connect は Android だけで使えます。');
  await expect(button(page, '連携する')).toBeDisabled();

  await page.getByRole('button', { name: /^読むもの・送る先・見られる人/ }).click();
  await expect(see(page, 'Health Connect の使い方')).toBeVisible();
  await expect(see(page, /心拍数は、1日ごとのまとめ/)).toBeVisible();
  await expect(see(page, /Claude・ChatGPT の MCP/)).toBeVisible();
  await button(page, '戻る').click();
  await expect(see(page, '連携していません')).toBeVisible();

  // リンク（Health Connect の権限の画面から開くときと同じ道）で直接開いても出る
  await page.goto('/health-privacy');
  await expect(see(page, 'Health Connect の使い方')).toBeVisible();
  expect(errors).toEqual([]);
});
