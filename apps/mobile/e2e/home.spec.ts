import { expect, Page, test } from '@playwright/test';
import { openApp, recordOn, moveToDate, TODAY, see } from './helpers';

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const day = (page: Page, date: string) => page.getByTestId('home-calendar').getByTestId(`day-${date}`);

test('記録がないときのホーム', async ({ page }) => {
  await openApp(page);
  await expect(see(page, 'November 2026', { exact: true })).toBeVisible();
  // 今日（8日）は塗られ、印はない
  await expect(day(page, TODAY)).toHaveAttribute('aria-label', TODAY);
  await expect(visible(page, 'archive')).toContainText('0days');
  await expect(visible(page, 'archive')).toContainText('TOTAL0 days');
  for (const id of ['volume-7d', 'volume-28d', 'volume-total']) {
    await expect(visible(page, id)).toContainText('0.00t');
    await expect(visible(page, id)).toContainText('× 0.0');
  }
  await expect(see(page, 'まだ今日の記録はありません。「本日のトレーニングを追加」から始めましょう。')).toBeVisible();
});

test('記録したあとの数字が手計算と合う', async ({ page }) => {
  // 範囲の外（28日より前）：デッドリフト 120×5 = 600kg
  await recordOn(page, '2026-10-01', [{ exercise: 'デッドリフト', sets: [{ weight: '120', reps: '5' }] }]);
  // 3週前の週（10/18〜）：ベンチ 75×8×2 = 1200kg
  await recordOn(page, '2026-10-20', [{ exercise: 'ベンチプレス', sets: [{ weight: '75', reps: '8' }, { weight: '75', reps: '8' }] }]);
  // 1週前の週（11/1〜）：スクワット 100×5×3 = 1500kg
  await recordOn(page, '2026-11-03', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }, { weight: '100', reps: '5' }, { weight: '100', reps: '5' }] }]);
  // 今日：ベンチ 80×8、80×8、70×10 = 1980kg と、回数だけの懸垂（負荷量は 0）
  await recordOn(page, TODAY, [
    { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }, { weight: '80', reps: '8', memo: '最後きつい' }, { weight: '70', reps: '10' }] },
    { exercise: '懸垂', sets: [{ reps: '10' }] },
  ]);
  await moveToDate(page, TODAY);

  // 7日間（11/2〜11/8）：1980 + 1500 = 3480kg → 3.48t、車 1.5t の 2.32 台
  await expect(visible(page, 'volume-7d')).toContainText('3.48t');
  await expect(visible(page, 'volume-7d')).toContainText('× 2.3');
  // 28日間（10/12〜11/8）：3480 + 1200 = 4680kg → 4.68t、バス 15t の 0.312 台
  await expect(visible(page, 'volume-28d')).toContainText('4.68t');
  await expect(visible(page, 'volume-28d')).toContainText('× 0.3');
  // 総合計：4680 + 600 = 5280kg → 5.28t、ジャンボ機 346t の 0.015 台
  await expect(visible(page, 'volume-total')).toContainText('5.28t');
  await expect(visible(page, 'volume-total')).toContainText('× 0.0');

  // 週ごとの棒：今週 1980、1週前 1500、3週前 1200（いちばん長い今週を 100% とする）
  const width = (i: number) => page.getByTestId(`week-bar-${i}`).evaluate((el) => el.style.width);
  expect(await width(0)).toBe('100%');
  expect(parseFloat(await width(1))).toBeCloseTo((1500 / 1980) * 100, 3);
  expect(parseFloat(await width(2))).toBe(0);
  expect(parseFloat(await width(3))).toBeCloseTo((1200 / 1980) * 100, 3);
  expect(parseFloat(await width(4))).toBe(0);

  // カレンダーの印は 11 月の 3 日と 8 日。今月 2 日、通算 4 日
  await expect(day(page, '2026-11-03')).toHaveAttribute('aria-label', '2026-11-03 記録あり');
  await expect(day(page, TODAY)).toHaveAttribute('aria-label', `${TODAY} 記録あり`);
  await expect(day(page, '2026-11-04')).toHaveAttribute('aria-label', '2026-11-04');
  await expect(visible(page, 'archive')).toContainText('2days');
  await expect(visible(page, 'archive')).toContainText('TOTAL4 days');

  // 今日の記録：推定1RM は 80 ×（1 ＋ 8 ÷ 30）= 101.33 → 101.3kg。メモも出る。懸垂は回数だけ
  await expect(see(page, '推定1RM 101.3kg')).toBeVisible();
  await expect(see(page, '80.0 kg × 8 回')).toHaveCount(2);
  await expect(see(page, '70.0 kg × 10 回')).toBeVisible();
  await expect(see(page, '最後きつい')).toBeVisible();
  await expect(see(page, '懸垂', { exact: true })).toBeVisible();
  await expect(see(page, '10 回', { exact: true })).toBeVisible();

  // 今日の記録を押すと、今日のトレーニングが開く
  await see(page, '懸垂', { exact: true }).click();
  await expect(see(page, '今日のトレーニング', { exact: true })).toBeVisible();
});
