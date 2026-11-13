import { expect, Locator, test } from '@playwright/test';
import { addEntry, button, goTab, homeCard, moveToDate, openApp, recordOn, see, TODAY } from './helpers';

// その日の部位：記録のまとめの「部位」、今日が空のときの回復マップのすすめ、ホームの今日のトレーニングと「最近の流れ」。
// その日の部位の決め方（総負荷量・7割）・ホームのおすすめの選び方は jest（lib/__tests__/training.test.ts）、回復マップのすすめは lib/__tests__/recoveryMap.test.ts。
// ここは画面に出ることと、412 より狭い 360 の幅で崩れないこと
test.use({ viewport: { width: 360, height: 800 } });

const box = async (l: Locator) => (await l.boundingBox())!;
const visible = (l: Locator) => l.filter({ visible: true });

test('360 の幅：背中・脚・胸の日のあと、今日が空なら回復マップのすすめと前回。ホームの最近の流れ。今日の種目を足すとまとめの部位は「胸」', async ({ page }) => {
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

  // ホーム：今日のトレーニングの2・3行目
  const card = homeCard(page, 'training');
  await expect(card.getByTestId('home-training-prev')).toHaveText('まだ記録なし ・前回胸2日前');
  await expect(card.getByTestId('home-training-suggest')).toHaveText('おすすめ背中6日あいている');
  await expect(card).toHaveAccessibleName('今日のトレーニングを開く。まだ記録なし、前回 胸 2日前。おすすめ 背中 6日あいている');
  // 360 の幅では「前回 [胸] 2日前」をまとめて次の行へ回してよい（札と日数は同じ行）。カードからはみ出さない
  const cardBox = await box(card);
  for (const l of [card.getByTestId('home-training-prev-part'), card.getByTestId('home-training-suggest')]) {
    const line = await box(l);
    expect(line.height).toBeLessThan(30); // 1行（札の高さ 24）
    expect(line.x + line.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  }
  // Pixel の 412 の幅では、2行目も1行に収まる
  await page.setViewportSize({ width: 412, height: 915 });
  expect((await box(card.getByTestId('home-training-prev'))).height).toBeLessThan(30);
  await page.setViewportSize({ width: 360, height: 800 });

  // ホーム：最近の流れ（3回の日と、今日のおすすめの点線の枠）。左の列からはみ出さない
  const flow = visible(page.getByTestId('recent-flow'));
  await expect(flow).toHaveAttribute('aria-label', '最近の部位の流れ。11月2日 背中、11月4日 脚、11月6日 胸。今日のおすすめは背中');
  await expect(flow.getByTestId('recent-flow-day')).toHaveCount(3);
  await expect(flow.getByTestId('recent-flow-planned')).toHaveCount(1);
  const flowBox = await box(flow);
  expect(flowBox.height).toBeLessThanOrEqual(51.5); // 「最近」も1行（縦長の四角の高さ 51）
  const calendar = await box(visible(page.getByTestId('home-calendar')));
  expect(flowBox.x + flowBox.width).toBeLessThanOrEqual(calendar.x + calendar.width + 0.5);
  // 四角は幅だけ縮み（筋肉の図の幅 23.5 は残す）、高さは 51 のまま
  const dayBox = await box(flow.getByTestId('recent-flow-day').first());
  expect(dayBox.width).toBeGreaterThanOrEqual(24);
  expect(dayBox.height).toBeCloseTo(51, 0);
  // 左の列（MONTHLY ARCHIVE）と右の列（部位のバランス）の下の端がそろう
  const archive = await box(visible(page.getByTestId('archive')));
  const balance = await box(visible(page.getByTestId('home-part-balance')));
  expect(Math.abs(archive.y + archive.height - (balance.y + balance.height))).toBeLessThan(1);

  // 押すと筋トレの記録のタブ：今日は空なので、まだ記録がないことと、回復マップのすすめ（回復済みでいちばん前の部位）、その下に前回の1行
  await card.click();
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

  // ホーム：今日やったので今までの1行。最近の流れの最後は今日の部位（普通の枠）
  await goTab(page, 'ホーム');
  // 見出しの右に部位の札「胸」。2行目は今までどおりの数字（省かない）。読み上げに「今日の部位 胸」
  const badge = card.getByTestId('home-training-parts');
  await expect(badge).toHaveText('胸');
  await expect(card).toHaveAccessibleName('今日のトレーニングを開く。今日の部位 胸。2種目 ・ 3セット ・ 1.28 t');
  await expect(card.getByText('2種目 ・ 3セット ・ 1.28 t', { exact: true })).toBeVisible();
  const cardNow = await box(card);
  const title = await box(card.getByText('今日のトレーニング', { exact: true }));
  const badgeBox = await box(badge);
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(cardNow.x + cardNow.width - 24);
  // 見出しは切れない（札が収まらなければ次の行）
  expect(title.width).toBeGreaterThan(130);
  await expect(card.getByTestId('home-training-suggest')).toHaveCount(0);
  await expect(flow).toHaveAttribute('aria-label', '最近の部位の流れ。11月2日 背中、11月4日 脚、11月6日 胸。今日 胸');
  await expect(flow.getByTestId('recent-flow-day')).toHaveCount(4);
  await expect(flow.getByTestId('recent-flow-planned')).toHaveCount(0);
});

test('背中・脚・胸以外の日（肩）：ホームのおすすめは出さない。記録の画面も回復中の肩はすすめない。過去の日のまとめも総負荷量の部位', async ({ page }) => {
  await openApp(page, '2026-11-06');
  await recordOn(page, '2026-11-06', [{ exercise: 'ショルダープレス', sets: [{ weight: '40', reps: '10' }] }]);
  await moveToDate(page, TODAY);
  const flow = visible(page.getByTestId('recent-flow'));
  // 背中・脚・胸の記録がないので、おすすめは出さない（流れは過去の日だけ）
  await expect(flow).toHaveAttribute('aria-label', '最近の部位の流れ。11月6日 肩');
  await expect(homeCard(page, 'training').getByTestId('home-training-prev')).toHaveText('まだ記録なし ・前回肩2日前');
  await expect(homeCard(page, 'training').getByTestId('home-training-suggest')).toHaveCount(0);
  // 筋トレの記録のタブ：肩は回復中（2日前、あと1日）で、ほかは一度もないので、すすめは出さない
  await goTab(page, '筋トレ');
  await expect(see(page, 'まだ記録がありません')).toBeVisible();
  await expect(visible(page.getByTestId('recovery-hero'))).toHaveAttribute('aria-label', '回復マップ。緑は回復済み、暖色は回復中、赤はケガ。回復中の部位、肩 あと1日');
  await expect(page.getByTestId('recovery-hero-suggest')).toHaveCount(0);
  await button(page, '前の日').click();
  await button(page, '前の日').click();
  await expect(visible(page.getByTestId('day-parts'))).toHaveText('部位肩');
});
