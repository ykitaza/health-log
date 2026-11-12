import { expect, Page, test } from '@playwright/test';
import { button, chooseExercise, chooseUnit, enter, enterBody, goPane, goTab, homeCard, openAccountFromSettings, openApp, openBody, openBodySheet, openSettings, recordToday, saveButton, see, setBodyInfo, recordFromHome } from './helpers';

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
  await enterBody(page, { weight: '70' });
  await goPane(page, '推移');
  await expect(see(page, '目標 65.0kg')).toBeVisible();

  // lb にする（からだの歯車から）
  await openSettings(page);
  await chooseUnit(page, 'lb');
  // アカウントの画面の目標体重の欄も lb で出る：65 ÷ 0.45359237 = 143.30
  await page.getByTestId('settings-account').click();
  await expect(page.getByRole('textbox', { name: '目標体重' })).toHaveValue('143.3');
  await expect(see(page, 'lb', { exact: true }).last()).toBeVisible();
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  // からだ：70kg = 154.32lb、目標 143.3lb、残り 11.0lb
  await expect(see(page, '目標 143.3lb')).toBeVisible();
  await expect(see(page, '11.0', { exact: true })).toBeVisible();
  await goPane(page, '今日');
  await expect(page.getByTestId('body-weight').filter({ visible: true })).toContainText('154.3');
  await expect(page.getByTestId('body-summary').filter({ visible: true })).toHaveText('週の平均 154.3 lb ・ 目標まで あと 11.0 lb');
  // シートの欄も lb。変えずに保存しても kg のまま（下で kg に戻して確かめる）
  await openBodySheet(page);
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toHaveValue('154.32');
  await button(page, '保存').click();
  await expect(page.getByRole('textbox', { name: '体重', exact: true })).toBeHidden();

  // ホーム：負荷量 640kg = 1410.96lb → 1.41 k lb。筋トレの今日：80kg = 176.4lb、推定1RM 101.33kg = 223.4lb
  await goTab(page, 'ホーム');
  await expect(page.getByTestId('volume-week')).toContainText('1.41k lb');
  await expect(homeCard(page, 'training')).toContainText('1.41 k lb');
  await goTab(page, '筋トレ');
  await expect(see(page, '176.4 lb × 8 回')).toBeVisible();
  await expect(see(page, '推定1RM 223.4lb')).toBeVisible();
  await goTab(page, 'ホーム');

  // lb で入れた記録は kg で保存する：100lb = 45.36kg
  await recordFromHome(page, 'training');
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
  await goTab(page, 'ホーム');

  // kg に戻すと元の値
  await openSettings(page);
  await chooseUnit(page, 'kg');
  await page.getByTestId('settings-account').click();
  await expect(page.getByRole('textbox', { name: '目標体重' })).toHaveValue('65');
  await button(page, '戻る').click();
  // CSV は kg のまま書き出す
  await page.getByRole('button', { name: /^筋トレの記録を CSV で書き出す/ }).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  expect((await shared(page))[0].title).toBe('hlog の記録（CSV）');
  const csv = (await shared(page))[0].text!;
  expect(csv.split('\r\n')[0]).toBe('日付,部位,種目,セット,重量(kg),回数,メモ,完了');
  expect(csv).toContain('2026-11-08,胸,ベンチプレス,1,80,8,,0\r\n');
  expect(csv).toMatch(/2026-11-08,脚,スクワット,1,45\.359237\d*,5,,0\r\n/);
  await button(page, '戻る').click();
  // lb で開いて変えずに保存した体重も 70kg のまま
  await openBody(page);
  await expect(page.getByTestId('body-weight').filter({ visible: true })).toContainText('70.0');
  await goTab(page, '筋トレ');
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

  await recordFromHome(page, 'training');
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'スクワット');
  await expect(page.getByLabel(/^セット\d+の回数$/)).toHaveCount(5);
  await button(page, '戻る').click();
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(page.getByLabel(/^セット\d+の回数$/)).toHaveCount(1);
  await button(page, '戻る').click();

  // 1セットにして、再読み込みしても残る
  await goTab(page, 'ホーム');
  await openSettings(page);
  await button(page, '1セット').click();
  await expect(button(page, '1セット')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(button(page, '1セット')).toHaveAttribute('aria-selected', 'true');
});

test('休憩のタイマーと今週の目標：初期値が選ばれ、選び直すと再読み込みしても残る', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  // 同じ「切」「3日」のチップがあるので、読み上げの名前は何の選択肢かを足す
  for (const name of ['休憩のタイマー、90秒', '筋トレ、3回', '食事の記録、5日', '睡眠、4日']) {
    await expect(button(page, name)).toHaveAttribute('aria-selected', 'true');
  }
  await button(page, '休憩のタイマー、切').click();
  await button(page, '筋トレ、5回').click();
  await button(page, '食事の記録、7日').click();
  await button(page, '睡眠、切').click();
  const chosen = ['休憩のタイマー、切', '筋トレ、5回', '食事の記録、7日', '睡眠、切'];
  // 保存が終わってから読み込み直す
  for (const name of chosen) await expect(button(page, name)).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, '休憩のタイマー、90秒')).toHaveAttribute('aria-selected', 'false');
  await page.reload();
  for (const name of chosen) await expect(button(page, name)).toHaveAttribute('aria-selected', 'true');
  await expect(button(page, '睡眠、4日')).toHaveAttribute('aria-selected', 'false');
});

test('身長と目標体重（アカウントの画面）の不正な値はエラーを出し、空にすると消える。lb の表示では範囲を lb で出す', async ({ page }) => {
  await openApp(page);
  await openAccountFromSettings(page);
  await enter(page, '身長', '99.9');
  await expect(see(page, '身長は 100〜250cm で入れてください')).toBeVisible();
  await enter(page, '身長', '250');
  await expect(see(page, '身長は 100〜250cm で入れてください')).toBeHidden();
  await enter(page, '目標体重', 'abc');
  await expect(see(page, '目標体重は 30〜300kg で入れてください')).toBeVisible();
  await enter(page, '目標体重', '60.5');
  await expect(see(page, '目標体重は 30〜300kg で入れてください')).toBeHidden();
  await button(page, '戻る').click();

  // 設定で lb にすると、範囲を lb で出す（30〜300kg = 66.14〜661.39lb を、範囲の内側に丸める）
  await chooseUnit(page, 'lb');
  await page.getByTestId('settings-account').click();
  await enter(page, '目標体重', '661.4');
  await expect(see(page, '目標体重は 66.2〜661.3lb で入れてください')).toBeVisible();
  await enter(page, '目標体重', '661.3');
  await expect(see(page, /目標体重は .*で入れてください/)).toHaveCount(0);
  await button(page, '戻る').click();
  await button(page, '戻る').click();

  await openBody(page);
  await openBodySheet(page);
  await page.getByRole('textbox', { name: '体重', exact: true }).fill('661.4');
  await button(page, '保存').click();
  await expect(see(page, '体重は 66.2〜661.3lb で入れてください')).toBeVisible();
  await page.getByRole('textbox', { name: '体重', exact: true }).fill('150');
  await button(page, '保存').click();
  // 身長 250cm・150lb（68.04kg）の BMI = 10.9
  await expect(see(page, '10.9', { exact: true })).toBeVisible();

  // 身長を空にすると消える
  await setBodyInfo(page, { height: '' });
  await expect(see(page, 'BMI は、アカウントの画面で身長を入れると出ます')).toBeVisible();
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
  expect((await shared(page))[0]).toMatchObject({ title: 'hlog の記録（CSV）', text: '日付,部位,種目,セット,重量(kg),回数,メモ,完了\r\n' });

  await page.evaluate(() => { (window as unknown as { __abort: boolean }).__abort = true; });
  await exportButton.click();
  await expect.poll(async () => (await shared(page)).length).toBe(2);
  await expect(see(page, /CSV を書き出せませんでした/)).toHaveCount(0);

  // web で navigator.share がないとき（Android ではまず起きない）。今までは何も起きなかった
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  await exportButton.click();
  await expect(see(page, '共有のメニューを開けなかったため、CSV を書き出せませんでした。')).toBeVisible();
});

// 体の情報（身長・目標体重）はアカウントの画面、重さの単位は設定の画面にある。同じ画面で「入れたまま単位を押す」ことはもうない
test('アカウントの画面で入れた身長と目標体重は保存され、設定で単位を変えると目標体重はその単位で出る（再読み込みしても残る）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await openAccountFromSettings(page);
  const height = page.getByRole('textbox', { name: '身長' });
  const goal = page.getByRole('textbox', { name: '目標体重' });
  await enter(page, '身長', '170');
  await enter(page, '目標体重', '70');
  await button(page, '戻る').click();
  await chooseUnit(page, 'lb');
  await button(page, '5セット').click();
  await expect(button(page, '5セット')).toHaveAttribute('aria-selected', 'true');
  await button(page, '戻る').click();
  await openBody(page);
  await openAccountFromSettings(page);
  // 70kg = 154.32lb
  await expect(goal).toHaveValue('154.32');
  await expect(height).toHaveValue('170');
  await page.reload();
  await expect(goal).toHaveValue('154.32');
  await expect(height).toHaveValue('170');
  expect(errors).toEqual([]);
});

test('設定のいちばん下にアプリの版が出る（web は開発版）', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await expect(see(page, /^バージョン /)).toBeVisible();
  await expect(see(page, 'アップデート：開発版')).toBeVisible();
});
