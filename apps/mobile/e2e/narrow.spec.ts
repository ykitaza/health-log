import { expect, test } from '@playwright/test';
import { button, openApp, openMealWeek, see, tab, TabName } from './helpers';

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
  // 右の列の部位のバランスの軸の名前が、カードからはみ出さない。左右の列の下の端がそろう
  const balance = (await page.getByTestId('home-part-balance').boundingBox())!;
  for (const name of ['背中', '腹']) {
    const label = (await page.getByTestId('home-part-balance').locator('text', { hasText: name }).boundingBox())!;
    expect(label.x).toBeGreaterThanOrEqual(balance.x);
    expect(label.x + label.width).toBeLessThanOrEqual(balance.x + balance.width);
  }
  // 下の端は、読み込みが済んで高さが決まってから比べる（読み込みの途中で2つを測ると、間に高さが変わって食い違う。CI で 74 ずれた）
  await expect.poll(async () => {
    const archive = (await page.getByTestId('archive').boundingBox())!;
    const b = (await page.getByTestId('home-part-balance').boundingBox())!;
    return Math.abs(archive.y + archive.height - (b.y + b.height));
  }).toBeLessThan(1);
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
