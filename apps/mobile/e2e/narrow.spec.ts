import { expect, test } from '@playwright/test';
import { button, openApp, openMealWeek, see } from './helpers';

// 412 より狭い画面（360×800 など）での崩れ
test.use({ viewport: { width: 360, height: 800 } });

test('360 の幅でも、ホームのカレンダーが負荷量のカードに潜らない', async ({ page }) => {
  await openApp(page);
  const calendar = page.getByTestId('home-calendar');
  const saturday = calendar.getByTestId('day-2026-11-07');
  const volume = page.getByTestId('volume-week');
  const sat = (await saturday.boundingBox())!;
  const vol = (await volume.boundingBox())!;
  expect(sat.x + sat.width).toBeLessThanOrEqual(vol.x);
  // 日付の丸は正円のまま
  expect(Math.abs(sat.width - sat.height)).toBeLessThan(1);
});

test('360 の幅でも、食事の推移の週（いちばん長い「10月26日〜11月1日」）がカレンダーのアイコンと1行に収まる', async ({ page }) => {
  await openApp(page);
  await openMealWeek(page);
  await button(page, '前の週').click();
  const label = see(page, '10月26日〜11月1日', { exact: true });
  await expect(label).toBeVisible();
  const box = (await label.boundingBox())!;
  const picker = (await button(page, '日を選ぶ（10月26日〜11月1日）').boundingBox())!;
  const next = (await button(page, '次の週').boundingBox())!;
  // 1行（titleM の行の高さ 24）で、次の週のボタンに重ならない
  expect(box.height).toBeLessThan(30);
  expect(picker.x + picker.width).toBeLessThanOrEqual(next.x);
});
