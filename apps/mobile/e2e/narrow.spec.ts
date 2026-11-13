import { expect, test } from '@playwright/test';
import { button, openApp, openMealWeek, see, tab, TabName } from './helpers';

// 412 より狭い画面（360×800 など）での崩れ
test.use({ viewport: { width: 360, height: 800 } });

test('360 の幅でも、ホームの計器の段・LOG・PARTS の文字がはみ出さない', async ({ page }) => {
  await openApp(page);
  // 計器の段の 3 つは横に並び、重ならない
  const [big3, load, sleep] = await Promise.all(['home-big3', 'volume-week', 'home-sleep'].map(async (id) => (await page.getByTestId(id).boundingBox())!));
  expect(big3.x + big3.width).toBeLessThanOrEqual(load.x);
  expect(load.x + load.width).toBeLessThanOrEqual(sleep.x);
  expect(sleep.x + sleep.width).toBeLessThanOrEqual(360);
  // LOG の日曜のマスは方眼の中
  const log = (await page.getByTestId('home-log').boundingBox())!;
  const sunday = (await page.getByTestId('log-2026-11-08').boundingBox())!;
  expect(sunday.x + sunday.width).toBeLessThanOrEqual(log.x + log.width);
  // PARTS の軸の名前が、枠からはみ出さない
  const parts = (await page.getByTestId('home-parts').boundingBox())!;
  for (const name of ['背中', '腹']) {
    const label = (await page.getByTestId('home-parts').locator('text', { hasText: name }).boundingBox())!;
    expect(label.x).toBeGreaterThanOrEqual(parts.x);
    expect(label.x + label.width).toBeLessThanOrEqual(parts.x + parts.width);
  }
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

test('360 の幅でも、下の5つのタブの文字（いちばん長い「レポート」）が切れず1行に収まり、選んだ印がタブの中に入る', async ({ page }) => {
  await openApp(page);
  const names: TabName[] = ['ホーム', '筋トレ', '食事', 'からだ', 'レポート'];
  for (const name of names) {
    const t = (await tab(page, name).boundingBox())!;
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(360);
    // 選んだ印（幅 64）が入る幅
    expect(t.width).toBeGreaterThanOrEqual(64);
    const label = tab(page, name).getByText(name, { exact: true });
    const l = (await label.boundingBox())!;
    expect(l.x).toBeGreaterThanOrEqual(t.x);
    expect(l.x + l.width).toBeLessThanOrEqual(t.x + t.width);
    // 1行（labelM の行の高さ 16）で、はみ出して切れていない
    expect(l.height).toBeLessThan(24);
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});
