import { expect, Locator, test } from '@playwright/test';
import { button, goPane, goTab, moveToDate, openApp, openBody, recordOn, see, swipe, TODAY } from './helpers';

// からだのタブの回復マップ。web では 3D を出さず、2D の図（前と後ろ）で塗る（Android は 3D と引き出し線の札。実機で見る）。
// 回復の日数と明るさ・色・部位と部品の対応・札の置き場所は jest（lib/__tests__/recoveryMap.test.ts、bodyScene.test.ts）。
// ここは、記録がなければ出さないこと、日の切り替えのすぐ下に出ること、一覧（はじめは回復中だけ・すべての部位）と SELECT //

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
  await expect(card.getByTestId('recovery-legend')).toHaveText('回復済み回復中空いている・まだケガ');
  await expect(card.getByTestId('recovery-2d')).toBeVisible();
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

test('空いている（回復済みの期限を過ぎた）：灰色と「空いて N日」。一覧・すすめ・ホームの NEXT', async ({ page }) => {
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
  if (shots) await card.screenshot({ path: `${shots}/stale-body.png` });

  // 筋トレの記録（今日は空）：いちばん長く空いている脚をすすめる（日数は 1 回だけ）
  await goTab(page, '筋トレ');
  await goPane(page, '記録');
  const hero = page.getByTestId('recovery-hero').filter({ visible: true });
  const suggest = page.getByTestId('recovery-hero-suggest').filter({ visible: true });
  await expect(suggest.getByLabel('今日は 脚 はどう？ 空いて19日', { exact: true })).toHaveText('今日は脚はどう？空いて19日');
  if (shots) await hero.locator('..').screenshot({ path: `${shots}/stale-record.png` });

  // ホームの RECOVERY：READY は空いている・まだも数える（回復中の胸のほか 6）。NEXT は脚で IDLE 19D
  await goTab(page, 'ホーム');
  await swipe(page.getByTestId('hero-swipe').filter({ visible: true }), 'next');
  const next = page.getByTestId('hero-recovery-next').filter({ visible: true });
  await expect(next).toHaveAccessibleName('次の部位 脚、空いて19日。回復マップを開く');
  await expect(next).toContainText('IDLE 19D');
  await expect(page.getByTestId('hero-recovery').filter({ visible: true })).toHaveAccessibleName(/^回復。鍛えられる 6部位（7部位のうち）。次の部位 脚、空いて19日。/);
  if (shots) await page.getByTestId('hero-recovery-2d').filter({ visible: true }).locator('..').screenshot({ path: `${shots}/stale-home.png` });
});
