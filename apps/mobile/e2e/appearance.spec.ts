import { expect, Page, test } from '@playwright/test';
import { openApp } from './helpers';

// 見た目（HUD・クラシック）の仕組み：theme が最初に評価されるときに見た目を読み、色を選ぶ。web は localStorage の appearance.look。
// 設定の画面はまだない（次の PR）ので、localStorage に直接入れて再読み込みする。色の選び方は jest（theme/__tests__/appearance.test.ts）

const HUD_BG = 'rgb(14, 16, 19)'; // #0E1013
const CLASSIC_BG = 'rgb(18, 20, 19)'; // #121413

/** 画面の地の色（ナビゲーションのテーマと Stack の contentStyle が colors.bg で塗る、body の上のいちばん外の面） */
const screenBg = (page: Page) =>
  page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body, body *'))) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    }
    return null;
  });

test('localStorage の見た目で画面の地の色が変わり、消すと HUD に戻る', async ({ page }) => {
  await openApp(page);
  expect(await screenBg(page)).toBe(HUD_BG);

  await page.evaluate(() => localStorage.setItem('appearance.look', 'classic'));
  await openApp(page);
  expect(await screenBg(page)).toBe(CLASSIC_BG);

  await page.evaluate(() => localStorage.removeItem('appearance.look'));
  await openApp(page);
  expect(await screenBg(page)).toBe(HUD_BG);
});
