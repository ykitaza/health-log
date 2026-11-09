import { expect, Page, test } from '@playwright/test';
import { button, chooseExercise, fillSets, goTab, openApp, saveButton, see, TODAY } from './helpers';

// ホームのカレンダーで過去の日を選んで記録する流れ。日付の計算（前回・自己ベスト・選べる日）は jest で確かめる
const day = (page: Page, date: string) => page.getByTestId('home-calendar').getByTestId(`day-${date}`);

test('過去の日を選んで記録すると、その日に出て、今日には出ず、履歴に出る', async ({ page }) => {
  await openApp(page);
  await day(page, '2026-11-03').click();
  await expect(day(page, '2026-11-03')).toHaveAttribute('aria-selected', 'true');
  await expect(see(page, '11月3日の記録', { exact: true })).toBeVisible();
  await expect(see(page, '11月3日（火）の記録はありません。「11月3日のトレーニングを追加」から記録できます。')).toBeVisible();

  await button(page, '11月3日のトレーニングを追加').click();
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
  await expect(see(page, '11月3日の記録', { exact: true })).toBeVisible();
  await expect(see(page, '80.0 kg × 8 回')).toBeVisible();
  await expect(day(page, '2026-11-03')).toHaveAttribute('aria-label', '11月3日（火） 記録あり');

  // 今日に戻ると、今日の記録には出ない
  await button(page, '今日に戻る').click();
  await expect(see(page, '今日の記録', { exact: true })).toBeVisible();
  await expect(see(page, 'まだ今日の記録はありません。「本日のトレーニングを追加」から始めましょう。')).toBeVisible();
  await expect(see(page, '80.0 kg × 8 回')).toHaveCount(0);
  await expect(day(page, TODAY)).toHaveAttribute('aria-selected', 'true');

  // 履歴：その日の記録が出て、そこから同じ日に足せる
  await goTab(page, '履歴／分析');
  await expect(see(page, '11月3日（火） ベンチプレス')).toBeVisible();
  await button(page, '11月3日に種目を追加').click();
  await expect(see(page, '11月3日（火）に記録', { exact: true })).toBeVisible();
});

test('未来の日は選べず、開いても記録できない', async ({ page }) => {
  await openApp(page);
  await expect(day(page, '2026-11-20')).toHaveAttribute('aria-disabled', 'true');
  await day(page, '2026-11-20').click({ force: true });
  await expect(see(page, '今日の記録', { exact: true })).toBeVisible();
  await expect(button(page, '本日のトレーニングを追加')).toBeVisible();

  // URL で直接開いても、種目を足せない
  await page.goto('/workout?date=2026-11-20');
  await expect(see(page, '未来の日には記録できません')).toBeVisible();
  await expect(button(page, '種目を追加')).toHaveAttribute('aria-disabled', 'true');
});
