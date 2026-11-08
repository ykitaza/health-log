import { expect, Page, test } from '@playwright/test';
import { button, chooseExercise, chooseUnit, controlDb, enter, goTab, openApp, openBody, openSettings, pressKeepingFocus, recordToday, saveButton, see, setBodyInfo } from './helpers';

/** CSV の書き出しは OS の共有のメニュー（web では navigator.share）に渡す。テストでは渡した中身を受け取る */
async function captureShare(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __shared: ShareData[] }).__shared = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => { (window as unknown as { __shared: ShareData[] }).__shared.push(data); },
    });
  });
}
const shared = (page: Page) => page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared);

// CSV の中身（くくり方、外した記録、完了）、lb と kg の換算と丸め、範囲の確かめは jest
//（lib/__tests__/screen-logic.test.ts、limits.test.ts、units-sets-csv.test.ts）。ここは画面の切り替えと保存、共有に渡すこと

test('kg と lb の切り替え：記録・体重・目標体重の表示が換算され、保存は kg のまま（lb で開いて変えずに保存しても）', async ({ page }) => {
  await captureShare(page);
  await openApp(page);
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await setBodyInfo(page, { goal: '65' });
  await openBody(page);
  await enter(page, '体重', '70');
  await expect(see(page, '目標 65.0kg')).toBeVisible();

  // lb にする（体組成の歯車から）
  await openSettings(page);
  await chooseUnit(page, 'lb');
  // 目標体重の欄も lb で出る：65 ÷ 0.45359237 = 143.30
  await expect(page.getByRole('textbox', { name: '目標体重' })).toHaveValue('143.3');
  await expect(see(page, 'lb', { exact: true }).last()).toBeVisible();
  await button(page, '戻る').click();

  // 体組成：70kg = 154.32lb、目標 143.3lb、残り 11.0lb
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toHaveValue('154.32');
  await expect(see(page, '目標 143.3lb')).toBeVisible();
  await expect(see(page, '11.0', { exact: true })).toBeVisible();

  // ホーム：80kg = 176.4lb、推定1RM 101.33kg = 223.4lb、負荷量 640kg = 1410.96lb → 1.41 k lb
  await goTab(page, 'ホーム');
  await expect(see(page, '176.4 lb × 8 回')).toBeVisible();
  await expect(see(page, '推定1RM 223.4lb')).toBeVisible();
  await expect(page.getByTestId('volume-total')).toContainText('1.41k lb');

  // lb で入れた記録は kg で保存する：100lb = 45.36kg
  await button(page, '本日のトレーニングを追加').click();
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'スクワット');
  await expect(see(page, '重量（lb）')).toBeVisible();
  await page.getByLabel('セット1の重量').fill('100');
  await page.getByLabel('セット1の回数').fill('5');
  await saveButton(page).click();
  await expect(see(page, '100.0 lb × 5 回')).toBeVisible();
  // 80kg の記録を lb（176.37）で開いて、変えずに保存しても 80kg のまま（下の CSV で確かめる）
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(page.getByLabel('セット1の重量')).toHaveValue('176.37');
  await saveButton(page).click();
  await expect(see(page, '176.4 lb × 8 回')).toBeVisible();
  await button(page, '戻る').click();

  // kg に戻すと元の値
  await openSettings(page);
  await chooseUnit(page, 'kg');
  await expect(page.getByRole('textbox', { name: '目標体重' })).toHaveValue('65');
  // CSV は kg のまま書き出す
  await page.getByRole('button', { name: /^筋トレの記録を CSV で書き出す/ }).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  expect((await shared(page))[0].title).toBe('トレログの記録（CSV）');
  const csv = (await shared(page))[0].text!;
  expect(csv.split('\r\n')[0]).toBe('日付,部位,種目,セット,重量(kg),回数,メモ,完了');
  expect(csv).toContain('2026-11-08,胸,ベンチプレス,1,80,8,,0\r\n');
  expect(csv).toMatch(/2026-11-08,脚,スクワット,1,45\.359237\d*,5,,0\r\n/);
  await button(page, '戻る').click();
  await expect(see(page, '80.0 kg × 8 回')).toBeVisible();
  await expect(see(page, '45.4 kg × 5 回')).toBeVisible();
});

test('セット数の初期値が、新しく足す種目に効く（既存の記録は変わらない）', async ({ page }) => {
  await openApp(page);
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await openSettings(page);
  await expect(button(page, '3セット')).toHaveAttribute('aria-selected', 'true');
  await button(page, '5セット').click();
  await expect(button(page, '5セット')).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, '3セット')).toHaveAttribute('aria-selected', 'false');
  await button(page, '戻る').click();

  await button(page, '本日のトレーニングを追加').click();
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'スクワット');
  await expect(page.getByLabel(/^セット\d+の回数$/)).toHaveCount(5);
  await button(page, '戻る').click();
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(page.getByLabel(/^セット\d+の回数$/)).toHaveCount(1);
  await button(page, '戻る').click();

  // 1セットにして、再読み込みしても残る
  await button(page, '戻る').click();
  await openSettings(page);
  await button(page, '1セット').click();
  await expect(button(page, '1セット')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(button(page, '1セット')).toHaveAttribute('aria-selected', 'true');
});

test('身長と目標体重の不正な値はエラーを出し、空にすると消える。lb の表示では範囲を lb で出す', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await enter(page, '身長', '99.9');
  await expect(see(page, '身長は 100〜250cm で入れてください')).toBeVisible();
  await enter(page, '身長', '250');
  await expect(see(page, '身長は 100〜250cm で入れてください')).toBeHidden();
  await enter(page, '目標体重', 'abc');
  await expect(see(page, '目標体重は 30〜300kg で入れてください')).toBeVisible();
  await enter(page, '目標体重', '60.5');
  await expect(see(page, '目標体重は 30〜300kg で入れてください')).toBeHidden();

  // lb にすると、範囲を lb で出す（30〜300kg = 66.14〜661.39lb を、範囲の内側に丸める）
  await chooseUnit(page, 'lb');
  await enter(page, '目標体重', '661.4');
  await expect(see(page, '目標体重は 66.2〜661.3lb で入れてください')).toBeVisible();
  await enter(page, '目標体重', '661.3');
  await expect(see(page, /目標体重は .*で入れてください/)).toHaveCount(0);
  await button(page, '戻る').click();

  await openBody(page);
  await expect(see(page, '自動で計算（身長 250cm）')).toBeVisible();
  await enter(page, '体重', '661.4');
  await expect(see(page, '体重は 66.2〜661.3lb で入れてください')).toBeVisible();

  // 身長を空にすると消える
  await setBodyInfo(page, { height: '' });
  await expect(see(page, 'BMI は、設定で身長を入れると出ます')).toBeVisible();
});

test('CSV：共有のメニューに渡す。閉じただけならエラーを出さず、共有が使えないときはエラーを出す', async ({ page }) => {
  // navigator.share を差し替える：初めは渡した中身を残し、次は閉じたとき（AbortError）にする
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: ShareData[]; __abort: boolean };
    w.__shared = [];
    w.__abort = false;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        w.__shared.push(data);
        if (w.__abort) throw new DOMException('Share canceled', 'AbortError');
      },
    });
  });
  await openApp(page);
  await openSettings(page);
  const exportButton = page.getByRole('button', { name: /^筋トレの記録を CSV で書き出す/ });
  await exportButton.click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  // 記録がなければ見出しだけ
  expect((await shared(page))[0]).toMatchObject({ title: 'トレログの記録（CSV）', text: '日付,部位,種目,セット,重量(kg),回数,メモ,完了\r\n' });

  await page.evaluate(() => { (window as unknown as { __abort: boolean }).__abort = true; });
  await exportButton.click();
  await expect.poll(async () => (await shared(page)).length).toBe(2);
  await expect(see(page, /CSV を書き出せませんでした/)).toHaveCount(0);

  // web で navigator.share がないとき（Android ではまず起きない）。今までは何も起きなかった
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  await exportButton.click();
  await expect(see(page, '共有のメニューを開けなかったため、CSV を書き出せませんでした。')).toBeVisible();
});

test('身長を入れたまま単位を押しても、身長と単位の両方を保存する', async ({ page }) => {
  // 欄を離れたときの保存と、単位の保存が同時に走る。トランザクションが入れ子になって片方が失敗していた
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await openSettings(page);
  await page.getByRole('textbox', { name: '身長' }).fill('170');
  await button(page, 'lb').click();
  await expect(button(page, 'lb')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('textbox', { name: '目標体重' }).fill('150');
  await button(page, '5セット').click();
  await expect(button(page, '5セット')).toHaveAttribute('aria-selected', 'true');
  await button(page, '戻る').click();
  await openBody(page);
  await expect(see(page, '自動で計算（身長 170cm）')).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole('textbox', { name: '目標体重' })).toHaveValue('150');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '身長' })).toHaveValue('170');
  await expect(page.getByRole('textbox', { name: '目標体重' })).toHaveValue('150');
  await expect(button(page, 'lb')).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, '5セット')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('欄を離れないまま（Android のように blur が起きずに）単位を押しても、入れた値を前の単位で保存する', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  const height = page.getByRole('textbox', { name: '身長' });
  const goal = page.getByRole('textbox', { name: '目標体重' });
  await height.fill('170');
  await pressKeepingFocus(button(page, 'lb'));
  await expect(button(page, 'lb')).toHaveAttribute('aria-selected', 'true');
  await expect(height).toHaveValue('170');
  // lb で入れた目標体重は、kg に押し戻す前に lb のまま保存する（150lb = 68.04kg）
  await goal.fill('150');
  await pressKeepingFocus(button(page, 'kg'));
  await expect(button(page, 'kg')).toHaveAttribute('aria-selected', 'true');
  await expect(goal).toHaveValue('68.04');
  await page.reload();
  await expect(height).toHaveValue('170');
  await expect(goal).toHaveValue('68.04');
});

test('身長と目標体重の保存が終わる前に単位を変えても、欄は保存したあとの値を出す', async ({ page }) => {
  // 欄を離れたときの保存と、単位の保存・読み直しが重なるときを、DB の返事を止めて毎回作る
  const db = await controlDb(page);
  await openApp(page);
  await openSettings(page);
  const height = page.getByRole('textbox', { name: '身長' });
  const goal = page.getByRole('textbox', { name: '目標体重' });
  await db.hold();
  await height.fill('170');
  await goal.fill('70'); // 身長の欄を離れて保存する（返事は止まっている）
  await button(page, 'lb').click(); // 目標体重の欄を離れて kg で保存し、単位を lb にする
  await db.release();
  await expect(button(page, 'lb')).toHaveAttribute('aria-selected', 'true');
  // 70kg = 154.32lb
  await expect(goal).toHaveValue('154.32');
  await expect(height).toHaveValue('170');
  await page.reload();
  await expect(goal).toHaveValue('154.32');
  await expect(height).toHaveValue('170');
});

test('設定のいちばん下にアプリの版が出る（web は開発版）', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await expect(see(page, /^バージョン /)).toBeVisible();
  await expect(see(page, 'アップデート：開発版')).toBeVisible();
});
