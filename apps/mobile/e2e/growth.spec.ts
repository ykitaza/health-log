import { expect, Page, test } from '@playwright/test';
import { button, openApp, recordOn, see, TODAY } from './helpers';

// 成長を見る画面。web では形（Skia）を描かないので、文字と操作が出ることを見る。
// 再生の位置・前後の日の値のつなぎ方・衛星のならし方・字幕の選び方・累計の文字は jest（lib/__tests__/growthPlayer.test.ts）。
// ホームからの入口はまだないので、/growth を直接開く

const day = (page: Page) => page.getByTestId('growth-day').filter({ visible: true });
const total = (page: Page, kind: 'training' | 'food' | 'sleep') => page.getByTestId(`growth-total-${kind}`).filter({ visible: true });

async function openGrowth(page: Page) {
  await page.goto('/growth');
  await expect(see(page, '点の軌跡', { exact: true })).toBeVisible();
}

test('記録がまだないとき：DAY 0 と今日の日付、案内の文、操作はどれも使えない、累計は 0', async ({ page }) => {
  await openApp(page);
  await openGrowth(page);
  await expect(see(page, '記録を始めると、ここから育ちます')).toBeVisible();
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 0、2026年11月8日（日）');
  await expect(see(page, '今日', { exact: true })).toHaveCount(2); // つまみの下（左はし）と「今日」のボタン
  await expect(page.getByRole('slider', { name: '日を選ぶ' })).toHaveAttribute('aria-disabled', 'true');
  await expect(button(page, '再生（記録がまだないため使えません）')).toBeDisabled();
  for (const name of ['再生の速さ 1倍。押すと2倍', '前のハイライトへ', '次のハイライトへ', '今日の姿に戻る']) {
    await expect(button(page, name)).toBeDisabled();
  }
  await expect(total(page, 'training')).toContainText('0.0t');
  await expect(total(page, 'food')).toContainText('0日');
  await expect(total(page, 'sleep')).toContainText('0日');
});

test('記録があるとき：今日の姿、つまみと ⏭ で日を移ると字幕、動きを減らす設定がオフなら開くと再生', async ({ page }) => {
  await recordOn(page, '2026-11-06', [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await recordOn(page, TODAY, [{ exercise: 'ベンチプレス', sets: [{ weight: '85', reps: '8' }] }]);
  await openGrowth(page);

  // 動きを減らす設定（E2E の既定）では再生せず、今日の姿を出す。再生は使えず、理由を読み上げる
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 3、2026年11月8日（日）');
  await expect(see(page, '成長', { exact: true })).toBeVisible();
  await expect(button(page, '再生（動きを減らす設定がオンのため使えません。つまみと前後のハイライトで日を選べます）')).toBeDisabled();
  await expect(see(page, '11月6日', { exact: true })).toBeVisible();
  await expect(see(page, '11月8日', { exact: true })).toBeVisible();
  // 640 kg ＋ 680 kg
  await expect(total(page, 'training')).toContainText('1.3t');
  await expect(button(page, '次のハイライトへ')).toBeDisabled();

  // つまみの左はしを押すと、最初の記録の日
  const box = await page.getByTestId('growth-scrubber').filter({ visible: true }).boundingBox();
  if (!box) throw new Error('つまみが見えていません');
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 1、2026年11月6日（金）');
  await expect(total(page, 'training')).toContainText('0.6t');

  // ⏭ で次のハイライト（今日の自己ベスト）の日へ。字幕が出る
  await button(page, '次のハイライトへ').click();
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 3、2026年11月8日（日）');
  await expect(see(page, 'ベンチプレス 自己ベスト 107.7 kg')).toBeVisible();
  await expect(button(page, '次のハイライトへ')).toBeDisabled();

  // つまみの左はしから「今日」で今日の姿に戻る
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 1、2026年11月6日（金）');
  await button(page, '今日の姿に戻る').click();
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 3、2026年11月8日（日）');

  // 動きを減らす設定がオフなら、開くと最初の日から再生する。一時停止・速さの切り替え
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openGrowth(page);
  await expect(see(page, '成長を再生中', { exact: true })).toBeVisible();
  await button(page, '再生の速さ 1倍。押すと2倍').click();
  await expect(button(page, '再生の速さ 2倍。押すと4倍')).toBeVisible();
  await button(page, '一時停止').click();
  await expect(see(page, '成長', { exact: true })).toBeVisible();
  // 再生を続けると、終わりまで行って今日の姿で止まる（3日・2x は 4秒）
  await button(page, '再生').click();
  await expect(see(page, '成長を再生中', { exact: true })).toBeVisible();
  await expect(see(page, '成長', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 3、2026年11月8日（日）');
  await expect(button(page, '再生')).toBeEnabled();

  // 再生中に「形を選ぶ」を押すと、一時停止してシートを出す
  await button(page, '再生').click();
  await expect(see(page, '成長を再生中', { exact: true })).toBeVisible();
  await button(page, '形を選ぶ').click();
  await expect(page.getByTestId('shape-picker').filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId('growth-status').filter({ visible: true })).toHaveText('成長');
});

test('形を選ぶ：シートに3つ並び、木を選ぶと画面の名前が変わって閉じる。開き直しても、ホームに戻っても木のまま', async ({ page }) => {
  await openApp(page);
  await button(page, '成長を見る').click();
  const name = page.getByTestId('growth-shape-name').filter({ visible: true });
  await expect(name).toHaveText('点の軌跡');

  // 記録がまだない日にもボタンは出る。押すとシートに3つ並び、最初は点の軌跡を選んでいる
  await button(page, '形を選ぶ').click();
  const sheet = page.getByTestId('shape-picker').filter({ visible: true });
  await expect(see(sheet, '形を選ぶ', { exact: true })).toBeVisible();
  await expect(see(sheet, 'どの形でも、育ち方と衛星の意味は同じです')).toBeVisible();
  const radios = sheet.getByRole('radio');
  await expect(radios).toHaveCount(3);
  const attractor = sheet.getByRole('radio', { name: '点の軌跡。点が増えて形が浮かび、広がる', exact: true });
  const tree = sheet.getByRole('radio', { name: '木。枝が伸び、葉が増え、光の粒が増える', exact: true });
  const galaxy = sheet.getByRole('radio', { name: '銀河。腕が伸び、星が増え、中心が光る', exact: true });
  await expect(attractor).toHaveAttribute('aria-checked', 'true');
  await expect(tree).toHaveAttribute('aria-checked', 'false');
  await expect(galaxy).toHaveAttribute('aria-checked', 'false');

  // 木を選ぶと、名前が「木」になり、シートが閉じる
  await tree.click();
  await expect(name).toHaveText('木');
  await expect(page.getByTestId('shape-picker')).toHaveCount(0);

  // 開き直しても木を選んでいる。外を押して閉じる
  await button(page, '形を選ぶ').click();
  await expect(tree).toHaveAttribute('aria-checked', 'true');
  await expect(attractor).toHaveAttribute('aria-checked', 'false');
  await button(page, '閉じる').click();
  await expect(page.getByTestId('shape-picker')).toHaveCount(0);

  // ホームに戻っても、形の段は木
  await button(page, '戻る').click();
  await expect(button(page, '成長の形（木）。押すと成長を見る画面を開く')).toBeVisible();
  // 開き直しても（端末に置いた値を読む）木のまま
  await page.reload();
  await expect(button(page, '成長の形（木）。押すと成長を見る画面を開く')).toBeVisible();
});
