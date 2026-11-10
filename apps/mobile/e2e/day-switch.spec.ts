import { expect, Page, test } from '@playwright/test';
import {
  addEntry, button, expectTrainingDay, goTab, moveToDate, openApp, openMealWeek, recordOn, see, swipe, tab, TODAY,
} from './helpers';

// 筋トレの記録と食事の、日付の切り替え（前の日・次の日、「日を選ぶ」のシート、左右のスワイプ）。
// スワイプの判定（横の動きの大きさと向き）は jest（lib/__tests__/swipe.test.ts）。ここは画面の流れ

const picker = (page: Page) => page.getByTestId('day-picker');
const pickDay = (page: Page, date: string) => picker(page).getByTestId(`day-${date}`);
const trainingArea = (page: Page) => page.getByTestId('training-day').filter({ visible: true });
const mealsArea = (page: Page) => page.getByTestId('meals-day').filter({ visible: true });

test('筋トレの記録：日を選ぶシート（筋トレの日に点、未来は押せない）、前の日・次の日とスワイプ、今日に戻る、過去の日に足す', async ({ page }) => {
  await recordOn(page, '2026-11-05', [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await moveToDate(page, TODAY);
  await goTab(page, '筋トレ');
  await expectTrainingDay(page, '11月8日（日）');

  // 日付を押すと「日を選ぶ」。筋トレをした日に印（読み上げは「記録あり」）、今日より後は押せない
  await button(page, '日を選ぶ（11月8日（日））').click();
  await expect(see(picker(page), '日を選ぶ', { exact: true })).toBeVisible();
  await expect(see(picker(page), '点のある日に筋トレの記録があります')).toBeVisible();
  await expect(see(picker(page), '筋トレをした日：今月 1回')).toBeVisible();
  await expect(pickDay(page, '2026-11-05')).toHaveAttribute('aria-label', '11月5日（木） 記録あり');
  await expect(pickDay(page, '2026-11-09')).toHaveAttribute('aria-disabled', 'true');
  await expect(button(picker(page), '次の月')).toHaveAttribute('aria-disabled', 'true');
  await button(picker(page), '前の月').click();
  await expect(see(picker(page), 'October 2026', { exact: true })).toBeVisible();
  await expect(see(picker(page), '筋トレをした日：10月 0回')).toBeVisible();
  await button(picker(page), '次の月').click();
  // 日を押すとシートが閉じて、その日になる
  await pickDay(page, '2026-11-05').click();
  await expect(picker(page)).toHaveCount(0);
  await expectTrainingDay(page, '11月5日（木）');
  await expect(see(page, '今日ではない日を見ています')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();

  // 左へスワイプで次の日、右へスワイプで前の日。縦の動きでは変わらない
  await swipe(trainingArea(page), 'next');
  await expectTrainingDay(page, '11月6日（金）');
  await expect(see(page, 'まだ種目がありません')).toBeVisible();
  await swipe(trainingArea(page), 'prev');
  await expectTrainingDay(page, '11月5日（木）');
  await swipe(trainingArea(page), 'prev', 200);
  await expectTrainingDay(page, '11月5日（木）');

  // 過去の日にも種目を足せる（記録のタブのその日に戻る）
  await addEntry(page, 'スクワット', [{ weight: '100', reps: '5' }]);
  await expectTrainingDay(page, '11月5日（木）');
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();

  // 今日に戻る。今日から次へは、ボタンでもスワイプでも進まない
  await button(page, '今日に戻る').click();
  await expectTrainingDay(page, '11月8日（日）');
  await expect(see(page, '今日ではない日を見ています')).toHaveCount(0);
  await swipe(trainingArea(page), 'next');
  await expectTrainingDay(page, '11月8日（日）');
  await button(page, '前の日').click();
  await expectTrainingDay(page, '11月7日（土）');
  await button(page, '次の日').click();
  await expectTrainingDay(page, '11月8日（日）');

  // 前のその日の画面の URL（ホームのカードなどが開く）は、記録のタブのその日へ移る
  await page.goto('/workout?date=2026-11-05');
  await expectTrainingDay(page, '11月5日（木）');
  await expect(page.getByRole('button', { name: 'スクワットを直す' })).toBeVisible();
  // 下のタブは押すだけで切り替わり、スワイプでは切り替わらない
  await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');
});

test('食事の記録：日を選ぶシート（食事を記録した日に点）とスワイプ。推移は前の週・次の週へスワイプと、日を選んでその週へ', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();

  // 前の日に1つ記録する（kcal と PFC だけ）
  await button(page, '前の日').click();
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  await button(page, '朝食を記録').click();
  await button(page, 'kcal と PFC だけ').click();
  await page.getByRole('textbox', { name: '品目1のエネルギー', exact: true }).filter({ visible: true }).fill('300');
  await button(page, '記録する').click();
  await expect(page.getByTestId('total-kcal').filter({ visible: true })).toHaveText('300');

  // スワイプで次の日・前の日。今日より先へは進まない
  await swipe(mealsArea(page), 'next');
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();
  await swipe(mealsArea(page), 'next');
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();
  await swipe(mealsArea(page), 'prev');
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();

  // 日付を押すと「日を選ぶ」。食事を記録した日に印
  await button(page, '日を選ぶ（11月7日（土））').click();
  await expect(see(picker(page), '点のある日に食事の記録があります')).toBeVisible();
  await expect(see(picker(page), '食事を記録した日：今月 1日')).toBeVisible();
  await expect(pickDay(page, '2026-11-07')).toHaveAttribute('aria-label', '11月7日（土） 記録あり');
  await expect(pickDay(page, '2026-11-07')).toHaveAttribute('aria-selected', 'true');
  await pickDay(page, '2026-11-02').click();
  await expect(picker(page)).toHaveCount(0);
  await expect(see(page, '11月2日（月）', { exact: true })).toBeVisible();

  // 推移：スワイプで前の週・次の週（今日を最後の日にするところまで）
  await openMealWeek(page);
  const week = page.getByTestId('meals-week').filter({ visible: true });
  await expect(see(page, '11月2日〜11月8日', { exact: true })).toBeVisible();
  await swipe(week, 'prev');
  await expect(see(page, '10月26日〜11月1日', { exact: true })).toBeVisible();
  await swipe(week, 'next');
  await expect(see(page, '11月2日〜11月8日', { exact: true })).toBeVisible();
  await swipe(week, 'next');
  await expect(see(page, '11月2日〜11月8日', { exact: true })).toBeVisible();
  await expect(button(page, '次の週')).toHaveAttribute('aria-disabled', 'true');

  // 推移も日付を押すと「日を選ぶ」。食事を記録した日に点、未来は押せない。選んだ日を含む週（月曜始まり）になる
  await button(page, '日を選ぶ（11月2日〜11月8日）').click();
  await expect(see(picker(page), '点のある日に食事の記録があります')).toBeVisible();
  await expect(pickDay(page, '2026-11-07')).toHaveAttribute('aria-label', '11月7日（土） 記録あり');
  await expect(pickDay(page, '2026-11-09')).toHaveAttribute('aria-disabled', 'true');
  await button(picker(page), '前の月').click();
  await pickDay(page, '2026-10-21').click(); // 水曜
  await expect(picker(page)).toHaveCount(0);
  await expect(see(page, '10月19日〜10月25日', { exact: true })).toBeVisible();
  await expect(see(page, 'この週はまだ記録がありません')).toBeVisible();
  await button(page, '次の週').click();
  await expect(see(page, '10月26日〜11月1日', { exact: true })).toBeVisible();
  // 今週の日を選ぶと、今日を最後の日にした週に戻る
  await button(page, '日を選ぶ（10月26日〜11月1日）').click();
  await expect(see(picker(page), 'November 2026', { exact: true })).toBeVisible(); // 見ている週の最後の日（11/1）の月から
  await pickDay(page, '2026-11-03').click();
  await expect(see(page, '11月2日〜11月8日', { exact: true })).toBeVisible();
  await expect(page.getByTestId('weekly-average-kcal').filter({ visible: true })).toContainText('300');
});
