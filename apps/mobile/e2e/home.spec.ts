import { expect, Page, test } from '@playwright/test';
import {
  button, expectTrainingDay, goTab, homeCard, homeIcon, openApp, openSettings, recordFromHome, recordOn, recordToday, moveToDate, setBodyInfo, TODAY, see, tab,
} from './helpers';

// 今週の負荷量・日数の計算は jest（lib/__tests__/screen-logic.test.ts の「ホームの数字」）、BIG3 の合計は lib/__tests__/home.test.ts。ここは画面に出ること

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const day = (page: Page, date: string) => page.getByTestId('home-calendar').getByTestId(`day-${date}`);

test('記録がないときのホーム（まっさらなデータから始まる）', async ({ page }) => {
  await openApp(page);
  await expect(see(page, 'November 2026', { exact: true })).toBeVisible();
  // 今日（8日）は塗られ、印はない
  await expect(day(page, TODAY)).toHaveAttribute('aria-label', '11月8日（日） 今日');
  await expect(visible(page, 'archive')).toContainText('0days');
  await expect(visible(page, 'archive')).toContainText('TOTAL0 days');
  await expect(visible(page, 'volume-week')).toContainText('合計負荷量／今週0.00t');
  await expect(visible(page, 'volume-week')).toContainText('× 0.0');
  // BIG3 の記録がまだないときは「—」
  await expect(visible(page, 'home-big3')).toHaveText('BIG3 推定1RM 合計—BIG3 の記録がまだありません');
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

test('記録したあとの今週の負荷量のカード、カレンダーの印、今日の記録', async ({ page }) => {
  // 今週（月曜始まり、11/2〜）：スクワット 100×5×3 = 1500kg
  await recordOn(page, '2026-11-03', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }, { weight: '100', reps: '5' }, { weight: '100', reps: '5' }] }]);
  // 今日：ベンチ 80×8、80×8、70×10 = 1980kg と、回数だけの懸垂（負荷量は 0）
  await recordOn(page, TODAY, [
    { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }, { weight: '80', reps: '8', memo: '最後きつい' }, { weight: '70', reps: '10' }] },
    { exercise: '懸垂', sets: [{ reps: '10' }] },
  ]);
  await moveToDate(page, TODAY);

  // 今週（月曜始まり、11/2〜11/8）：1980 + 1500 = 3480kg → 3.48t、車 1.5t の 2.32 台。週ごとの棒は出さない
  await expect(visible(page, 'volume-week')).toContainText('3.48t');
  await expect(visible(page, 'volume-week')).toContainText('× 2.3');
  await expect(page.getByTestId('week-bar-0')).toHaveCount(0);
  // デッドリフトの記録がないので、BIG3 の合計はまだ出ない
  await expect(visible(page, 'home-big3')).toContainText('BIG3 の記録がまだありません');

  // カレンダーの印は 11 月の 3 日と 8 日
  await expect(day(page, '2026-11-03')).toHaveAttribute('aria-label', '11月3日（火） 記録あり');
  await expect(day(page, TODAY)).toHaveAttribute('aria-label', '11月8日（日） 今日 記録あり');
  await expect(day(page, '2026-11-04')).toHaveAttribute('aria-label', '11月4日（水）');
  await expect(visible(page, 'archive')).toContainText('2days');
  await expect(visible(page, 'archive')).toContainText('TOTAL2 days');

  // 今日のトレーニングのカード：2種目・4セット・1980kg
  await expect(homeCard(page, 'training')).toContainText('2種目 ・ 4セット ・ 1.98 t');

  // カードを押すと、筋トレのタブの記録の今日が開く。推定1RM は 80 ×（1 ＋ 8 ÷ 30）= 101.33 → 101.3kg。メモも出る。懸垂は回数だけ
  await homeCard(page, 'training').click();
  await expectTrainingDay(page, '11月8日（日）');
  await expect(see(page, '推定1RM 101.3kg')).toBeVisible();
  await expect(see(page, '80.0 kg × 8 回')).toHaveCount(2);
  await expect(see(page, '70.0 kg × 10 回')).toBeVisible();
  await expect(see(page, '最後きつい')).toBeVisible();
  await expect(see(page, '懸垂', { exact: true })).toBeVisible();
  await expect(see(page, '10 回', { exact: true })).toBeVisible();
});

test('BIG3 推定1RM 合計：先月との差と折れ線。押すと筋トレの推移', async ({ page }) => {
  // 1か月前（10/8）より前：3種目とも 100×5（推定1RM 116.67）→ 合計 350.0
  await recordOn(page, '2026-10-01', ['ベンチプレス', 'スクワット', 'デッドリフト'].map((exercise) => ({ exercise, sets: [{ weight: '100', reps: '5' }] })));
  await moveToDate(page, TODAY);
  await expect(visible(page, 'home-big3')).toContainText('350.0kg');
  await expect(visible(page, 'home-big3')).toContainText('±0 kg先月より');
  // 今日：スクワット 110×5（128.33）→ 合計 361.7、先月より +11.7
  await recordToday(page, [{ exercise: 'スクワット', sets: [{ weight: '110', reps: '5' }] }]);
  await expect(visible(page, 'home-big3')).toContainText('361.7kg');
  await expect(visible(page, 'home-big3-change')).toHaveText('+11.7 kg先月より');
  await expect(visible(page, 'home-big3')).toHaveAttribute('aria-label', 'BIG3 推定1RM 合計 361.7kg。先月より +11.7kg。筋トレの推移を開く');
  await expect(visible(page, 'home-big3').locator('svg polyline')).toHaveCount(1);

  // 押すと筋トレのタブの「推移」
  await visible(page, 'home-big3').click();
  await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '推移', exact: true }).filter({ visible: true })).toHaveAttribute('aria-selected', 'true');
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

// 形は web では描かない（components/growth/GrowthShape.web.tsx）。スコアの計算と文言は jest（lib/__tests__/growth.test.ts・home.test.ts）。
// ここは形の段の文字と押せるものが出ること
test('形の段：アイコン・月・歯車・成長スコア・「成長を見る」。スコアを押すと内訳のシート', async ({ page }) => {
  await openApp(page);
  const stage = visible(page, 'growth-stage');
  await expect(stage.getByTestId('home-app-icon')).toHaveAttribute('aria-label', 'hlog');
  // 月の見出しは段にだけ出す（カレンダーの上に二重に出さない）
  await expect(see(stage, 'November 2026', { exact: true })).toBeVisible();
  await expect(see(page, 'November 2026', { exact: true })).toHaveCount(1);
  await expect(button(stage, '設定')).toBeVisible();
  await expect(button(stage, '成長の形。押すと成長を見る画面を開く')).toBeVisible();
  await expect(button(stage, '成長を見る')).toHaveText('成長を見る ›');

  // 記録がまだないときは「—」。内訳もどの柱も「—」で、先週との差は出さない
  const noScore = button(stage, '成長スコア まだ記録がありません。押すと内訳');
  await expect(noScore).toHaveText('—成長スコア');
  await noScore.click();
  const sheet = visible(page, 'growth-score-sheet');
  await expect(see(sheet, '成長スコア', { exact: true })).toBeVisible();
  for (const name of ['training', 'meal', 'sleep', 'total']) await expect(sheet.getByTestId(`growth-score-${name}`)).toContainText('—');
  await expect(sheet.getByTestId('growth-score-week')).toHaveCount(0);
  await expect(see(sheet, '直近7日の記録から計算します。記録がない日は数えません')).toBeVisible();
  await button(page, '閉じる').click();
  await expect(sheet).toHaveCount(0);

  // 先週（11/1）と今日に筋トレ：今週は筋トレ 1/3 回・負荷量は前の4週の平均以上で 27点、食事と睡眠は記録がないので外す
  await recordOn(page, '2026-11-01', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  await moveToDate(page, TODAY);
  await recordToday(page, [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  const score = button(stage, '成長スコア 67点、直近7日。先週より 34点高い。押すと内訳');
  await expect(score).toHaveText('67成長スコア↑ +34');
  await score.click();
  await expect(sheet.getByTestId('growth-score-training')).toHaveText('筋トレ27 / 40');
  await expect(sheet.getByTestId('growth-score-meal')).toHaveText('食事—');
  await expect(sheet.getByTestId('growth-score-sleep')).toHaveText('睡眠—');
  await expect(sheet.getByTestId('growth-score-total')).toHaveText('合計67 / 100');
  await expect(sheet.getByTestId('growth-score-week')).toHaveText('先週との差↑ +34');
});

/** 今週の目標を、筋トレ 2回・食事の記録 3日・睡眠 切にする（ホームから設定を開いて戻る） */
async function setSmallGoals(page: Page) {
  await openSettings(page);
  for (const name of ['筋トレ、2回', '食事の記録、3日', '睡眠、切']) {
    await button(page, name).click();
    await expect(button(page, name)).toHaveAttribute('aria-selected', 'true');
  }
  await button(page, '戻る').click();
  await expect(homeIcon(page)).toBeVisible();
}

/** 食事のタブで、今の日の昼食を1品だけ記録して、ホームに戻る */
async function recordMeal(page: Page) {
  await goTab(page, '食事');
  await button(page, '昼食を記録').click();
  await button(page, '品目を入力').click();
  const field = (label: string) => page.getByRole('textbox', { name: label, exact: true }).filter({ visible: true });
  await field('品目1の品名').fill('おにぎり');
  await field('品目1の量').fill('1');
  await field('品目1のエネルギー').fill('200');
  await button(page, '記録する').click();
  await expect(page.getByTestId('total-kcal').filter({ visible: true })).toHaveText('200');
  await goTab(page, 'ホーム');
}

// 達成と連続の数え方（途切れ・今週を含む・含まない・0・上限）は jest（lib/__tests__/goals.test.ts、db/__tests__/achievements.test.ts）。
// 動かすのは同じ週の初めの1回だけ（lib/__tests__/home.test.ts の shouldCelebrate）。ここは画面に出ること
test('今週の目標：最後の1つが届くと見出しの右に「✓ 達成」、いちばん下に連続の記録。開き直しても残る', async ({ page }) => {
  await openApp(page);
  await setSmallGoals(page);
  // 11/6・11/7 に筋トレと食事。今日（11/8）はまだ食事がない
  for (const date of ['2026-11-06', '2026-11-07']) {
    await recordOn(page, date, [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
    await recordMeal(page);
  }
  await moveToDate(page, TODAY);
  await expect(visible(page, 'goal-training')).toContainText('2／2 回');
  await expect(visible(page, 'goal-meals')).toContainText('2／3 日');
  await expect(visible(page, 'goals-achieved')).toHaveCount(0);
  await expect(visible(page, 'weekly-goals')).toHaveAttribute('aria-label', '今週の目標。筋トレ 2回、目標 2回、達成。食事の記録 2日、目標 3日。押すと設定で変えられます');
  // 連続が0なら出さない
  await expect(visible(page, 'goal-streak')).toHaveCount(0);

  // 最後の1つ（食事の記録の3日目）
  await recordMeal(page);
  await expect(visible(page, 'goal-meals')).toContainText('3／3 日');
  await expect(visible(page, 'goals-achieved')).toHaveText('達成');
  await expect(visible(page, 'goal-streak')).toHaveText('1週連続で達成');
  await expect(visible(page, 'weekly-goals')).toHaveAttribute(
    'aria-label', '今週の目標をすべて達成。筋トレ 2回、目標 2回、達成。食事の記録 3日、目標 3日、達成。1週連続で達成。押すと設定で変えられます',
  );

  await page.reload();
  await expect(homeIcon(page)).toBeVisible();
  await expect(visible(page, 'goal-meals')).toContainText('3／3 日');
  await expect(visible(page, 'goals-achieved')).toHaveText('達成');
  await expect(visible(page, 'goal-streak')).toHaveText('1週連続で達成');
});

test('今週の目標：今週はまだで先週まで達成していれば「先週まで 1週連続で達成」', async ({ page }) => {
  await openApp(page);
  await setSmallGoals(page);
  // 先週（10/26〜11/1）：筋トレ 10/30・10/31、食事 10/30・10/31・11/1
  for (const date of ['2026-10-30', '2026-10-31']) {
    await recordOn(page, date, [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
    await recordMeal(page);
  }
  await moveToDate(page, '2026-11-01');
  await recordMeal(page);
  await expect(visible(page, 'goal-streak')).toHaveText('1週連続で達成');

  await moveToDate(page, TODAY);
  await expect(visible(page, 'goals-achieved')).toHaveCount(0);
  await expect(visible(page, 'goal-streak')).toHaveText('先週まで 1週連続で達成');
});

test('今週の目標のカードを押すと、設定の「今週の目標」の欄までスクロールして開く。変えるとホームに出る', async ({ page }) => {
  await openApp(page);
  await button(page, '今週の目標。筋トレ 0回、目標 3回。食事の記録 0日、目標 5日。押すと設定で変えられます').click();
  await expect(see(page, '重さの単位', { exact: true })).toBeVisible();
  await expect(page.getByTestId('settings-weekly-goals').filter({ visible: true })).toBeInViewport();
  await expect(button(page, '睡眠、4日')).toBeInViewport();
  await button(page, '筋トレ、4回').click();
  await expect(button(page, '筋トレ、4回')).toHaveAttribute('aria-selected', 'true');
  await button(page, '戻る').click();
  await expect(visible(page, 'goal-training')).toContainText('0／4 回');
});
