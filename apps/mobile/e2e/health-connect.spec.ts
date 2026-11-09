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

test('からだの睡眠・心拍の行から推移を開く。記録がなければ「Health Connect をつなぐ」が出て、つなぐ画面へ行ける', async ({ page }) => {
  // 推移の数字（平均・寝た時刻の平均）と期間の読み出しは jest（lib/__tests__/healthTrend.test.ts、db/__tests__/healthConnect.test.ts）
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await openBody(page);
  await expect(page.getByTestId('sleep-day').filter({ visible: true })).toContainText('この日の記録はありません');
  await page.getByRole('button', { name: '睡眠の推移を見る' }).click();
  await expect(see(page, '睡眠の推移', { exact: true })).toBeVisible();
  await expect(see(page, 'まだ記録がありません')).toBeVisible();
  // 期間の切り替えは残す
  await button(page, '3か月').click();
  await expect(button(page, '3か月')).toHaveAttribute('aria-selected', 'true');
  await button(page, 'Health Connect をつなぐ').click();
  await expect(see(page, '連携していません')).toBeVisible();
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  await page.getByRole('button', { name: '安静時心拍の推移を見る' }).click();
  await expect(see(page, '安静時心拍の推移', { exact: true })).toBeVisible();
  await expect(button(page, 'Health Connect をつなぐ')).toBeVisible();
  expect(errors).toEqual([]);
});
