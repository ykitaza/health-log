import { expect, test } from '@playwright/test';
import { button, enter, goTab, openApp, openBody, openSettings, recordToday, see, setBodyInfo, tab } from './helpers';

test('4つのタブ、歯車から設定へ行って戻る、設定と RM計算機にタブバーは出ない、知らない道', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(tab(page, 'ホーム')).toHaveAttribute('aria-selected', 'true');

  await goTab(page, '食事');
  await expect(see(page, '食事', { exact: true }).first()).toBeVisible();
  await expect(see(page, '朝食はまだ記録していません')).toBeVisible();

  await goTab(page, '履歴／分析');
  await expect(see(page, 'まだ記録がありません')).toBeVisible();

  // 体組成の歯車から設定へ行き、戻ると体組成
  await goTab(page, '体組成');
  await expect(see(page, '体重', { exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole('tablist')).toBeHidden();
  await button(page, '戻る').click();
  await expect(see(page, '自動で計算', { exact: true })).toBeVisible();
  await expect(tab(page, '体組成')).toHaveAttribute('aria-selected', 'true');

  // ホームの歯車から設定へ行き、戻るとホーム
  await goTab(page, 'ホーム');
  await expect(see(page, '今日の記録', { exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole('tablist')).toBeHidden();
  // 設定の「準備中」
  await expect(see(page, 'チャットとの連携', { exact: true })).toBeVisible();
  await expect(see(page, '準備中', { exact: true })).toHaveCount(1);
  await button(page, '戻る').click();
  await expect(see(page, '今日の記録', { exact: true })).toBeVisible();
  await expect(page.getByRole('tablist')).toBeVisible();

  await button(page, 'RM計算機').click();
  await expect(page.getByRole('tablist')).toBeHidden();
  await button(page, '戻る').click();
  await expect(page.getByRole('tablist')).toBeVisible();

  // 知らない道は「画面が見つかりません」からホームへ戻れる
  await page.goto('/no-such-page');
  await expect(see(page, '画面が見つかりません')).toBeVisible();
  await see(page, 'ホームへ').click();
  await expect(see(page, '今日の記録', { exact: true })).toBeVisible();
});

test('再読み込みしても記録・体組成・設定が残る', async ({ page }) => {
  await openApp(page);
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8', memo: '残る？' }] }]);
  await setBodyInfo(page, { height: '170' });
  await openBody(page);
  await enter(page, '体重', '68.4');
  await expect(see(page, '23.7', { exact: true })).toBeVisible();

  // 体組成のタブのまま再読み込みする
  await page.reload();
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toHaveValue('68.4');
  await goTab(page, 'ホーム');
  await expect(see(page, '80.0 kg × 8 回')).toBeVisible();
  await expect(see(page, '残る？')).toBeVisible();
  await expect(page.getByTestId('volume-total')).toContainText('0.64t');
  await openBody(page);
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toHaveValue('68.4');
  await expect(see(page, '自動で計算（身長 170cm）')).toBeVisible();
  await expect(see(page, '23.7', { exact: true })).toBeVisible();

  // 深い画面の URL を直接開いても動く
  await page.goto('/workout?date=2026-11-08');
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
});
