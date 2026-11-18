import { expect, test } from '@playwright/test';
import { button, byTest, capture, goTab, openApp } from './helpers';

// 聞くの読み方（設定の速さ・くり返し・間）と、手札の画面の「聞く」（手札だけを流す）。
// web は音を出さず、1 語の長さを読み方から見積もって時計で進める（端末と同じく、準備するときに読み方を読む）

test('設定の読み方を選ぶと残り、聞くで 1 語が長くなる（くり返し 3 回・0.8 倍・長い間）', async ({ page }) => {
  await openApp(page);
  await capture(page, { text: '腑に落ちる', want: true });
  await byTest(page, 'home-settings').click();
  // 既定は 1.0 倍・1 回・ふつう
  await expect(byTest(page, 'pace-speed-1')).toHaveAttribute('aria-selected', 'true');
  await expect(byTest(page, 'pace-repeat-1')).toHaveAttribute('aria-selected', 'true');
  await expect(byTest(page, 'pace-pause-normal')).toHaveAttribute('aria-selected', 'true');
  await byTest(page, 'pace-speed-0.8').click();
  await byTest(page, 'pace-repeat-3').click();
  await byTest(page, 'pace-pause-long').click();
  await expect(byTest(page, 'pace-speed-0.8')).toHaveAttribute('aria-selected', 'true');
  await expect(byTest(page, 'pace-speed-1')).toHaveAttribute('aria-selected', 'false');
  await button(page, '戻る').click();
  // 開き直しても残る
  await byTest(page, 'home-settings').click();
  await expect(byTest(page, 'pace-speed-0.8')).toHaveAttribute('aria-selected', 'true');
  await expect(byTest(page, 'pace-repeat-3')).toHaveAttribute('aria-selected', 'true');
  await expect(byTest(page, 'pace-pause-long')).toHaveAttribute('aria-selected', 'true');
  await button(page, '戻る').click();

  // 既定なら 3 秒ほどで聞き終える語が、くり返し 3 回なら 6 秒たっても鳴っている
  await goTab(page, 'listen');
  await expect(byTest(page, 'listen-position')).toHaveText('1 / 1');
  await byTest(page, 'listen-play').click();
  await expect(byTest(page, 'listen-pause')).toBeVisible();
  await page.waitForTimeout(6000);
  await expect(byTest(page, 'listen-pause')).toBeVisible();
});

test('手札の「聞く」は、手札だけを聞くへ移って最初から鳴らす。「すべてを聞く」でいつもの並びに戻る', async ({ page }) => {
  await openApp(page);
  await capture(page, { text: '肩の荷が下りる', want: true });
  await capture(page, { text: '腑に落ちる', want: true });
  await capture(page, { text: '一目置く' }); // 拾っただけ（いつもの並びには最近拾ったものとして入る）

  await goTab(page, 'listen');
  await expect(byTest(page, 'listen-position')).toHaveText('1 / 3');
  await expect(byTest(page, 'listen-scope-hand')).toHaveCount(0);

  await goTab(page, 'hand');
  await byTest(page, 'start-listen').click();
  await expect(byTest(page, 'listen-screen')).toBeVisible();
  await expect(byTest(page, 'listen-scope-hand')).toContainText('手札だけを聞いています');
  await expect(byTest(page, 'listen-position')).toHaveText('1 / 2');
  await expect(byTest(page, 'listen-pause')).toBeVisible();
  expect(['肩の荷が下りる', '腑に落ちる']).toContain(await byTest(page, 'listen-current').getAttribute('aria-label'));

  await byTest(page, 'listen-pause').click();
  await byTest(page, 'listen-scope-all').click();
  await expect(byTest(page, 'listen-position')).toHaveText('1 / 3');
  await expect(byTest(page, 'listen-scope-hand')).toHaveCount(0);
});
