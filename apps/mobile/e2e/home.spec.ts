import { expect, Page, test } from '@playwright/test';
import { button, goTab, homeCard, openApp, recordFromHome, recordOn, moveToDate, setBodyInfo, TODAY, see, tab } from './helpers';

// 総負荷量・週ごとの棒・日数の計算は jest（lib/__tests__/screen-logic.test.ts の「ホームの数字」）。ここは画面に出ること

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const day = (page: Page, date: string) => page.getByTestId('home-calendar').getByTestId(`day-${date}`);

test('記録がないときのホーム（まっさらなデータから始まる）', async ({ page }) => {
  await openApp(page);
  await expect(see(page, 'November 2026', { exact: true })).toBeVisible();
  // 今日（8日）は塗られ、印はない
  await expect(day(page, TODAY)).toHaveAttribute('aria-label', '11月8日（日） 今日');
  await expect(visible(page, 'archive')).toContainText('0days');
  await expect(visible(page, 'archive')).toContainText('TOTAL0 days');
  for (const id of ['volume-7d', 'volume-28d', 'volume-total']) await expect(visible(page, id)).toContainText('0.00t');
  // 乗り物の倍率は7日間だけ
  await expect(visible(page, 'volume-7d')).toContainText('× 0.0');
  await expect(visible(page, 'volume-28d')).toHaveText('28日間0.00t');
  await expect(visible(page, 'volume-total')).toHaveText('総合計0.00t');
  // 今週の目標（設定の初期値：筋トレ 3回、食事の記録 5日）
  await expect(visible(page, 'goal-training')).toContainText('0／3 回');
  await expect(visible(page, 'goal-meals')).toContainText('0／5 日');
  await expect(see(page, '食事の記録', { exact: true })).toHaveCount(2); // 今週の目標と、カレンダーの凡例
  // 週のまとめがなければ、今週やることは出さない。RM計算機の入口はホームにない
  await expect(visible(page, 'weekly-todo')).toHaveCount(0);
  await expect(button(page, 'RM計算機')).toHaveCount(0);
  // 今日のトレーニング・食事・体調の小さなカード。記録がない日も出す
  await expect(homeCard(page, 'training')).toContainText('今日のトレーニング');
  await expect(homeCard(page, 'training')).toContainText('まだ記録がありません');
  await expect(homeCard(page, 'meals')).toContainText('今日の食事');
  await expect(homeCard(page, 'meals')).toContainText('0 kcal ・ まだ記録がありません');
  await expect(homeCard(page, 'condition')).toContainText('今日の体調');
  await expect(homeCard(page, 'condition')).toContainText('まだ記録がありません');
  await expect(button(page, '記録する')).toBeVisible();

  // 食事のカードは食事のタブ、体調のカードはからだのタブを開く
  await homeCard(page, 'meals').click();
  await expect(tab(page, '食事')).toHaveAttribute('aria-selected', 'true');
  await goTab(page, 'ホーム');
  await homeCard(page, 'condition').click();
  await expect(tab(page, 'からだ')).toHaveAttribute('aria-selected', 'true');
});

test('記録したあとの総負荷量のカード、週ごとの棒、カレンダーの印、今日の記録', async ({ page }) => {
  // 今週（月曜始まり、11/2〜）：スクワット 100×5×3 = 1500kg
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
  await expect(visible(page, 'volume-28d')).toContainText('3.48t');
  await expect(visible(page, 'volume-total')).toContainText('3.48t');

  // 週ごとの棒（週は月曜始まり）：今週 1980 + 1500 = 3480、1週前 0（いちばん長い今週を 100% とする）
  const width = (i: number) => page.getByTestId(`week-bar-${i}`).evaluate((el) => el.style.width);
  expect(await width(0)).toBe('100%');
  expect(parseFloat(await width(1))).toBe(0);

  // カレンダーの印は 11 月の 3 日と 8 日
  await expect(day(page, '2026-11-03')).toHaveAttribute('aria-label', '11月3日（火） 記録あり');
  await expect(day(page, TODAY)).toHaveAttribute('aria-label', '11月8日（日） 今日 記録あり');
  await expect(day(page, '2026-11-04')).toHaveAttribute('aria-label', '11月4日（水）');
  await expect(visible(page, 'archive')).toContainText('2days');
  await expect(visible(page, 'archive')).toContainText('TOTAL2 days');

  // 今日のトレーニングのカード：2種目・4セット・1980kg
  await expect(homeCard(page, 'training')).toContainText('2種目 ・ 4セット ・ 1.98 t');

  // カードを押すと、今日のトレーニングが開く。推定1RM は 80 ×（1 ＋ 8 ÷ 30）= 101.33 → 101.3kg。メモも出る。懸垂は回数だけ
  await homeCard(page, 'training').click();
  await expect(see(page, '今日のトレーニング', { exact: true })).toBeVisible();
  await expect(see(page, '推定1RM 101.3kg')).toBeVisible();
  await expect(see(page, '80.0 kg × 8 回')).toHaveCount(2);
  await expect(see(page, '70.0 kg × 10 回')).toBeVisible();
  await expect(see(page, '最後きつい')).toBeVisible();
  await expect(see(page, '懸垂', { exact: true })).toBeVisible();
  await expect(see(page, '10 回', { exact: true })).toBeVisible();
});

test('「記録する」のシート：食事は時刻から区分を決め、体重はからだのタブで計測のシートを開く。食事の点・目標体重まで・今週の目標', async ({ page }) => {
  await openApp(page);
  await button(page, '記録する').click();
  await expect(see(page, '記録する', { exact: true }).first()).toBeVisible();
  await expect(see(page, '11月8日（日）の記録', { exact: true })).toBeVisible();
  // テストの時刻は朝 10 時なので昼食
  await expect(see(page, '昼食として記録します（時刻から）', { exact: true })).toBeVisible();
  await expect(see(page, '今日の体重や体脂肪率を入れます', { exact: true })).toBeVisible();
  await expect(button(page, 'AI で記録。ChatGPT か Claude を開きます（食事）')).toBeVisible();

  // 食事 → 昼食を選んだ品目の入力
  await page.getByTestId('record-meal').click();
  await expect(see(page, '品目を入力', { exact: true })).toBeVisible();
  await expect(button(page, '昼食')).toHaveAttribute('aria-selected', 'true');
  const field = (label: string) => page.getByRole('textbox', { name: label, exact: true }).filter({ visible: true });
  await field('品目1の品名').fill('白米');
  await field('品目1の量').fill('200');
  await field('品目1のエネルギー').fill('312');
  await button(page, '記録する').click();
  await expect(homeCard(page, 'meals')).toContainText('312 kcal');

  // カレンダーの点と読み上げ、凡例。今週の目標の食事の記録
  await expect(page.getByTestId(`meal-dot-${TODAY}`).filter({ visible: true })).toBeVisible();
  await expect(day(page, TODAY)).toHaveAttribute('aria-label', '11月8日（日） 今日 食事の記録あり');
  await expect(visible(page, 'goal-meals')).toContainText('1／5 日');
  await expect(visible(page, 'goal-meals')).toHaveAttribute('aria-label', '食事の記録 1日、目標 5日');

  // 体重 → からだのタブで計測のシートが開く。保存すると、体調のカードに目標体重までが出る
  await setBodyInfo(page, { goal: '65' });
  await recordFromHome(page, 'body');
  await expect(tab(page, 'からだ')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '体重', exact: true }).fill('68.4');
  await button(page, '保存').click();
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toBeHidden();
  await goTab(page, 'ホーム');
  await expect(homeCard(page, 'condition')).toContainText('体重 68.4 kg');
  await expect(homeCard(page, 'condition')).toContainText('目標まで あと 3.4 kg');

  // もう一度開いても、その日の値を入れた計測のシートが開く（からだのタブで前の日を見ていても、その日に戻す）
  await goTab(page, 'からだ');
  await button(page, '前の日').click();
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  await goTab(page, 'ホーム');
  await recordFromHome(page, 'body');
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toHaveValue('68.4');
  await page.getByRole('textbox', { name: '体重', exact: true }).fill('65');
  await button(page, '保存').click();
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toBeHidden();
  await goTab(page, 'ホーム');
  await expect(homeCard(page, 'condition')).toContainText('目標に届きました');

  // 筋トレを記録すると、今週の目標の筋トレが増える
  await recordOn(page, TODAY, [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  await expect(visible(page, 'goal-training')).toContainText('1／3 回');
});
