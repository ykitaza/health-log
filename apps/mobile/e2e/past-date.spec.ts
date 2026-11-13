import { expect, Page, test } from '@playwright/test';
import {
  button, chooseExercise, expectTrainingDay, fillSets, goTab, homeCard, homeLatest, openApp, openTrainingTrend, saveButton, see, TODAY, trendDay,
} from './helpers';

// ホームの LOG（直近 4 週の方眼）で過去の日を選んで記録する流れ。日付の計算（前回・自己ベスト・選べる日）は jest で確かめる
const day = (page: Page, date: string) => page.getByTestId(`log-${date}`).filter({ visible: true });

test('過去の日を選んで記録すると、その日に出て、今日には出ず、推移に出る', async ({ page }) => {
  await openApp(page);
  await day(page, '2026-11-03').click();
  await expect(day(page, '2026-11-03')).toHaveAttribute('aria-selected', 'true');
  await expect(see(page, '11月3日（火）を表示しています')).toBeVisible();
  await expect(homeCard(page, 'condition')).toContainText('11月3日の体調');
  await expect(day(page, '2026-11-03')).toHaveAccessibleName('11月3日（火）、筋トレなし');

  // 「記録する」のシートは、選んだ日の記録
  await button(page, '記録する').click();
  await expect(see(page, '11月3日（火）の記録', { exact: true })).toBeVisible();
  await expect(see(page, '区分を選んで記録します', { exact: true })).toBeVisible();
  await expect(see(page, '11月3日の体重や体脂肪率を入れます', { exact: true })).toBeVisible();
  // 筋トレのタブの「記録」がその日で開く
  await page.getByTestId('record-training').click();
  await expectTrainingDay(page, '11月3日（火）');
  await expect(see(page, '今日ではない日を見ています')).toBeVisible();
  await button(page, '種目を追加').click();
  await expect(see(page, '11月3日（火）に記録', { exact: true })).toBeVisible();
  await chooseExercise(page, 'ベンチプレス');
  await expect(see(page, '胸 ・ 11月3日（火）の1種目目')).toBeVisible();
  await expect(see(page, '過去の日（11月3日（火））に記録しています')).toBeVisible();
  await fillSets(page, [{ weight: '80', reps: '8' }]);
  await expect(saveButton(page)).toHaveText('この日のトレーニングに追加');
  await saveButton(page).click();
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
  await expectTrainingDay(page, '11月3日（火）');
  await goTab(page, 'ホーム');

  // ホーム：LOG のその日のマスに出て、ヒーローの LATEST（直近のトレーニング）もその日
  await expect(homeCard(page, 'condition')).toContainText('11月3日の体調');
  await expect(day(page, '2026-11-03')).toHaveAccessibleName('11月3日（火）、筋トレ 0.64トン 胸');
  await expect(homeLatest(page)).toHaveAttribute('aria-label', /^直近のトレーニング 11月3日（火）。1種目 1セット 0\.64トン/);

  // 今日に戻ると、今日の記録には出ない
  await button(page, '今日に戻る').click();
  await expect(homeCard(page, 'condition')).toContainText('今日の体調');
  await expect(day(page, TODAY)).toHaveAttribute('aria-selected', 'true');
  await expect(day(page, TODAY)).not.toHaveAccessibleName(/筋トレ 0/);

  // 筋トレの推移：種目を選ぶとその日のカードが出て、押すと記録のタブのその日。そこから同じ日に足せる
  await goTab(page, '筋トレ');
  await button(page, '今日に戻る').click();
  await openTrainingTrend(page);
  await button(page, 'ベンチプレス').click();
  await expect(trendDay(page, '2026-11-03')).toContainText('ベンチプレス');
  await trendDay(page, '2026-11-03').click();
  await expectTrainingDay(page, '11月3日（火）');
  await button(page, '種目を追加').click();
  await expect(see(page, '11月3日（火）に記録', { exact: true })).toBeVisible();
});

test('未来の日は選べず、URL で開いても記録できない', async ({ page }) => {
  // 木曜を今日にする（LOG の今週の金〜日が未来の日）
  await openApp(page, '2026-11-05');
  await expect(day(page, '2026-11-06')).toHaveAttribute('aria-disabled', 'true');
  await expect(day(page, '2026-11-06')).toHaveAccessibleName('11月6日（金）、これから');
  // 右下の「記録する」に重ならない高さまでスクロールしてから押す
  await day(page, '2026-11-06').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await day(page, '2026-11-06').click({ force: true });
  await expect(homeCard(page, 'condition')).toContainText('今日の体調');
  // 「記録する」は今日の記録のまま
  await button(page, '記録する').click();
  await expect(see(page, '11月5日（木）の記録', { exact: true })).toBeVisible();

  // 前のその日の画面の URL で未来の日を開くと、筋トレのタブの今日になる
  await page.goto('/workout?date=2026-11-20');
  await expectTrainingDay(page, '11月5日（木）');
  await expect(button(page, '次の日')).toHaveAttribute('aria-disabled', 'true');
  // 種目の選択を URL で直接開いても、未来の日には記録できない
  await page.goto('/workout/select?date=2026-11-20');
  await expect(see(page, '未来の日には記録できません')).toBeVisible();
});
