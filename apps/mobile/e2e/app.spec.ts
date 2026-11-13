import { expect, test } from '@playwright/test';
import { button, enterBody, goPane, goTab, homeCard, openApp, openBody, openRm, openSettings, recordToday, see, setBodyInfo, tab } from './helpers';

test('5つのタブ、歯車から設定へ行って戻る、設定と RM計算機にタブバーは出ない、知らない道', async ({ page }) => {
  await openApp(page);
  // タブはホーム・筋トレ・食事・からだ・レポートの5つ（推移は筋トレ・食事・からだのタブの中）
  await expect(page.getByRole('tab')).toHaveCount(5);
  await expect(page.getByRole('tab')).toHaveText(['ホーム', '筋トレ', '食事', 'からだ', 'レポート']);
  await expect(tab(page, 'ホーム')).toHaveAttribute('aria-selected', 'true');

  await goTab(page, '食事');
  await expect(see(page, '食事', { exact: true }).first()).toBeVisible();
  await expect(see(page, '朝食はまだ記録していません')).toBeVisible();

  await goTab(page, '筋トレ');
  await expect(see(page, 'まだ記録がありません')).toBeVisible();
  await goPane(page, '推移');
  await expect(see(page, 'まだ記録がありません')).toBeVisible();

  // からだの歯車から設定へ行き、戻るとからだ
  await goTab(page, 'からだ');
  await expect(see(page, '体重', { exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole('tablist')).toBeHidden();
  await button(page, '戻る').click();
  await expect(see(page, '計測を入れる', { exact: true })).toBeVisible();
  await expect(tab(page, 'からだ')).toHaveAttribute('aria-selected', 'true');

  // ホームの歯車から設定へ行き、戻るとホーム
  await goTab(page, 'ホーム');
  await expect(homeCard(page, 'training')).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole('tablist')).toBeHidden();
  // 設定の「チャットとの連携」（前は準備中だった）
  await expect(see(page, 'チャットとの連携', { exact: true })).toBeVisible();
  await expect(see(page, '準備中', { exact: true })).toHaveCount(0);
  await button(page, '戻る').click();
  await expect(homeCard(page, 'training')).toBeVisible();
  await expect(page.getByRole('tablist')).toBeVisible();

  // RM計算機は筋トレのタブの右上から開く。タブバーは出ず、戻ると筋トレ
  await openRm(page);
  await expect(page.getByRole('tablist')).toBeHidden();
  await button(page, '戻る').click();
  await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');

  // 知らない道は「画面が見つかりません」からホームへ戻れる
  await page.goto('/no-such-page');
  await expect(see(page, '画面が見つかりません')).toBeVisible();
  await see(page, 'ホームへ').click();
  await expect(homeCard(page, 'training')).toBeVisible();
});

test('再読み込みしても記録・体組成・設定が残る', async ({ page }) => {
  await openApp(page);
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8', memo: '残る？' }] }]);
  await setBodyInfo(page, { height: '170' });
  await openBody(page);
  await enterBody(page, { weight: '68.4' });
  await expect(see(page, '23.7', { exact: true })).toBeVisible();

  // からだのタブのまま再読み込みする
  await page.reload();
  await expect(page.getByTestId('body-weight').filter({ visible: true })).toContainText('68.4');
  await goTab(page, 'ホーム');
  await expect(homeCard(page, 'training')).toContainText('1種目 ・ 1セット ・ 0.64 t');
  await expect(page.getByTestId('volume-week')).toContainText('0.64t');
  await goTab(page, '筋トレ');
  await expect(see(page, '80.0 kg × 8 回')).toBeVisible();
  await expect(see(page, '残る？')).toBeVisible();
  await openBody(page);
  await expect(page.getByTestId('body-weight').filter({ visible: true })).toContainText('68.4');
  await expect(see(page, '23.7', { exact: true })).toBeVisible();

  // 深い画面の URL を直接開いても動く
  await page.goto('/workout?date=2026-11-08');
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
});

/** 見えているタブの画面のスクロールの位置（React Native Web の ScrollView は、縦にスクロールする div） */
async function scrollTop(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('div')].filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(style.overflowY)
        && !el.closest('[aria-hidden="true"]');
    });
    return els.map((el) => el.scrollTop).reduce((a, b) => Math.max(a, b), 0);
  });
}

test('今のタブをもう一度押すと、いちばん上へ戻る（中で切り替える画面も）。同期はしない', async ({ page }) => {
  // 記録がなくてもスクロールできるよう、画面を低くする
  await page.setViewportSize({ width: 412, height: 520 });
  await openApp(page);
  // ホーム
  await page.mouse.move(206, 300);
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
  await tab(page, 'ホーム').click();
  await expect.poll(() => scrollTop(page)).toBe(0);
  // すでにいちばん上でもう一度押しても、同期しない（ログインしていないので、同期しようとすれば案内が出る）
  await tab(page, 'ホーム').click();
  await expect(page.getByTestId('pull-notice')).toHaveCount(0);

  // 食事の「推移」（タブの中の切り替え）
  await goTab(page, '食事');
  await goPane(page, '推移');
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
  await tab(page, '食事').click();
  await expect.poll(() => scrollTop(page)).toBe(0);
  await expect(page.getByRole('tab', { name: '推移', exact: true }).filter({ visible: true })).toHaveAttribute('aria-selected', 'true');
});
