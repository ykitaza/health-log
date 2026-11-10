import { expect, Page, test } from '@playwright/test';
import { button, chooseExercise, fillSets, homeCard, openApp, openTrainingTrend, saveButton, see, TODAY, trendDay } from './helpers';

// ホームのカレンダーで過去の日を選んで記録する流れ。日付の計算（前回・自己ベスト・選べる日）は jest で確かめる
const day = (page: Page, date: string) => page.getByTestId('home-calendar').getByTestId(`day-${date}`);

test('過去の日を選んで記録すると、その日に出て、今日には出ず、推移に出る', async ({ page }) => {
  await openApp(page);
  await day(page, '2026-11-03').click();
  await expect(day(page, '2026-11-03')).toHaveAttribute('aria-selected', 'true');
  await expect(see(page, '11月3日（火）を表示しています')).toBeVisible();
  await expect(homeCard(page, 'training')).toContainText('11月3日のトレーニング');
  await expect(homeCard(page, 'training')).toContainText('まだ記録がありません');
  await expect(homeCard(page, 'meals')).toContainText('11月3日の食事');

  // 「記録する」のシートは、選んだ日の記録
  await button(page, '記録する').click();
  await expect(see(page, '11月3日（火）の記録', { exact: true })).toBeVisible();
  await expect(see(page, '区分を選んで記録します', { exact: true })).toBeVisible();
  await expect(see(page, '11月3日の体重や体脂肪率を入れます', { exact: true })).toBeVisible();
  await page.getByTestId('record-training').click();
  await expect(see(page, '11月3日（火）', { exact: true })).toBeVisible();
  await expect(see(page, '過去の日（11月3日（火））に記録しています')).toBeVisible();
  await button(page, '種目を追加').click();
  await expect(see(page, '11月3日（火）に記録', { exact: true })).toBeVisible();
  await chooseExercise(page, 'ベンチプレス');
  await expect(see(page, '胸 ・ 11月3日（火）の1種目目')).toBeVisible();
  await expect(see(page, '過去の日（11月3日（火））に記録しています')).toBeVisible();
  await fillSets(page, [{ weight: '80', reps: '8' }]);
  await expect(saveButton(page)).toHaveText('この日のトレーニングに追加');
  await saveButton(page).click();
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
  await button(page, '戻る').click();

  // ホーム：選んだ日に出て、カレンダーに印が付く
  await expect(homeCard(page, 'training')).toContainText('11月3日のトレーニング');
  await expect(homeCard(page, 'training')).toContainText('1種目 ・ 1セット ・ 0.64 t');
  await expect(day(page, '2026-11-03')).toHaveAttribute('aria-label', '11月3日（火） 記録あり');

  // 今日に戻ると、今日の記録には出ない
  await button(page, '今日に戻る').click();
  await expect(homeCard(page, 'training')).toContainText('今日のトレーニング');
  await expect(homeCard(page, 'training')).toContainText('まだ記録がありません');
  await expect(day(page, TODAY)).toHaveAttribute('aria-selected', 'true');

  // 筋トレの推移：その日のカードが出て、押すとその日のトレーニング。そこから同じ日に足せる
  await openTrainingTrend(page);
  await expect(trendDay(page, '2026-11-03')).toContainText('ベンチプレス');
  await trendDay(page, '2026-11-03').click();
  await expect(see(page, '11月3日（火）', { exact: true })).toBeVisible();
  await button(page, '種目を追加').click();
  await expect(see(page, '11月3日（火）に記録', { exact: true })).toBeVisible();
});

test('未来の日は選べず、開いても記録できない', async ({ page }) => {
  await openApp(page);
  await expect(day(page, '2026-11-20')).toHaveAttribute('aria-disabled', 'true');
  await day(page, '2026-11-20').click({ force: true });
  await expect(homeCard(page, 'training')).toContainText('今日のトレーニング');
  // 「記録する」は今日の記録のまま
  await button(page, '記録する').click();
  await expect(see(page, '11月8日（日）の記録', { exact: true })).toBeVisible();

  // URL で直接開いても、種目を足せない
  await page.goto('/workout?date=2026-11-20');
  await expect(see(page, '未来の日には記録できません')).toBeVisible();
  await expect(button(page, '種目を追加')).toHaveAttribute('aria-disabled', 'true');
});
