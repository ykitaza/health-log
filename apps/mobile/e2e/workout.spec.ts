import { expect, Page, test } from '@playwright/test';
import {
  addEntry, button, chooseExercise, controlDb, expectTrainingDay, fillSets, goTab, homeCard, moveToDate, openApp, recordOn, saveButton, TODAY, see, recordFromHome, tab,
} from './helpers';

/** ホームから今日のトレーニング（筋トレのタブの「記録」の今日）を開く */
async function openToday(page: Page) {
  await recordFromHome(page, 'training');
  await expectTrainingDay(page, TODAY_LABEL);
}

const TODAY_LABEL = '11月8日（日）';

/** その日のトレーニングの画面の、種目の並び */
const entryOrder = (page: Page) =>
  page.getByRole('button', { name: /を直す(。|$)/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/を直す(。.*)?$/, '')));

test('空の画面 → 種目の選択 → 記録の入力 → 追加後の画面（回数だけの種目も）。選択と入力の画面にタブバーは出ない', async ({ page }) => {
  await openApp(page);
  await openToday(page);
  await expect(see(page, 'まだ種目がありません')).toBeVisible();
  // 今日なら「今日ではない日」の知らせは出ず、次の日へは進めない
  await expect(see(page, '今日ではない日を見ています')).toHaveCount(0);
  await expect(button(page, '次の日')).toHaveAttribute('aria-disabled', 'true');

  await button(page, '種目を追加').click();
  await expect(tab(page, 'ホーム')).toBeHidden();
  await chooseExercise(page, 'ベンチプレス');
  await expect(tab(page, 'ホーム')).toBeHidden();
  await expect(see(page, '胸 ・ 今日の1種目目')).toBeVisible();
  await expect(see(page, '前回の記録はありません')).toBeVisible();
  // 初期値は 3 セット
  await expect(page.getByLabel(/^セット\d+の回数$/)).toHaveCount(3);

  await fillSets(page, [{ weight: '80', reps: '8' }, { weight: '80', reps: '6' }]);
  await saveButton(page).click();

  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
  // 種目のカードの並びの上に見出し（記録がない日は出さない）
  await expect(page.getByRole('heading', { name: '記録した種目', exact: true }).filter({ visible: true })).toBeVisible();
  // 空の3セット目は保存しない：2セット、負荷量 80×8 + 80×6 = 1120kg
  await expect(see(page, '種目1部位胸セット2合計負荷量1.12 t')).toBeVisible();
  await expect(see(page, '80.0 kg × 8 回')).toBeVisible();
  await expect(see(page, '80.0 kg × 6 回')).toBeVisible();
  await expect(see(page, '推定1RM 101.3kg')).toBeVisible();

  // 2種目目は「今日の2種目目」。回数だけの種目は重量の欄がなく、負荷量に入らず、推定1RM も出ない
  await button(page, '種目を追加').click();
  await chooseExercise(page, '懸垂');
  await expect(see(page, '背中 ・ 今日の2種目目')).toBeVisible();
  await expect(page.getByLabel('セット1の重量')).toHaveCount(0);
  await fillSets(page, [{ reps: '12' }]);
  await saveButton(page).click();
  await expect(see(page, '12 回', { exact: true })).toBeVisible();
  await expect(see(page, '種目2部位胸・背中セット3合計負荷量1.12 t')).toBeVisible();
  await expect(see(page, /推定1RM/)).toHaveCount(1);

  // 下のタブでホームへ
  await goTab(page, 'ホーム');
  await expect(homeCard(page, 'training')).toContainText('2種目 ・ 3セット ・ 1.12 t');
});

test('前回の表示と「前回をコピー」、自己ベスト', async ({ page }) => {
  await recordOn(page, '2026-11-05', [
    { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8', memo: '前回のメモ' }, { weight: '82.5', reps: '6' }] },
  ]);
  await moveToDate(page, TODAY);
  await openToday(page);
  await button(page, '種目を追加').click();
  // 選択の一覧に、前回のいちばん重いセットと何日前か
  await expect(page.getByRole('button', { name: 'ベンチプレス BIG3 前回 82.5kg × 6 ・ 3日前' })).toBeVisible();
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

test('上のセットをコピー（押せないとき）、セットの追加と削除と「元に戻す」、メモと完了', async ({ page }) => {
  await openApp(page);
  await openToday(page);
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  // 重量か回数が入っているセットがなければ（メモだけでも）、上のセットをコピーは押せない（写すセットの選び方は jest）
  await expect(button(page, '上のセットをコピー')).toBeDisabled();
  await fillSets(page, [{ memo: 'メモだけ' }]);
  await expect(button(page, '上のセットをコピー')).toBeDisabled();

  await fillSets(page, [{ weight: '60', reps: '10', memo: 'アップ', done: true }, { weight: '70', reps: '8' }]);
  await expect(button(page, '上のセットをコピー')).toBeEnabled();
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
  await expect(see(page, '種目1部位胸セット3合計負荷量1.46 t')).toBeVisible();
  await expect(see(page, 'アップ')).toBeVisible();
  await expect(see(page, '限界')).toBeVisible();

  // 開き直すと、完了とメモが残っている
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(saveButton(page)).toHaveText('変更を保存');
  await expect(page.getByRole('checkbox', { name: 'セット1の完了' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: 'セット2の完了' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByLabel('セット3のメモ')).toHaveValue('限界');
});

test('入力の確かめ：エラーの出し方と、直すと消えること。全角と「,」の小数点、メモは 1000 文字で止まる', async ({ page }) => {
  // 範囲・全角・小数点・上限の一つひとつは jest（lib/__tests__/screen-logic.test.ts の「保存のボタンを押したとき」）
  await openApp(page);
  await openToday(page);
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  await saveButton(page).click();
  await expect(see(page, 'セットを1つ以上入れてください')).toBeVisible();
  // メモだけの行は、重量と回数の両方が要る
  await fillSets(page, [{ memo: 'メモだけ' }, { weight: 'abc', reps: '8' }]);
  await saveButton(page).click();
  await expect(see(page, '重量を入れてください・回数を入れてください')).toBeVisible();
  await expect(see(page, '重量は 500kg までの正の数で入れてください', { exact: true })).toBeVisible();
  await expect(see(page, '入力を確かめてください')).toBeVisible();
  // 直した行のエラーと、下の文言が消える
  await fillSets(page, [{ weight: '５７,５', reps: '8', memo: 'あ'.repeat(1001) }]);
  await expect(see(page, '重量を入れてください・回数を入れてください')).toBeHidden();
  await expect(see(page, '入力を確かめてください')).toBeHidden();
  await expect(page.getByLabel('セット1のメモ', { exact: true })).toHaveValue('あ'.repeat(1000));
  await saveButton(page).click();
  await expect(see(page, '重量は 500kg までの正の数で入れてください', { exact: true })).toBeVisible();
  await fillSets(page, [{}, { weight: '500' }]);
  await saveButton(page).click();
  await expect(see(page, '57.5 kg × 8 回')).toBeVisible();
  await expect(see(page, '500.0 kg × 8 回')).toBeVisible();
});

test('並べ替え（↑ の2回押し、端、再読み込み）、同じ種目を選ぶと既存の記録、外すときの確認', async ({ page }) => {
  // 並べ替えの保存が重なると、トランザクションが入れ子になって片方が失敗していた
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await openToday(page);
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);
  await addEntry(page, 'スクワット', [{ weight: '100', reps: '5' }]);
  await addEntry(page, 'デッドリフト', [{ weight: '120', reps: '3' }]);
  await expect.poll(() => entryOrder(page)).toEqual(['ベンチプレス', 'スクワット', 'デッドリフト']);

  // ↑ を素早く2回押しても、2つ上がる
  const card = (name: string) => page.getByRole('button', { name: `${name}を外す` }).locator('..');
  await card('デッドリフト').getByRole('button', { name: '上へ' }).dblclick();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'ベンチプレス', 'スクワット']);
  // 端では押せない
  await expect(card('デッドリフト').getByRole('button', { name: '上へ' })).toBeDisabled();
  await expect(card('スクワット').getByRole('button', { name: '下へ' })).toBeDisabled();
  await card('ベンチプレス').getByRole('button', { name: '下へ' }).click();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'スクワット', 'ベンチプレス']);
  await card('ベンチプレス').getByRole('button', { name: '上へ' }).click();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'ベンチプレス', 'スクワット']);

  // 並びは保存され、開き直しても同じ。記録の入力の「何種目目」も並びに合う
  await page.reload();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'ベンチプレス', 'スクワット']);
  await page.getByRole('button', { name: 'スクワットを直す' }).click();
  await expect(see(page, '脚 ・ 今日の3種目目')).toBeVisible();
  await button(page, '戻る').click();
  expect(errors).toEqual([]);

  // 同じ日に同じ種目を選ぶと、新しく足さずに既存の記録が開く
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  await expect(see(page, '胸 ・ 今日の2種目目')).toBeVisible();
  await expect(saveButton(page)).toHaveText('変更を保存');
  await expect(page.getByLabel('セット1の重量')).toHaveValue('80');
  await fillSets(page, [{}, { weight: '85', reps: '3' }]);
  await saveButton(page).click();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'ベンチプレス', 'スクワット']);
  await expect(see(page, '85.0 kg × 3 回')).toBeVisible();
  await expect(see(page, '種目3部位背中・胸 ほか1セット4')).toBeVisible();

  // 外すときの確認。やめるなら残る
  await button(page, 'ベンチプレスを外す').click();
  const dialog = page.getByRole('dialog');
  // 題は短く1行、種目の名前とセットの数は本文に
  await expect(dialog).toContainText('種目を外しますか？');
  await expect(dialog).toContainText('ベンチプレスと、そのセット 2 件を今日の記録から外します。メモも消えます。');
  await button(dialog, 'やめる').click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'ベンチプレス', 'スクワット']);
  await button(page, 'ベンチプレスを外す').click();
  await button(page.getByRole('dialog'), '外す').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(() => entryOrder(page)).toEqual(['デッドリフト', 'スクワット']);
  await expect(see(page, '種目2部位背中・脚セット2合計負荷量0.86 t')).toBeVisible(); // 120×3 + 100×5

  // 最後の1つを外すと空の画面に戻り、ホームの数字も 0 に戻る
  for (const name of ['デッドリフト', 'スクワット']) {
    await button(page, `${name}を外す`).click();
    await button(page.getByRole('dialog'), '外す').click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  await expect(see(page, 'まだ種目がありません')).toBeVisible();
  // 途中で再読み込みしたので、画面のスタックはこの画面から始まっている。ホームを開き直す
  await page.goto('/');
  await expect(homeCard(page, 'training')).toContainText('まだ記録がありません');
  await expect(page.getByTestId('volume-week')).toContainText('0.00t');
});

test('保存のボタンを2回押しても、記録は1つだけ', async ({ page }) => {
  // 保存が終わる前（ボタンが押せなくなる前）に2回目が届くときを、DB の返事を止めて毎回作る
  const db = await controlDb(page);
  await openApp(page);
  await openToday(page);
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  await fillSets(page, [{ weight: '80', reps: '8' }]);
  await db.hold();
  // 2回の押下を、画面が描き直す前に続けて届ける
  await saveButton(page).evaluate((el) => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
  await db.release();
  // 1つ前の画面（筋トレのタブの記録）に戻る。2回戻ってホームまで行かない
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
  await expectTrainingDay(page, TODAY_LABEL);
  await page.goto('/');
  await openToday(page);
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toHaveCount(1);
  await expect(see(page, '80.0 kg × 8 回')).toHaveCount(1);
});

test('入力の途中で戻るときは「入力をやめますか？」と確かめる（画面の戻るとブラウザの戻る）。変更がなければ確かめない', async ({ page }) => {
  await openApp(page);
  await openToday(page);
  // 何も入れずに戻るなら確かめない（空のセットを足しただけでも同じ）
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  await button(page, 'セットを追加').click();
  await button(page, '戻る').click();
  await expect(see(page, 'まだ種目がありません')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 入れてから戻ると確かめる。「入力を続ける」なら入力はそのまま
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  await fillSets(page, [{ weight: '80', reps: '8' }]);
  await button(page, '戻る').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('入力をやめますか？');
  await expect(dialog).toContainText('まだ追加していないセットは保存されません。');
  await button(dialog, '入力を続ける').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('セット1の重量')).toHaveValue('80');
  // 「保存せずに戻る」と、保存せずに戻る
  await button(page, '戻る').click();
  await button(page.getByRole('dialog'), '保存せずに戻る').click();
  await expect(see(page, 'まだ種目がありません')).toBeVisible();

  // 保存して戻るときは確かめない
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 既存の記録：開いて何も変えずに戻るなら確かめない
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(saveButton(page)).toHaveText('変更を保存');
  await button(page, '戻る').click();
  await expect(see(page, '種目1部位胸セット1')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 完了の印を変えただけでも確かめる。保存せずに戻ると元のまま
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await page.getByRole('checkbox', { name: 'セット1の完了' }).click();
  await button(page, '戻る').click();
  await button(page.getByRole('dialog'), '保存せずに戻る').click();
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(page.getByRole('checkbox', { name: 'セット1の完了' })).toHaveAttribute('aria-checked', 'false');

  // 値を変えてセットを消しても、保存せずに戻ると元のまま
  await fillSets(page, [{ weight: '200' }]);
  await button(page, 'セット1を削除').click();
  await button(page, '戻る').click();
  await button(page.getByRole('dialog'), '保存せずに戻る').click();
  await expect(see(page, '80.0 kg × 8 回')).toBeVisible();
  await expect(see(page, '種目1部位胸セット1')).toBeVisible();

  // 種目の選択から戻っても、確かめず、何も足されない
  await button(page, '種目を追加').click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await button(page, '戻る').click();
  await expectTrainingDay(page, TODAY_LABEL);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => entryOrder(page)).toEqual(['ベンチプレス']);

  // ブラウザの戻るでも、入力の途中なら確かめる
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'スクワット');
  await fillSets(page, [{ weight: '100', reps: '5' }]);
  await page.goBack();
  await expect(page.getByRole('dialog')).toContainText('入力をやめますか？');
  await button(page.getByRole('dialog'), '入力を続ける').click();
  await expect(page.getByLabel('セット1の重量')).toHaveValue('100');
  await page.goBack();
  await button(page.getByRole('dialog'), '保存せずに戻る').click();
  await expectTrainingDay(page, TODAY_LABEL);
  await expect.poll(() => entryOrder(page)).toEqual(['ベンチプレス']);
});
