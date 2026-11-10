import { expect, Page, test } from '@playwright/test';
import {
  button, goTab, moveToDate, openApp, openMealWeek, openTrainingTrend, recordOn, recordToday, saveButton, see, tab, TODAY, trendDay,
} from './helpers';

// 総負荷量・推定1RM・増減・自己ベスト・BIG3 の合計・カードの要約の計算は jest（lib/__tests__/screen-logic.test.ts の「履歴の数字」、
// lib/__tests__/training-trend.test.ts）。ここは画面の切り替えと表示

/**
 * 推移のテストのデータ
 * - 9/15  ベンチ 60×10（負荷量 600、推定1RM 80）
 * - 10/20 スクワット 100×5（500、116.7）
 * - 11/5  ベンチ 80×8 ×2（1280、101.3）
 * - 11/8（今日）ベンチ 85×5（425、99.2）と懸垂 10 回
 */
async function seed(page: Page) {
  await recordOn(page, '2026-09-15', [{ exercise: 'ベンチプレス', sets: [{ weight: '60', reps: '10' }] }]);
  await recordOn(page, '2026-10-20', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  await recordOn(page, '2026-11-05', [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }, { weight: '80', reps: '8' }] }]);
  await recordOn(page, TODAY, [
    { exercise: 'ベンチプレス', sets: [{ weight: '85', reps: '5' }] },
    { exercise: '懸垂', sets: [{ reps: '10' }] },
  ]);
  await moveToDate(page, TODAY);
  await openTrainingTrend(page);
}

const day = (page: Page, date: string) => page.getByTestId('history-calendar').getByTestId(`day-${date}`);
const cards = (page: Page) => page.getByTestId(/^trend-day-/).filter({ visible: true });

test('記録がないとき（筋トレと食事）。回数だけの記録しかないときの自己ベストと BIG3', async ({ page }) => {
  await openApp(page);
  await openTrainingTrend(page);
  await expect(see(page, 'まだ記録がありません')).toBeVisible();
  await openMealWeek(page);
  await expect(see(page, 'この週はまだ記録がありません')).toBeVisible();
  await goTab(page, '筋トレ');
  await expect(see(page, 'まだ記録がありません')).toBeVisible();

  await tab(page, 'ホーム').click();
  await recordToday(page, [{ exercise: '懸垂', sets: [{ reps: '10' }] }]);
  await openTrainingTrend(page);
  await button(page, 'グラフ').click();
  await expect(see(page, '重量のある種目の記録がまだありません')).toBeVisible();
  await expect(see(page, '週の平均 0.0t ・ 先週より +0.0t')).toBeVisible();
  // BIG3 は名前で決めた3種目。記録がないので合計は出ない
  await expect(page.getByTestId('big3-missing')).toContainText('ベンチプレス・スクワット・デッドリフトの記録（重量 × 回数）がそろうと合計が出ます');
});

test('記録：日ごとのカードを新しい順に。カレンダーの日で絞る・すべて表示。種目のチップで絞る。カードからその日を直す', async ({ page }) => {
  await seed(page);
  // 種目のチップは1列：すべて、記録のある種目（部位の順）。部位のチップの段はない
  await expect(button(page, 'すべて')).toHaveAttribute('aria-selected', 'true');
  for (const name of ['ベンチプレス', '懸垂', 'スクワット']) await expect(button(page, name)).toBeVisible();
  await expect(button(page, '胸')).toHaveCount(0);
  await expect(button(page, '記録')).toHaveAttribute('aria-selected', 'true');

  await expect(see(page, 'November 2026', { exact: true })).toBeVisible();
  await expect(see(page, '筋トレをした日：今月 2回')).toBeVisible();
  // 全部を新しい順に（10日ずつ。4日なので全部）
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).nth(0)).toHaveAttribute('data-testid', 'trend-day-2026-11-08');
  await expect(cards(page).nth(3)).toHaveAttribute('data-testid', 'trend-day-2026-09-15');
  await expect(page.getByRole('button', { name: /^もっと見る/ })).toHaveCount(0);
  // カード：日付、部位、その日の合計負荷量、種目ごとの要約。BIG3 の印
  const today = trendDay(page, TODAY);
  await expect(today).toContainText('11月8日（日）');
  await expect(today).toContainText('胸');
  await expect(today).toContainText('背中');
  await expect(today).toContainText('0.42 t'); // 425kg（懸垂は体重がないので 0）
  await expect(today).toContainText('ベンチプレスBIG3');
  await expect(today).toContainText('85.0 kg × 5');
  await expect(today).toContainText('10 回');
  await expect(trendDay(page, '2026-11-05')).toContainText('80.0 kg × 8・8');

  // カレンダーの日を押すと、その日だけ。もう一度押すか「すべて表示」で戻る
  await day(page, '2026-11-05').click();
  await expect(see(page, '11月5日（木）だけを表示中')).toBeVisible();
  await expect(cards(page)).toHaveCount(1);
  await expect(day(page, '2026-11-05')).toHaveAttribute('aria-selected', 'true');
  // 記録のない日を押しても変わらない
  await day(page, '2026-11-06').click();
  await expect(see(page, '11月5日（木）だけを表示中')).toBeVisible();
  await button(page, 'すべて表示').click();
  await expect(cards(page)).toHaveCount(4);
  await day(page, '2026-11-05').click();
  await day(page, '2026-11-05').click();
  await expect(see(page, '11月5日（木）だけを表示中')).toHaveCount(0);

  // 月の移動
  await button(page, '前の月').click();
  await expect(see(page, 'October 2026', { exact: true })).toBeVisible();
  await expect(see(page, '筋トレをした日：今月 1回')).toBeVisible();
  await button(page, '次の月').click();

  // 種目のチップ：その種目をした日だけ。カードはその種目のセット
  await button(page, 'ベンチプレス').click();
  await expect(see(page, 'ベンチプレスをした日：今月 2回')).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
  await expect(trendDay(page, TODAY)).toContainText('11月8日（日） ベンチプレス');
  await expect(trendDay(page, TODAY)).not.toContainText('懸垂');
  await expect(trendDay(page, '2026-11-05')).toContainText('80.0 kg × 8 回');
  // スクワットに替えると、ベンチの日の絞りは外れる
  await day(page, '2026-11-05').click();
  await button(page, 'スクワット').click();
  await expect(see(page, /だけを表示中/)).toHaveCount(0);
  await expect(cards(page)).toHaveCount(1);

  // カードを押すと、その日のトレーニングが開いて直せる
  await button(page, 'すべて').click();
  await trendDay(page, '2026-11-05').click();
  await expect(see(page, 'トレーニング', { exact: true })).toBeVisible();
  await expect(see(page, '11月5日（木）', { exact: true })).toBeVisible();
  await expect(page.getByRole('tablist')).toBeHidden();
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(see(page, '胸 ・ 11月5日（木）の1種目目')).toBeVisible();
  // 前回は 9/15、自己ベストはその日より前だけで見る（60×10 の 80kg）
  await expect(see(page, '前回 9月15日（火）')).toBeVisible();
  await expect(see(page, '自己ベスト 推定1RM 80kg（60kg × 10）')).toBeVisible();
  await page.getByLabel('セット2の回数').fill('6');
  await saveButton(page).click();
  await expect(see(page, '80.0 kg × 6 回')).toBeVisible();
  await button(page, '戻る').click();
  // 推移に戻ると直した値が出る（80×8 + 80×6 = 1120）
  await expect(trendDay(page, '2026-11-05')).toContainText('80.0 kg × 8・6');
  await expect(trendDay(page, '2026-11-05')).toContainText('1.12 t');
});

test('グラフ「すべて」：BIG3 の推定1RM（そろうまで）と、総負荷量の週 → 日の切り替え（開き直しても覚えている）、自己ベスト', async ({ page }) => {
  await seed(page);
  await button(page, 'グラフ').click();
  // BIG3：ベンチ 101.3（1か月前の 10/8 までは 80 → +21.3）、スクワット 116.7（1か月前は記録なし）、デッドリフトは記録なし
  await expect(page.getByTestId('big3-missing')).toContainText('デッドリフトの記録（重量 × 回数）がそろうと合計が出ます');
  await expect(page.getByTestId('big3-total')).toHaveCount(0);
  await expect(page.getByTestId('big3-bench')).toContainText('101.3kg+21.3');
  await expect(page.getByTestId('big3-squat')).toContainText('116.7kg先月の記録なし');
  await expect(page.getByTestId('big3-deadlift')).toContainText('—記録なし');

  // 初めは週ごと
  await expect(button(page, '週')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('volume-chart-week')).toBeVisible();
  await expect(page.getByTestId('volume-chart-day')).toHaveCount(0);
  // 週は月曜始まり。今週（11/2〜）1280+425 = 1705kg → 1.7t。8週（9/14〜）の合計 600+500+1705 = 2805 → 平均 350.6kg → 0.4t。先週 0 との差 +1.7t
  await expect(see(page, '1.7', { exact: true })).toBeVisible();
  await expect(see(page, '週の平均 0.4t ・ 先週より +1.7t')).toBeVisible();

  // 日ごと：4週（週は月曜始まり。10/12〜11/8）の 28 日。10/20 の 500、11/5 の 1280、11/8 の 425（懸垂は体重がないので 0）
  await button(page, '日').click();
  await expect(button(page, '日')).toHaveAttribute('aria-selected', 'true');
  const chart = page.getByTestId('volume-chart-day');
  await expect(chart).toBeVisible();
  await expect(see(page, '日ごとの総負荷量', { exact: true })).toBeVisible();
  await expect(see(page, '2.2', { exact: true })).toBeVisible(); // 2205kg
  await expect(see(page, 'いちばん多い日 11/5 1.3t ・ 3日')).toBeVisible();
  // 棒は記録のあった3日だけ。日付の軸は週の始まり（月曜）
  await expect(chart.locator('rect')).toHaveCount(3);
  for (const d of ['10/12', '10/19', '10/26', '11/2']) await expect(chart.getByText(d, { exact: true })).toBeVisible();
  await expect(chart.getByText('1.3t', { exact: true })).toBeVisible();
  await expect(chart).toHaveAttribute('aria-label', '日ごとの総負荷量のグラフ。10月12日から今日までの合計 2.2トン、3日。いちばん多い日は11月5日で 1.3トン');

  // 開き直しても「日」のまま
  await moveToDate(page, TODAY);
  await openTrainingTrend(page);
  await button(page, 'グラフ').click();
  await expect(button(page, '日')).toHaveAttribute('aria-selected', 'true');
  await button(page, '週').click();
  await expect(page.getByTestId('volume-chart-week')).toBeVisible();

  // 凡例は記録のある部位だけ
  await expect(see(page, '胸', { exact: true })).toHaveCount(2); // 凡例、自己ベストの部位
  await expect(see(page, '背中', { exact: true })).toHaveCount(0);
  // 自己ベスト：スクワット 116.7、ベンチ 101.3 の順。懸垂は出ない。押すとその種目のグラフへ
  const pbs = page.getByRole('button', { name: /^(スクワット|ベンチプレス|懸垂) / }).filter({ visible: true });
  await expect(pbs).toHaveCount(2);
  await expect(pbs.nth(0)).toContainText('スクワット脚116.7kg');
  await expect(pbs.nth(1)).toContainText('ベンチプレス胸101.3kg');
  await pbs.nth(1).click();
  await expect(button(page, 'ベンチプレス')).toHaveAttribute('aria-selected', 'true');
  await expect(see(page, '最大RM（推定）', { exact: true })).toBeVisible();
});

test('グラフ：種目を選ぶと、その種目の推移（期間の切り替え、記録が1件以下、回数だけの種目）', async ({ page }) => {
  await seed(page);
  await button(page, 'ベンチプレス').click();
  await button(page, 'グラフ').click();

  // 3か月（8/8〜）：9/15、11/5、11/8 の3日
  await expect(see(page, '総負荷量', { exact: true })).toBeVisible();
  await expect(see(page, '最大RM（推定）', { exact: true })).toBeVisible();
  await expect(see(page, '425', { exact: true })).toBeVisible();
  await expect(see(page, '3か月で −175kg')).toBeVisible(); // 425 − 600
  await expect(see(page, '99.2', { exact: true })).toBeVisible();

  await button(page, '1か月').click();
  await expect(see(page, '1か月で −855kg')).toBeVisible(); // 425 − 1280
  await button(page, 'すべて').last().click();
  await expect(see(page, 'すべての期間で −175kg')).toBeVisible();

  // 1日しかない種目（スクワット）は空の状態
  await button(page, 'スクワット').click();
  await expect(see(page, 'この期間の記録は 1 日です。2日以上になるとグラフが出ます')).toBeVisible();
  // 回数だけの種目も、今は1日だけ
  await button(page, '懸垂').click();
  await expect(see(page, 'この期間の記録は 1 日です。2日以上になるとグラフが出ます')).toBeVisible();
});
