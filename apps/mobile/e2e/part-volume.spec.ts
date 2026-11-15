import { expect, Page, test } from '@playwright/test';
import { goTab, moveToDate, recordOn, TODAY } from './helpers';

// ホームの「今週の部位」（部位の量）：月曜から今日までの、部位ごとのセット数と、1 週間 10〜20 セットの目安との差、先週の同じ曜日までとの差。
// 集計・段・文字・読み上げは jest（lib/__tests__/partVolume.test.ts）。ここは画面に出ること：行の文字、読み上げ、行の四角と 2D の図の塗り。
// 今日は 2026-11-08（日曜）なので、今週は 11/2〜11/8、先週は 10/26〜11/1。
// 週のまとめの同じカード（report-weekly-volume）は reports.spec.ts、スクリーンショットは report-shots.spec.ts（SHOT_DIR）

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const row = (page: Page, part: string) => visible(page, `home-parts-body-row-${part}`);
const swatch = (page: Page, part: string) => visible(page, `home-parts-body-swatch-${part}`);

// theme の volumePalette（0 は図の筋肉の灰色、1〜3 段は青の濃淡）。sub は colors.sub
const RGB = { empty: 'rgb(74, 81, 93)', level1: 'rgb(42, 120, 173)', level2: 'rgb(58, 154, 217)', level3: 'rgb(99, 189, 245)', sub: 'rgb(154, 161, 173)' };

test('今週の部位：行の文字と読み上げ、行の四角と図の塗り、先週との差。押すと筋トレの推移の部位のバランス', async ({ page }) => {
  test.setTimeout(150_000);
  const sets = (n: number, weight: string, reps: string) => Array.from({ length: n }, () => ({ weight, reps }));
  // 先週（10/26〜11/1）：脚 8（10/28）、胸 2（10/30）。10/25 の胸 5 は先週の外
  await recordOn(page, '2026-10-28', [{ exercise: 'スクワット', sets: sets(8, '100', '5') }]);
  await recordOn(page, '2026-10-30', [{ exercise: 'ベンチプレス', sets: sets(2, '60', '10') }]);
  await recordOn(page, '2026-10-25', [{ exercise: 'ダンベルフライ', sets: sets(5, '10', '10') }]);
  // 今週（11/2〜今日）：脚 4、胸 10（目安の下限ちょうど）、肩 6、背中 1（回数だけの懸垂）
  await recordOn(page, '2026-11-03', [{ exercise: 'スクワット', sets: sets(4, '100', '5') }]);
  await recordOn(page, '2026-11-05', [{ exercise: 'ベンチプレス', sets: sets(10, '60', '10') }]);
  await recordOn(page, TODAY, [
    { exercise: 'ショルダープレス', sets: sets(6, '30', '10') },
    { exercise: '懸垂', sets: [{ reps: '10' }] },
  ]);
  await moveToDate(page, TODAY);

  const card = visible(page, 'home-parts');
  await test.step('見出しと期間。凡例は出さない。FUEL は全幅で、下の別の段', async () => {
    await expect(card).toContainText('今週の部位');
    await expect(card).toContainText('11/2–11/8');
    await expect(card).not.toContainText('凡例');
    await expect(card).not.toContainText('PARTS');
    const parts = (await card.boundingBox())!;
    const fuel = (await visible(page, 'home-fuel').boundingBox())!;
    expect(fuel.y).toBeGreaterThanOrEqual(parts.y + parts.height);
    expect(Math.abs(fuel.width - parts.width)).toBeLessThan(2);
  });

  await test.step('6 つの行：セット数と目安、先週の同じ曜日までとの差', async () => {
    await expect(row(page, '胸')).toHaveText('胸10 目安内先週 +8');
    await expect(row(page, '肩')).toHaveText('肩6／10 あと4先週 +6');
    await expect(row(page, '背中')).toHaveText('背中1／10 あと9先週 +1');
    await expect(row(page, '腕')).toHaveText('腕0／10 あと10先週 ±0');
    await expect(row(page, '脚')).toHaveText('脚4／10 あと6先週 −4');
    await expect(row(page, '腹')).toHaveText('腹0／10 あと10先週 ±0');
  });

  await test.step('差の色：目安に近づいた差だけ青、遠ざかった・同じ差は灰色', async () => {
    await expect(row(page, '胸').getByText('先週 +8')).toHaveCSS('color', RGB.level3);
    await expect(row(page, '脚').getByText('先週 −4')).toHaveCSS('color', RGB.sub);
    await expect(row(page, '腕').getByText('先週 ±0')).toHaveCSS('color', RGB.sub);
  });

  await test.step('行の四角：0 は灰色、1〜4 は 1 段、5〜9 は 2 段、10〜14 は 3 段', async () => {
    await expect(swatch(page, '腕')).toHaveCSS('background-color', RGB.empty);
    await expect(swatch(page, '腹')).toHaveCSS('background-color', RGB.empty);
    await expect(swatch(page, '背中')).toHaveCSS('background-color', RGB.level1);
    await expect(swatch(page, '脚')).toHaveCSS('background-color', RGB.level1);
    await expect(swatch(page, '肩')).toHaveCSS('background-color', RGB.level2);
    await expect(swatch(page, '胸')).toHaveCSS('background-color', RGB.level3);
  });

  await test.step('2D の図：前と後ろの両方。胸は 3 段、肩は 2 段、脚と背中は 1 段、腹は灰色のまま', async () => {
    const front = visible(page, 'home-parts-body-figure-front');
    const back = visible(page, 'home-parts-body-figure-back');
    await expect(front).toBeVisible();
    await expect(back).toBeVisible();
    await expect(front.locator('path[fill="#63BDF5"]').first()).toBeAttached(); // 胸
    await expect(front.locator('path[fill="#3A9AD9"]').first()).toBeAttached(); // 肩
    await expect(front.locator('path[fill="#2A78AD"]').first()).toBeAttached(); // 脚（前もも）
    await expect(back.locator('path[fill="#2A78AD"]').first()).toBeAttached(); // 背中・脚（もも裏）
    await expect(front.locator('path[fill="#4A515D"]').first()).toBeAttached(); // 腹・腕などの灰色
    // 緑・黄・橙・赤は使わない（回復の色と区別する）。ケガはないので赤の三角もない
    for (const c of ['#5BE49B', '#A6F2C8', '#FF8A3D', '#F5C94A', '#FF5A4F']) await expect(card.locator(`path[fill="${c}"]`)).toHaveCount(0);
    await expect(card.locator('[data-testid^="home-parts-body-injury-"]')).toHaveCount(0);
  });

  await test.step('読み上げ：期間・目安・部位ごとのセット数と目安との差・先週との差', async () => {
    await expect(card).toHaveAttribute('aria-label', '今週の部位、11月2日から11月8日のセット数（目安は 1 週間 10〜20）。'
      + '胸 10 セット、目安内、先週より 8 セット増えた、目安に近づいた。'
      + '肩 6 セット、あと4、先週より 6 セット増えた、目安に近づいた。'
      + '背中 1 セット、あと9、先週より 1 セット増えた、目安に近づいた。'
      + '腕 0 セット、あと10、先週と同じ。'
      + '脚 4 セット、あと6、先週より 4 セット減った、目安から離れた。'
      + '腹 0 セット、あと10、先週と同じ。筋トレの推移を開く');
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

test('月曜は先週の月曜どうしで比べる：今日が月曜なら、今週は今日 1 日だけ', async ({ page }) => {
  test.setTimeout(90_000);
  // 先週の月曜（10/26）に胸 3 セット、今週の月曜（11/2、今日）に胸 3 セット、日曜（11/1）の胸は先週に入る
  await recordOn(page, '2026-10-26', [{ exercise: 'ベンチプレス', sets: Array.from({ length: 3 }, () => ({ weight: '60', reps: '10' })) }]);
  await recordOn(page, '2026-11-01', [{ exercise: 'ベンチプレス', sets: [{ weight: '60', reps: '10' }] }]);
  await recordOn(page, '2026-11-02', [{ exercise: 'ベンチプレス', sets: [{ weight: '60', reps: '10' }, { weight: '60', reps: '10' }] }]);
  await moveToDate(page, '2026-11-02');
  const card = visible(page, 'home-parts');
  await expect(card).toContainText('11/2–11/2');
  // 今週は 11/2 だけの胸 2。前は 10/26 の 3（11/1 の 1 は先週の月曜〜同じ曜日（月曜）の外）
  await expect(row(page, '胸')).toHaveText('胸2／10 あと8先週 −1');
});
