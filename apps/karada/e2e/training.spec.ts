import { expect, Page, test } from '@playwright/test';
import {
  addEntry, button, fillSets, goTab, moveToDate, openApp, openSettings, recordFromHome, recordOn, saveButton, see, TODAY,
} from './helpers';

// 筋トレの画面の新しいもの：BIG3 の割り当て、フォームの動画のリンク、休憩のタイマー、前回のメニューを写す。
// 役の決め方・リンクの形・タイマーの数え方・写す中身は jest（lib/__tests__/restTimer.test.ts、training-trend.test.ts、limits.test.ts、
// db/__tests__/repositories.test.ts）

const row = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name} `) }).filter({ visible: true });

/** 外のアプリを開く（Linking.openURL は web では window.open）を差し替えて、開いた URL を覚える。fail なら開けない */
async function stubOpen(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[]; __openFails: boolean };
    w.__opened = [];
    w.__openFails = false;
    window.open = ((url: string) => {
      if (w.__openFails) throw new Error('no app');
      w.__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
}

test('BIG3 の割り当て（付け替えると前の種目から外す）とフォームの動画のリンク。名前の横の印と、記録の入力の「フォーム」', async ({ page }) => {
  await stubOpen(page);
  await openApp(page);
  await openSettings(page);
  await page.getByRole('button', { name: /^種目と部位の管理/ }).click();
  // 割り当てる前は、名前で決めた3種目に印
  await expect(row(page, 'ベンチプレス')).toContainText('BIG3');
  await expect(row(page, 'スクワット')).toContainText('BIG3');
  await expect(row(page, 'インクラインダンベルプレス')).not.toContainText('BIG3');

  await row(page, 'インクラインダンベルプレス').click();
  await expect(see(page, '種目を編集', { exact: true })).toBeVisible();
  await button(page, 'BIG3 なし').click();
  await expect(button(page, 'BIG3 なし')).toHaveAttribute('aria-selected', 'true');
  await button(page, 'BIG3 のベンチプレス').click();
  await expect(page.getByTestId('big3-note').filter({ visible: true })).toHaveText('「ベンチプレス」から外して、この種目を BIG3 のベンチプレスにします。');
  // リンクは https:// だけ
  const link = page.getByRole('textbox', { name: 'フォームの動画（リンク）' });
  await link.fill('youtu.be/abc');
  await button(page, '変更を保存').click();
  await expect(see(page, 'リンクは https:// で始まるものを入れてください（空白は入れられません）').first()).toBeVisible();
  await link.fill('https://youtu.be/abc');
  await button(page, '変更を保存').click();
  await expect(see(page, '種目と部位の管理', { exact: true })).toBeVisible();
  await expect(row(page, 'インクラインダンベルプレス')).toContainText('BIG3');
  await expect(row(page, 'ベンチプレス')).not.toContainText('BIG3');
  await expect(row(page, 'スクワット')).toContainText('BIG3'); // ほかの役は残る
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  // 種目の選択と記録の入力にも印。リンクがある種目だけ「フォーム」を出し、押すと外のアプリで開く
  await recordFromHome(page, 'training');
  await button(page, '種目を追加').click();
  await expect(row(page, 'インクラインダンベルプレス')).toContainText('BIG3');
  await row(page, 'インクラインダンベルプレス').click();
  await expect(saveButton(page)).toBeVisible();
  await expect(see(page, 'BIG3', { exact: true })).toBeVisible();
  const form = page.getByRole('button', { name: 'インクラインダンベルプレスのフォームの動画を開く（外のアプリ）' });
  await form.click();
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://youtu.be/abc']);
  // 開けなかったときは、AI で記録と同じく知らせる
  await page.evaluate(() => { (window as unknown as { __openFails: boolean }).__openFails = true; });
  await form.click();
  await expect(see(page, 'フォームの動画を開けませんでした。ブラウザで開けるか確かめてください。')).toBeVisible();
  await fillSets(page, [{ weight: '26', reps: '10' }]);
  await saveButton(page).click();
  // 今日のトレーニングにも印
  await expect(page.getByRole('button', { name: 'インクラインダンベルプレスを直す' })).toContainText('BIG3');
  // リンクのない種目は「フォーム」を出さない
  await addEntry(page, 'ベンチプレス', [{ weight: '80', reps: '8' }]);
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(saveButton(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /フォームの動画を開く/ })).toHaveCount(0);
});

test('休憩のタイマー：セットを完了にすると数え、+30秒・止める。今日のトレーニングに戻っても同じ帯', async ({ page }) => {
  await openApp(page);
  await recordFromHome(page, 'training');
  await button(page, '種目を追加').click();
  await row(page, 'ベンチプレス').click();
  await expect(saveButton(page)).toBeVisible();
  await expect(page.getByTestId('rest-timer')).toHaveCount(0);
  // 初期の設定は 90 秒（時計は止めているので、残りは動かない）
  await fillSets(page, [{ weight: '80', reps: '8', done: true }]);
  const time = page.getByTestId('rest-timer-time').filter({ visible: true });
  await expect(time).toHaveText('1:30');
  await button(page, '休憩を30秒のばす').click();
  await expect(time).toHaveText('2:00');
  await saveButton(page).click();
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
  await expect(time).toHaveText('2:00');
  await button(page, '休憩のタイマーを止める').click();
  await expect(page.getByTestId('rest-timer')).toHaveCount(0);
  await goTab(page, 'ホーム');

  // 設定で「切」にすると動かさない
  await openSettings(page);
  await button(page, '休憩のタイマー、切').click();
  await expect(button(page, '休憩のタイマー、切')).toHaveAttribute('aria-selected', 'true');
  await button(page, '戻る').click();
  await recordFromHome(page, 'training');
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await page.getByRole('checkbox', { name: 'セット1の完了' }).click();
  await page.getByRole('checkbox', { name: 'セット1の完了' }).click();
  await expect(page.getByTestId('rest-timer')).toHaveCount(0);
});

test('今日が空なら前回の1行。「同じメニューで始める」で、重さと回数を未完了のセットとして写す', async ({ page }) => {
  await recordOn(page, '2026-11-04', [{ exercise: 'デッドリフト', sets: [{ weight: '120', reps: '5' }] }]);
  await recordOn(page, '2026-11-06', [
    { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8', memo: '補助あり', done: true }, { weight: '75', reps: '10' }] },
    { exercise: 'インクラインダンベルプレス', sets: [{ weight: '26', reps: '10' }] },
  ]);
  await moveToDate(page, TODAY);
  await goTab(page, '筋トレ');
  // 回復マップの下に前回の1行（日付と部位）と「同じメニューで始める」
  const menu = page.getByTestId('previous-line').filter({ visible: true });
  await expect(menu).toContainText('前回 11月6日（金） 胸');
  await button(page, '11月6日（金）と同じメニューで始める').click();
  await expect(page.getByRole('button', { name: 'ベンチプレスを直す' })).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(see(page, '80.0 kg × 8 回')).toBeVisible();
  await expect(see(page, '補助あり')).toHaveCount(0); // メモは写さない
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(page.getByRole('checkbox', { name: 'セット1の完了' })).toHaveAttribute('aria-checked', 'false'); // 完了も写さない
  await expect(page.getByLabel('セット2の重量')).toHaveValue('75');
});
