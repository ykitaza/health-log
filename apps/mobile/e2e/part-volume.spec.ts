import { expect, Locator, Page, test } from '@playwright/test';
import { goTab, moveToDate } from './helpers';
import { bulkPhase, change, EXERCISE, openWith, workout } from './seed';

// ホームの「部位の量」：宣言したフェーズ（なければ直近 4 週）の、部位ごとのセット数・1 週間あたり・1 週間 10〜20 セットの目安との差。
// 集計・段・文字・読み上げ・札の選び方は jest（lib/__tests__/partVolume.test.ts・heroTags.test.ts）。ここは画面に出ること：行の文字、読み上げ、行の四角と 2D の図の塗り、
// ホームの体の「回復」「部位の量」の切り替えと、色の見方ごとの札（気にしたい部位が多くても 3 つ。体を押すと、その部位の札を足す）。
// 記録は偽の同期サーバーから入れる（40 セットなどを画面で 1 つずつ記録しない。e2e/seed.ts）。今日は 2026-11-08（日）なので、フェーズなしの直近 4 週は 10/12〜11/8。
// 週のまとめの同じ形のカード（月曜〜日曜。report-weekly-volume）は reports.spec.ts。色の見分けのスクリーンショットは SHOT_DIR（このファイルの最後のテスト）

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const row = (page: Page, part: string) => visible(page, `home-parts-body-row-${part}`);
const swatch = (page: Page, part: string) => visible(page, `home-parts-body-swatch-${part}`);

// theme の volumePalette（0 は図の筋肉の灰色、1〜5 段は青の濃淡）。sub は colors.sub
const RGB = {
  empty: 'rgb(74, 81, 93)', level1: 'rgb(42, 120, 173)', level2: 'rgb(58, 154, 217)', level3: 'rgb(99, 189, 245)',
  level5: 'rgb(221, 242, 255)',
};
const FILL = { level1: '#2A78AD', level2: '#3A9AD9', level3: '#63BDF5', level5: '#DDF2FF', empty: '#4A515D' };
const RECOVERY_COLORS = ['#5BE49B', '#A6F2C8', '#FF8A3D', '#F5C94A', '#FF5A4F'];

/**
 * フェーズなし（直近 4 週 = 10/12〜11/8、weeks 4）：胸 40 → 週 10.0（3 段・目安内）、肩 20 → 5.0（2 段・あと5）、背中 4 → 1.0（1 段・あと9）、
 * 腕 90 → 22.5（5 段・多い）、脚 5（10/13）+ 3（今日）= 8 → 2.0（1 段・あと8）、腹 0。10/11 の脚 30 は期間の外。
 * 回復：脚は今日（回復 3 日 → あと4日）、背中は昨日（あと3日）。ほかは回復済み
 */
const noPhase = () => [
  ...workout('2026-11-03', EXERCISE.bench, 40), ...workout('2026-11-02', EXERCISE.shoulderPress, 20), ...workout('2026-11-07', EXERCISE.pullUp, 4),
  ...workout('2026-10-20', EXERCISE.curl, 90), ...workout('2026-10-13', EXERCISE.squat, 5), ...workout('2026-11-08', EXERCISE.squat, 3),
  ...workout('2026-10-11', EXERCISE.squat, 30),
];

test('フェーズなし：「直近4週の部位」。6 つの行（セット数・週あたり・目安との差）、行の四角と図の塗り、読み上げ。押すと筋トレの推移の部位のバランス', async ({ page, context }) => {
  test.setTimeout(150_000);
  await openWith(page, context, noPhase());
  const card = visible(page, 'home-parts');

  await test.step('見出しと期間。先週比と凡例は出さない。FUEL は全幅で、下の別の段', async () => {
    await expect(card).toContainText('直近4週の部位');
    await expect(card).toContainText('10/12–11/8');
    for (const gone of ['今週', '先週比', '凡例', 'PARTS']) await expect(card).not.toContainText(gone);
    const parts = (await card.boundingBox())!;
    const fuel = (await visible(page, 'home-fuel').boundingBox())!;
    expect(fuel.y).toBeGreaterThanOrEqual(parts.y + parts.height);
    expect(Math.abs(fuel.width - parts.width)).toBeLessThan(2);
  });

  await test.step('6 つの行：セット数・週あたり・目安との差', async () => {
    await expect(row(page, '胸')).toHaveText('胸40セット週 10.0目安内');
    await expect(row(page, '肩')).toHaveText('肩20セット週 5.0あと5');
    await expect(row(page, '背中')).toHaveText('背中4セット週 1.0あと9');
    await expect(row(page, '腕')).toHaveText('腕90セット週 22.5目安より多い');
    await expect(row(page, '脚')).toHaveText('脚8セット週 2.0あと8');
    await expect(row(page, '腹')).toHaveText('腹0セット週 0あと10');
  });

  await test.step('行の四角：週あたりの段（0 は灰色、1〜4 は 1 段、5〜9 は 2 段、10〜14 は 3 段、21 以上は 5 段）', async () => {
    await expect(swatch(page, '腹')).toHaveCSS('background-color', RGB.empty);
    await expect(swatch(page, '背中')).toHaveCSS('background-color', RGB.level1);
    await expect(swatch(page, '脚')).toHaveCSS('background-color', RGB.level1);
    await expect(swatch(page, '肩')).toHaveCSS('background-color', RGB.level2);
    await expect(swatch(page, '胸')).toHaveCSS('background-color', RGB.level3);
    await expect(swatch(page, '腕')).toHaveCSS('background-color', RGB.level5);
  });

  await test.step('2D の図（前と後ろ）：胸は 3 段、肩は 2 段、脚と背中は 1 段、腹は灰色。回復の色・赤は使わない', async () => {
    const front = visible(page, 'home-parts-body-figure-front');
    const back = visible(page, 'home-parts-body-figure-back');
    await expect(front.locator(`path[fill="${FILL.level3}"]`).first()).toBeAttached();
    await expect(front.locator(`path[fill="${FILL.level2}"]`).first()).toBeAttached();
    await expect(front.locator(`path[fill="${FILL.level1}"]`).first()).toBeAttached();
    await expect(front.locator(`path[fill="${FILL.level5}"]`).first()).toBeAttached(); // 腕
    await expect(back.locator(`path[fill="${FILL.level1}"]`).first()).toBeAttached();
    await expect(front.locator(`path[fill="${FILL.empty}"]`).first()).toBeAttached();
    for (const c of RECOVERY_COLORS) await expect(card.locator(`path[fill="${c}"]`)).toHaveCount(0);
    await expect(card.locator('[data-testid^="home-parts-body-injury-"]')).toHaveCount(0);
  });

  await test.step('読み上げ：期間・目安・部位ごとのセット数と週あたりと目安との差', async () => {
    await expect(card).toHaveAttribute('aria-label', '直近4週の部位、10月12日から11月8日。1 週間あたりのセット数（目安は 10〜20）。'
      + '胸 40 セット、週 10.0、目安内。肩 20 セット、週 5.0、あと5。背中 4 セット、週 1.0、あと9。'
      + '腕 90 セット、週 22.5、目安より多い。脚 8 セット、週 2.0、あと8。腹 0 セット、週 0、あと10。筋トレの推移を開く');
  });

  await test.step('押すと筋トレの推移の部位のバランス（覚えている期間のまま。28日にしない）', async () => {
    await card.click();
    await expect(page.getByRole('tab', { name: '推移', exact: true }).filter({ visible: true })).toHaveAttribute('aria-selected', 'true');
    const balance = visible(page, 'trend-part-balance');
    await expect(balance).toHaveAttribute('aria-label', /^部位のバランス、直近2週のセット数。/);
    await expect(page.getByRole('button', { name: '2週', exact: true }).filter({ visible: true })).toHaveAttribute('aria-selected', 'true');
    await goTab(page, 'ホーム');
  });
});

/** 図を押す（図の中の割合で。前の図の胸は上のほう、腹は中ほど） */
async function pressFigure(press: Locator, x: number, y: number) {
  const box = (await press.boundingBox())!;
  await press.click({ position: { x: box.width * x, y: box.height * y } });
}

test('ホームの体：「回復」と「部位の量」の切り替え。色・キャプション・読み上げ・札が見方に合わせて変わり、種目の札は出ない。選んだものは覚える', async ({ page, context }) => {
  test.setTimeout(150_000);
  await openWith(page, context, noPhase());
  const hero = visible(page, 'home-hero');
  const mode = visible(page, 'hero-body-mode');
  const body = hero.getByTestId('day-body-2d');
  const latest = visible(page, 'home-latest');
  const caption = page.getByTestId('hero-body-caption');
  const tags = visible(page, 'hero-body-tag');
  const tab = (name: string) => mode.getByRole('button', { name, exact: true });

  await test.step('初めは「回復」：回復中の部位の札だけ（背中はあと3日、脚はあと4日）。種目の札（EX-）は出ない', async () => {
    await expect(tab('回復')).toHaveAttribute('aria-selected', 'true');
    await expect(caption).toHaveCount(0);
    await expect(tags).toHaveCount(2);
    await expect(tags.filter({ hasText: '脚' })).toHaveText('脚あと4日');
    await expect(tags.filter({ hasText: '背中' })).toHaveText('背中あと3日');
    await expect(page.getByTestId('day-body-tag')).toHaveCount(0);
    await expect(hero).not.toContainText('EX-0');
    await expect(latest).toHaveAttribute('aria-label', /回復中 背中 あと3日、脚 あと4日/);
    for (const c of [FILL.level1, FILL.level2, FILL.level3, FILL.level5]) await expect(body.locator(`path[fill="${c}"]`)).toHaveCount(0);
  });

  await test.step('回復の札は押せない（種目の札ではないので、押しても記録を開かない）。LATEST の四隅はそのまま：日付・種目の数・合計負荷量・自己ベスト', async () => {
    await expect(latest).toContainText('TODAY');
    await expect(visible(page, 'home-latest-ex')).toContainText('SETS 3');
    await tags.nth(0).click({ force: true });
    await expect(visible(page, 'home-hero')).toBeVisible();
    await expect(page.getByTestId('hero-body-tag')).toHaveCount(2);
  });

  await test.step('「部位の量」：週あたりの段の色。キャプションと読み上げ。札は目安から外れた部位を外れ方の大きい順に 3 つ（腹・背中・脚）', async () => {
    await tab('部位の量').click();
    await expect(tab('部位の量')).toHaveAttribute('aria-selected', 'true');
    await expect(caption).toHaveText('直近4週の部位（1週あたり）');
    await expect(latest).toHaveAttribute('aria-label', /直近4週の部位の量、10月12日から11月8日の 1 週間あたりのセット数。胸 10.0、肩 5.0、背中 1.0、腕 22.5、脚 2.0、腹 0。/);
    await expect(latest).not.toHaveAttribute('aria-label', /回復中/);
    await expect(body.locator(`path[fill="${FILL.level3}"]`).first()).toBeAttached(); // 胸
    await expect(body.locator(`path[fill="${FILL.level5}"]`).first()).toBeAttached(); // 腕
    await expect(body.locator(`path[fill="${FILL.empty}"]`).first()).toBeAttached(); // 腹
    for (const c of RECOVERY_COLORS) await expect(body.locator(`path[fill="${c}"]`)).toHaveCount(0);
    await expect(tags).toHaveCount(3);
    await expect(tags.filter({ hasText: '腹' })).toHaveText('腹週0あと10');
    await expect(tags.filter({ hasText: '背中' })).toHaveText('背中週1.0あと9');
    await expect(tags.filter({ hasText: '脚' })).toHaveText('脚週2.0あと8');
    // 目安の中の胸・あと5 の肩・多い腕は、先頭 3 つに入らない
    await expect(tags.filter({ hasText: '胸' })).toHaveCount(0);
    await expect(page.getByTestId('day-body-tag')).toHaveCount(0);
  });

  const pressFront = visible(page, 'day-body-2d-press-front');
  await test.step('体を押すと、その部位の札を足す（先頭 3 つの外でも）。もう一度押す・体の外を押すと消える', async () => {
    await pressFigure(pressFront, 0.42, 0.225); // 胸
    await expect(tags).toHaveCount(4);
    await expect(tags.filter({ hasText: '胸' })).toHaveText('胸週10.0目安内');
    await pressFigure(pressFront, 0.42, 0.225);
    await expect(tags).toHaveCount(3);
    await pressFigure(pressFront, 0.42, 0.225);
    await expect(tags).toHaveCount(4);
    await pressFigure(pressFront, 0.02, 0.98); // 体の外
    await expect(tags).toHaveCount(3);
    // 先頭 3 つに入っている部位（脚）を押しても、札は増えない
    await pressFigure(pressFront, 0.4, 0.7);
    await expect(tags).toHaveCount(3);
  });

  await test.step('押した部位は、見方を変えても残る（回復では胸は回復済み）。覚えた見方で開き直す', async () => {
    await pressFigure(pressFront, 0.42, 0.225);
    await expect(tags).toHaveCount(4);
    await tab('回復').click();
    await expect(caption).toHaveCount(0);
    await expect(tags).toHaveCount(3);
    await expect(tags.filter({ hasText: '胸' })).toHaveText('胸回復済み');
    await expect(latest).toHaveAttribute('aria-label', /回復中/);
    await expect(body.locator(`path[fill="${FILL.level3}"]`)).toHaveCount(0);
    await tab('部位の量').click();
    await page.waitForTimeout(500); // 覚える書き込みは裏で走る。終わる前に開き直さない
    await moveToDate(page, '2026-11-08');
    await expect(tab('部位の量')).toHaveAttribute('aria-selected', 'true');
    await expect(caption).toHaveText('直近4週の部位（1週あたり）');
    await expect(tags).toHaveCount(3);
  });
});

test('フェーズ：「増量 8週の部位」。始まりから今日まで、療養の日の記録は数えず、日数からも引く（週あたりは療養を除いた日数で）', async ({ page, context }) => {
  test.setTimeout(150_000);
  const BULK = 'ffffffff-0000-4000-8000-000000000011';
  const REHAB = 'ffffffff-0000-4000-8000-000000000012';
  // 増量 8 週（10/26〜12/20）。11/2〜11/5 は療養（11/6 に終えた）。今日 11/8 は 14 日目、療養を除くと 10 日（weeks 10/7）
  const rehab = change('phase', REHAB, {
    kind: 'rehab', direction: null, name: '', start_date: '2026-11-02', end_date: null, target_weight_kg: null, meal_targets: null, snapshot: null,
    status: 'ended', paused_phase_id: BULK, target_history: [], ended_on: '2026-11-06',
  });
  await openWith(page, context, [
    bulkPhase(BULK, '2026-10-26', '2026-12-20'), rehab,
    ...workout('2026-10-28', EXERCISE.bench, 20), // 数える：20 × 7 ÷ 10 = 週 14.0
    ...workout('2026-11-03', EXERCISE.bench, 5), // 療養の日：数えない
    ...workout('2026-11-06', EXERCISE.squat, 10), // 療養を終えた日：数える。週 7.0
    ...workout('2026-10-25', EXERCISE.squat, 10), // フェーズの前：数えない
    ...workout('2026-11-08', EXERCISE.pullUp, 1), // 週 0.7
  ]);
  const card = visible(page, 'home-parts');
  await expect(card).toContainText('増量 8週の部位');
  await expect(card).toContainText('10/26–11/8');
  await expect(row(page, '胸')).toHaveText('胸20セット週 14.0目安内');
  await expect(row(page, '脚')).toHaveText('脚10セット週 7.0あと3');
  await expect(row(page, '背中')).toHaveText('背中1セット週 0.7あと9.3');
  await expect(row(page, '腹')).toHaveText('腹0セット週 0あと10');
  await expect(swatch(page, '胸')).toHaveCSS('background-color', RGB.level3);
  await expect(swatch(page, '脚')).toHaveCSS('background-color', RGB.level2);
  await expect(swatch(page, '背中')).toHaveCSS('background-color', RGB.level1);
  await expect(card).toHaveAttribute('aria-label', /^増量 8週の部位、10月26日から11月8日。1 週間あたりのセット数（目安は 10〜20）。胸 20 セット、週 14.0、目安内。/);
});

test('療養中：止めた増量のフェーズの期間で数える（療養の日は今日まで除く）', async ({ page, context }) => {
  test.setTimeout(150_000);
  const BULK = 'ffffffff-0000-4000-8000-000000000021';
  const REHAB = 'ffffffff-0000-4000-8000-000000000022';
  // 増量 8 週（10/26〜）。11/6 から療養中（今日まで 3 日止まる）。14 日 − 3 日 = 11 日（weeks 11/7）
  const rehab = change('phase', REHAB, {
    kind: 'rehab', direction: null, name: '', start_date: '2026-11-06', end_date: null, target_weight_kg: null, meal_targets: null, snapshot: null,
    status: 'active', paused_phase_id: BULK, target_history: [], ended_on: null,
  });
  await openWith(page, context, [
    bulkPhase(BULK, '2026-10-26', '2026-12-20'), rehab,
    ...workout('2026-10-30', EXERCISE.bench, 22), // 22 × 7 ÷ 11 = 14.0
    ...workout('2026-11-07', EXERCISE.bench, 50), // 療養中：数えない
  ]);
  const card = visible(page, 'home-parts');
  await expect(card).toContainText('増量 8週の部位');
  await expect(card).toContainText('10/26–11/8');
  await expect(row(page, '胸')).toHaveText('胸22セット週 14.0目安内');
});

// 色の見分け（スクリーンショット）：SHOT_DIR を渡したときだけ撮る。ホームのカードと、体の「回復」「部位の量」の 2 つ。412 の幅
test('部位の量のカードと体を撮る（SHOT_DIR）', async ({ page, context }) => {
  test.skip(!process.env.SHOT_DIR, 'SHOT_DIR を渡したときだけ撮る');
  test.setTimeout(150_000);
  await openWith(page, context, noPhase());
  await moveToDate(page, '2026-11-08');
  const dir = process.env.SHOT_DIR!;
  const card = visible(page, 'home-parts');
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await card.screenshot({ path: `${dir}/home-card.png` });
  await visible(page, 'home-hero').scrollIntoViewIfNeeded();
  const hero = visible(page, 'hero-swipe');
  const mode = visible(page, 'hero-body-mode');
  await page.waitForTimeout(800);
  await hero.screenshot({ path: `${dir}/hero-recovery.png` });
  await mode.getByRole('button', { name: '部位の量', exact: true }).click();
  await page.waitForTimeout(800);
  await hero.screenshot({ path: `${dir}/hero-volume.png` });
  await pressFigure(visible(page, 'day-body-2d-press-front'), 0.42, 0.225);
  await page.waitForTimeout(500);
  await hero.screenshot({ path: `${dir}/hero-volume-picked.png` });
});

