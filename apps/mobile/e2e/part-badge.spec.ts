import { expect, Locator, test } from '@playwright/test';
import { addEntry, goTab, openApp, openTrainingTrend, see, TODAY, trendDay, button } from './helpers';

// 種目の部位の札（記録のタブの種目のカードの2行目、推移で種目を選んだときの記録のカード）と、まとめの「部位」。
// 部位の決め方（総負荷量・7割）・読み上げの文は jest（lib/__tests__/training.test.ts の dayFocus・entryCardLabel）。
// ここは画面に出ることと、412 より狭い 360 の幅で崩れないこと
test.use({ viewport: { width: 360, height: 800 } });

const box = async (l: Locator) => (await l.boundingBox())!;
const visible = (l: Locator) => l.filter({ visible: true });

test('360 の幅：種目のカードは1行目に順番・名前・＞、2行目に部位・BIG3・推定1RM。まとめに部位。推移のカードにも部位', async ({ page }) => {
  await openApp(page);
  await goTab(page, '筋トレ');
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);

  // 読み上げ：動き、部位、BIG3、推定1RM
  const bench = page.getByRole('button', { name: 'ベンチプレスを直す。部位 胸、BIG3、推定1RM 101.3kg', exact: true });
  await expect(bench).toBeVisible();
  const parts = visible(page.getByTestId('day-parts'));
  await expect(parts).toHaveText('部位胸');
  await expect(parts).toHaveAttribute('aria-label', '部位 胸');
  // まとめの下に、鍛えた部位の図（前と後ろ。鍛えた筋肉を塗る。読み上げは番号・種目・部位）
  await expect(visible(page.getByTestId('day-parts-figure'))).toHaveAttribute('aria-label', '鍛えた部位の図。1 ベンチプレス 胸');

  // 名前の長い種目（部位の名前も長い）と、BIG3・推定1RM のない種目（回数だけ）を足す
  await addEntry(page, 'ライイングトライセプスエクステンション', [{ weight: '50', reps: '10' }]);
  await addEntry(page, '懸垂', [{ reps: '10' }]);
  await expect(page.getByRole('button', { name: '懸垂を直す。部位 背中', exact: true })).toBeVisible();
  // 部位は総負荷量で：胸 640、上腕三頭筋 500（7割以上）で2つ。懸垂は体重の記録がないので 0
  await expect(parts).toHaveText('部位胸・上腕三頭筋');
  await expect(parts).toHaveAttribute('aria-label', '部位 胸、上腕三頭筋');

  // まとめ：4つの欄が1行に並び、重ならず、カードからはみ出さない。部位の値は1行（行の高さ 28）
  const summary = await box(page.locator('[data-testid="day-parts"]').filter({ visible: true }).locator('..'));
  const stats = ['種目', '部位', 'セット', '合計負荷量'].map((label) => visible(see(page, label, { exact: true })).first().locator('..'));
  const boxes = await Promise.all(stats.map(box));
  for (const [i, b] of boxes.entries()) {
    expect(b.x).toBeGreaterThanOrEqual(summary.x);
    expect(b.x + b.width).toBeLessThanOrEqual(summary.x + summary.width + 0.5);
    expect(Math.abs(b.y - boxes[0].y)).toBeLessThan(1);
    if (i > 0) expect(boxes[i - 1].x + boxes[i - 1].width).toBeLessThanOrEqual(b.x);
  }
  expect((await box(parts.getByText('胸・上腕三頭筋', { exact: true }))).height).toBeLessThan(32);

  // 種目のカード：1行目の名前は＞に重ならない。2行目は名前の位置にそろい、札は高さ 24 でカードに収まる
  const long = page.getByRole('button', { name: /^ライイングトライセプスエクステンションを直す。/ });
  await expect(long).toHaveAccessibleName('ライイングトライセプスエクステンションを直す。部位 上腕三頭筋、推定1RM 66.7kg');
  const card = await box(long);
  const name = await box(long.getByText('ライイングトライセプスエクステンション', { exact: true }));
  const tags = long.getByTestId('entry-tags');
  const badge = await box(tags.getByText('上腕三頭筋', { exact: true }).locator('..'));
  const oneRm = await box(tags.getByText('推定1RM 66.7kg', { exact: true }));
  expect(Math.abs((await box(tags)).x - name.x)).toBeLessThan(1);
  expect(badge.y).toBeGreaterThanOrEqual(name.y + name.height - 0.5);
  expect(Math.abs(badge.height - 24)).toBeLessThan(1);
  expect(oneRm.x + oneRm.width).toBeLessThanOrEqual(card.x + card.width);
  expect(name.x + name.width).toBeLessThanOrEqual(card.x + card.width - 24);
  // 回数だけの種目は、部位の札だけ（BIG3・推定1RM はない）
  const pullUp = page.getByRole('button', { name: '懸垂を直す。部位 背中', exact: true }).getByTestId('entry-tags');
  await expect(pullUp).toHaveText('背中');
  await expect(bench.getByTestId('entry-tags')).toHaveText('胸BIG3推定1RM 101.3kg');

  // 推移で種目を選んだときの記録のカード：日付と種目の横に部位の札
  await openTrainingTrend(page);
  await button(page, 'ライイングトライセプスエクステンション').click();
  const day = trendDay(page, TODAY);
  await expect(day).toContainText('11月8日（日） ライイングトライセプスエクステンション');
  const dayCard = await box(day);
  const dayBadge = await box(day.getByText('上腕三頭筋', { exact: true }).locator('..'));
  expect(dayBadge.x + dayBadge.width).toBeLessThanOrEqual(dayCard.x + dayCard.width - 20);
  expect(Math.abs(dayBadge.height - 24)).toBeLessThan(1);
});
