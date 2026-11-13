import { expect, Page, test } from '@playwright/test';
import {
  button, chooseExercise, enterBody, fillSets, goTab, homeLatest, openApp, openBody, openSettings, recordFromHome, saveButton, see,
} from './helpers';

// 自重の負荷量の計算（体重 × 割合 × 回数、30日以内の前の日の体重、名前から決める割合）は jest
// （lib/__tests__/shared-testdata.test.ts の bodyweight.json）。ここは種目の追加・編集の割合の欄と、ホームの合計に入ること

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const ratio = (page: Page) => page.getByRole('textbox', { name: '体重に対する割合（%）' }).filter({ visible: true });
const NOTE = '体重の記録がないので自重の種目は入っていません';
const NAME = 'ハンドスタンドプッシュアップ';

test('回数だけの種目を割合つきで足して記録すると、体重 × 割合 × 回数がホームの合計に入る。体重がなければ入れずに知らせる', async ({ page }) => {
  await openApp(page);
  await recordFromHome(page, 'training');
  await button(page, '種目を追加').click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await button(page, '種目を追加').click();
  await page.getByPlaceholder('例：インクラインベンチプレス').fill(NAME);

  // 「重量 × 回数」のときは割合の欄を出さない。「回数だけ」にすると、名前から決めた割合（プッシュアップ 65%）が入る
  await expect(ratio(page)).toHaveCount(0);
  await page.getByRole('radio', { name: /^回数だけ/ }).click();
  await expect(ratio(page)).toHaveValue('65');
  await expect(button(page, '65%')).toHaveAttribute('aria-selected', 'true');
  await button(page, '100%').click();
  await expect(ratio(page)).toHaveValue('100');
  await ratio(page).fill('0');
  await expect(see(page, '0% なので、この種目は負荷量に入れません（プランクなど）')).toBeVisible();
  await ratio(page).fill('120');
  await button(page, '追加する').click();
  await expect(see(page, '体重に対する割合を 0〜100 で入れてください')).toBeVisible();
  await ratio(page).fill('90');
  await button(page, '追加する').click();

  await chooseExercise(page, NAME);
  await fillSets(page, [{ reps: '10' }, { reps: '8' }]);
  await saveButton(page).click();
  // 体重の記録がないので、その日の合計に入らず、知らせる
  await expect(page.getByRole('button', { name: `${NAME}を直す` })).toBeVisible();
  await expect(see(page, NOTE)).toBeVisible();
  await goTab(page, 'ホーム');
  await expect(visible(page, 'volume-week')).toContainText('0.00t');
  await expect(see(page, NOTE)).toBeVisible();

  // 体重を記録すると入る：70 × 90% ×（10 ＋ 8）= 1134kg
  await openBody(page);
  await enterBody(page, { weight: '70' });
  await goTab(page, 'ホーム');
  await expect(visible(page, 'volume-week')).toContainText('1.13t');
  await expect(homeLatest(page)).toHaveAttribute('aria-label', /1種目 2セット 1\.13トン/);
  await expect(see(page, NOTE)).toBeHidden();

  // 編集の画面で割合を変えると、過去の記録の合計も新しい割合で出る：70 × 50% × 18 = 630kg
  await openSettings(page);
  await page.getByRole('button', { name: /^種目と部位の管理/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${NAME} `) }).filter({ visible: true }).click();
  await expect(see(page, '種目を編集', { exact: true })).toBeVisible();
  await expect(ratio(page)).toHaveValue('90');
  await button(page, '50%').click();
  await button(page, '変更を保存').click();
  await expect(see(page, '種目と部位の管理', { exact: true })).toBeVisible();
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await expect(visible(page, 'volume-week')).toContainText('0.63t');
});

test('初期の自重の種目は名前から決めた割合で、重量 × 回数の種目の編集には割合の欄がない', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.getByRole('button', { name: /^種目と部位の管理/ }).click();
  await page.getByRole('button', { name: /^懸垂 / }).filter({ visible: true }).click();
  await expect(ratio(page)).toHaveValue('100');
  await button(page, '戻る').click();
  await page.getByRole('button', { name: /^クランチ / }).filter({ visible: true }).click();
  await expect(ratio(page)).toHaveValue('30');
  await button(page, '戻る').click();
  await page.getByRole('button', { name: /^ベンチプレス / }).filter({ visible: true }).click();
  await expect(see(page, '種目を編集', { exact: true })).toBeVisible();
  await expect(ratio(page)).toHaveCount(0);
});
