import { expect, Page, test } from '@playwright/test';
import {
  button, expectTrainingDay, goPane, goTab, moveToDate, openApp, openMealWeek, openTrainingTrend, recordOn, recordToday, saveButton, see, tab, TODAY,
  trendDay,
} from './helpers';

// 総負荷量・推定1RM・先月との差・自己ベスト・BIG3 の合計の計算は jest（lib/__tests__/screen-logic.test.ts の「履歴の数字」、
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
  await expect(see(page, '重量のある種目の記録がまだありません')).toBeVisible();
  await expect(see(page, '週の平均 0.0t ・ 先週より +0.0t')).toBeVisible();
  // BIG3 は名前で決めた3種目。記録がないので合計は出ない
  await expect(page.getByTestId('big3-missing')).toContainText('ベンチプレス・スクワット・デッドリフトの記録（重量 × 回数）がそろうと合計が出ます');
});

// 4つの確かめは同じ記録を使う。記録を画面で作るのに時間がかかるので、1回作って続けて確かめる（覚えた期間は前のステップから引き継ぐ）
test('記録があるときの推移', async ({ page }) => {
  await seed(page);
  await test.step('グラフ「すべて」：BIG3 の推定1RM（そろうまで）と、総負荷量の週 → 日の切り替え（開き直しても覚えている）、自己ベスト', async () => {
    // BIG3：ベンチ 101.3（1か月前の 10/8 までは 80 → +21.3）、スクワット 116.7（1か月前は記録なし）、デッドリフトは記録なし
    // 記録がある2種目だけの合計（101.3 + 116.7 = 218.0）と添え書き。デッドリフトの記録を促す案内も残る
    // 今の合計は上のホームと同じ BIG3 のカードだけに出す（下の BIG3 のカードは、合計の先月との差と 3か月の折れ線）
    await expect(page.getByTestId('trend-big3-gauge')).toContainText('218.0');
    await expect(page.getByTestId('big3-partial')).toHaveText('2種目の合計（デッドリフトはまだ）');
    await expect(page.getByTestId('big3-missing')).toContainText('デッドリフトの記録（重量 × 回数）があると合計に加わります');
    await expect(page.getByTestId('big3-bench')).toContainText('101.3kg+21.3');
    await expect(page.getByTestId('big3-squat')).toContainText('116.7kg先月の記録なし');
    await expect(page.getByTestId('big3-deadlift')).toContainText('—記録なし');

    // 初めは週ごと
    await expect(button(page, '週')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('volume-chart-week')).toBeVisible();
    await expect(page.getByTestId('volume-chart-day')).toHaveCount(0);
    // 週は月曜始まり。今週（11/2〜）1280+425 = 1705kg → 1.7t。8週（9/14〜）の合計 600+500+1705 = 2805 → 平均 350.6kg → 0.4t。先週 0 との差 +1.7t
    // 今週の合計は上の LOAD のカードだけに出す（総負荷量のカードの週ごとには出さない）
    await expect(page.getByTestId('trend-load-gauge')).toContainText('1.71');
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
    await expect(see(page, 'ベンチプレスの推定1RM', { exact: true })).toBeVisible();
  });

  await test.step('部位のバランス：BIG3 と総負荷量のあいだ。2週・3か月・これまでの切り替えと読み上げ（選んだ期間を覚える）', async () => {
    // 前のステップで選んだ種目を外し、開き直して「すべて」から始める
    await moveToDate(page, TODAY);
    await openTrainingTrend(page);
    await button(page, 'すべて').click();
    const card = page.getByTestId('trend-part-balance').filter({ visible: true });
    // 並び：BIG3 → 部位のバランス → 総負荷量
    const y = async (l: ReturnType<typeof see>) => (await l.boundingBox())!.y;
    const big3 = await y(see(page, 'BIG3 の推定1RM（合計）', { exact: true }));
    const balance = await y(see(page, '部位のバランス', { exact: true }));
    const volume = await y(see(page, '総負荷量', { exact: true }));
    expect(big3).toBeLessThan(balance);
    expect(balance).toBeLessThan(volume);

    // 初めは 2週（10/26〜今日）：ベンチ 11/5 の2セットと今日の1セットで胸 3、懸垂で背中 1。軸の名前の横にセット数
    await expect(button(page, '2週')).toHaveAttribute('aria-selected', 'true');
    await expect(card).toHaveAttribute('aria-label', '部位のバランス、直近2週のセット数。胸 3、肩 0、背中 1、腕 0、脚 0、腹 0');
    await expect(card.getByText('胸 3', { exact: true })).toBeVisible();
    await expect(card.getByText('背中 1', { exact: true })).toBeVisible();
    await expect(card).toContainText('外周は、この期間でいちばん多い部位（胸）');
    await expect(card.locator('svg circle')).toHaveCount(6);
    await expect(card.locator('path[stroke-dasharray]')).toHaveCount(0);

    // 3か月（8/8〜）：9/15 のベンチと 10/20 のスクワットも入る
    await button(page, '3か月').click();
    await expect(button(page, '3か月')).toHaveAttribute('aria-selected', 'true');
    await expect(card).toHaveAttribute('aria-label', '部位のバランス、直近3か月のセット数。胸 4、肩 0、背中 1、腕 0、脚 1、腹 0');
    await expect(card.getByText('脚 1', { exact: true })).toBeVisible();

    // これまで：直近2週を点線で重ね、凡例を出す
    await button(page, 'これまで').click();
    await expect(card).toHaveAttribute(
      'aria-label', '部位のバランス、これまでのセット数。胸 4、肩 0、背中 1、腕 0、脚 1、腹 0。直近2週は 胸 3、肩 0、背中 1、腕 0、脚 0、腹 0',
    );
    await expect(card.getByText('直近2週', { exact: true })).toBeVisible();
    await expect(card.locator('path[stroke-dasharray]')).toHaveCount(1);
    await expect(card).toContainText('外周は、その期間でいちばん多い部位（どちらも胸）');

    // 種目を選んで「すべて」に戻っても、開き直しても、これまでのまま
    await button(page, 'ベンチプレス').click();
    await expect(card).toHaveCount(0);
    await button(page, 'すべて').click();
    await expect(button(page, 'これまで')).toHaveAttribute('aria-selected', 'true');
    await moveToDate(page, TODAY);
    await openTrainingTrend(page);
    await expect(button(page, 'これまで')).toHaveAttribute('aria-selected', 'true');
    await expect(card).toHaveAttribute('aria-label', /^部位のバランス、これまでのセット数。/);
  });

  await test.step('部位のバランス：ホームの部位のバランスから来ると、覚えた期間に関係なくホームと同じ 28日。タブや BIG3 から開くと覚えた期間', async () => {
    // 前のステップで選んだ種目を外し、開き直して「すべて」から始める
    await moveToDate(page, TODAY);
    await openTrainingTrend(page);
    await button(page, 'すべて').click();
    const card = page.getByTestId('trend-part-balance').filter({ visible: true });
    const home = (id: string) => page.getByTestId(id).filter({ visible: true });
    await button(page, 'これまで').click();
    await expect(card).toHaveAttribute('aria-label', /^部位のバランス、これまでのセット数。/);

    // ホームの部位のレーダー（PARTS）を押すと 28日（10/12〜今日。前の28日は 9/14〜10/11 で、9/15 のベンチ）。切り替えはどれも選ばない
    await goTab(page, 'ホーム');
    await home('home-parts').click();
    await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');
    await expect(card).toHaveAttribute('aria-label',
      '部位のバランス、直近28日のセット数。胸 3、肩 0、背中 1、腕 0、脚 1、腹 0。前の28日は 胸 1、肩 0、背中 0、腕 0、脚 0、腹 0');
    await expect(button(page, '2週')).toHaveAttribute('aria-selected', 'false');
    await expect(button(page, 'これまで')).toHaveAttribute('aria-selected', 'false');

    // 覚えた期間は書き換えない：下のタブで開き直すと、これまで
    await goTab(page, 'ホーム');
    await goTab(page, '筋トレ');
    await expect(button(page, 'これまで')).toHaveAttribute('aria-selected', 'true');

    // 上の切り替えで記録 → 推移に移っても、これまで
    await goTab(page, 'ホーム');
    await home('home-parts').click();
    await expect(card).toHaveAttribute('aria-label', /^部位のバランス、直近28日のセット数。/);
    await goPane(page, '記録');
    await goPane(page, '推移');
    await expect(button(page, 'これまで')).toHaveAttribute('aria-selected', 'true');

    // BIG3 のカードから来たときも、これまで
    await goTab(page, 'ホーム');
    await home('home-big3').click();
    await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');
    await expect(button(page, 'これまで')).toHaveAttribute('aria-selected', 'true');
  });

  await test.step('種目を選ぶと、推定1RM の折れ線とその種目の記録（新しい順）。カードを押すと記録のタブのその日で直せる', async () => {
    // 前のステップで選んだ種目を外し、開き直して「すべて」から始める
    await moveToDate(page, TODAY);
    await openTrainingTrend(page);
    await button(page, 'すべて').click();
    // 種目のチップは1列：すべて、記録のある種目（部位の順）。部位のチップと「記録／グラフ」の切り替えはない
    await expect(button(page, 'すべて')).toHaveAttribute('aria-selected', 'true');
    for (const name of ['ベンチプレス', '懸垂', 'スクワット']) await expect(button(page, name)).toBeVisible();
    await expect(button(page, '胸')).toHaveCount(0);
    await expect(button(page, 'グラフ')).toHaveCount(0);
    // すべてのときは、日ごとのカードを出さない
    await expect(cards(page)).toHaveCount(0);

    // ベンチプレス：3か月（8/8〜）の推定1RM。今は今日の 85×5 の 99.2、1か月前（10/8）までは 9/15 の 80 → +19.2
    await button(page, 'ベンチプレス').click();
    await expect(see(page, 'ベンチプレスの推定1RM', { exact: true })).toBeVisible();
    await expect(page.getByTestId('exercise-trend-value').filter({ visible: true })).toContainText('99.2kg+19.2 kg先月より');
    await expect(see(page, 'ベンチプレスの記録（新しい順）', { exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    await expect(cards(page).nth(0)).toHaveAttribute('data-testid', `trend-day-${TODAY}`);
    await expect(cards(page).nth(2)).toHaveAttribute('data-testid', 'trend-day-2026-09-15');
    await expect(page.getByRole('button', { name: /^もっと見る/ })).toHaveCount(0);
    // カード：日付と種目、セット、総負荷量と推定1RM（ほかの種目は出さない）
    const today = trendDay(page, TODAY);
    await expect(today).toContainText('11月8日（日） ベンチプレス');
    await expect(today).toContainText('85.0 kg × 5 回');
    await expect(today).toContainText('総負荷量425 kg');
    await expect(today).toContainText('推定1RM99.2 kg');
    await expect(today).not.toContainText('懸垂');
    await expect(trendDay(page, '2026-11-05')).toContainText('80.0 kg × 8 回');

    // 1日しかない種目（スクワット）は、折れ線の代わりに説明
    await button(page, 'スクワット').click();
    await expect(see(page, '3か月の記録が2日以上になると、折れ線が出ます')).toBeVisible();
    await expect(cards(page)).toHaveCount(1);
    // 回数だけの種目は総負荷量。体重の記録がないので値は出ず、推定1RM のタイルもない
    await button(page, '懸垂').click();
    await expect(see(page, '懸垂の総負荷量', { exact: true })).toBeVisible();
    await expect(page.getByTestId('exercise-trend-empty').filter({ visible: true })).toBeVisible();
    await expect(trendDay(page, TODAY)).toContainText('10 回');
    await expect(trendDay(page, TODAY)).not.toContainText('推定1RM');

    // カードを押すと、記録のタブのその日が開いて直せる
    await button(page, 'ベンチプレス').click();
    await trendDay(page, '2026-11-05').click();
    await expectTrainingDay(page, '11月5日（木）');
    await expect(see(page, '今日ではない日を見ています')).toBeVisible();
    await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
    await expect(see(page, '胸 ・ 11月5日（木）の1種目目')).toBeVisible();
    // 前回は 9/15、自己ベストはその日より前だけで見る（60×10 の 80kg）
    await expect(see(page, '前回 9月15日（火）')).toBeVisible();
    await expect(see(page, '自己ベスト 推定1RM 80kg（60kg × 10）')).toBeVisible();
    await page.getByLabel('セット2の回数').fill('6');
    await saveButton(page).click();
    await expectTrainingDay(page, '11月5日（木）');
    await expect(see(page, '80.0 kg × 6 回')).toBeVisible();
    // 推移に戻ると直した値が出る（80×8 + 80×6 = 1120）
    await goPane(page, '推移');
    await button(page, 'ベンチプレス').click();
    await expect(trendDay(page, '2026-11-05')).toContainText('80.0 kg × 6 回');
    await expect(trendDay(page, '2026-11-05')).toContainText('総負荷量1,120 kg');
  });

  await test.step('ホームの LATEST の PR // 0（今日のベンチ 85×5 は自己ベストでない）：推移の「すべて」の種目ごとの自己ベスト', async () => {
    await goTab(page, 'ホーム');
    const pr = page.getByTestId('home-latest-pr').filter({ visible: true });
    await expect(pr).toHaveAccessibleName('自己ベスト 0。種目ごとの自己ベストを開く');
    await pr.click();
    await expect(page.getByRole('tab', { name: '推移', exact: true }).filter({ visible: true })).toHaveAttribute('aria-selected', 'true');
    await expect(button(page, 'すべて')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('trend-best').filter({ visible: true })).toBeInViewport({ ratio: 0.9 });
  });
});
