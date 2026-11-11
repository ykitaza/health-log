import { expect, Locator, test } from '@playwright/test';
import { addEntry, button, goTab, homeCard, moveToDate, openApp, recordOn, see, TODAY } from './helpers';

// その日の部位：記録のまとめの「部位」、今日が空のときの「部位ごとの前回」とおすすめ、ホームの今日のトレーニングと「最近の流れ」。
// その日の部位の決め方（総負荷量・7割）・前回とおすすめの選び方は jest（lib/__tests__/training.test.ts）。
// ここは画面に出ることと、412 より狭い 360 の幅で崩れないこと
test.use({ viewport: { width: 360, height: 800 } });

const box = async (l: Locator) => (await l.boundingBox())!;
const visible = (l: Locator) => l.filter({ visible: true });

test('360 の幅：背中・脚・胸の日のあと、今日が空なら前回とおすすめ。ホームの最近の流れ。今日の種目を足すとまとめの部位は「胸」', async ({ page }) => {
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
  expect(flowBox.height).toBeLessThanOrEqual(32.5); // 「最近」も1行
  const calendar = await box(visible(page.getByTestId('home-calendar')));
  expect(flowBox.x + flowBox.width).toBeLessThanOrEqual(calendar.x + calendar.width + 0.5);
  expect((await box(flow.getByTestId('recent-flow-day').first())).width).toBeGreaterThanOrEqual(24);
  expect((await box(flow.getByTestId('recent-flow-day').first())).height).toBeLessThanOrEqual(32.5);

  // 押すと筋トレの記録のタブ：今日は空なので「部位ごとの前回」と、その下に前回のメニュー
  await card.click();
  const last = visible(page.getByTestId('part-last'));
  await expect(last).toBeVisible();
  await expect(see(page, 'まだ種目がありません')).toHaveCount(0);
  await expect(last.getByTestId('part-last-胸')).toHaveAttribute('aria-label', '胸、2日前、11月6日（金）');
  await expect(last.getByTestId('part-last-脚')).toHaveAttribute('aria-label', '脚、4日前、11月4日（水）');
  await expect(last.getByTestId('part-last-背中')).toHaveAttribute('aria-label', '背中、6日前、11月2日（月）、いちばん空いている');
  // 前回の新しい順。いちばん空いている行に緑の文字
  const order = await Promise.all(['胸', '脚', '背中'].map(async (n) => (await box(last.getByTestId(`part-last-${n}`))).y));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(last.getByTestId('part-last-背中')).toContainText('いちばん空いている');
  // 日数・日付・「いちばん空いている」はそれぞれ1行（折り返すなら「いちばん空いている」ごと次の行）
  for (const t of ['6日前', '11月2日（月）', 'いちばん空いている']) {
    expect((await box(last.getByTestId('part-last-背中').getByText(t, { exact: true }))).height).toBeLessThan(26);
  }
  // 文は1行に収め、カードからはみ出さない
  const lastBox = await box(last);
  const text = last.getByTestId('part-suggest-text');
  await expect(text).toHaveText('今日は背中はどう？');
  await expect(text).toHaveAttribute('aria-label', '今日は 背中 はどう？');
  const textBox = await box(text);
  expect(textBox.height).toBeLessThan(30); // 1行（札の高さ 24）
  expect(textBox.x + textBox.width).toBeLessThanOrEqual(lastBox.x + lastBox.width);
  const choose = button(last, '背中の種目を選ぶ');
  const chooseBox = await box(choose);
  expect(chooseBox.height).toBeGreaterThanOrEqual(48);
  expect(chooseBox.x + chooseBox.width).toBeLessThanOrEqual(lastBox.x + lastBox.width);
  const menu = visible(page.getByTestId('previous-menu'));
  expect((await box(menu)).y).toBeGreaterThan(lastBox.y + lastBox.height);

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

  // 今日の種目を足したら「部位ごとの前回」は出さない。まとめの部位は「背中」（体重の記録がないので、セットの数で）
  await expect(page.getByTestId('part-last')).toHaveCount(0);
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

test('背中・脚・胸以外の日はダンベル。過去の日のまとめも総負荷量の部位', async ({ page }) => {
  await openApp(page, '2026-11-06');
  await recordOn(page, '2026-11-06', [{ exercise: 'ショルダープレス', sets: [{ weight: '40', reps: '10' }] }]);
  await moveToDate(page, TODAY);
  const flow = visible(page.getByTestId('recent-flow'));
  // 背中・脚・胸の記録がないので、おすすめは出さない（流れは過去の日だけ）
  await expect(flow).toHaveAttribute('aria-label', '最近の部位の流れ。11月6日 肩');
  await expect(homeCard(page, 'training').getByTestId('home-training-prev')).toHaveText('まだ記録なし ・前回肩2日前');
  await expect(homeCard(page, 'training').getByTestId('home-training-suggest')).toHaveCount(0);
  await goTab(page, '筋トレ');
  await expect(page.getByTestId('part-last')).toHaveCount(0);
  await expect(see(page, 'まだ種目がありません')).toBeVisible();
  await button(page, '前の日').click();
  await button(page, '前の日').click();
  await expect(visible(page.getByTestId('day-parts'))).toHaveText('部位肩');
});
