import { expect, Page, test } from '@playwright/test';
import {
  button, expectTrainingDay, goTab, homeCard, homeFuel, homeLatest, openApp, recordFromHome, recordOn, recordToday, moveToDate, setBodyInfo,
  TODAY, see, tab,
} from './helpers';

// ホームの計器の盤（刷新 A）。集計（LATEST・BIG3・LOAD・SLEEP・LOG・PARTS・FUEL）は jest（lib/__tests__/homeHud.test.ts）。ここは画面に出ること。
// web では 3D の体を描かないので、LATEST は 2D の図（前と後ろ）と種目の札になる

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const cell = (page: Page, date: string) => visible(page, `log-${date}`);

test('記録がないときのホーム（まっさらなデータから始まる）', async ({ page }) => {
  await openApp(page);
  // 見出しの行：アカウントの写真・「HLOG // NOV 2026」・設定の歯車
  const header = visible(page, 'home-header');
  await expect(button(header, 'アカウント。押すとアカウントの画面')).toBeVisible();
  await expect(header.getByRole('heading', { name: '2026年11月' })).toHaveText('HLOG // NOV 2026');
  await expect(button(header, '設定')).toBeVisible();
  // ヒーロー：はじめは LATEST。記録がなければ数字は「—」
  await expect(visible(page, 'hero-page-latest')).toHaveAttribute('aria-selected', 'true');
  await expect(homeLatest(page)).toHaveAttribute('aria-label', '直近のトレーニング。まだ記録がありません');
  await expect(homeLatest(page)).toContainText('—');
  await expect(visible(page, 'day-body-tag')).toHaveCount(0);
  // 計器の段
  await expect(visible(page, 'home-big3')).toHaveAttribute('aria-label', 'BIG3 推定1RM 合計。BIG3 の記録がまだありません。筋トレの推移を開く');
  await expect(visible(page, 'volume-week')).toContainText('LOAD0.00t');
  await expect(visible(page, 'volume-week')).toContainText('vs LW —');
  await expect(visible(page, 'home-sleep')).toHaveAttribute('aria-label', '睡眠。昨夜 記録なし。目標 7時間。睡眠の推移を開く');
  // LOG：直近 4 週（28 マス）。今日（8日）は選んだ状態。週は W1〜W4
  await expect(visible(page, 'home-log').getByRole('button')).toHaveCount(28);
  await expect(cell(page, TODAY)).toHaveAttribute('aria-selected', 'true');
  await expect(cell(page, TODAY)).toHaveAccessibleName('11月8日（日） 今日、筋トレなし');
  await expect(visible(page, 'home-log')).toContainText('LOG // W1-W4');
  await expect(visible(page, 'home-log')).toContainText('NOV  0D · 0.00T');
  // PARTS と FUEL
  await expect(visible(page, 'home-parts')).toHaveAttribute('aria-label', '部位のバランス、直近28日のセット数。まだ記録がありません。筋トレの推移を開く');
  await expect(visible(page, 'home-parts-empty')).toHaveText('記録がたまると形になります');
  await expect(homeFuel(page)).toHaveAttribute('aria-label', '今日の食事 0kcal。休みの日。たんぱく質 0g、脂質 0g、炭水化物 0g。食事のタブを開く');
  // なくしたもの：カレンダー、今日のトレーニング・食事のカード、最近の流れ
  await expect(page.getByTestId('home-calendar')).toHaveCount(0);
  await expect(page.getByTestId('home-training')).toHaveCount(0);
  await expect(page.getByTestId('home-meals')).toHaveCount(0);
  await expect(page.getByTestId('recent-flow')).toHaveCount(0);
  // 週のまとめがなければ、今週やることは出さない。RM計算機の入口はホームにない
  await expect(visible(page, 'weekly-goals')).toHaveCount(0);
  await expect(visible(page, 'weekly-todo')).toHaveCount(0);
  await expect(button(page, 'RM計算機')).toHaveCount(0);
  // 体調のカードは残す
  await expect(homeCard(page, 'condition')).toContainText('今日の体調');
  await expect(homeCard(page, 'condition')).toContainText('まだ記録がありません');
  await expect(button(page, '記録する')).toBeVisible();

  // FUEL は食事のタブ、体調のカードはからだのタブ、SLEEP は睡眠の推移を開く
  await homeFuel(page).click();
  await expect(tab(page, '食事')).toHaveAttribute('aria-selected', 'true');
  await goTab(page, 'ホーム');
  await homeCard(page, 'condition').click();
  await expect(tab(page, 'からだ')).toHaveAttribute('aria-selected', 'true');
});

test('記録したあとの LATEST・LOAD・BIG3・LOG・PARTS', async ({ page }) => {
  // 今週（月曜始まり、11/2〜）：スクワット 100×5×3 = 1500kg
  await recordOn(page, '2026-11-03', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }, { weight: '100', reps: '5' }, { weight: '100', reps: '5' }] }]);
  // 今日：ベンチ 80×8、80×8、70×10 = 1980kg と、回数だけの懸垂（負荷量は 0）
  await recordOn(page, TODAY, [
    { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }, { weight: '80', reps: '8', memo: '最後きつい' }, { weight: '70', reps: '10' }] },
    { exercise: '懸垂', sets: [{ reps: '10' }] },
  ]);
  await moveToDate(page, TODAY);

  // LATEST：今日。2種目・4セット・1980kg。種目の札は 2 つ（EX-01・EX-02）
  await expect(homeLatest(page)).toHaveAttribute('aria-label', '直近のトレーニング 今日。2種目 4セット 1.98トン。1 ベンチプレス 80kg × 8、2 懸垂 10回。その日の記録を開く');
  await expect(homeLatest(page)).toContainText('TODAY');
  await expect(visible(page, 'home-latest-ex')).toContainText('SETS 4');
  await expect(visible(page, 'home-latest-load')).toContainText('1.98t');
  await expect(visible(page, 'day-body-tag')).toHaveCount(2);
  await expect(visible(page, 'day-body-tag').first()).toContainText('EX-01');

  // LOAD：今週（11/2〜11/8）は 1980 + 1500 = 3480kg → 3.48t。先週の記録はないので比は出さない
  await expect(visible(page, 'volume-week')).toContainText('3.48t');
  await expect(visible(page, 'volume-week')).toContainText('vs LW —');
  // BIG3：スクワット（11/3、116.7）とベンチ（今日、101.3）の合計 218.0。記録が 28 日に満たないので、始めた日（スクワットだけ 116.7）との差 +101.3
  await expect(visible(page, 'home-big3')).toContainText('218.0KG');
  await expect(visible(page, 'home-big3')).toContainText('Δ START +101.3');
  await expect(visible(page, 'home-big3')).toHaveAttribute(
    'aria-label', 'BIG3 推定1RM 合計 218.0kg。始めた日より +101.3kg。ベンチプレス 101.3kg、スクワット 116.7kg、デッドリフト まだ。筋トレの推移を開く',
  );

  // LOG：11/3 は脚、今日は胸。どちらもいちばん多い日の 2/3 を超えるので、いちばん濃い塗り。右上は今月の日数と合計
  await expect(cell(page, '2026-11-03')).toHaveAccessibleName('11月3日（火）、筋トレ 1.50トン 脚');
  await expect(cell(page, TODAY)).toHaveAccessibleName('11月8日（日） 今日、筋トレ 1.98トン 胸');
  await expect(cell(page, '2026-11-04')).toHaveAccessibleName('11月4日（水）、筋トレなし');
  await expect(visible(page, 'home-log')).toContainText('NOV  2D · 3.48T');

  // PARTS：直近 28 日のセット数（脚 3、胸 3。懸垂は背中 1）。今日の胸と背中は回復中
  await expect(visible(page, 'home-parts')).toHaveAttribute('aria-label', '部位のバランス、直近28日のセット数。'
    + '胸 3（前の28日 0） 回復中、肩 0（前の28日 0）、背中 1（前の28日 0） 回復中、腕 0（前の28日 0）、脚 3（前の28日 0）、腹 0（前の28日 0）。'
    + 'いちばん少ないのは肩。筋トレの推移を開く');
  await expect(visible(page, 'home-parts')).toContainText('LOW › 肩');
  await expect(visible(page, 'home-parts-empty')).toHaveCount(0);

  // LATEST の左上を押すと、筋トレのタブの記録のその日。推定1RM は 80 ×（1 ＋ 8 ÷ 30）= 101.33 → 101.3kg。メモも出る。懸垂は回数だけ
  await homeLatest(page).click();
  await expectTrainingDay(page, '11月8日（日）');
  await expect(see(page, '推定1RM 101.3kg')).toBeVisible();
  await expect(see(page, '80.0 kg × 8 回')).toHaveCount(2);
  await expect(see(page, '70.0 kg × 10 回')).toBeVisible();
  await expect(see(page, '最後きつい')).toBeVisible();
  await expect(see(page, '懸垂', { exact: true })).toBeVisible();
  await expect(see(page, '10 回', { exact: true })).toBeVisible();
});

test('BIG3：28 日前との差と 16 週の線。押すと筋トレの推移', async ({ page }) => {
  // 28 日前（10/11）より前：3種目とも 100×5（推定1RM 116.67）→ 合計 350.0
  await recordOn(page, '2026-10-01', ['ベンチプレス', 'スクワット', 'デッドリフト'].map((exercise) => ({ exercise, sets: [{ weight: '100', reps: '5' }] })));
  await moveToDate(page, TODAY);
  await expect(visible(page, 'home-big3')).toContainText('350.0KG');
  await expect(visible(page, 'home-big3')).toContainText('Δ 28D +0.0');
  // 今日：スクワット 110×5（128.33）→ 合計 361.7、28 日前より +11.7
  await recordToday(page, [{ exercise: 'スクワット', sets: [{ weight: '110', reps: '5' }] }]);
  await expect(visible(page, 'home-big3')).toContainText('361.7KG');
  await expect(visible(page, 'home-big3')).toContainText('Δ 28D +11.7');
  await expect(visible(page, 'home-big3')).toHaveAttribute(
    'aria-label', 'BIG3 推定1RM 合計 361.7kg。28日前より +11.7kg。ベンチプレス 116.7kg、スクワット 128.3kg、デッドリフト 116.7kg。筋トレの推移を開く',
  );
  await expect(visible(page, 'home-big3').locator('svg polyline')).toHaveCount(1);
  // 今日は自己ベストを更新した（スクワット）。LATEST の右下に 1
  await expect(visible(page, 'home-latest-pr')).toContainText('1');
  await expect(homeLatest(page)).toHaveAttribute('aria-label', /自己ベスト 1（スクワット）/);

  // 押すと筋トレのタブの「推移」
  await visible(page, 'home-big3').click();
  await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '推移', exact: true }).filter({ visible: true })).toHaveAttribute('aria-selected', 'true');

  // PARTS を押したときの行き先（推移の 2週）は trend.spec.ts の「記録があるときの推移」で確かめる
});

test('「記録する」のシート：食事は時刻から区分を決め、体重はからだのタブで計測のシートを開く。FUEL・体重の点・目標体重まで', async ({ page }) => {
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
  await goTab(page, 'ホーム');
  // FUEL：今日の kcal。目標がないので、LOG の食事の下線（目標を達成）は出ない
  await expect(homeFuel(page)).toHaveAttribute('aria-label', /^今日の食事 312kcal。/);
  await expect(homeFuel(page)).toContainText('312KCAL');
  await expect(page.getByTestId(`log-meal-${TODAY}`)).toHaveCount(0);

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
  // LOG の今日のマスに、体重を測った点
  await expect(visible(page, `log-weighed-${TODAY}`)).toBeVisible();
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
});

// 形は web では描かない（components/growth/GrowthShape.web.tsx）。スコアの計算と文言は jest（lib/__tests__/growth.test.ts・home.test.ts）。
// ここはヒーローの GROWTH のページの文字と押せるものが出ること
test('ヒーローの GROWTH のページ：育つ形・PHASE・PACE・WEIGHT・成長スコア。スコアを押すと内訳のシート。開き直すと LATEST から', async ({ page }) => {
  await openApp(page);
  // はじめは LATEST。GROWTH は切り替えるまで描かない
  await expect(page.getByTestId('growth-stage')).toHaveCount(0);
  await visible(page, 'hero-page-growth').click();
  await expect(visible(page, 'hero-page-growth')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('home-latest')).toHaveCount(0);
  const stage = visible(page, 'growth-stage');
  await expect(button(stage, '成長の形（点の軌跡）。押すと成長を見る画面を開く')).toBeVisible();
  // 右上はフェーズのペース（「成長を見る」は形を押して開く）。フェーズがなければ PHASE・PACE は「—」、WEIGHT は体重がまだない
  await expect(button(stage, '成長を見る')).toHaveCount(0);
  await expect(visible(page, 'hero-growth')).toHaveAccessibleName('フェーズは未設定。体重 週平均 まだ。フェーズを始める');
  await expect(visible(page, 'hero-swipe')).toContainText('PACE //—NO DATA');

  // 記録がまだないときは「—」。内訳もどの柱も「—」で、先週との差は出さない
  const noScore = button(stage, '成長スコア まだ記録がありません。押すと内訳');
  await expect(noScore).toHaveText('SCORE //—成長スコア');
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
  // 開き直すと LATEST から（前に見たページは覚えない）
  await expect(visible(page, 'hero-page-latest')).toHaveAttribute('aria-selected', 'true');
  await visible(page, 'hero-page-growth').click();
  await recordToday(page, [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  const score = button(stage, '成長スコア 67点、直近7日。先週より 34点高い。押すと内訳');
  await expect(score).toHaveText('SCORE //67成長スコア↑ +34');
  await score.click();
  await expect(sheet.getByTestId('growth-score-training')).toHaveText('筋トレ27 / 40');
  await expect(sheet.getByTestId('growth-score-meal')).toHaveText('食事—');
  await expect(sheet.getByTestId('growth-score-sleep')).toHaveText('睡眠—');
  await expect(sheet.getByTestId('growth-score-total')).toHaveText('合計67 / 100');
  await expect(sheet.getByTestId('growth-score-week')).toHaveText('先週との差↑ +34');
});

test('タブを移ってホームに戻ると、数え上げをやり直して最後の値に着く', async ({ page }) => {
  await recordOn(page, TODAY, [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await moveToDate(page, TODAY);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(visible(page, 'volume-week')).toContainText('0.64t');
  await goTab(page, '食事');
  await goTab(page, 'ホーム');
  // 0 から数え直したあと、最後の値になる（動きの途中は web の確認では捉えない）
  await expect(visible(page, 'volume-week')).toContainText('0.64t');
  await expect(visible(page, 'home-parts')).toBeVisible();
  expect(errors).toEqual([]);
});
