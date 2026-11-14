import { expect, Page, test } from '@playwright/test';
import { button, enterBody, goTab, moveToDate, openApp, openBody, openSettings, settle, TODAY } from './helpers';

// フェーズの設定（オンボーディング）と進捗の詳細。計算（今の記録・週の点・ペースの文・崩れ・中間・成功の指標）は jest
// （lib/__tests__/phaseView.test.ts）、計画の編集の決まりと目盛りは lib/__tests__/phaseEdit.test.ts。ここでは画面の流れ：
// 始める → ホームの 1 行が変わる → 詳細 → 計画を変える（延ばす・目標・縮める）→ 中断、始め忘れ（過去の開始日）→ 開始日・期間を直す、
// 療養に入る・終える、「あとで」、設定の行。今日は 2026-11-08（日）。SHOT_DIR を渡すと <SHOT_DIR>/phase-edit-*.png を撮る

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

test('始める → ホームの 1 行 → 詳細 → 計画を変える（延ばす・目標・縮める）→ 中断で様子見に戻る', async ({ page }) => {
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
    // いまどこ：2 週目で、16 週なので目盛りは 1 つ過ぎて 2 つ目
    await expect(visible(page, 'phase-now')).toContainText('W02');
    await expect(page.getByTestId('phase-ticks-done')).toHaveCount(1);
    await expect(page.getByTestId('phase-ticks-current')).toHaveCount(1);
  });

  await test.step('中間の週（12/21 は 8 週目）は、上に中間の見直し。「このまま続ける」で閉じる', async () => {
    await moveToDate(page, '2026-12-21');
    await expect(phaseLine(page)).toHaveText('BULK 08/16 · NO DATA');
    await phaseLine(page).click();
    await expect(visible(page, 'phase-mid')).toContainText('8／16週');
    await visible(page, 'phase-mid-keep').click();
    await expect(visible(page, 'phase-mid')).toHaveCount(0);
  });

  await test.step('計画を変える（今日から）：期間を 20 週に延ばす', async () => {
    await visible(page, 'phase-plan-change').click();
    await expect(visible(page, 'phase-mode-change')).toHaveAttribute('aria-checked', 'true');
    // 変えていないうちは押せない
    await expect(visible(page, 'phase-edit-save')).toBeDisabled();
    for (let i = 0; i < 4; i++) await visible(page, 'phase-edit-weeks-plus').click();
    await expect(visible(page, 'phase-edit-weeks')).toHaveValue('20');
    await expect(visible(page, 'phase-edit-preview')).toContainText('2/20 → 3/20');
    await visible(page, 'phase-edit-save').click();
    await expect(page.getByRole('heading', { name: '増量 20週' }).filter({ visible: true })).toBeVisible();
  });

  await test.step('計画を変える：目標を今日から 79kg に。予定の線は 2 本（前の線は薄く）', async () => {
    await visible(page, 'phase-plan-change').click();
    // 開くたびに今の計画から始まる（前に入れた値は残らない）
    await expect(visible(page, 'phase-edit-weeks')).toHaveValue('20');
    await visible(page, 'phase-edit-target').fill('79');
    await expect(visible(page, 'phase-edit-preview')).toContainText('今日から 79.0 kg');
    await visible(page, 'phase-edit-save').click();
    await expect(page.getByTestId('phase-chart-plan-old')).toHaveCount(1);
    await expect(visible(page, 'phase-weight')).toContainText('GOAL 79.0 KG');
    await expect(visible(page, 'phase-plan')).toContainText('計画を変えた回数');
  });

  await test.step('計画を変える：期間を縮める。終わりが今日より前になる週数は選べない', async () => {
    await visible(page, 'phase-plan-change').click();
    await visible(page, 'phase-edit-weeks').fill('7');
    await expect(visible(page, 'phase-edit-problem')).toHaveText('期間は8週より短くできません（終わりが今日より前になります）');
    await expect(visible(page, 'phase-edit-save')).toBeDisabled();
    await visible(page, 'phase-edit-weeks').fill('10');
    await visible(page, 'phase-edit-save').click();
    await expect(page.getByRole('heading', { name: '増量 10週' }).filter({ visible: true })).toBeVisible();
  });

  await test.step('戻るとホームの 1 行は 08/10', async () => {
    await button(page, '戻る').click();
    await expect(phaseLine(page)).toHaveText('BULK 08/10 · NO DATA');
  });

  await test.step('中断：確かめてから様子見に戻る', async () => {
    await phaseLine(page).click();
    await visible(page, 'phase-abort').click();
    await button(page, '中断する').click();
    await expect(phaseLine(page)).toHaveText('NO PHASE · + START');
  });
});

test('療養に入る → ホームは REHAB → 療養を終えて再開する。早めに終えると振り返りへ', async ({ page }) => {
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
  // 振り返りの画面へ（くわしくは phase-review.spec.ts）。戻るとホームの 1 行はその振り返りへの入口
  await expect(page.getByRole('heading', { name: 'フェーズの振り返り' }).filter({ visible: true })).toBeVisible();
  await button(page, '戻る').click();
  await expect(phaseLine(page)).toHaveText('BULK DONE · REVIEW');
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

const shot = async (page: Page, name: string, top = false) => {
  if (!process.env.SHOT_DIR) return;
  // 進み具合は上（いまどこ）から撮る
  if (top) {
    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, -10000);
    await expect(visible(page, 'phase-now')).toBeInViewport();
  }
  await page.screenshot({ path: `${process.env.SHOT_DIR}/phase-edit-${name}.png`, fullPage: false });
};

test('始め忘れ：過去の開始日で始める → 開始日・期間・目標を直す（目盛りは期間に比例）', async ({ page }) => {
  // 11/1（日）に体重を測っていたが、フェーズを始め忘れた。1 週あとの今日（11/8）に、11/1 から始めたことにする
  await openApp(page, '2026-11-01');
  await weighToday(page, '76');
  await moveToDate(page, TODAY);

  await test.step('始める：開始日をカレンダーで先週の日曜にする。体重・終了日・開始時の記録はその日から', async () => {
    await button(page, 'フェーズは未設定。フェーズを始める').click();
    await settle(visible(page, 'phase-direction-bulk'));
    await visible(page, 'phase-direction-bulk').click();
    await button(page, '次へ').click();
    // 今日より後の日は選べない
    await expect(visible(page, 'phase-start-date-next')).toBeDisabled();
    await visible(page, 'phase-start-date').click();
    await expect(page.getByTestId('day-2026-11-09').filter({ visible: true })).toBeDisabled();
    await page.getByTestId('day-2026-11-01').filter({ visible: true }).click();
    await expect(visible(page, 'phase-start-past')).toContainText('11月1日（日）から始めたことにします');
    await expect(page.getByText('開始日の体重（11月1日までの7日平均）76.0 kg').filter({ visible: true })).toBeVisible();
    await visible(page, 'phase-target').fill('80');
    await expect(page.getByText('2月20日。あとで変えられます').filter({ visible: true })).toBeVisible();
    await page.mouse.wheel(0, -2000);
    await shot(page, 'new-start-date');
    await button(page, '次へ').click();
    await button(page, 'スキップ（今の目標のまま）').click();
    await expect(page.getByRole('heading', { name: '開始日（11月1日）までの記録を控えます' }).filter({ visible: true })).toBeVisible();
    await expect(visible(page, 'phase-snapshot')).toContainText('76.0');
    await button(page, 'この内容で始める').click();
    await settle(phaseLine(page));
    await expect(phaseLine(page)).toHaveText('BULK 02/16 · NO DATA');
  });

  await test.step('16 週：2 週目は目盛りが 1 つ過ぎて 2 つ目', async () => {
    await phaseLine(page).click();
    await expect(visible(page, 'phase-plan')).toContainText('11月1日（日）');
    await expect(page.getByTestId('phase-ticks-done')).toHaveCount(1);
    await expect(page.getByTestId('phase-ticks-current')).toHaveCount(1);
    await shot(page, 'progress-16w', true);
  });

  /** 直すのシートで期間だけ変える */
  const correctWeeks = async (weeks: string) => {
    await visible(page, 'phase-plan-correct').click();
    await expect(visible(page, 'phase-mode-correct')).toHaveAttribute('aria-checked', 'true');
    await visible(page, 'phase-edit-weeks').fill(weeks);
    await visible(page, 'phase-edit-save').click();
    await expect(page.getByRole('heading', { name: `増量 ${weeks}週` }).filter({ visible: true })).toBeVisible();
  };

  await test.step('8 週に直す：1 週で 2 つ進むので、2 週目は 2 つ過ぎて 3 つ目', async () => {
    await correctWeeks('8');
    await expect(page.getByTestId('phase-ticks-done')).toHaveCount(2);
    await expect(visible(page, 'phase-now')).toContainText('1 TICK = 3.5D');
    await shot(page, 'progress-8w', true);
  });

  await test.step('24 週に直す：1 つが 1.5 週なので、2 週目はまだ 1 つ目', async () => {
    await correctWeeks('24');
    await expect(page.getByTestId('phase-ticks-done')).toHaveCount(0);
    await expect(page.getByTestId('phase-ticks-current')).toHaveCount(1);
    await expect(visible(page, 'phase-now')).toContainText('1 TICK = 1.5W');
    await shot(page, 'progress-24w', true);
  });

  await test.step('開始日を直す（11/1 → 11/3）と目標。開始時の記録は 11/3 までの記録から出し直し、線は開始日から 1 本', async () => {
    // 先に今日から目標を変えておく（直すとこの線は消える）
    await visible(page, 'phase-plan-change').click();
    await visible(page, 'phase-edit-target').fill('81');
    await visible(page, 'phase-edit-save').click();
    await expect(page.getByTestId('phase-chart-plan-old')).toHaveCount(1);

    await visible(page, 'phase-plan-correct').click();
    await expect(visible(page, 'phase-edit-warning')).toHaveText('今までに計画を変えた 1 回分の線は消え、最初からこの計画だったことになります。');
    await visible(page, 'phase-edit-start-next').click();
    await visible(page, 'phase-edit-start-next').click();
    await visible(page, 'phase-edit-target').fill('79');
    const preview = visible(page, 'phase-edit-preview');
    await expect(preview).toContainText('11/1 → 11/3');
    await expect(preview).toContainText('76.0 kg');
    await expect(preview).toContainText('11/3から 76.0 kg → 79.0 kg');
    await shot(page, 'sheet-correct');
    await visible(page, 'phase-edit-save').click();
    await expect(visible(page, 'phase-plan')).toContainText('11月3日（火）');
    await expect(visible(page, 'phase-weight')).toContainText('GOAL 79.0 KG');
    await expect(page.getByTestId('phase-chart-plan-old')).toHaveCount(0);
    await expect(visible(page, 'phase-plan')).not.toContainText('計画を変えた回数');
  });

  await test.step('計画を変えるのシート（撮るだけ）', async () => {
    await visible(page, 'phase-plan-change').click();
    await visible(page, 'phase-edit-weeks-minus').click();
    await shot(page, 'sheet-change');
    await page.getByRole('button', { name: 'やめる' }).filter({ visible: true }).click();
  });

  await test.step('ホームの輪も 16 の目盛り（撮るだけ）', async () => {
    await button(page, '戻る').click();
    await expect(phaseLine(page)).toHaveText('BULK 01/24 · NO DATA');
    await shot(page, 'home-ring-24w');
  });

  await test.step('期間が終わったら「期間を延ばす」：今日までを収める週数から始まり、そのまま延ばせる', async () => {
    // 11/3 から 24 週は 4/19 まで。4/25 は 25 週目に入る
    await moveToDate(page, '2027-04-25');
    await phaseLine(page).click();
    await expect(visible(page, 'phase-expired')).toBeVisible();
    await visible(page, 'phase-expired').getByRole('button', { name: '期間を延ばす' }).click();
    await expect(visible(page, 'phase-edit-weeks')).toHaveValue('25');
    await expect(visible(page, 'phase-edit-preview')).toContainText('4/19 → 4/26');
    await visible(page, 'phase-edit-save').click();
    await expect(page.getByRole('heading', { name: '増量 25週' }).filter({ visible: true })).toBeVisible();
    await expect(visible(page, 'phase-expired')).toHaveCount(0);
  });
});
