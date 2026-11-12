import { expect, test } from '@playwright/test';
import { button, moveToDate, openApp, openBody, recordOn, see, TODAY } from './helpers';

// からだのタブの回復マップ。web では 3D を出さず、2D の図（前と後ろ）で 7日以内に鍛えた部位を塗る（Android は 3D。実機で見る）。
// 光の強さ・部位と部品の対応・日数とセット数の数え方は jest（lib/__tests__/recoveryMap.test.ts、bodyScene.test.ts）。
// ここは、記録がなければ出さないことと、部位のボタンを押すと最後の日・2週間のセット数が出ること

test('筋トレの記録がなければ回復マップは出さない。記録したら 2D の図と部位のボタン。押すと最後に鍛えた日と2週間のセット数', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await openBody(page);
  await expect(button(page, '前の日')).toBeVisible();
  await expect(page.getByTestId('recovery-map')).toHaveCount(0);

  await recordOn(page, '2026-10-20', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  await recordOn(page, '2026-11-05', [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }, { weight: '80', reps: '8' }] }]);
  await moveToDate(page, TODAY);
  await openBody(page);

  const card = page.getByTestId('recovery-map').filter({ visible: true });
  await expect(card).toBeVisible();
  await expect(see(card, 'RECOVERY MAP // 7D')).toBeVisible();
  await expect(card.getByTestId('recovery-2d')).toBeVisible();
  await expect(card.getByTestId('recovery-legend')).toHaveText('温存最近の負荷ケガ');
  await expect(card.getByLabel(/^回復マップ。青は温存、橙は最近の負荷、赤はケガ。7日以内に鍛えた部位、胸 3日前$/)).toHaveCount(1);
  // 2週間より前の脚は、ボタンには出るが 7日以内には入らない
  await expect(button(card, '脚、19日前、2週間で 0セット')).toBeVisible();
  await expect(button(card, '背中、まだ鍛えていない、2週間で 0セット')).toBeVisible();
  // ボタンは 48dp 以上
  expect((await button(card, '胸、3日前、2週間で 2セット').boundingBox())!.height).toBeGreaterThanOrEqual(48);

  await button(card, '胸、3日前、2週間で 2セット').click();
  const sel = card.getByTestId('recovery-select');
  await expect(sel).toContainText('SELECT //');
  await expect(sel).toContainText('最後に鍛えた日 3日前（11月5日）');
  await expect(sel).toContainText('2週間のセット数 2セット');
  // もう一度押すと閉じる
  await button(card, '胸、3日前、2週間で 2セット').click();
  await expect(sel).toHaveCount(0);

  // 前の日に移ると、その日までの記録で数える（11月4日には胸はまだ）
  for (let i = 0; i < 4; i++) await button(page, '前の日').click();
  await expect(see(page, '11月4日（水）', { exact: true })).toBeVisible();
  await expect(button(card, '胸、まだ鍛えていない、2週間で 0セット')).toBeVisible();
  await expect(button(card, '脚、15日前、2週間で 0セット')).toBeVisible();
});
