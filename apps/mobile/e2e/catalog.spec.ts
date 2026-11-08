import { expect, Page, test } from '@playwright/test';
import { addEntry, button, chooseExercise, openApp, openSettings, recordToday, see, tab } from './helpers';

/** ホーム → 今日のトレーニング → 種目の選択 */
async function openSelect(page: Page) {
  await button(page, '本日のトレーニングを追加').click();
  await button(page, '種目を追加').click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
}

/** ホーム → 設定 → 種目と部位の管理 */
async function openManage(page: Page) {
  await openSettings(page);
  await page.getByRole('button', { name: /^種目と部位の管理/ }).click();
  await expect(see(page, '種目と部位の管理', { exact: true })).toBeVisible();
}

const row = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name} `) }).filter({ visible: true });
const search = (page: Page) => page.getByPlaceholder('種目を検索');

test('種目の検索と部位のチップ。一致がなければ空の状態', async ({ page }) => {
  await openApp(page);
  await openSelect(page);
  await expect(row(page, 'ベンチプレス')).toBeVisible();

  await search(page).fill('プレス');
  for (const n of ['ベンチプレス', 'インクラインダンベルプレス', 'ショルダープレス', 'レッグプレス']) {
    await expect(row(page, n)).toBeVisible();
  }
  await expect(row(page, 'スクワット')).toHaveCount(0);
  await expect(see(page, '脚', { exact: true })).toHaveCount(2); // チップと見出し

  // 部位のチップと検索を合わせる
  await button(page, '肩').click();
  await expect(button(page, '肩')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'ショルダープレス')).toBeVisible();
  await expect(row(page, 'ベンチプレス')).toHaveCount(0);

  // 前後の空白は無視する
  await button(page, 'すべて').click();
  await search(page).fill('  スクワット ');
  await expect(row(page, 'スクワット')).toBeVisible();

  await search(page).fill('存在しない種目');
  await expect(see(page, '見つかりません')).toBeVisible();
  await expect(see(page, '「＋ 種目を追加」で新しい種目を作れます')).toBeVisible();

  // 部位に種目がなければ（腹筋で「プレス」）空の状態
  await search(page).fill('プレス');
  await button(page, '腹筋').click();
  await expect(see(page, '見つかりません')).toBeVisible();
});

test('種目の追加：名前が空、同じ名前、長い名前（40文字まで）、回数だけ', async ({ page }) => {
  await openApp(page);
  await openSelect(page);
  // 選んでいた部位が初めから選ばれる
  await button(page, '肩').click();
  await button(page, '種目を追加').click();
  await expect(see(page, '種目の名前', { exact: true })).toBeVisible();
  await expect(button(page, '肩')).toHaveAttribute('aria-selected', 'true');

  const name = page.getByPlaceholder('例：インクラインベンチプレス');
  await button(page, '追加する').click();
  await expect(see(page, '種目の名前を入れてください')).toBeVisible();
  await name.fill('   ');
  await expect(see(page, '種目の名前を入れてください')).toBeHidden(); // 入れ直すと消える
  await button(page, '追加する').click();
  await expect(see(page, '種目の名前を入れてください')).toBeVisible();

  // 同じ部位に同じ名前（前後の空白は落として比べる）
  await name.fill(' ショルダープレス ');
  await button(page, '追加する').click();
  await expect(see(page, '同じ部位に同じ名前の種目があります')).toBeVisible();

  // 名前は40文字まで（前後の空白は数えない）
  await name.fill('とても長い名前の種目' + 'ア'.repeat(40));
  await button(page, '追加する').click();
  await expect(see(page, '種目の名前は40文字以内で入れてください（今は50文字）')).toBeVisible();
  const long = 'とても長い名前の種目' + 'ア'.repeat(30);
  await name.fill(`  ${long} `);
  await page.getByRole('radio', { name: /^回数だけ/ }).click();
  await expect(page.getByRole('radio', { name: /^回数だけ/ })).toHaveAttribute('aria-checked', 'true');
  await button(page, '追加する').click();

  // 選択の画面に戻り、肩の最後に出る
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await expect(row(page, long)).toBeVisible();
  await chooseExercise(page, long);
  await expect(see(page, '肩 ・ 今日の1種目目')).toBeVisible();
  await expect(page.getByLabel('セット1の重量')).toHaveCount(0);
  await expect(page.getByLabel('セット1の回数')).toBeVisible();
});

test('部位の追加と、その部位に種目を足す', async ({ page }) => {
  await openApp(page);
  await openManage(page);
  await button(page, '部位を追加').click();
  const input = page.getByPlaceholder('部位の名前（例：前腕）');
  await button(page, '追加する').click();
  await expect(see(page, '部位の名前を入れてください')).toBeVisible();
  await input.fill('胸');
  await button(page, '追加する').click();
  await expect(see(page, '同じ名前の部位があります')).toBeVisible();
  await input.fill('長'.repeat(41));
  await button(page, '追加する').click();
  await expect(see(page, '部位の名前は40文字以内で入れてください（今は41文字）')).toBeVisible();
  // キャンセルすると入力は消える
  await button(page, 'キャンセル').click();
  await button(page, '部位を追加').click();
  await expect(input).toHaveValue('');

  await input.fill('前腕');
  await button(page, '追加する').click();
  await expect(see(page, '前腕', { exact: true })).toBeVisible();
  await expect(see(page, '0種目')).toBeVisible();
  await expect(see(page, '種目がありません')).toBeVisible();

  // 管理の画面から種目を追加する
  await button(page, '種目を追加').click();
  await page.getByPlaceholder('例：インクラインベンチプレス').fill('リストカール');
  await button(page, '前腕').click();
  await button(page, '追加する').click();
  await expect(row(page, 'リストカール')).toBeVisible();
  await expect(see(page, '1種目')).toBeVisible();

  // 選択の画面にもチップと種目が出る
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await openSelect(page);
  await button(page, '前腕').click();
  await expect(row(page, 'リストカール')).toBeVisible();
});

test('非表示にした種目と部位は選択から消え、過去の記録には残る', async ({ page }) => {
  await openApp(page);
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }, { exercise: 'クランチ', sets: [{ reps: '20' }] }]);

  await openManage(page);
  await row(page, 'ベンチプレス').click();
  await expect(row(page, 'ベンチプレス')).toContainText('非表示');
  await expect(see(page, '5種目・非表示 1')).toBeVisible();
  // 腹筋の部位ごと非表示にする
  await see(page, '腹筋', { exact: true }).locator('..').getByRole('button', { name: '部位を非表示' }).click();
  await expect(see(page, '腹筋（非表示）')).toBeVisible();
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  // ホームの今日の記録には残る
  await expect(see(page, 'ベンチプレス', { exact: true })).toBeVisible();
  await expect(see(page, 'クランチ', { exact: true })).toBeVisible();

  // 選択の一覧から消える（検索でも出ない）。部位のチップも消える
  await openSelect(page);
  await expect(row(page, 'インクラインダンベルプレス')).toBeVisible();
  await expect(row(page, 'ベンチプレス')).toHaveCount(0);
  await expect(button(page, '腹筋')).toHaveCount(0);
  await search(page).fill('ベンチ');
  await expect(see(page, '見つかりません')).toBeVisible();
  await button(page, '戻る').click();

  // その日の画面では直せる
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(page.getByLabel('セット1の重量')).toHaveValue('80');
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  // 履歴にも残る
  await tab(page, '履歴／分析').click();
  await expect(button(page, 'ベンチプレス')).toBeVisible();
  await expect(button(page, 'クランチ')).toBeVisible();
  await expect(see(page, '11月8日（日） ベンチプレス')).toBeVisible();

  // 表示に戻すと、選択にも戻る
  await tab(page, 'ホーム').click();
  await openManage(page);
  await row(page, 'ベンチプレス').click();
  await expect(row(page, 'ベンチプレス')).toContainText('表示中');
  await button(page, '部位を表示').click();
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await openSelect(page);
  await expect(row(page, 'ベンチプレス')).toBeVisible();
  await expect(button(page, '腹筋')).toBeVisible();
  // すでに今日記録があるので、選ぶと既存の記録が開く
  await chooseExercise(page, 'ベンチプレス');
  await expect(page.getByLabel('セット1の重量')).toHaveValue('80');
});

test('非表示にした種目は、新しく足せないが、すでにある日の記録は外せる', async ({ page }) => {
  await openApp(page);
  await button(page, '本日のトレーニングを追加').click();
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);
  await button(page, '戻る').click();
  await openManage(page);
  await row(page, 'ベンチプレス').click();
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await button(page, '本日のトレーニングを追加').click();
  await button(page, 'ベンチプレスを外す').click();
  await button(page.getByRole('dialog'), '外す').click();
  await expect(see(page, 'まだ種目がありません')).toBeVisible();
});

test('種目と部位の追加の途中で戻るときも確かめる。名前が空なら確かめない', async ({ page }) => {
  await openApp(page);
  await openSelect(page);
  const name = page.getByPlaceholder('例：インクラインベンチプレス');
  await button(page, '種目を追加').click();
  await expect(name).toBeVisible();
  await button(page, '戻る').click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await button(page, '種目を追加').click();
  await name.fill('片手ケーブルクロス');
  await button(page, '戻る').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('入力をやめますか？');
  await expect(dialog).toContainText('入力した種目は追加されません。');
  await button(dialog, 'キャンセル').click();
  await expect(name).toHaveValue('片手ケーブルクロス');
  await button(page, '戻る').click();
  await button(page.getByRole('dialog'), 'やめる').click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await expect(row(page, '片手ケーブルクロス')).toHaveCount(0);
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  await openManage(page);
  await button(page, '部位を追加').click();
  await page.getByPlaceholder('部位の名前（例：前腕）').fill('前腕');
  await button(page, '戻る').click();
  await expect(page.getByRole('dialog')).toContainText('入力した部位は追加されません。');
  await button(page.getByRole('dialog'), 'やめる').click();
  await expect(see(page, '重さの単位', { exact: true })).toBeVisible();
});

test('非表示の部位・種目と同じ名前を足そうとすると、表示に戻すか確かめる', async ({ page }) => {
  await openApp(page);
  await openManage(page);
  await see(page, '腹筋', { exact: true }).locator('..').getByRole('button', { name: '部位を非表示' }).click();
  await expect(see(page, '腹筋（非表示）')).toBeVisible();

  await button(page, '部位を追加').click();
  await page.getByPlaceholder('部位の名前（例：前腕）').fill(' 腹筋 ');
  await button(page, '追加する').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('非表示の部位があります。表示に戻しますか？');
  // キャンセルなら非表示のまま
  await button(dialog, 'キャンセル').click();
  await expect(dialog).toBeHidden();
  await expect(see(page, '腹筋（非表示）')).toBeVisible();
  // 表示に戻すと、新しく足さずにその部位が表示に戻る
  await button(page, '追加する').click();
  await button(page.getByRole('dialog'), '表示に戻す').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(see(page, '腹筋（非表示）')).toHaveCount(0);
  await expect(see(page, '腹筋', { exact: true })).toHaveCount(1);
  await expect(button(page, '部位を追加')).toBeVisible();

  // 種目も同じ（同じ部位の非表示の種目）
  await row(page, 'ベンチプレス').click();
  await expect(row(page, 'ベンチプレス')).toContainText('非表示');
  await button(page, '種目を追加').click();
  await page.getByPlaceholder('例：インクラインベンチプレス').fill('ベンチプレス');
  await button(page, '胸').click();
  await button(page, '追加する').click();
  await expect(page.getByRole('dialog')).toContainText('非表示の種目があります。表示に戻しますか？');
  await button(page.getByRole('dialog'), '表示に戻す').click();
  await expect(see(page, '種目と部位の管理', { exact: true })).toBeVisible();
  await expect(row(page, 'ベンチプレス')).toHaveCount(1);
  await expect(row(page, 'ベンチプレス')).toContainText('表示中');
});
