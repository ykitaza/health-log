import { expect, test } from '@playwright/test';
import { button, openApp, openMealWeek, see, tab, TabName } from './helpers';
import { bulkPhase, EXERCISE, openWith, workout } from './seed';

// 412 より狭い画面（360×800 など）での崩れ
test.use({ viewport: { width: 360, height: 800 } });

test('360 の幅でも、ホームの計器の段・LOG・部位の量の文字がはみ出さない', async ({ page }) => {
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
  // 部位の量：6 つの行（部位・セット数・週あたり・目安との差）が枠の中に収まり、どの文字も省略されない
  const parts = (await page.getByTestId('home-parts').boundingBox())!;
  for (const name of ['胸', '肩', '背中', '腕', '脚', '腹']) {
    const row = page.getByTestId(`home-parts-body-row-${name}`);
    const box = (await row.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(parts.x);
    expect(box.x + box.width).toBeLessThanOrEqual(parts.x + parts.width);
    const clipped = await row.evaluate((el) => [...el.querySelectorAll('div')].some((d) => d.children.length === 0 && d.textContent !== '' && d.scrollWidth > d.clientWidth));
    expect(clipped, `${name} の行の文字が省略されている`).toBe(false);
  }
});

test('360 の幅でも、部位の量の行は、いちばん長い文字（3 桁のセット数・「目安より多い」・「あと9.7」）と長いフェーズの名前でも収まり、体の札は 4 つでも四隅と重ならない', async ({ page, context }) => {
  test.setTimeout(150_000);
  await openWith(page, context, [
    bulkPhase('ffffffff-0000-4000-8000-000000000031', '2026-10-12', '2026-12-06', { name: '夏までに体を作る長い名前の増量フェーズ（第 2 期）' }),
    ...workout('2026-10-20', EXERCISE.curl, 120), ...workout('2026-11-07', EXERCISE.pullUp, 1), ...workout('2026-11-06', EXERCISE.bench, 20),
    ...workout('2026-11-08', EXERCISE.squat, 3),
  ]);
  const card = page.getByTestId('home-parts').filter({ visible: true });
  const parts = (await card.boundingBox())!;
  expect(parts.x + parts.width).toBeLessThanOrEqual(360);
  // 長いフェーズの名前は見出しで 1 行に縮む（…）。行の文字は省略されない
  await expect(card.getByRole('heading')).toContainText('夏までに');
  for (const name of ['胸', '肩', '背中', '腕', '脚', '腹']) {
    const row = card.getByTestId(`home-parts-body-row-${name}`);
    const box = (await row.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(parts.x + parts.width);
    const clipped = await row.evaluate((el) => [...el.querySelectorAll('div')].some((d) => d.children.length === 0 && d.textContent !== '' && d.scrollWidth > d.clientWidth));
    const info = await row.evaluate((el) => [...el.querySelectorAll('div')].filter((d) => d.children.length === 0 && d.textContent !== '').map((d) => `${d.textContent}:${d.scrollWidth}/${d.clientWidth}`).join(' '));
    expect(clipped, `${name} の行の文字が省略されている ${info}`).toBe(false);
  }
  await expect(card.getByTestId('home-parts-body-row-腕')).toContainText('目安より多い');
  // 体の札：部位の量にして、1 つ押して足しても（4 つ）、四隅の数字・切り替えと重ならない
  const mode = page.getByTestId('hero-body-mode').filter({ visible: true });
  await mode.getByRole('button', { name: '部位の量', exact: true }).click();
  const press = page.getByTestId('day-body-2d-press-front').filter({ visible: true });
  const figure = (await press.boundingBox())!;
  await press.click({ position: { x: figure.width * 0.42, y: figure.height * 0.225 } }); // 胸（先頭の 3 つは肩・腕・腹）
  const tags = page.getByTestId('hero-body-tag').filter({ visible: true });
  await expect(tags).toHaveCount(4);
  const corners = await Promise.all(['home-latest', 'home-latest-ex', 'home-latest-load', 'home-latest-pr', 'hero-body-mode'].map(async (id) => (await page.getByTestId(id).filter({ visible: true }).boundingBox())!));
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height - 8 && b.y + 8 < a.y + a.height; // 四隅の押せる枠の余白（8px）は札が入ってよい
  for (let i = 0; i < 4; i++) {
    const box = (await tags.nth(i).boundingBox())!;
    for (const c of corners) expect(overlaps(box, c), `札 ${i} が四隅・切り替えと重なる ${JSON.stringify(box)} ${JSON.stringify(corners)}`).toBe(false);
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
