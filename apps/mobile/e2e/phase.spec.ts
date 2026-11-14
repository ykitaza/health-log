import { expect, Page, test } from '@playwright/test';
import { button, enterBody, goTab, moveToDate, openApp, openBody, openSettings, settle, TODAY } from './helpers';

// フェーズの設定（オンボーディング）と進捗の詳細。計算（今の記録・週の点・ペースの文・崩れ・中間・成功の指標）は jest
// （lib/__tests__/phaseView.test.ts）。ここでは画面の流れ：始める → ホームの 1 行が変わる → 詳細 → 延長・目標の変更 → 中断、
// 療養に入る・終える、「あとで」、設定の行。今日は 2026-11-08（日）

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const phaseLine = (page: Page) => visible(page, 'hero-phase');

/** 今日の体重を入れてホームに戻る */
async function weighToday(page: Page, kg: string) {
  await openBody(page);
  await enterBody(page, { weight: kg, bodyFat: '18.2' });
  await goTab(page, 'ホーム');
}

/** ホームの NO PHASE から、増量・目標 80kg・16 週で始める（食事はスキップ） */
async function startBulk(page: Page) {
  await button(page, 'フェーズは未設定。フェーズを始める').click();
  await settle(visible(page, 'phase-direction-bulk'));
  await visible(page, 'phase-direction-bulk').click();
  await button(page, '次へ').click();
  await visible(page, 'phase-target').fill('80');
  await button(page, '次へ').click();
  await button(page, 'スキップ（今の目標のまま）').click();
  await button(page, 'この内容で始める').click();
  await settle(phaseLine(page));
}

test('始める → ホームの 1 行 → 詳細 → 延長 → 目標を変える → 中断で様子見に戻る', async ({ page }) => {
  // 11/1（日）に体重を測って始め、1 週あとの今日（11/8）に詳細を見る（目標の変更は始めた日と別の日にしないと、線が 1 本のまま置き換わる）
  await openApp(page, '2026-11-01');
  await weighToday(page, '76');

  await test.step('設定のステップ：向きを選ばないと進めない、目標と週、食事の目標、開始時の記録', async () => {
    await button(page, 'フェーズは未設定。フェーズを始める').click();
    await expect(page.getByRole('heading', { name: 'フェーズを始める' }).filter({ visible: true })).toBeVisible();
    await button(page, '次へ').click();
    await expect(page.getByRole('alert').filter({ visible: true })).toHaveText('向きを選んでください');
    await visible(page, 'phase-direction-bulk').click();
    await expect(visible(page, 'phase-direction-bulk')).toHaveAttribute('aria-checked', 'true');
    await button(page, '次へ').click();
    // 目標体重はアカウントにないので空。今の体重（7 日平均）は 76.0
    await expect(page.getByText('今の体重（7日平均）76.0 kg').filter({ visible: true })).toBeVisible();
    await button(page, '次へ').click();
    await expect(page.getByRole('alert').filter({ visible: true })).toHaveText('目標体重を入れてください');
    await visible(page, 'phase-target').fill('80');
    await expect(page.getByRole('radio', { name: '期間 16週' }).filter({ visible: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('週 +0.25 kg').filter({ visible: true })).toBeVisible();
    await expect(page.getByText('空なら「増量 16週」にします').filter({ visible: true })).toBeVisible();
    await button(page, '次へ').click();
    // 食事の目標：入れて進む
    await visible(page, 'phase-meal-training').fill('2800');
    await visible(page, 'phase-meal-rest').fill('2500');
    await visible(page, 'phase-meal-protein').fill('150');
    await button(page, '次へ').click();
    const snap = visible(page, 'phase-snapshot');
    await expect(snap).toContainText('76.0');
    await expect(snap).toContainText('18.2');
    await button(page, 'この内容で始める').click();
  });

  await test.step('ホームの 1 行が BULK 01/16 になる（測ったのが 1 日なので NO DATA）。1 週あとは 02/16', async () => {
    await expect(phaseLine(page)).toHaveText('BULK 01/16 · NO DATA');
    await moveToDate(page, TODAY);
    await expect(phaseLine(page)).toHaveText('BULK 02/16 · NO DATA');
  });

  await test.step('詳細：グラフ（予定の線と帯、1 週目は測ったのが 1 日なので白抜き）、ペースの理由、成功の指標、食事の目標', async () => {
    await phaseLine(page).click();
    await expect(page.getByRole('heading', { name: '増量 16週' }).filter({ visible: true })).toBeVisible();
    await expect(visible(page, 'phase-pace-status')).toHaveText('判定なし');
    await expect(visible(page, 'phase-pace-reason')).toHaveText('この7日に体重を測ったのが0日なので、判定していません（2日以上で判定します）。');
    await expect(page.getByTestId('phase-chart-plan')).toHaveCount(1);
    await expect(page.getByTestId('phase-chart-band')).toHaveCount(1);
    await expect(page.getByTestId('phase-chart-point-open')).toHaveCount(1);
    await expect(visible(page, 'phase-success')).toContainText('体重（週平均）・主');
    await expect(visible(page, 'phase-meals')).toContainText('筋トレの日 2,800・休みの日 2,500 kcal・たんぱく質 150 g');
  });

  await test.step('中間の週（12/21 は 8 週目）は、上に中間の見直し。「このまま続ける」で閉じる', async () => {
    await moveToDate(page, '2026-12-21');
    await expect(phaseLine(page)).toHaveText('BULK 08/16 · NO DATA');
    await phaseLine(page).click();
    await expect(visible(page, 'phase-mid')).toContainText('8／16週');
    await visible(page, 'phase-mid-keep').click();
    await expect(visible(page, 'phase-mid')).toHaveCount(0);
  });

  await test.step('延長：+4 週で 20 週に', async () => {
    await visible(page, 'phase-extend').click();
    await page.getByRole('radio', { name: '4週 延長' }).filter({ visible: true }).click();
    await visible(page, 'phase-extend-save').click();
    await expect(page.getByRole('heading', { name: '増量 20週' }).filter({ visible: true })).toBeVisible();
  });

  await test.step('目標を変える：79kg。予定の線は 2 本（前の線は薄く）', async () => {
    await visible(page, 'phase-target-change').click();
    await visible(page, 'phase-target-input').fill('79');
    await visible(page, 'phase-target-save').click();
    await expect(page.getByTestId('phase-chart-plan-old')).toHaveCount(1);
    await expect(visible(page, 'phase-weight')).toContainText('GOAL 79.0 KG');
  });

  await test.step('戻るとホームの 1 行は 01/20', async () => {
    await button(page, '戻る').click();
    await expect(phaseLine(page)).toHaveText('BULK 08/20 · NO DATA');
  });

  await test.step('中断：確かめてから様子見に戻る', async () => {
    await phaseLine(page).click();
    await visible(page, 'phase-abort').click();
    await button(page, '中断する').click();
    await expect(phaseLine(page)).toHaveText('NO PHASE · + START');
  });
});

test('療養に入る → ホームは REHAB → 療養を終えて再開する。早めに終えるとホームへ', async ({ page }) => {
  await openApp(page);
  await weighToday(page, '76');
  await startBulk(page);
  await expect(phaseLine(page)).toHaveText('BULK 01/16 · NO DATA');

  await phaseLine(page).click();
  await visible(page, 'phase-rehab-start').click();
  await visible(page, 'phase-rehab-name').fill('風邪');
  await visible(page, 'phase-rehab-save').click();
  await expect(page.getByRole('heading', { name: '風邪' }).filter({ visible: true })).toBeVisible();
  await expect(visible(page, 'phase-paused')).toContainText('止めているフェーズ：増量 16週');

  await button(page, '戻る').click();
  await expect(phaseLine(page)).toHaveText('REHAB DAY 01 · BULK PAUSED');

  await phaseLine(page).click();
  await visible(page, 'phase-end-rehab').click();
  await visible(page, 'phase-resume').click();
  await expect(page.getByRole('heading', { name: '増量 16週' }).filter({ visible: true })).toBeVisible();

  await visible(page, 'phase-end').click();
  await button(page, '終える').click();
  await expect(phaseLine(page)).toHaveText('NO PHASE · + START');
});

test('「あとで」は確かめてから閉じ、何も始めない。設定のいちばん上にフェーズの行', async ({ page }) => {
  await openApp(page);
  await button(page, 'フェーズは未設定。フェーズを始める').click();
  await visible(page, 'phase-direction-cut').click();
  await button(page, 'あとで').click();
  await expect(page.getByRole('heading', { name: 'フェーズを始めずに閉じますか？' })).toBeVisible();
  await button(page, '続ける').click();
  await expect(visible(page, 'phase-direction-cut')).toHaveAttribute('aria-checked', 'true');
  await button(page, 'あとで').click();
  await button(page, '閉じる').click();
  await expect(phaseLine(page)).toHaveText('NO PHASE · + START');

  await openSettings(page);
  const row = visible(page, 'settings-phase');
  await expect(row).toContainText('様子見中');
  await row.click();
  await expect(page.getByRole('heading', { name: 'フェーズを始める' }).filter({ visible: true })).toBeVisible();
});
