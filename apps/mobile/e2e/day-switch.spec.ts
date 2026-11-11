import { expect, Page, test } from '@playwright/test';
import {
  addEntry, button, expectTrainingDay, goPane, goTab, moveToDate, openApp, openMealWeek, recordOn, see, swipe, tab, TODAY,
} from './helpers';

// 筋トレの記録と食事の、日付の切り替え（前の日・次の日、「日を選ぶ」のシート、左右のスワイプ）。
// スワイプの判定（横の動きの大きさと向き）、ゴムの抵抗の計算、ヒントを出すかは jest（lib/__tests__/swipe.test.ts）。ここは画面の流れ

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

const hint = (page: Page) => see(page, '左右にスワイプで日を移れます');

test('スワイプのヒント：開いたときに日付の下に出る（推移は週）。スワイプで日を動かしたら、どの画面でももう出さない', async ({ page }) => {
  await openApp(page);
  await goTab(page, '筋トレ');
  await expect(hint(page)).toBeVisible();
  await goTab(page, '食事');
  await expect(hint(page)).toBeVisible();
  await goPane(page, '推移');
  await expect(see(page, '左右にスワイプで週を移れます')).toBeVisible();
  await goPane(page, '記録');

  // 前・次のボタンで動かしても消えない（スワイプを知ったことにはしない）
  await button(page, '前の日').click();
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  await expect(hint(page)).toBeVisible();
  // スワイプで動かすと消え、開き直しても出ない
  await swipe(mealsArea(page), 'prev');
  await expect(see(page, '11月6日（金）', { exact: true })).toBeVisible();
  await expect(hint(page)).toHaveCount(0);

  await moveToDate(page, TODAY);
  await goTab(page, '筋トレ');
  await expectTrainingDay(page, '11月8日（日）');
  await goTab(page, '食事');
  await goPane(page, '推移');
  await expect(see(page, '11月2日〜11月8日', { exact: true })).toBeVisible();
  await expect(page.getByTestId('swipe-hint')).toHaveCount(0);
});

test('スワイプのヒントは、スワイプしなくても1つの画面で3回まで', async ({ page }) => {
  await openApp(page);
  for (let i = 0; i < 3; i++) {
    if (i > 0) await moveToDate(page, TODAY);
    await goTab(page, '筋トレ');
    await expect(hint(page)).toBeVisible();
  }
  await moveToDate(page, TODAY);
  await goTab(page, '筋トレ');
  await expectTrainingDay(page, '11月8日（日）');
  await expect(page.getByTestId('swipe-hint')).toHaveCount(0);
  // ほかの画面は、まだ出す
  await goTab(page, '食事');
  await expect(hint(page)).toBeVisible();
});

test.describe('動きを減らす設定がオフ', () => {
  test.use({ reducedMotion: 'no-preference' });

  /** 中身の横の位置（transform の translateX） */
  const offsetX = (page: Page) => page.getByTestId('training-day-content').filter({ visible: true })
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  /** これから frames フレームのあいだ、毎フレーム中身の横の位置を記録する（動きの途中を見落とさないよう、操作の前に始める） */
  const sampleX = (page: Page, frames = 60) => page.evaluate((n) => new Promise<number[]>((resolve) => {
    const xs: number[] = [];
    let count = 0;
    const tick = () => {
      for (const el of document.querySelectorAll('[data-testid="training-day-content"]')) xs.push(new DOMMatrix(getComputedStyle(el).transform).m41);
      if (++count < n) requestAnimationFrame(tick); else resolve(xs);
    };
    tick();
  }), frames);

  // 指についてくる位置の計算は jest（dragOffset）。web のマウスでは途中の動きが間引かれることがあるので、ここは向きと大きさの範囲だけ見る
  test('今日より先へはゴムのように小さく動いて戻り、日は変わらない。前へはボタンでもスワイプでも横にすべって変わる', async ({ page }) => {
    await openApp(page);
    // 開いたときのヒントのずれ：今日は次へ進めないので、右（前の日の向き）へずれて戻る。開く前から毎フレーム位置を記録する
    const nudge = sampleX(page, 180);
    await goTab(page, '筋トレ');
    await expectTrainingDay(page, '11月8日（日）');
    await expect(hint(page)).toBeVisible();
    const xs = await nudge;
    expect(Math.max(...xs)).toBeGreaterThan(10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(24);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0); // 左（進めない次の向き）へはずれない
    await expect.poll(() => offsetX(page)).toBe(0);
    await page.addStyleTag({ content: '* { user-select: none !important; -webkit-user-select: none !important; }' });
    const box = await trainingArea(page).boundingBox();
    if (!box) throw new Error('スワイプする範囲が見えていません');
    const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 200);

    // 今日から左（次の日）へ 160 引く：指より小さく、上限より小さく動く（抵抗）
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 160, y, { steps: 8 });
    await expect.poll(() => offsetX(page)).toBeLessThan(-10);
    const rubber = await offsetX(page);
    expect(rubber).toBeGreaterThan(-72);
    await page.mouse.up();
    await expect.poll(() => offsetX(page)).toBe(0);
    await expectTrainingDay(page, '11月8日（日）');

    // 前の日のボタンでも、スワイプと同じ向きに横にすべって変わる（右へ出ていき、左から入る）
    const slid = sampleX(page);
    await button(page, '前の日').click();
    await expectTrainingDay(page, '11月7日（土）');
    const xs2 = await slid;
    expect(Math.max(...xs2)).toBeGreaterThan(50);
    expect(Math.min(...xs2)).toBeLessThan(-50);
    await expect.poll(() => offsetX(page)).toBe(0);
    await swipe(trainingArea(page), 'prev');
    await expectTrainingDay(page, '11月6日（金）');
    await expect.poll(() => offsetX(page)).toBe(0);
    await expect(hint(page)).toHaveCount(0);
  });
});
