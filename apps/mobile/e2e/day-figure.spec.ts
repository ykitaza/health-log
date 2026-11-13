import { expect, Locator, Page, test } from '@playwright/test';
import { addEntry, button, goTab, moveToDate, openApp, recordOn, see, TODAY } from './helpers';

// 記録の画面の体の図：種目ごとの札（EX-01・種目・いちばん重いセット）と引き出し線、記録のない日の前回の図、図の部位から記録。
// 札の並べ方（左右・ずらし・「+N」）と、筋肉 → 部位の逆引きは jest（lib/__tests__/dayCallouts.test.ts）。
// ここは画面に出ること、360 と 412 の幅で札が図とカードに重ならないこと、押して種目の選択に進むこと
const SHOTS = process.env.FIGURE_SHOTS;

const box = async (l: Locator) => (await l.boundingBox())!;
const visible = (l: Locator) => l.filter({ visible: true });

/** 札がカードの中に収まり、前と後ろの図の上に重ならない（線は図の上へ伸びる） */
async function expectCalloutsFit(page: Page, figure: Locator) {
  const card = await box(figure);
  const figs = await Promise.all(['front', 'back'].map(async (v) => box(figure.getByTestId(new RegExp(`-press-${v}$`)))));
  const callouts = await figure.getByTestId(/^day-callout/).all();
  expect(callouts.length).toBeGreaterThan(0);
  const rects = await Promise.all(callouts.map(box));
  for (const r of rects) {
    expect(r.x).toBeGreaterThanOrEqual(card.x - 0.5);
    expect(r.x + r.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    expect(r.y + r.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
    for (const f of figs) expect(r.x + r.width <= f.x + 0.5 || r.x >= f.x + f.width - 0.5).toBe(true);
  }
  // 同じ側の札は重ならない
  for (const [i, a] of rects.entries()) {
    for (const b of rects.slice(i + 1)) {
      if (Math.abs(a.x - b.x) > 1) continue;
      expect(a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5).toBe(true);
    }
  }
}

for (const width of [360, 412]) {
  test.describe(`${width} の幅`, () => {
    test.use({ viewport: { width, height: 915 } });

    test('種目が 2 つの日と 6 つの日：札と番号、多い日は「+N」。読み上げは番号・種目・部位', async ({ page }) => {
      await openApp(page);
      await goTab(page, '筋トレ');
      await addEntry(page, 'ベンチプレス', [{ weight: '70', reps: '10' }, { weight: '80', reps: '8' }]);
      await addEntry(page, '懸垂', [{ reps: '10' }]);
      const figure = visible(page.getByTestId('day-parts-figure'));
      await expect(figure).toHaveAttribute('aria-label', '鍛えた部位の図。1 ベンチプレス 胸、2 懸垂 背中');
      // 前の図の胸の札は左、後ろの図の背中の札は右
      const bench = figure.getByTestId('day-callout').filter({ hasText: 'EX-01' });
      await expect(bench).toContainText('ベンチプレス');
      await expect(bench).toContainText('80kg × 8');
      const pull = figure.getByTestId('day-callout').filter({ hasText: 'EX-02' });
      await expect(pull).toContainText('10回');
      expect((await box(bench)).x).toBeLessThan((await box(pull)).x);
      await expectCalloutsFit(page, figure);
      if (SHOTS) {
        await figure.locator('..').scrollIntoViewIfNeeded();
        await figure.locator('..').screenshot({ path: `${SHOTS}/record-2-${width}.png` });
        await page.screenshot({ path: `${SHOTS}/record-2-${width}-page.png` });
      }

      // 6 種目（前の図に 5、後ろに 1）：左は 3 つと「+2」
      await addEntry(page, 'インクラインダンベルプレス', [{ weight: '26', reps: '10' }]);
      await addEntry(page, 'ダンベルフライ', [{ weight: '14', reps: '12' }]);
      await addEntry(page, 'ショルダープレス', [{ weight: '40', reps: '10' }]);
      await addEntry(page, 'ライイングトライセプスエクステンション', [{ weight: '30', reps: '12' }]);
      await expect(figure.getByTestId('day-callout')).toHaveCount(4);
      const more = figure.getByTestId('day-callout-more');
      await expect(more).toContainText('+2');
      await expect(more).toContainText('EX-03 EX-04');
      await expectCalloutsFit(page, figure);
      if (SHOTS) {
        await figure.locator('..').scrollIntoViewIfNeeded();
        await figure.locator('..').screenshot({ path: `${SHOTS}/record-6-${width}.png` });
        await page.screenshot({ path: `${SHOTS}/record-6-${width}-page.png` });
      }
    });

    test('記録のない日は前回の図（控えめな緑・札・同じメニューで始める）。一度も記録がない日は空の体', async ({ page }) => {
      await openApp(page);
      await goTab(page, '筋トレ');
      const empty = visible(page.getByTestId('empty-figure'));
      await expect(empty).toHaveAttribute('aria-label', '体の図');
      await expect(empty.getByTestId(/^day-callout/)).toHaveCount(0);
      if (SHOTS) {
        await empty.locator('..').scrollIntoViewIfNeeded();
        await empty.locator('..').screenshot({ path: `${SHOTS}/never-${width}.png` });
        await page.screenshot({ path: `${SHOTS}/never-${width}-page.png` });
      }

      await recordOn(page, '2026-11-06', [
        { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] },
        { exercise: 'ラットプルダウン', sets: [{ weight: '50', reps: '10' }] },
      ]);
      await moveToDate(page, TODAY);
      await goTab(page, '筋トレ');
      const menu = visible(page.getByTestId('previous-menu'));
      await expect(menu).toContainText('前回のメニュー');
      await expect(menu).toContainText('LAST SESSION');
      await expect(menu).toContainText('11月6日（金） ・ 胸・背中');
      const figure = visible(page.getByTestId('previous-figure'));
      await expect(figure).toHaveAttribute('aria-label', '前回 11月6日（金）。1 ベンチプレス 胸、2 ラットプルダウン 背中');
      await expect(figure.getByTestId('day-callout')).toHaveCount(2);
      await expectCalloutsFit(page, figure);
      await expect(button(menu, '11月6日（金）と同じメニューで始める')).toBeVisible();
      await expect(visible(page.getByTestId('empty-figure'))).toHaveCount(0);
      if (SHOTS) {
        await menu.scrollIntoViewIfNeeded();
        await menu.screenshot({ path: `${SHOTS}/empty-day-${width}.png` });
        await page.screenshot({ path: `${SHOTS}/empty-day-${width}-page.png` });
      }
    });
  });
}

test('図の筋肉を押すと近い部位のチップが先頭に。チップで、その部位で絞った種目の選択へ（記録のある日も同じ）', async ({ page }) => {
  await openApp(page);
  await goTab(page, '筋トレ');
  const parts = visible(page.getByTestId('empty-figure-parts'));
  await expect(parts).toContainText('部位から記録');
  // 後ろの図のもも裏を押す（図の座標 42, 130 → 66×132 の図で 27.7, 85.8）
  await visible(page.getByTestId('empty-figure-press-back')).click({ position: { x: 27.7, y: 85.8 } });
  await expect(parts).toContainText('押した所の部位から記録');
  const first = parts.getByRole('button').first();
  await expect(first).toHaveAccessibleName('脚の種目を選ぶ');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  expect((await box(first)).height).toBeGreaterThanOrEqual(48);
  await first.click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^スクワット / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^ベンチプレス / })).toHaveCount(0);
  await page.getByRole('button', { name: /^スクワット / }).click();
  await page.getByLabel('セット1の重量', { exact: true }).fill('100');
  await page.getByLabel('セット1の回数', { exact: true }).fill('5');
  await page.getByRole('button', { name: '今日のトレーニングに追加', exact: true }).click();

  // 記録のある日：前の図の胸を押すと胸と肩、チップ（読み上げの入口）でも同じ所へ
  const figure = visible(page.getByTestId('day-parts-figure'));
  await expect(figure).toHaveAttribute('aria-label', '鍛えた部位の図。1 スクワット 脚');
  const dayParts = visible(page.getByTestId('day-parts-figure-parts'));
  await visible(page.getByTestId('day-parts-figure-press-front')).click({ position: { x: 27.5, y: 29.2 } });
  await expect(dayParts.locator('[aria-selected="true"]')).toHaveCount(2);
  await expect(dayParts.getByRole('button').first()).toHaveAccessibleName('胸の種目を選ぶ');
  await button(dayParts, '胸の種目を選ぶ').click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^ベンチプレス / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^スクワット / })).toHaveCount(0);
});
