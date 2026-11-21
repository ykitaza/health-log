import { expect, Locator, test } from '@playwright/test';
import { button, goPane, goTab, moveToDate, openApp, openBody, recordOn, see, TODAY } from './helpers';
import { change, EXERCISE, openWith, workout } from './seed';

// からだのタブの回復マップ。web では 3D を出さず、2D の図（前と後ろ）で塗る（Android は 3D と引き出し線の札。実機で見る）。
// 回復の日数と明るさ・色・部位と部品の対応・札の置き場所は jest（lib/__tests__/recoveryMap.test.ts、bodyScene.test.ts）。
// ここは、記録がなければ出さないこと、日の切り替えのすぐ下に出ること、図の札（鍛えたことのある部位に、部位と状態）、一覧（はじめは回復中だけ・すべての部位）と SELECT //。
// ホームの LATEST の体の回復の色も

const box = async (l: Locator) => (await l.boundingBox())!;

test('記録がなければ出さない。記録したら日の切り替えのすぐ下に 2D の図と一覧。行を押すと SELECT //。前の日はその日までで数える', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await openBody(page);
  await expect(page.getByTestId('recovery-map')).toHaveCount(0);

  await recordOn(page, '2026-10-20', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  await recordOn(page, '2026-11-07', [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }, { weight: '80', reps: '8' }] }]);
  await moveToDate(page, TODAY);
  await openBody(page);

  const card = page.getByTestId('recovery-map').filter({ visible: true });
  await expect(card).toBeVisible();
  await expect(see(card, 'RECOVERY MAP // LIVE')).toBeVisible();
  await expect(card.getByTestId('recovery-legend')).toHaveCount(0);
  await expect(card.getByTestId('recovery-2d')).toBeVisible();
  // 図の札：鍛えたことのある部位に、部位と状態（回復中の胸・空いている脚）。一度も鍛えていない部位には付けない
  const callouts = card.getByTestId('recovery-callout');
  await expect(callouts).toHaveCount(2);
  await expect(callouts.filter({ hasText: '胸' })).toContainText('あと2日');
  await expect(callouts.filter({ hasText: '脚' })).toContainText('空いて19日');
  await expect(card.getByLabel('回復マップ。緑は回復済み、暖色は回復中、灰色は空いている・まだ、赤はケガ。回復中の部位、胸 あと2日。空いている部位、脚 空いて19日', { exact: true })).toHaveCount(1);
  // 日の切り替えのすぐ下、体重のカードより上
  const switcher = await box(button(page, '前の日'));
  const cardBox = await box(card);
  expect(cardBox.y).toBeGreaterThan(switcher.y);
  expect(cardBox.y).toBeLessThan((await box(page.getByTestId('body-add').filter({ visible: true }))).y);

  // 一覧ははじめ回復中の部位だけ（胸は昨日、回復の目安 2日 → あと2日）。行は 48dp 以上
  const chest = button(card, '胸、昨日、回復中 あと2日、2週間で 2セット');
  await expect(chest).toBeVisible();
  expect((await box(chest)).height).toBeGreaterThanOrEqual(48);
  await expect(card.getByTestId('recovery-part-脚')).toHaveCount(0);
  // すべての部位で広げる（空いている脚・まだの背中も）。脚（回復 3日）は 19日前：回復済みになった 4日目から 7日を過ぎたので空いている
  await button(card, 'すべての部位（7）').click();
  await expect(button(card, '脚、19日前、空いて19日、2週間で 0セット')).toBeVisible();
  await expect(card.getByTestId('recovery-part-脚')).toContainText('空いて19日');
  await expect(button(card, '背中、まだ鍛えていない、2週間で 0セット')).toBeVisible();
  await button(card, '回復中だけにする').click();
  await expect(card.getByTestId('recovery-part-脚')).toHaveCount(0);

  await chest.click();
  const sel = card.getByTestId('recovery-select');
  await expect(sel).toContainText('SELECT //');
  await expect(sel).toContainText('最後に鍛えた日 昨日（11月7日）');
  await expect(sel).toContainText('回復中 あと2日（回復の目安 2日）');
  await expect(sel).toContainText('2週間のセット数 2セット');
  // もう一度押すと閉じる
  await chest.click();
  await expect(sel).toHaveCount(0);

  // 前の日に移ると、その日までの記録で数える（11月4日には胸はまだ、回復中の部位はない）
  for (let i = 0; i < 4; i++) await button(page, '前の日').click();
  await expect(see(page, '11月4日（水）', { exact: true })).toBeVisible();
  await expect(see(card, 'いま回復中の部位はありません')).toBeVisible();
  await button(card, 'すべての部位（7）').click();
  await expect(button(card, '胸、まだ鍛えていない、2週間で 0セット')).toBeVisible();
  await expect(button(card, '脚、15日前、空いて15日、2週間で 0セット')).toBeVisible();
});

test('直している途中のケガ：一覧にケガのある部位を出し（回復していなくても）、▲ ALERT。SELECT にケガの件', async ({ page }) => {
  test.setTimeout(90_000);
  await recordOn(page, '2026-11-07', [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await moveToDate(page, TODAY);
  // 右肩を、ベンチプレスで痛めた（肩の部品にかかわる。痛めた種目の部位の胸には結ばない）
  await goTab(page, '筋トレ');
  await goPane(page, 'ケガ');
  await page.getByTestId('injury-new').click();
  await page.getByTestId('injury-new-manual').filter({ visible: true }).click();
  const front = page.getByTestId('injury-figure-front').filter({ visible: true });
  const fb = await box(front);
  await front.click({ position: { x: fb.width * 0.27, y: fb.height * 0.22 } });
  await expect(page.getByTestId('injury-selected').filter({ visible: true })).toHaveText('右肩');
  await page.getByTestId('injury-exercise').filter({ visible: true }).click();
  await button(page, 'ベンチプレス 胸').click();
  await page.getByTestId('injury-save').filter({ visible: true }).click();
  await expect(page.getByTestId('injury-map').filter({ visible: true })).toBeVisible();

  await openBody(page);
  const card = page.getByTestId('recovery-map').filter({ visible: true });
  await expect(see(card, '▲ 1 ALERT')).toBeVisible();
  await expect(button(card, '胸、昨日、回復中 あと2日、2週間で 1セット')).toBeVisible();
  await expect(button(card, '肩、まだ鍛えていない、2週間で 0セット、直している途中のケガ 1件')).toBeVisible();
  await button(card, '肩、まだ鍛えていない、2週間で 0セット、直している途中のケガ 1件').click();
  await expect(card.getByTestId('recovery-select')).toContainText('▲ 右肩のケガを直している途中');

  // 筋トレの記録のタブ（今日は空）の回復マップも同じ：胸は回復中の札、肩にケガの札
  await goTab(page, '筋トレ');
  await goPane(page, '記録');
  const hero = page.getByTestId('recovery-hero').filter({ visible: true });
  await expect(hero).toHaveAttribute('aria-label', '回復マップ。緑は回復済み、暖色は回復中、灰色は空いている・まだ、赤はケガ。回復中の部位、胸 あと2日。直している途中のケガ、右肩');
  await expect(hero.getByTestId('recovery-callout').filter({ hasText: '胸' })).toContainText('あと2日');
  await expect(hero.getByTestId('recovery-callout').filter({ hasText: '肩' })).toContainText('▲ 右肩');
  await expect(hero.getByTestId('recovery-callout').filter({ hasText: '胸' })).not.toContainText('▲');
  if (process.env.FIGURE_SHOTS) await hero.locator('..').screenshot({ path: `${process.env.FIGURE_SHOTS}/injury-412.png` });
});

test('空いている（回復済みの期限を過ぎた）：灰色と「空いて N日」。図の札・一覧・すすめ・ホームの LATEST の色', async ({ page }) => {
  test.setTimeout(90_000);
  const shots = process.env.STALE_SHOTS;
  // 脚は 19日前（空いている）、背中は 4日前（回復 3日：回復済み）、胸は昨日（回復中）、ほかは一度もない（まだ）
  await recordOn(page, '2026-10-20', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  await recordOn(page, '2026-11-04', [{ exercise: 'ラットプルダウン', sets: [{ weight: '50', reps: '10' }] }]);
  await recordOn(page, '2026-11-07', [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await moveToDate(page, TODAY);

  await openBody(page);
  const card = page.getByTestId('recovery-map').filter({ visible: true });
  await expect(card.getByLabel('回復マップ。緑は回復済み、暖色は回復中、灰色は空いている・まだ、赤はケガ。回復中の部位、胸 あと2日。空いている部位、脚 空いて19日', { exact: true })).toHaveCount(1);
  await button(card, 'すべての部位（7）').click();
  await expect(button(card, '背中、4日前、回復済み、2週間で 1セット')).toBeVisible();
  await expect(button(card, '脚、19日前、空いて19日、2週間で 0セット')).toBeVisible();
  await expect(button(card, '肩、まだ鍛えていない、2週間で 0セット')).toBeVisible();
  // 図の札は回復済みの背中にも（光っているだけでは分からない）
  await expect(card.getByTestId('recovery-callout')).toHaveCount(3);
  await expect(card.getByTestId('recovery-callout').filter({ hasText: '背中' })).toContainText('回復済み');
  if (shots) await card.screenshot({ path: `${shots}/stale-body.png` });

  // 筋トレの記録（今日は空）：いちばん長く空いている脚をすすめる（日数は 1 回だけ）
  await goTab(page, '筋トレ');
  await goPane(page, '記録');
  const hero = page.getByTestId('recovery-hero').filter({ visible: true });
  const suggest = page.getByTestId('recovery-hero-suggest').filter({ visible: true });
  await expect(suggest.getByLabel('今日は 脚 はどう？ 空いて19日', { exact: true })).toHaveText('今日は脚はどう？空いて19日');
  if (shots) await hero.locator('..').screenshot({ path: `${shots}/stale-record.png` });

  // ホームの LATEST（直近は昨日の胸）：体は回復の色（RECOVERY のページはない）。読み上げに回復中の胸
  await goTab(page, 'ホーム');
  await expect(page.getByTestId('home-latest').filter({ visible: true })).toHaveAccessibleName(/。回復中 胸 あと2日。その日の記録を開く$/);
  await expect(page.getByTestId('hero-page-recovery')).toHaveCount(0);
  if (shots) await page.getByTestId('home-hero').filter({ visible: true }).screenshot({ path: `${shots}/stale-home.png` });
  await expect(page.getByTestId('hero-legend')).toHaveCount(0);
});

// クラシックは藍の一色（#334）：回復中だけ藍（鍛えた日 #232A62 → 最後の日 #5A62A8）、ケガは赤、回復済みは石膏のまま（一覧の文字は墨）。緑は使わない
test('クラシック：回復中は藍（図の塗り・一覧の文字）、回復済みは石膏、緑は出ない。読み上げも藍', async ({ page, context }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => localStorage.setItem('appearance.look', 'classic'));
  // 胸は今日、脚は昨日、背中は 3日前（最後の日）、肩・二頭は 6日前（回復済み）、三頭・腹はまだ。右の肩の前を直している途中
  await openWith(page, context, [
    ...workout('2026-11-08', EXERCISE.bench, 3), ...workout('2026-11-07', EXERCISE.squat, 3), ...workout('2026-11-05', EXERCISE.pullUp, 3),
    ...workout('2026-11-02', EXERCISE.shoulderPress, 3), ...workout('2026-11-02', EXERCISE.curl, 3),
    change('injury', 'cccccccc-0000-4000-8000-000000000334', {
      occurred_on: '2026-11-06', site: 'shoulder_front', side: 'right', exercise_id: EXERCISE.shoulderPress, phase: '', symptom: '肩の前に違和感', cause: '', fix: '',
      status: 'fixing', fixed_on: null,
    }),
  ]);
  const shots = process.env.RECOVERY_334_SHOTS;
  const fillsIn = (l: Locator) => l.evaluate((el) => [...el.querySelectorAll('path')].map((p) => (p.getAttribute('fill') ?? '').toUpperCase()));
  const GREENS = ['#1E6B47', '#ADB4A2', '#5BE49B', '#3F8F63'];

  // ホームの LATEST の体（web は 2D）：胸は濃い藍、緑はない
  const hero = page.getByTestId('home-hero').filter({ visible: true });
  await expect(hero).toBeVisible();
  const heroFills = await fillsIn(hero);
  expect(heroFills).toContain('#232A62');
  for (const g of GREENS) expect(heroFills).not.toContain(g);
  if (shots) await hero.screenshot({ path: `${shots}/final-home.png` });

  await openBody(page);
  const card = page.getByTestId('recovery-map').filter({ visible: true });
  await expect(card.getByLabel(/^回復マップ。藍は回復中（濃いほど鍛えたばかり）、赤はケガ、色のない部位は回復済み・空いている・まだ。回復中の部位、/)).toHaveCount(1);
  // 図の塗り：胸（鍛えた日）は濃い藍、背中（最後の日）は淡い藍、回復済みは石膏。緑はない
  const mapFills = await fillsIn(card.getByTestId('recovery-2d'));
  expect(mapFills).toEqual(expect.arrayContaining(['#232A62', '#5A62A8', '#EAE3D4']));
  for (const g of GREENS) expect(mapFills).not.toContain(g);
  // 一覧の状態の文字：回復中は藍、回復済みは墨
  const colorOf = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color);
  await expect.poll(() => colorOf(card.getByTestId('recovery-part-胸').getByText(/^回復中 あと/))).toBe('rgb(35, 42, 98)');
  await expect.poll(() => colorOf(card.getByTestId('recovery-part-背中').getByText(/^回復中 あと/))).toBe('rgb(90, 98, 168)');
  await card.getByTestId('recovery-all').click();
  await expect.poll(() => colorOf(card.getByTestId('recovery-part-上腕二頭筋').getByText('回復済み', { exact: true }))).toBe('rgb(87, 80, 71)');
  if (shots) await card.screenshot({ path: `${shots}/final-map.png` });
});
