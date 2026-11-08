import { expect, Page, test } from '@playwright/test';
import { addEntry, button, chooseExercise, fillSets, moveToDate, openApp, recordOn, saveButton, TODAY, see } from './helpers';

/** ホームから今日のトレーニングを開く */
async function openToday(page: Page) {
  await button(page, '本日のトレーニングを追加').click();
  await expect(see(page, '今日のトレーニング', { exact: true })).toBeVisible();
}

/** その日のトレーニングの画面の、種目の並び */
const entryOrder = (page: Page) =>
  page.getByRole('button', { name: /を直す$/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/を直す$/, '')));

test('空の画面 → 種目の選択 → 記録の入力 → 追加後の画面。タブバーは出ない', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('tablist')).toBeVisible();
  await openToday(page);
  await expect(page.getByRole('tablist')).toBeHidden();
  await expect(see(page, '11月8日（日）')).toBeVisible();
  await expect(see(page, 'まだ種目がありません')).toBeVisible();

  await button(page, '種目を追加').click();
  await expect(page.getByRole('tablist')).toBeHidden();
  await chooseExercise(page, 'ベンチプレス');
  await expect(page.getByRole('tablist')).toBeHidden();
  await expect(see(page, '胸 ・ 今日の1種目目')).toBeVisible();
  await expect(see(page, '前回の記録はありません')).toBeVisible();
  // 初期値は 3 セット
  await expect(page.getByLabel(/^セット\d+の回数$/)).toHaveCount(3);

  await fillSets(page, [{ weight: '80', reps: '8' }, { weight: '80', reps: '6' }]);
  await saveButton(page).click();

  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
  // 空の3セット目は保存しない：2セット、負荷量 80×8 + 80×6 = 1120kg
  await expect(see(page, '種目1セット2合計負荷量1.12 t')).toBeVisible();
  await expect(see(page, '80.0 kg × 8 回')).toBeVisible();
  await expect(see(page, '80.0 kg × 6 回')).toBeVisible();
  await expect(see(page, '推定1RM 101.3kg')).toBeVisible();

  // 2種目目は「今日の2種目目」
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'スクワット');
  await expect(see(page, '脚 ・ 今日の2種目目')).toBeVisible();
  await button(page, '戻る').click();

  // 戻るでホームへ。タブバーが戻る
  await button(page, '戻る').click();
  await expect(page.getByRole('tablist')).toBeVisible();
  await expect(see(page, '今日の記録', { exact: true })).toBeVisible();
});

test('前回の表示と「前回をコピー」、自己ベスト', async ({ page }) => {
  await recordOn(page, '2026-11-05', [
    { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8', memo: '前回のメモ' }, { weight: '82.5', reps: '6' }] },
  ]);
  await moveToDate(page, TODAY);
  await openToday(page);
  await button(page, '種目を追加').click();
  // 選択の一覧に、前回のいちばん重いセットと何日前か
  await expect(page.getByRole('button', { name: 'ベンチプレス 前回 82.5kg × 6 ・ 3日前' })).toBeVisible();
  await chooseExercise(page, 'ベンチプレス');

  await expect(see(page, '前回 11月5日（木）')).toBeVisible();
  await expect(see(page, '80kg × 8 ・ 82.5kg × 6')).toBeVisible();
  // 自己ベストは推定1RM の大きいほう：80×(1+8/30)=101.3 > 82.5×(1+6/30)=99
  await expect(see(page, '自己ベスト 推定1RM 101kg（80kg × 8）')).toBeVisible();
  // 前回の値が、入力欄の薄い字（placeholder）に出る
  await expect(page.getByLabel('セット1の重量')).toHaveAttribute('placeholder', '80');
  await expect(page.getByLabel('セット2の回数')).toHaveAttribute('placeholder', '6');
  await expect(page.getByLabel('セット3の重量')).toHaveAttribute('placeholder', '重量');

  await button(page, '前回をコピー').click();
  // 前回のセット数（2）になり、メモと完了は写さない
  await expect(page.getByLabel(/^セット\d+の回数$/)).toHaveCount(2);
  await expect(page.getByLabel('セット1の重量')).toHaveValue('80');
  await expect(page.getByLabel('セット1の回数')).toHaveValue('8');
  await expect(page.getByLabel('セット1のメモ')).toHaveValue('');
  await expect(page.getByLabel('セット2の重量')).toHaveValue('82.5');
  await expect(page.getByRole('checkbox', { name: 'セット1の完了' })).toHaveAttribute('aria-checked', 'false');
  await saveButton(page).click();
  await expect(see(page, '82.5 kg × 6 回')).toBeVisible();
});

test('上のセットをコピー、セットの追加と削除と「元に戻す」、メモと完了', async ({ page }) => {
  await openApp(page);
  await openToday(page);
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');

  await fillSets(page, [{ weight: '60', reps: '10', memo: 'アップ', done: true }, { weight: '70', reps: '8' }]);
  await expect(page.getByRole('checkbox', { name: 'セット1の完了' })).toHaveAttribute('aria-checked', 'true');

  // 3セット目を消して、上のセット（2セット目）をコピーする
  await button(page, 'セット3を削除').click();
  await expect(see(page, 'セット3を削除しました')).toBeVisible();
  await button(page, '上のセットをコピー').click();
  await expect(page.getByLabel(/^セット\d+の回数$/)).toHaveCount(3);
  await expect(page.getByLabel('セット3の重量')).toHaveValue('70');
  await expect(page.getByLabel('セット3の回数')).toHaveValue('8');

  // 1セット目を消して「元に戻す」と、同じ場所に値ごと戻る
  await button(page, 'セット1を削除').click();
  await expect(see(page, 'セット1を削除しました')).toBeVisible();
  await expect(page.getByLabel('セット1の重量')).toHaveValue('70');
  await button(page, '元に戻す').click();
  await expect(see(page, 'セット1を削除しました')).toBeHidden();
  await expect(page.getByLabel('セット1の重量')).toHaveValue('60');
  await expect(page.getByLabel('セット1のメモ')).toHaveValue('アップ');
  await expect(page.getByRole('checkbox', { name: 'セット1の完了' })).toHaveAttribute('aria-checked', 'true');

  // 「元に戻す」は 6 秒で消える
  await button(page, 'セット3を削除').click();
  await expect(see(page, 'セット3を削除しました')).toBeVisible();
  await expect(see(page, 'セット3を削除しました')).toBeHidden({ timeout: 9000 });

  // セットを足して3セット目を入れて保存する
  await button(page, 'セットを追加').click();
  await fillSets(page, [{}, {}, { weight: '75', reps: '4', memo: '限界' }]);
  await saveButton(page).click();
  // 60×10 + 70×8 + 75×4 = 1460kg
  await expect(see(page, '種目1セット3合計負荷量1.46 t')).toBeVisible();
  await expect(see(page, 'アップ')).toBeVisible();
  await expect(see(page, '限界')).toBeVisible();

  // 開き直すと、完了とメモが残っている
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(saveButton(page)).toHaveText('変更を保存');
  await expect(page.getByRole('checkbox', { name: 'セット1の完了' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: 'セット2の完了' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByLabel('セット3のメモ')).toHaveValue('限界');
});

test.describe('重量と回数の入力の確かめ', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await openToday(page);
    await button(page, '種目を追加').click();
    await chooseExercise(page, 'ベンチプレス');
  });

  const cases: { name: string; weight: string; reps: string; error: string }[] = [
    { name: '重量が空', weight: '', reps: '8', error: '重量を入れてください' },
    { name: '重量が 0', weight: '0', reps: '8', error: '重量は正の数で入れてください' },
    { name: '重量が負の数', weight: '-5', reps: '8', error: '重量は正の数で入れてください' },
    { name: '重量が数字でない', weight: 'abc', reps: '8', error: '重量は正の数で入れてください' },
    { name: '重量が指数の書き方', weight: '1e3', reps: '8', error: '重量は正の数で入れてください' },
    { name: '回数が空', weight: '80', reps: '', error: '回数を入れてください' },
    { name: '回数が 0', weight: '80', reps: '0', error: '回数を入れてください' },
    { name: '回数が小数', weight: '80', reps: '8.5', error: '回数を入れてください' },
  ];
  for (const c of cases) {
    test(`${c.name}なら保存しない`, async ({ page }) => {
      await fillSets(page, [{ weight: c.weight, reps: c.reps }]);
      await saveButton(page).click();
      await expect(see(page, c.error, { exact: true })).toBeVisible();
      await expect(see(page, '入力を確かめてください')).toBeVisible();
      // 戻ると、何も保存されていない
      await button(page, '戻る').click();
      await expect(see(page, 'まだ種目がありません')).toBeVisible();
    });
  }

  test('重量も回数も空ならエラー。直すとエラーが消える', async ({ page }) => {
    await saveButton(page).click();
    await expect(see(page, 'セットを1つ以上入れてください')).toBeVisible();
    // メモだけの行は、重量と回数の両方が要る
    await fillSets(page, [{ memo: 'メモだけ' }]);
    await saveButton(page).click();
    await expect(see(page, '重量を入れてください・回数を入れてください')).toBeVisible();
    await fillSets(page, [{ weight: '80', reps: '5' }]);
    await expect(see(page, '重量を入れてください・回数を入れてください')).toBeHidden();
    await expect(see(page, '入力を確かめてください')).toBeHidden();
    await saveButton(page).click();
    await expect(see(page, '80.0 kg × 5 回')).toBeVisible();
  });

  test('小数、全角の数字、「,」の小数点、とても大きな値は受ける', async ({ page }) => {
    await fillSets(page, [
      { weight: '62.5', reps: '8' },
      { weight: '６０', reps: '１０' },
      { weight: '57,5', reps: '3' },
      { weight: '99999', reps: '1' },
    ]);
    await saveButton(page).click();
    await expect(see(page, '62.5 kg × 8 回')).toBeVisible();
    await expect(see(page, '60.0 kg × 10 回')).toBeVisible();
    await expect(see(page, '57.5 kg × 3 回')).toBeVisible();
    await expect(see(page, '99999.0 kg × 1 回')).toBeVisible();
  });
});

test('回数だけの種目は重量の欄がない', async ({ page }) => {
  await openApp(page);
  await openToday(page);
  await button(page, '種目を追加').click();
  await chooseExercise(page, '懸垂');
  await expect(page.getByLabel('セット1の重量')).toHaveCount(0);
  await saveButton(page).click();
  await expect(see(page, 'セットを1つ以上入れてください')).toBeVisible();
  await fillSets(page, [{ reps: '0' }]);
  await saveButton(page).click();
  await expect(see(page, '回数を入れてください', { exact: true })).toBeVisible();
  await fillSets(page, [{ reps: '12' }]);
  await saveButton(page).click();
  await expect(see(page, '12 回', { exact: true })).toBeVisible();
  // 負荷量は 0、推定1RM は出ない
  await expect(see(page, '種目1セット1合計負荷量0.00 t')).toBeVisible();
  await expect(see(page, /推定1RM/)).toHaveCount(0);
});

test('種目を外すときの確認（キャンセルと実行）', async ({ page }) => {
  await openApp(page);
  await openToday(page);
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);
  await addEntry(page, 'スクワット', [{ weight: '100', reps: '5' }]);

  await button(page, 'ベンチプレスを外す').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ベンチプレスを外しますか？');
  await expect(dialog).toContainText('入力したセットとメモも消えます。');
  await button(dialog, 'キャンセル').click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => entryOrder(page)).toEqual(['ベンチプレス', 'スクワット']);

  await button(page, 'ベンチプレスを外す').click();
  await button(page.getByRole('dialog'), '外す').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(() => entryOrder(page)).toEqual(['スクワット']);
  await expect(see(page, '種目1セット1合計負荷量0.50 t')).toBeVisible();

  // 最後の1つを外すと空の画面に戻り、ホームの数字も 0 に戻る
  await button(page, 'スクワットを外す').click();
  await button(page.getByRole('dialog'), '外す').click();
  await expect(see(page, 'まだ種目がありません')).toBeVisible();
  await button(page, '戻る').click();
  await expect(see(page, 'まだ今日の記録はありません。「本日のトレーニングを追加」から始めましょう。')).toBeVisible();
  await expect(page.getByTestId('volume-total')).toContainText('0.00t');
});

test('上下のボタンで並べ替える。端では動かない', async ({ page }) => {
  await openApp(page);
  await openToday(page);
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);
  await addEntry(page, 'スクワット', [{ weight: '100', reps: '5' }]);
  await addEntry(page, 'デッドリフト', [{ weight: '120', reps: '3' }]);
  await expect.poll(() => entryOrder(page)).toEqual(['ベンチプレス', 'スクワット', 'デッドリフト']);

  const card = (name: string) => page.getByRole('button', { name: `${name}を外す` }).locator('..');
  await card('デッドリフト').getByRole('button', { name: '上へ' }).click();
  await expect.poll(() => entryOrder(page)).toEqual(['ベンチプレス', 'デッドリフト', 'スクワット']);
  await card('ベンチプレス').getByRole('button', { name: '上へ' }).click();
  await card('スクワット').getByRole('button', { name: '下へ' }).click();
  await card('ベンチプレス').getByRole('button', { name: '下へ' }).click();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'ベンチプレス', 'スクワット']);

  // 並びは保存され、開き直しても同じ。記録の入力の「何種目目」も並びに合う
  await page.reload();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'ベンチプレス', 'スクワット']);
  await page.getByRole('button', { name: 'スクワットを直す' }).click();
  await expect(see(page, '脚 ・ 今日の3種目目')).toBeVisible();
});

test('↑ を素早く2回押しても、2つ上がる', async ({ page }) => {
  // 並べ替えの保存が重なると、トランザクションが入れ子になって片方が失敗していた
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await openToday(page);
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);
  await addEntry(page, 'スクワット', [{ weight: '100', reps: '5' }]);
  await addEntry(page, 'デッドリフト', [{ weight: '120', reps: '3' }]);
  const up = page.getByRole('button', { name: 'デッドリフトを外す' }).locator('..').getByRole('button', { name: '上へ' });
  await up.dblclick();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'ベンチプレス', 'スクワット']);
  await page.reload();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'ベンチプレス', 'スクワット']);
  expect(errors).toEqual([]);
});

test('同じ日に同じ種目を選ぶと、新しく足さずに既存の記録が開く', async ({ page }) => {
  await openApp(page);
  await openToday(page);
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);
  await addEntry(page, 'スクワット', [{ weight: '100', reps: '5' }]);

  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  await expect(see(page, '胸 ・ 今日の1種目目')).toBeVisible();
  await expect(saveButton(page)).toHaveText('変更を保存');
  await expect(page.getByLabel('セット1の重量')).toHaveValue('80');
  await fillSets(page, [{}, { weight: '85', reps: '3' }]);
  await saveButton(page).click();

  await expect.poll(() => entryOrder(page)).toEqual(['ベンチプレス', 'スクワット']);
  await expect(see(page, '85.0 kg × 3 回')).toBeVisible();
  await expect(see(page, '種目2セット3')).toBeVisible();
});

test('入力の途中で戻ると、保存しない', async ({ page }) => {
  await openApp(page);
  await openToday(page);
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  await fillSets(page, [{ weight: '80', reps: '8' }]);
  await button(page, '戻る').click();
  await expect(see(page, 'まだ種目がありません')).toBeVisible();

  // 既存の記録を直している途中で戻っても、元のまま
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await fillSets(page, [{ weight: '200' }]);
  await button(page, 'セット1を削除').click();
  await button(page, '戻る').click();
  await expect(see(page, '80.0 kg × 8 回')).toBeVisible();
  await expect(see(page, '種目1セット1')).toBeVisible();

  // 種目の選択から戻っても何も足されない
  await button(page, '種目を追加').click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await button(page, '戻る').click();
  await expect(see(page, '今日のトレーニング', { exact: true })).toBeVisible();
  await expect.poll(() => entryOrder(page)).toEqual(['ベンチプレス']);
});
