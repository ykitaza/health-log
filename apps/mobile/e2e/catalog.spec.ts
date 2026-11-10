import { expect, Page, test } from '@playwright/test';
import { button, chooseExercise, goPane, goTab, openApp, openSettings, recordToday, see, tab, recordFromHome } from './helpers';

/** ホーム → 今日のトレーニング → 種目の選択 */
async function openSelect(page: Page) {
  await recordFromHome(page, 'training');
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

/** 管理の画面で種目を押して、編集の画面を開く */
async function openEdit(page: Page, name: string) {
  await row(page, name).click();
  await expect(see(page, '種目を編集', { exact: true })).toBeVisible();
}
const shownSwitch = (page: Page) => page.getByRole('switch', { name: '種目の選択に表示する' }).filter({ visible: true });

/** 管理の画面から、種目の表示・非表示を切り替えて保存し、管理の画面に戻る */
async function toggleShown(page: Page, name: string) {
  await openEdit(page, name);
  await shownSwitch(page).click();
  await button(page, '変更を保存').click();
  await expect(see(page, '種目と部位の管理', { exact: true })).toBeVisible();
}
const search = (page: Page) => page.getByPlaceholder('種目を検索');

test('種目の検索と部位のチップ。一致がなければ空の状態', async ({ page }) => {
  // 絞り込みの細かい場合（前後の空白、部位と検索の組み合わせ）は jest（lib/__tests__/screen-logic.test.ts）
  await openApp(page);
  await openSelect(page);
  await expect(row(page, 'ベンチプレス')).toBeVisible();

  await search(page).fill('プレス');
  await expect(row(page, 'ショルダープレス')).toBeVisible();
  await expect(row(page, 'スクワット')).toHaveCount(0);
  // 部位のチップと検索を合わせる
  await button(page, '肩').click();
  await expect(button(page, '肩')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'ショルダープレス')).toBeVisible();
  await expect(row(page, 'ベンチプレス')).toHaveCount(0);

  await button(page, 'すべて').click();
  await search(page).fill('存在しない種目');
  await expect(see(page, '見つかりません')).toBeVisible();
  await expect(see(page, '右上の「種目を追加」で新しい種目を作れます')).toBeVisible();
});

test('種目の追加：名前が空、同じ名前、回数だけ', async ({ page }) => {
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

  // 名前の長さの上限（40文字）は jest（db/__tests__/repositories.test.ts）。前後の空白は落とす
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
  // 名前が空・長すぎるときの断り方は jest（db/__tests__/repositories.test.ts）
  await input.fill('胸');
  await button(page, '追加する').click();
  await expect(see(page, '同じ名前の部位があります')).toBeVisible();
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

test('非表示にした種目と部位は選択から消え、過去の記録には残る。その日の記録は直せて、外せる', async ({ page }) => {
  await openApp(page);
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }, { exercise: 'クランチ', sets: [{ reps: '20' }] }]);

  await openManage(page);
  await toggleShown(page, 'ベンチプレス');
  await expect(row(page, 'ベンチプレス')).toContainText('非表示');
  await expect(see(page, '5種目・非表示 1')).toBeVisible();
  // 腹筋の部位ごと非表示にする
  await see(page, '腹筋', { exact: true }).locator('..').getByRole('button', { name: '部位を非表示' }).click();
  await expect(see(page, '腹筋（非表示）')).toBeVisible();
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  // 筋トレの今日と履歴には残る
  await goTab(page, '筋トレ');
  await goPane(page, '今日');
  await expect(see(page, 'ベンチプレス', { exact: true })).toBeVisible();
  await expect(see(page, 'クランチ', { exact: true })).toBeVisible();
  await goPane(page, '履歴');
  await expect(button(page, 'ベンチプレス')).toBeVisible();
  await expect(button(page, 'クランチ')).toBeVisible();
  await expect(see(page, '11月8日（日） ベンチプレス')).toBeVisible();
  await tab(page, 'ホーム').click();

  // 選択の一覧から消える（検索でも出ない）。部位のチップも消える
  await openSelect(page);
  await expect(row(page, 'インクラインダンベルプレス')).toBeVisible();
  await expect(row(page, 'ベンチプレス')).toHaveCount(0);
  await expect(button(page, '腹筋')).toHaveCount(0);
  await search(page).fill('ベンチ');
  await expect(see(page, '見つかりません')).toBeVisible();
  await button(page, '戻る').click();

  // その日の画面では直せて、外せる
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(page.getByLabel('セット1の重量')).toHaveValue('80');
  await button(page, '戻る').click();
  await button(page, 'ベンチプレスを外す').click();
  await button(page.getByRole('dialog'), '外す').click();
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toHaveCount(0);
  await button(page, '戻る').click();

  // 表示に戻すと、選択にも戻る
  await openManage(page);
  await toggleShown(page, 'ベンチプレス');
  await expect(row(page, 'ベンチプレス')).toContainText('表示中');
  await button(page, '部位を表示').click();
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await openSelect(page);
  await expect(row(page, 'ベンチプレス')).toBeVisible();
  await expect(button(page, '腹筋')).toBeVisible();
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
  await button(dialog, '入力を続ける').click();
  await expect(name).toHaveValue('片手ケーブルクロス');
  await button(page, '戻る').click();
  await button(page.getByRole('dialog'), '保存せずに戻る').click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await expect(row(page, '片手ケーブルクロス')).toHaveCount(0);
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  await openManage(page);
  await button(page, '部位を追加').click();
  await page.getByPlaceholder('部位の名前（例：前腕）').fill('前腕');
  await button(page, '戻る').click();
  await expect(page.getByRole('dialog')).toContainText('入力した部位は追加されません。');
  await button(page.getByRole('dialog'), '保存せずに戻る').click();
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
  // やめるなら非表示のまま
  await button(dialog, 'やめる').click();
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
  await toggleShown(page, 'ベンチプレス');
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

test('種目の名前を変えると、過去の記録・履歴・選択に新しい名前で出る。編集の画面で非表示にする', async ({ page }) => {
  await openApp(page);
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await openManage(page);
  await openEdit(page, 'ベンチプレス');
  const name = page.getByLabel('種目の名前', { exact: true }).filter({ visible: true });
  await expect(name).toHaveValue('ベンチプレス');
  await expect(button(page, '胸')).toHaveAttribute('aria-selected', 'true');
  await expect(see(page, '重量 × 回数', { exact: true })).toBeVisible();
  await expect(shownSwitch(page)).toHaveAttribute('aria-checked', 'true');

  // 変えずに戻るときは確かめない
  await button(page, '戻る').click();
  await expect(see(page, '種目と部位の管理', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 変えて戻ると確かめる
  await openEdit(page, 'ベンチプレス');
  await name.fill('バーベルベンチプレス');
  await button(page, '戻る').click();
  await expect(page.getByRole('dialog')).toContainText('変更は保存されません。');
  await button(page.getByRole('dialog'), '入力を続ける').click();

  // 断るときの文言を出す（空の名前・長い名前などの決まりは jest の db/__tests__/repositories.test.ts）
  await name.fill('  ');
  await button(page, '変更を保存').click();
  await expect(see(page, '種目の名前を入れてください')).toBeVisible();

  await name.fill(' バーベルベンチプレス ');
  await button(page, '変更を保存').click();
  await expect(see(page, '種目と部位の管理', { exact: true })).toBeVisible();
  await expect(row(page, 'バーベルベンチプレス')).toBeVisible();
  await expect(row(page, 'ベンチプレス')).toHaveCount(0);
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  // 筋トレの今日と履歴に、新しい名前で出る
  await goTab(page, '筋トレ');
  await goPane(page, '今日');
  await expect(see(page, 'バーベルベンチプレス', { exact: true })).toBeVisible();
  await goPane(page, '履歴');
  await expect(button(page, 'バーベルベンチプレス')).toBeVisible();
  await expect(see(page, '11月8日（日） バーベルベンチプレス')).toBeVisible();
  await tab(page, 'ホーム').click();

  // 選択の画面にも新しい名前で出て、選ぶと今日の記録が開く（同じ種目）
  await openSelect(page);
  await chooseExercise(page, 'バーベルベンチプレス');
  await expect(page.getByLabel('セット1の重量')).toHaveValue('80');
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  // 編集の画面で表示を切り替えただけで戻るときも確かめる（保存していない）
  await openManage(page);
  await openEdit(page, 'スクワット');
  await shownSwitch(page).click();
  await expect(shownSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await button(page, '戻る').click();
  await button(page.getByRole('dialog'), '保存せずに戻る').click();
  await expect(row(page, 'スクワット')).toContainText('表示中');
  // 保存すると非表示になり、開き直してもスイッチは切れたまま
  await toggleShown(page, 'スクワット');
  await expect(row(page, 'スクワット')).toContainText('非表示');
  await openEdit(page, 'スクワット');
  await expect(shownSwitch(page)).toHaveAttribute('aria-checked', 'false');
});

test('種目の部位を変えると、新しい部位の最後に並ぶ。部位の名前を変えると、種目の編集と選択にも出る', async ({ page }) => {
  // 同じ名前を断る決まりと並び順は jest（db/__tests__/repositories.test.ts）。ここは画面の数と並び
  await openApp(page);
  await openManage(page);
  await openEdit(page, 'ベンチプレス');
  const name = page.getByLabel('種目の名前', { exact: true }).filter({ visible: true });
  await name.fill('ダンベルフライ');
  await button(page, '変更を保存').click();
  await expect(see(page, '同じ部位に同じ名前の種目があります')).toBeVisible();

  // ほかの部位なら同じ名前でもよい
  await button(page, '肩').click();
  await button(page, '変更を保存').click();
  await expect(see(page, '種目と部位の管理', { exact: true })).toBeVisible();
  const part = (n: string) => see(page, n, { exact: true }).locator('../..');
  await expect(part('胸')).toContainText('4種目'); // 5から4に
  await expect(part('肩')).toContainText('4種目'); // 3から4に
  await expect(part('胸').getByRole('button', { name: /^ベンチプレス / })).toHaveCount(0);
  // 胸にも元の「ダンベルフライ」は残る。肩では最後に並ぶ
  await expect(part('胸').getByRole('button', { name: /^ダンベルフライ / })).toHaveCount(1);
  await expect(part('肩').getByRole('button', { name: / (重量×回数|回数だけ) / }).last()).toHaveAccessibleName(/^ダンベルフライ /);

  // 部位の名前を変える。同じ名前は断り、キャンセルすると元の名前のまま
  await button(page, '胸の名前を変える').click();
  const input = page.getByLabel('部位の名前', { exact: true }).filter({ visible: true });
  await expect(input).toHaveValue('胸');
  await input.fill('背中');
  await button(page, '名前を保存').click();
  await expect(see(page, '同じ名前の部位があります')).toBeVisible();
  await button(page, 'キャンセル').click();
  await expect(see(page, '胸', { exact: true })).toBeVisible();

  await button(page, '胸の名前を変える').click();
  await input.fill(' 大胸筋 ');
  await button(page, '名前を保存').click();
  await expect(see(page, '大胸筋', { exact: true })).toBeVisible();
  await expect(see(page, '胸', { exact: true })).toHaveCount(0);

  // 種目の編集と選択の画面にも新しい名前で出る。部位を変えた種目は、選択の画面でも肩に出る
  await openEdit(page, 'インクラインダンベルプレス');
  await expect(button(page, '大胸筋')).toHaveAttribute('aria-selected', 'true');
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await openSelect(page);
  await expect(button(page, '大胸筋')).toBeVisible();
  await button(page, '肩').click();
  await expect(row(page, 'ダンベルフライ')).toHaveCount(1);
  await expect(row(page, 'ベンチプレス')).toHaveCount(0);
});
