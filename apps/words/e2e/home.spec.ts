import { expect, test } from '@playwright/test';
import { button, byTest, capture, openApp } from './helpers';

// ホーム（書き留める欄・今週の一文と落款・今日の手札・手札を聞く・最近拾った）と、ホームから記録・聞くへの移動。
// 今週の数の計算は jest（lib/__tests__/home.test.ts）。テストの「今」は 2026-11-18（水）で、週は 11/16 から

test('何も拾っていないときは、責めない一文だけ。落款・手札・聞く・最近拾ったは出さない', async ({ page }) => {
  await openApp(page);
  await expect(byTest(page, 'home-week-line')).toHaveText('今週はまだ。拾ったら、ここに並びます');
  await expect(byTest(page, 'home-week-seals')).toHaveCount(0);
  await expect(byTest(page, 'home-hand')).toHaveCount(0);
  await expect(byTest(page, 'home-listen')).toHaveCount(0);
  await expect(byTest(page, 'home-recent')).toHaveCount(0);
  // 書き留める欄は、ことばの欄と「拾う」「AI で拾う」だけ。書き始めると場所・題が開く
  await expect(byTest(page, 'capture-title')).toHaveCount(0);
  await expect(byTest(page, 'ai-capture')).toBeVisible();
  await byTest(page, 'capture-text').fill('一目置く');
  await expect(byTest(page, 'capture-title')).toBeVisible();
});

test('拾うと今週の一文・今日の手札・最近拾ったに出る。使えたで落款が押される。押すと記録・聞くへ移る', async ({ page }) => {
  await openApp(page);
  await capture(page, { text: '腑に落ちる', source: 'Kindle', title: '舟を編む', want: true });
  await capture(page, { text: '一目置く', source: 'Audible' });

  await expect(byTest(page, 'home-week-line')).toHaveText('今週は 2 語。使えた 0。');
  await expect(byTest(page, 'home-week-seals')).toHaveCount(0);
  await expect(byTest(page, 'home-hand-card')).toHaveCount(1);
  await expect(byTest(page, 'home-hand-card')).toContainText('腑に落ちる');
  // 最近拾った（出会った場所つき。テストの時計は止めてあり、同じ時刻なので並びは確かめない）
  await expect(byTest(page, 'recent-row')).toHaveCount(2);
  await expect(byTest(page, 'recent-row').filter({ hasText: '一目置く' })).toContainText('Audible');
  await expect(byTest(page, 'recent-row').filter({ hasText: '腑に落ちる' })).toContainText('Kindle');
  // 聞くの数は、聞くの並び（手札と最近拾ったもの）と同じ
  await expect(byTest(page, 'home-listen')).toHaveText('手札を聞く（2 語・約 1 分）');

  // 今日の手札から詳細を開いて、使えたを押す
  await byTest(page, 'home-hand-card').click();
  await byTest(page, 'used').click();
  await expect(byTest(page, 'word-notice')).toHaveText('使えた、を記録しました');
  await button(page, '戻る').click();
  await expect(byTest(page, 'home-week-line')).toHaveText('今週は 2 語。使えた 1。');
  await expect(byTest(page, 'home-week-seals').getByTestId('seal')).toHaveCount(1);

  // 今週の一文を押すと記録へ（同じ計算の数）
  await byTest(page, 'home-week').click();
  await expect(byTest(page, 'records-screen')).toBeVisible();
  await expect(byTest(page, 'records-lead')).toHaveText('今週は 2 語。これまでに 2 語、拾っています');
  await expect(byTest(page, 'records-uses')).toHaveText('使えた 1 回 · 自分の言葉 0 語');
  await button(page, '戻る').click();

  // 最近拾ったを押すと詳細
  await byTest(page, 'recent-row').filter({ hasText: '一目置く' }).click();
  await expect(byTest(page, 'word-text')).toHaveText('一目置く');
  await button(page, '戻る').click();

  // 手札を聞くを押すと聞くへ（並びの数がそろう）
  await byTest(page, 'home-listen').click();
  await expect(byTest(page, 'listen-screen')).toBeVisible();
  await expect(byTest(page, 'listen-position')).toHaveText('1 / 2');
});
