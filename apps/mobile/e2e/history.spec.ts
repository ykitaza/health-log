import { expect, Page, test } from '@playwright/test';
import { button, goTab, moveToDate, openApp, openMealWeek, openTrainingHistory, recordOn, recordToday, saveButton, see, tab, TODAY } from './helpers';

// 総負荷量・推定1RM・増減・自己ベストの計算は jest（lib/__tests__/screen-logic.test.ts の「履歴の数字」）。ここは画面の切り替えと表示

/**
 * 履歴のテストのデータ
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
  await openTrainingHistory(page);
}

const day = (page: Page, date: string) => page.getByTestId('history-calendar').getByTestId(`day-${date}`);

test('記録がないとき（筋トレと食事）。回数だけの記録しかないときの自己ベスト', async ({ page }) => {
  await openApp(page);
  await openTrainingHistory(page);
  await expect(see(page, 'まだ記録がありません')).toBeVisible();
  await openMealWeek(page);
  await expect(see(page, 'この週はまだ記録がありません')).toBeVisible();
  await goTab(page, '筋トレ');
  await expect(see(page, 'まだ記録がありません')).toBeVisible();

  await tab(page, 'ホーム').click();
  await recordToday(page, [{ exercise: '懸垂', sets: [{ reps: '10' }] }]);
  await openTrainingHistory(page);
  await button(page, 'グラフ').click();
  await expect(see(page, '重量のある種目の記録がまだありません')).toBeVisible();
  await expect(see(page, '週の平均 0.0t ・ 先週より +0.0t')).toBeVisible();
});

test('カレンダー：月の移動、記録のある日・ない日の選択、種目で絞る。日を押すと、その日のトレーニングが開いて直せる', async ({ page }) => {
  await seed(page);
  await expect(see(page, 'November 2026', { exact: true })).toBeVisible();
  await expect(see(page, 'トレーニングした日：今月 2回')).toBeVisible();
  // 初めは、その月で最後に記録した日（今日）を選ぶ
  await expect(see(page, '11月8日（日） ベンチプレス')).toBeVisible();
  await expect(see(page, '11月8日（日） 懸垂')).toBeVisible();
  await expect(see(page, '425 kg')).toBeVisible();
  await expect(see(page, '99.2 kg')).toBeVisible();

  // 記録のある日を押すと切り替わる
  await day(page, '2026-11-05').click();
  await expect(see(page, '11月5日（木） ベンチプレス')).toBeVisible();
  await expect(see(page, '11月8日（日） ベンチプレス')).toBeHidden();
  await expect(see(page, '1,280 kg')).toBeVisible();
  await expect(see(page, '101.3 kg')).toBeVisible();
  // 記録のない日を押しても変わらない
  await day(page, '2026-11-06').click();
  await expect(see(page, '11月5日（木） ベンチプレス')).toBeVisible();

  // 前の月へ
  await button(page, '前の月').click();
  await expect(see(page, 'October 2026', { exact: true })).toBeVisible();
  await expect(see(page, 'トレーニングした日：今月 1回')).toBeVisible();
  await expect(see(page, '10月20日（火） スクワット')).toBeVisible();
  await button(page, '前の月').click();
  await expect(see(page, '9月15日（火） ベンチプレス')).toBeVisible();
  // 先の月（記録なし）
  await button(page, '次の月').click();
  await button(page, '次の月').click();
  await button(page, '次の月').click();
  await expect(see(page, 'December 2026', { exact: true })).toBeVisible();
  await expect(see(page, 'トレーニングした日：今月 0回')).toBeVisible();
  await expect(see(page, 'この月の記録はありません')).toBeVisible();

  // 種目で絞る：ベンチプレスをした日
  await button(page, '前の月').click();
  await button(page, 'ベンチプレス').click();
  await expect(see(page, 'ベンチプレスをした日：今月 2回')).toBeVisible();
  await expect(see(page, '11月8日（日） 懸垂')).toBeHidden();
  await expect(day(page, '2026-11-05')).toHaveAttribute('aria-label', '11月5日（木） 記録あり');
  await button(page, '前の月').click();
  await expect(see(page, 'ベンチプレスをした日：今月 0回')).toBeVisible();
  await expect(see(page, 'この月の記録はありません')).toBeVisible();

  // 回数だけの種目は、自重の総負荷量（体重 × 割合 × 回数。体重の記録がないので 0）だけで、推定1RM は出さない
  await button(page, '次の月').click();
  await button(page, '懸垂').click();
  await expect(see(page, '11月8日（日） 懸垂')).toBeVisible();
  await expect(see(page, '10 回', { exact: true })).toBeVisible();
  await expect(see(page, '総負荷量', { exact: true })).toBeVisible();
  await expect(see(page, '0 kg', { exact: true })).toBeVisible();
  await expect(see(page, '推定1RM', { exact: true })).toHaveCount(0);

  // 日を押すと、その日のトレーニングが開いて直せる
  await button(page, 'すべて').click();
  await day(page, '2026-11-05').click();
  await see(page, '11月5日（木） ベンチプレス').click();
  await expect(see(page, 'トレーニング', { exact: true })).toBeVisible();
  await expect(see(page, '11月5日（木）', { exact: true })).toBeVisible();
  await expect(page.getByRole('tablist')).toBeHidden();

  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(see(page, '胸 ・ 11月5日（木）の1種目目')).toBeVisible();
  await expect(saveButton(page)).toHaveText('変更を保存');
  // 前回は 9/15、自己ベストはその日より前だけで見る（60×10 の 80kg）
  await expect(see(page, '前回 9月15日（火）')).toBeVisible();
  await expect(see(page, '自己ベスト 推定1RM 80kg（60kg × 10）')).toBeVisible();
  await page.getByLabel('セット2の回数').fill('6');
  await saveButton(page).click();
  await expect(see(page, '80.0 kg × 6 回')).toBeVisible();

  // 過去の日に種目を足すと「この日のトレーニングに追加」
  await button(page, '種目を追加').click();
  await page.getByRole('button', { name: /^スクワット / }).click();
  await expect(saveButton(page)).toHaveText('この日のトレーニングに追加');
  await expect(see(page, '脚 ・ 11月5日（木）の2種目目')).toBeVisible();
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  // 履歴に戻ると直した値が出る（80×8 + 80×6 = 1120）
  await expect(see(page, '1,120 kg')).toBeVisible();
});

test('「すべて」の総負荷量：週 → 日の切り替えで棒が日ごとになり、開き直しても覚えている', async ({ page }) => {
  await seed(page);
  await button(page, 'グラフ').click();
  // 初めは週ごと
  await expect(button(page, '週')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('volume-chart-week')).toBeVisible();
  await expect(page.getByTestId('volume-chart-day')).toHaveCount(0);

  // 日ごと：4週（10/18〜11/14）の 28 日。10/20 の 500、11/5 の 1280、11/8 の 425（懸垂は体重がないので 0）
  await button(page, '日').click();
  await expect(button(page, '日')).toHaveAttribute('aria-selected', 'true');
  const chart = page.getByTestId('volume-chart-day');
  await expect(chart).toBeVisible();
  await expect(page.getByTestId('volume-chart-week')).toHaveCount(0);
  await expect(see(page, '日ごとの総負荷量', { exact: true })).toBeVisible();
  await expect(see(page, '2.2', { exact: true })).toBeVisible(); // 2205kg
  await expect(see(page, 'いちばん多い日 11/5 1.3t ・ 3日')).toBeVisible();
  // 棒は記録のあった3日だけ。日付の軸は週の始まり（日曜）
  await expect(chart.locator('rect')).toHaveCount(3);
  for (const d of ['10/18', '10/25', '11/1', '11/8']) await expect(chart.getByText(d, { exact: true })).toBeVisible();
  // いちばん多い日だけ、棒の上に値
  await expect(chart.getByText('1.3t', { exact: true })).toBeVisible();
  // 読み上げの要約（期間の合計と、いちばん多い日）
  await expect(chart).toHaveAttribute('aria-label', '日ごとの総負荷量のグラフ。10月18日から今日までの合計 2.2トン、3日。いちばん多い日は11月5日で 1.3トン');

  // 開き直しても「日」のまま
  await moveToDate(page, TODAY);
  await openTrainingHistory(page);
  await button(page, 'グラフ').click();
  await expect(button(page, '日')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('volume-chart-day')).toBeVisible();

  // 週に戻す
  await button(page, '週').click();
  await expect(page.getByTestId('volume-chart-week')).toBeVisible();
  await expect(see(page, '週の平均 0.3t ・ 先週より −0.9t')).toBeVisible();
});

test('グラフ：期間の切り替え、記録が1件以下、回数だけの種目。「すべて」：週ごとの総負荷量と自己ベスト', async ({ page }) => {
  await seed(page);
  await button(page, 'ベンチプレス').click();
  await button(page, 'グラフ').click();

  // 3か月（8/8〜）：9/15、11/5、11/8 の3日
  await expect(see(page, '総負荷量', { exact: true })).toBeVisible();
  await expect(see(page, '最大RM（推定）', { exact: true })).toBeVisible();
  await expect(see(page, '425', { exact: true })).toBeVisible();
  await expect(see(page, '3か月で −175kg')).toBeVisible(); // 425 − 600
  await expect(see(page, '99.2', { exact: true })).toBeVisible();
  await expect(page.locator('svg').filter({ visible: true })).not.toHaveCount(0);

  // 1か月（10/8〜）：11/5 と 11/8
  await button(page, '1か月').click();
  await expect(see(page, '1か月で −855kg')).toBeVisible(); // 425 − 1280
  // すべて
  await button(page, 'すべて').last().click();
  await expect(see(page, 'すべての期間で −175kg')).toBeVisible();

  // 1日しかない種目（スクワット）は空の状態
  await button(page, 'すべて').first().click();
  await button(page, 'スクワット').click();
  await expect(see(page, 'グラフにするには記録が足りません')).toBeVisible();
  await expect(see(page, 'この期間の記録は 1 日です。2日以上になるとグラフが出ます')).toBeVisible();

  // 回数だけの種目も、自重の総負荷量（体重 × 割合 × 回数）のグラフになる（推定1RM は出さない）。今は1日だけ
  await button(page, '懸垂').click();
  await expect(see(page, 'この期間の記録は 1 日です。2日以上になるとグラフが出ます')).toBeVisible();

  // 部位を選ぶと、記録のある種目が選ばれる。記録のない種目は 0 日
  await button(page, '脚').click();
  await expect(button(page, 'スクワット')).toHaveAttribute('aria-selected', 'true');
  await button(page, 'レッグプレス').click();
  await expect(see(page, 'この期間の記録は 0 日です。2日以上になるとグラフが出ます')).toBeVisible();

  // 「すべて」の種目：週ごとの総負荷量と自己ベスト
  await button(page, 'すべて').first().click();
  await expect(see(page, '週ごとの総負荷量', { exact: true })).toBeVisible();
  // 今週 425kg → 0.4t。8週（9/20〜）の合計 500+1280+425 = 2205 → 平均 275.6kg → 0.3t。先週 1280 との差 −855 → −0.9t
  await expect(see(page, '0.4', { exact: true })).toBeVisible();
  await expect(see(page, '週の平均 0.3t ・ 先週より −0.9t')).toBeVisible();
  // 凡例は記録のある部位だけ
  await expect(see(page, '胸', { exact: true })).toHaveCount(3); // 部位のチップ、凡例、自己ベストの部位
  await expect(see(page, '背中', { exact: true })).toHaveCount(1); // チップだけ（凡例に出ない）

  // 自己ベスト：スクワット 100×(1+5/30)=116.7、ベンチ 80×(1+8/30)=101.3 の順。懸垂は出ない
  const pbs = page.getByRole('button', { name: /^(スクワット|ベンチプレス|懸垂) / }).filter({ visible: true });
  await expect(pbs).toHaveCount(2);
  await expect(pbs.nth(0)).toContainText('スクワット脚116.7kg');
  await expect(pbs.nth(1)).toContainText('ベンチプレス胸101.3kg');

  // 押すと、その種目のグラフへ
  await pbs.nth(1).click();
  await expect(button(page, '胸')).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, 'ベンチプレス')).toHaveAttribute('aria-selected', 'true');
  await expect(see(page, '最大RM（推定）', { exact: true })).toBeVisible();
});
