import { expect, Page, test } from '@playwright/test';
import { button, chooseExercise, goPane, goTab, moveToDate, openApp, see } from './helpers';

// 筋トレの入力画面の「直すこと」の帯：直している途中のケガで、種目が同じときに出る。
// 突き合わせ（直せた・ほかの種目は出さない、新しい順に2件まで）と、同じ日の振り返り済みの判定は jest（lib/__tests__/injuries.test.ts）。
// SHOT_DIR を渡すと、帯が出た入力画面と、振り返りを押したあとのスクリーンショットを残す（見た目の確認用）

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
};

/** ベンチプレスのラックアップで右の部位（既定は肩）を痛めた、直し方つきのケガを記録する */
async function recordBenchInjury(page: Page, site = '肩') {
  await goTab(page, '筋トレ');
  await goPane(page, 'ケガ');
  await page.getByTestId('injury-new').click();
  // 記録の方法のシートで「自分で入力」
  await page.getByTestId('injury-new-manual').filter({ visible: true }).click();
  await button(page, '一覧から選ぶ').click();
  await button(page, site).click();
  await page.getByTestId('injury-exercise').filter({ visible: true }).click();
  await button(page, 'ベンチプレス 胸').click();
  await button(page, 'ラックアップ').click();
  await page.getByRole('textbox', { name: '次はこう直す' }).fill('肩甲骨を寄せてから外す');
  await page.getByTestId('injury-save').filter({ visible: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^右${site}、直している途中`) }).filter({ visible: true })).toBeVisible();
}

/** 筋トレのタブの「記録」から、種目の入力画面を開く */
async function openEntry(page: Page, exercise: string) {
  await goTab(page, '筋トレ');
  await goPane(page, '記録');
  await button(page, '種目を追加').click();
  await chooseExercise(page, exercise);
}

const band = (page: Page) => page.getByRole('button', { name: /^直すこと、/ }).filter({ visible: true });

test('ケガの種目の入力画面に「直すこと」の帯が出る。振り返りを書けて、直せたにすると帯が消える。別の種目には出ない', async ({ page }) => {
  await openApp(page);
  await recordBenchInjury(page);

  // 別の種目には出ない
  await openEntry(page, 'スクワット');
  await expect(page.getByTestId('injury-band')).toHaveCount(0);
  await button(page, '戻る').click();

  // ベンチプレスには出る：直すこと・部位と場面・直し方
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  await expect(band(page)).toHaveAccessibleName('直すこと、肩甲骨を寄せてから外す。右肩・ラックアップ。押すとケガの記録を開く');
  await expect(band(page)).toContainText('右肩・ラックアップ');
  await shot(page, 'injury-band');

  // まだ：結果を選んだシートが開く（日付と種目は決め打ち）→ 足すと、入口は「振り返り済み」になる
  await button(page, '振り返りを書く：△ まだ（右肩・ラックアップ）').click();
  await expect(see(page, '振り返りを足す', { exact: true })).toBeVisible();
  await expect(see(page, '11月8日（日） ・ ベンチプレスで試した', { exact: true })).toBeVisible();
  await expect(button(page, '△ まだ')).toHaveAttribute('aria-selected', 'true');
  await shot(page, 'injury-band-review');
  await page.getByRole('textbox', { name: 'メモ', exact: true }).fill('まだ肩が前に出る');
  await page.getByTestId('review-save').filter({ visible: true }).click();
  const reviewed = button(page, '振り返り済み、まだ（右肩・ラックアップ）。押すとケガの記録を開く');
  await expect(reviewed).toBeVisible();
  await expect(reviewed).toContainText('振り返り済み（△まだ）');
  await expect(button(page, '振り返りを書く：✓ 直せた（右肩・ラックアップ）')).toHaveCount(0);
  await shot(page, 'injury-band-reviewed');

  // 振り返り済みを押すと1件が開き、振り返りが1件増えている（種目つき）
  await reviewed.click();
  await expect(see(page, '次はこう直す', { exact: true })).toBeVisible();
  const log = page.getByTestId('injury-log').filter({ visible: true });
  await expect(log).toContainText('△まだ');
  await expect(log).toContainText('ベンチプレス');
  await expect(see(page, /振り返り 1回/)).toBeVisible();
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  // 次の日：入口がまた出る。直せた → 聞かれて直せたにする → 帯が消える
  await moveToDate(page, '2026-11-09');
  await openEntry(page, 'ベンチプレス');
  await button(page, '振り返りを書く：✓ 直せた（右肩・ラックアップ）').click();
  await expect(button(page, '✓ 直せた')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('review-save').filter({ visible: true }).click();
  await expect(see(page, 'このケガを直せたにしますか？', { exact: true })).toBeVisible();
  await button(page, '直せたにする').click();
  await expect(page.getByTestId('injury-band')).toHaveCount(0);

  // ケガの一覧では直せたに移り、振り返りは2件
  await button(page, '戻る').click();
  await goPane(page, 'ケガ');
  await page.getByRole('button', { name: /^右肩、直せた/ }).filter({ visible: true }).click();
  await expect(see(page, /振り返り 2回/)).toBeVisible();
});

test('同じ種目のケガが3件あれば、帯は2件まで出し、残りは「ほか 1 件」', async ({ page }) => {
  await openApp(page);
  for (const site of ['肩', 'ひじ', '手首']) await recordBenchInjury(page, site);
  await openEntry(page, 'ベンチプレス');
  await expect(band(page)).toHaveCount(2);
  await expect(page.getByTestId('injury-band-more')).toHaveText('ほか 1 件');
});

test.describe('動きを減らす設定がオフ', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('帯が動きつきで出る（画面のエラーなしで出る）', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await recordBenchInjury(page);
    await openEntry(page, 'ベンチプレス');
    await expect(band(page)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
