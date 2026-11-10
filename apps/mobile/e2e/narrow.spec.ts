import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

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
