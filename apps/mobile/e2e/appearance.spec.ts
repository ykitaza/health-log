import { expect, Page, test } from '@playwright/test';
import { button, goPane, goTab, moveToDate, openApp, openSettings, see, TODAY } from './helpers';
import { AT, bulkPhase, change, EXERCISE, mcp, openWith } from './seed';

// 見た目（HUD・クラシック）：theme が最初に評価されるときに見た目を読み、色と飾りを選ぶ。web は localStorage の appearance.look。
// 設定の「表示」で選ぶと、確かめてから保存し（sync_meta と localStorage）、アプリを開き直す。
// 色の選び方は jest（theme/__tests__/appearance.test.ts）、3D の場面の強さは jest（lib/__tests__/bodyScene.test.ts）。
// クラシックは地の色が HUD と同じ（Figma「ホーム（unslop 案）」）なので、見分けはヒーローの四隅のラベル（LATEST // と 直近）で見る

const REPORT = 'aaaaaaaa-0000-4000-8000-0000000000e1';
const latestCorner = (page: Page) => page.getByTestId('home-latest').filter({ visible: true });

test('localStorage の見た目でホームの見出しが変わり、消すと HUD に戻る', async ({ page }) => {
  await openApp(page);
  await expect(latestCorner(page)).toContainText('LATEST //');

  await page.evaluate(() => localStorage.setItem('appearance.look', 'classic'));
  await openApp(page);
  await expect(latestCorner(page)).toContainText('直近');
  await expect(latestCorner(page)).not.toContainText('LATEST //');

  await page.evaluate(() => localStorage.removeItem('appearance.look'));
  await openApp(page);
  await expect(latestCorner(page)).toContainText('LATEST //');
});

test('設定でクラシックを選ぶと、確かめてから開き直し、ホームとレポートが日本語の見出しになる。HUD に戻せる', async ({ page, context }) => {
  // 週のまとめ（レポートのタブの表の見出しを見る）
  await openWith(page, context, [
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'report', entity_id: REPORT, op: 'create' as const, changed_at: AT, fields: {
      title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08', overall_tone: 'good', headline: '脚の日が2回に増えた',
      highlights: [{ area: 'training', tone: 'good', text: '脚の日が2回に増えた' }], next_steps: ['脚の日を2回入れる'], body: '## 筋トレ\n- 脚が増えた',
    } },
  ]);
  await goTab(page, 'レポート');
  await expect(see(page, 'Weekly Status')).toBeVisible();
  await goTab(page, 'ホーム');

  // 設定：初めは HUD。クラシックを選ぶと確かめる（やめると何も変えない）
  await openSettings(page);
  await expect(see(page, '選ぶとアプリを開き直して切り替えます')).toBeVisible();
  await expect(button(page, 'HUD')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('appearance-mismatch')).toHaveCount(0);
  await button(page, 'クラシック').click();
  await expect(see(page, '見た目を切り替えますか？')).toBeVisible();
  await button(page, 'やめる').click();
  await expect(see(page, '見た目を切り替えますか？')).toHaveCount(0);
  await expect(button(page, 'HUD')).toHaveAttribute('aria-selected', 'true');

  await button(page, 'クラシック').click();
  await Promise.all([page.waitForEvent('load'), button(page, '切り替える').click()]);
  expect(await page.evaluate(() => localStorage.getItem('appearance.look'))).toBe('classic');

  // 開き直したあと：ホームは日本語の見出し、英字の LATEST // はない
  await moveToDate(page, TODAY);
  await expect(latestCorner(page)).toContainText('直近');
  await expect(see(page, 'LATEST //')).toHaveCount(0);
  await expect(see(page, '今日の食事')).toBeVisible();
  // レポートのタブも日本語の見出し
  await goTab(page, 'レポート');
  await expect(see(page, '今週の記録', { exact: true })).toBeVisible();
  await expect(see(page, 'Weekly Status')).toHaveCount(0);
  await expect(see(page, 'KARADA // REPORT')).toHaveCount(0);
  await goTab(page, 'ホーム');

  // 設定はクラシックを選んだ状態。保存した値と表示が同じなので、違いの知らせは出ない
  await openSettings(page);
  await expect(button(page, 'クラシック')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('appearance-mismatch')).toHaveCount(0);

  // HUD に戻す
  await button(page, 'HUD').click();
  await Promise.all([page.waitForEvent('load'), button(page, '切り替える').click()]);
  await moveToDate(page, TODAY);
  await expect(latestCorner(page)).toContainText('LATEST //');
  await goTab(page, 'レポート');
  await expect(see(page, 'Weekly Status')).toBeVisible();
});

test('保存した見た目と表示が違うとき（起動のときに読めなかったなど）は、設定でそのことを知らせる', async ({ page }) => {
  await openApp(page);
  // 保存はクラシック（sync_meta）のまま、表示のもとになる localStorage だけを消す
  await openSettings(page);
  await button(page, 'クラシック').click();
  await Promise.all([page.waitForEvent('load'), button(page, '切り替える').click()]);
  await page.evaluate(() => localStorage.removeItem('appearance.look'));
  await moveToDate(page, TODAY);
  await expect(latestCorner(page)).toContainText('LATEST //');
  await openSettings(page);
  await expect(page.getByTestId('appearance-mismatch')).toHaveText('保存した見た目と表示が違います（開き直してください）');
});

test('クラシックのフェーズとケガの画面は日本語の見出しで、英字の見出しは出ない。HUD は英字のまま', async ({ page, context }) => {
  const changes = [
    bulkPhase('ffffffff-0000-4000-8000-0000000000e1', '2026-10-12', '2026-12-06'),
    change('injury', 'cccccccc-0000-4000-8000-0000000000e1', {
      occurred_on: '2026-11-06', site: 'shoulder_joint', side: 'right', exercise_id: EXERCISE.bench, phase: 'ラックアップ', symptom: '肩の前に違和感', cause: '', fix: '',
      status: 'fixing', fixed_on: null,
    }),
  ];
  const phaseLine = page.getByTestId('hero-phase').filter({ visible: true });

  // HUD：英字の見出し
  await openWith(page, context, changes);
  await phaseLine.click();
  await expect(see(page, 'KARADA // PHASE · BULK 04/08')).toBeVisible();
  await expect(see(page, 'START 10/12')).toBeVisible();
  await button(page, '戻る').click();
  await goTab(page, '筋トレ');
  await goPane(page, 'ケガ');
  await expect(see(page, 'BODY MAP // SCAN')).toBeVisible();
  await expect(see(page, 'ACTIVE 01 / CLEARED 00')).toBeVisible();

  // クラシック：同じ画面が日本語の見出し
  await page.evaluate(() => localStorage.setItem('appearance.look', 'classic'));
  await openApp(page);
  await expect(latestCorner(page)).toContainText('直近');
  await phaseLine.click();
  await expect(see(page, 'フェーズ · 増量 4/8週')).toBeVisible();
  await expect(see(page, '開始 10/12')).toBeVisible();
  await expect(see(page, '直近3週', { exact: false })).toBeVisible();
  await expect(see(page, 'いまどこ', { exact: true })).toBeVisible();
  for (const en of ['KARADA // PHASE', 'START 10/12', '1 TICK', 'PLAN', 'ACTIONS', 'NOW //']) await expect(see(page, en, { exact: false })).toHaveCount(0);
  await button(page, '戻る').click();
  await goTab(page, '筋トレ');
  await goPane(page, 'ケガ');
  await expect(see(page, '体の図', { exact: true })).toBeVisible();
  await expect(see(page, 'ケガ 1 ▲')).toBeVisible();
  for (const en of ['BODY MAP // SCAN', 'ACTIVE 01', 'CLEARED', 'R FRONT L', 'INJ-01']) await expect(see(page, en, { exact: false })).toHaveCount(0);
  // 1件の画面
  await page.getByRole('button', { name: /^右肩.*直している途中/ }).filter({ visible: true }).click();
  await expect(see(page, '対象 ・ ケガ 1')).toBeVisible();
  for (const en of ['TARGET', '01 / WHERE', 'R FRONT L', 'L BACK R']) await expect(see(page, en, { exact: false })).toHaveCount(0);
});
