import { expect, Page, test } from '@playwright/test';
import { button, chooseExercise, chooseUnit, enter, goTab, moveToDate, openApp, openBody, openSettings, recordOn, recordToday, saveButton, see, setBodyInfo } from './helpers';

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

test('kg と lb の切り替え：記録・体重・目標体重の表示が換算され、保存は kg のまま', async ({ page }) => {
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
  await button(page, '戻る').click();

  // kg に戻すと元の値
  await openSettings(page);
  await chooseUnit(page, 'kg');
  await expect(page.getByRole('textbox', { name: '目標体重' })).toHaveValue('65');
  // CSV は kg のまま書き出す
  await page.getByRole('button', { name: /^筋トレの記録を CSV で書き出す/ }).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
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

test('身長と目標体重の不正な値', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  for (const bad of ['49', '251', '0', '-170', 'abc']) {
    await enter(page, '身長', bad);
    await expect(see(page, '身長は 50〜250 cm で入れてください')).toBeVisible();
  }
  await enter(page, '身長', '250');
  await expect(see(page, '身長は 50〜250 cm で入れてください')).toBeHidden();
  for (const bad of ['0', '-60', 'abc']) {
    await enter(page, '目標体重', bad);
    await expect(see(page, '目標体重は正の数で入れてください')).toBeVisible();
  }
  await enter(page, '目標体重', '60.5');
  await expect(see(page, '目標体重は正の数で入れてください')).toBeHidden();
  await button(page, '戻る').click();
  await openBody(page);
  await expect(see(page, '自動で計算（身長 250cm）')).toBeVisible();

  // 空にすると消える
  await setBodyInfo(page, { height: '' });
  await expect(see(page, 'BMI は、設定で身長を入れると出ます')).toBeVisible();
});

test('CSV：記録がなければ見出しだけ', async ({ page }) => {
  await captureShare(page);
  await openApp(page);
  await openSettings(page);
  await page.getByRole('button', { name: /^筋トレの記録を CSV で書き出す/ }).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  const s = (await shared(page))[0];
  expect(s.title).toBe('トレログの記録（CSV）');
  expect(s.text).toBe('日付,部位,種目,セット,重量(kg),回数,メモ,完了\r\n');
});

test('CSV：メモの「,」と「"」はくくって書き出し、消した記録と完了を反映する', async ({ page }) => {
  await captureShare(page);
  await openApp(page);
  await recordToday(page, [
    { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8', memo: 'フォーム "良い", 重い', done: true }, { weight: '82.5', reps: '5' }] },
    { exercise: '懸垂', sets: [{ reps: '10' }] },
    { exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] },
  ]);
  // スクワットを外す
  await button(page, '本日のトレーニングを追加').click();
  await button(page, 'スクワットを外す').click();
  await button(page.getByRole('dialog'), '外す').click();
  await expect(page.getByRole('button', { name: 'スクワットを直す' })).toHaveCount(0);
  await button(page, '戻る').click();
  await openSettings(page);
  await page.getByRole('button', { name: /^筋トレの記録を CSV で書き出す/ }).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  expect((await shared(page))[0].text).toBe(
    '日付,部位,種目,セット,重量(kg),回数,メモ,完了\r\n' +
    '2026-11-08,胸,ベンチプレス,1,80,8,"フォーム ""良い"", 重い",1\r\n' +
    '2026-11-08,胸,ベンチプレス,2,82.5,5,,0\r\n' +
    '2026-11-08,背中,懸垂,1,,10,,0\r\n',
  );
});

test('lb の表示で記録を開いて変えずに保存しても、kg の値は変わらない', async ({ page }) => {
  // 80kg は 176.37lb と出る。これを kg に戻すと 80.0000863kg になっていた（CSV で見える）
  await captureShare(page);
  await openApp(page);
  await recordToday(page, [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await openSettings(page);
  await chooseUnit(page, 'lb');
  await button(page, '戻る').click();

  await button(page, '本日のトレーニングを追加').click();
  await page.getByRole('button', { name: 'ベンチプレスを直す' }).click();
  await expect(page.getByLabel('セット1の重量')).toHaveValue('176.37');
  await saveButton(page).click();
  await expect(see(page, '176.4 lb × 8 回')).toBeVisible();
  await button(page, '戻る').click();

  await openSettings(page);
  await page.getByRole('button', { name: /^筋トレの記録を CSV で書き出す/ }).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  expect((await shared(page))[0].text).toContain('2026-11-08,胸,ベンチプレス,1,80,8,,0\r\n');
});

test('lb の表示で「前回をコピー」しても、kg の値は前回と同じ', async ({ page }) => {
  await captureShare(page);
  await recordOn(page, '2026-11-07', [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await moveToDate(page, '2026-11-08');
  await openSettings(page);
  await chooseUnit(page, 'lb');
  await button(page, '戻る').click();
  await button(page, '本日のトレーニングを追加').click();
  await button(page, '種目を追加').click();
  await chooseExercise(page, 'ベンチプレス');
  await button(page, '前回をコピー').click();
  await expect(page.getByLabel('セット1の重量')).toHaveValue('176.37');
  // 上のセットをコピーしても同じ
  await button(page, '上のセットをコピー').click();
  await saveButton(page).click();
  await button(page, '戻る').click();

  await openSettings(page);
  await page.getByRole('button', { name: /^筋トレの記録を CSV で書き出す/ }).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  expect((await shared(page))[0].text).toContain(
    '2026-11-08,胸,ベンチプレス,1,80,8,,0\r\n2026-11-08,胸,ベンチプレス,2,80,8,,0\r\n',
  );
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
