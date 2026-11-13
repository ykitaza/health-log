import { expect, Locator, test } from '@playwright/test';
import { addEntry, button, goTab, moveToDate, openApp, recordOn, see, TODAY } from './helpers';

// その日の部位：記録のまとめの「部位」、今日が空のときの回復マップのすすめ、ホームの LOG の部位の頭文字と今日のおすすめ。
// その日の部位の決め方（総負荷量・7割）・ホームのおすすめの選び方は jest（lib/__tests__/training.test.ts）、回復マップのすすめは lib/__tests__/recoveryMap.test.ts。
// ここは画面に出ることと、412 より狭い 360 の幅で崩れないこと
test.use({ viewport: { width: 360, height: 800 } });

const box = async (l: Locator) => (await l.boundingBox())!;
const visible = (l: Locator) => l.filter({ visible: true });

test('360 の幅：背中・脚・胸の日のあと、今日が空なら回復マップのすすめと前回。ホームの LOG の今日のおすすめ。今日の種目を足すとまとめの部位は「胸」', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, '2026-11-02');
  await recordOn(page, '2026-11-02', [{ exercise: 'デッドリフト', sets: [{ weight: '100', reps: '5' }] }]);
  await recordOn(page, '2026-11-04', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  // 胸 80×8 = 640、肩 20×10 = 200（7割未満）→ 胸の日
  await recordOn(page, '2026-11-06', [
    { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] },
    { exercise: 'サイドレイズ', sets: [{ weight: '20', reps: '10' }] },
  ]);
  await moveToDate(page, TODAY);

  // ホーム：LOG の今日のマスに、今日のおすすめ（背中 → 頭文字「背」）。前の日のマスには、その日の部位の頭文字
  const cell = (d: string) => visible(page.getByTestId(`log-${d}`));
  await expect(cell(TODAY).getByTestId('log-suggest')).toHaveText('背');
  await expect(cell(TODAY)).toHaveAccessibleName('11月8日（日） 今日、おすすめ 背中');
  await expect(cell('2026-11-02')).toContainText('背');
  await expect(cell('2026-11-04')).toContainText('脚');
  await expect(cell('2026-11-06')).toContainText('胸');
  // 360 の幅でも、マスは方眼の中に収まり、押せる高さ（44）がある
  const log = await box(visible(page.getByTestId('home-log')));
  const today = await box(cell(TODAY));
  expect(today.x + today.width).toBeLessThanOrEqual(log.x + log.width);
  expect(today.height).toBeGreaterThanOrEqual(44);

  // 筋トレのタブの記録（今日）：今日は空なので、まだ記録がないことと、回復マップのすすめ（回復済みでいちばん前の部位）、その下に前回の1行
  await goTab(page, '筋トレ');
  await expect(visible(page.getByTestId('no-workout'))).toContainText('まだ記録がありません');
  const hero = visible(page.getByTestId('recovery-hero'));
  // 胸・肩（11-06、回復 2日）は回復中、脚（11-04、3日）と背中（11-02）は回復済み → いちばん前の背中
  await expect(hero).toHaveAttribute('aria-label', '回復マップ。緑は回復済み、暖色は回復中、赤はケガ。回復中の部位、胸 あと1日、肩 あと1日');
  const suggest = visible(page.getByTestId('recovery-hero-suggest'));
  const text = suggest.getByLabel('今日は 背中 はどう？ 6日前、回復済み', { exact: true });
  await expect(text).toHaveText('今日は背中はどう？6日前・回復済み');
  // 文は1行に収め、カードからはみ出さない（360 の幅ではボタンが次の行へ回ってよい）
  const heroCard = await box(hero.locator('..'));
  const textBox = await box(text);
  expect(textBox.height).toBeLessThan(30); // 1行（札の高さ 24）
  expect(textBox.x + textBox.width).toBeLessThanOrEqual(heroCard.x + heroCard.width);
  const choose = button(suggest, '背中の種目を選ぶ');
  const chooseBox = await box(choose);
  expect(chooseBox.height).toBeGreaterThanOrEqual(48);
  expect(chooseBox.x + chooseBox.width).toBeLessThanOrEqual(heroCard.x + heroCard.width);
  const prev = visible(page.getByTestId('previous-line'));
  await expect(prev).toContainText('前回 11月6日（金） 胸・肩');
  expect((await box(prev)).y).toBeGreaterThan(textBox.y + textBox.height);
  // 部位から記録のチップに回復の状態（色の点と「あと1日」）
  await expect(button(hero.locator('..'), '胸の種目を選ぶ、回復中 あと1日')).toContainText('あと1日');

  // 「背中の種目を選ぶ」：種目を選ぶ画面を背中のチップで開く
  await choose.click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await expect(button(page, 'ラットプルダウン')).toHaveCount(0); // 名前だけでなく前回の文も入るので、行は前方一致で探す
  await expect(page.getByRole('button', { name: /^ラットプルダウン / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^ベンチプレス / })).toHaveCount(0);
  await page.getByRole('button', { name: /^懸垂 / }).click();
  await page.getByLabel('セット1の回数', { exact: true }).fill('10');
  await page.getByRole('button', { name: '今日のトレーニングに追加', exact: true }).click();
  await expect(page.getByRole('button', { name: /^懸垂を直す/ })).toBeVisible();

  // 今日の種目を足したら回復マップは出さない。まとめの部位は「背中」（体重の記録がないので、セットの数で）
  await expect(page.getByTestId('recovery-hero')).toHaveCount(0);
  const parts = visible(page.getByTestId('day-parts'));
  await expect(parts).toHaveText('部位背中');
  // 胸 80×8×2 = 1280 で背中（負荷量 0）より多い → 胸
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }, { weight: '80', reps: '8' }]);
  await expect(parts).toHaveText('部位胸');
  await expect(parts).toHaveAttribute('aria-label', '部位 胸');

  // ホーム：今日やったので、今日のマスはおすすめではなく今日の部位（胸）
  await goTab(page, 'ホーム');
  await expect(cell(TODAY).getByTestId('log-suggest')).toHaveCount(0);
  await expect(cell(TODAY)).toContainText('胸');
  await expect(cell(TODAY)).toHaveAccessibleName(/^11月8日（日） 今日、筋トレ 1\.28トン 胸/);
});

test('背中・脚・胸以外の日（肩）：ホームのおすすめは出さない。記録の画面も回復中の肩はすすめない。過去の日のまとめも総負荷量の部位', async ({ page }) => {
  await openApp(page, '2026-11-06');
  await recordOn(page, '2026-11-06', [{ exercise: 'ショルダープレス', sets: [{ weight: '40', reps: '10' }] }]);
  await moveToDate(page, TODAY);
  // 背中・脚・胸の記録がないので、LOG の今日のマスにおすすめは出さない。11/6 のマスは肩
  await expect(visible(page.getByTestId('log-suggest'))).toHaveCount(0);
  await expect(visible(page.getByTestId('log-2026-11-06'))).toContainText('肩');
  // 筋トレの記録のタブ：肩は回復中（2日前、あと1日）で、ほかは一度もないので、すすめは出さない
  await goTab(page, '筋トレ');
  await expect(see(page, 'まだ記録がありません')).toBeVisible();
  await expect(visible(page.getByTestId('recovery-hero'))).toHaveAttribute('aria-label', '回復マップ。緑は回復済み、暖色は回復中、赤はケガ。回復中の部位、肩 あと1日');
  await expect(page.getByTestId('recovery-hero-suggest')).toHaveCount(0);
  await button(page, '前の日').click();
  await button(page, '前の日').click();
  await expect(visible(page.getByTestId('day-parts'))).toHaveText('部位肩');
});
