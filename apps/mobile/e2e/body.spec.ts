import { expect, Page, test } from '@playwright/test';
import { button, enterBody, goPane, openApp, openBody, openBodySheet, see, setBodyInfo } from './helpers';

const field = (page: Page, label: string) => page.getByRole('textbox', { name: label, exact: true }).filter({ visible: true });
/** 今日の体重の大きな数字 */
const weight = (page: Page) => page.getByTestId('body-weight').filter({ visible: true });
/** 体重の下の「週の平均 ・ 目標まで」 */
const summary = (page: Page) => page.getByTestId('body-summary').filter({ visible: true });

// 範囲（両端）・BMI などの計算・目標体重の残りとペース・7日の平均・週の平均・1日に複数の記録のまとめ方・取り込みの値は jest
//（lib/__tests__/limits.test.ts、body.test.ts、screen-logic.test.ts、db/__tests__/repositories.test.ts、healthConnect.test.ts）。
// ここは入力と保存の流れと表示。Health Connect の取り込みは web では動かないので、取り込みの印とシートの「取り込み」は jest と実機で見る

async function goBackDays(page: Page, n: number) {
  for (let i = 0; i < n; i++) await button(page, '前の日').click();
}

test('記録がない日 → シートで入れて保存 → 体重・週の平均・タイル・メモ。再読み込みしても残る。欄を空にすると消える', async ({ page }) => {
  await openApp(page);
  await setBodyInfo(page, { height: '170' });
  await openBody(page);
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();
  await expect(see(page, 'この日の記録はありません').first()).toBeVisible();
  // 前回の記録がなければ、前回の行は出さない
  await expect(see(page, /^前回 /)).toHaveCount(0);

  await openBodySheet(page);
  await expect(see(page, '手入力した値が取り込みより先に出ます。欄を空にして保存すると、取り込みの値に戻ります（取り込みがなければ消えます）')).toBeVisible();
  await field(page, '体重').fill('68.4');
  await field(page, '体脂肪率').fill('16.2');
  await field(page, '体組成のメモ').fill('朝・起床後');
  await button(page, '保存').click();
  await expect(field(page, '体重')).toBeHidden();

  // BMI = 68.4 ÷ 1.7² = 23.67、除脂肪体重 = 68.4 −（68.4 × 16.2%）= 57.32
  await expect(weight(page)).toContainText('68.4');
  await expect(summary(page)).toHaveText('週の平均 68.4 kg');
  await expect(button(page, '体脂肪率 16.2%。体脂肪率の推移を見る')).toBeVisible();
  await expect(button(page, '除脂肪体重 57.3kg。除脂肪体重の推移を見る')).toBeVisible();
  await expect(button(page, 'BMI 23.7。BMIの推移を見る')).toBeVisible();
  await expect(see(page, '朝・起床後', { exact: true })).toBeVisible();
  // 筋肉率・ウエストは出さない
  await expect(see(page, /筋肉|ウエスト/)).toHaveCount(0);

  await page.reload();
  await openBody(page);
  await expect(weight(page)).toContainText('68.4');
  await expect(button(page, 'BMI 23.7。BMIの推移を見る')).toBeVisible();

  // シートには保存した値が入っている。体脂肪率を空にして保存すると消え、タイルは「—」
  await openBodySheet(page);
  await expect(field(page, '体重')).toHaveValue('68.4');
  await expect(field(page, '体脂肪率')).toHaveValue('16.2');
  await expect(field(page, '体組成のメモ')).toHaveValue('朝・起床後');
  await expect(field(page, '筋肉率')).toHaveCount(0);
  await expect(field(page, 'ウエスト')).toHaveCount(0);
  await field(page, '体脂肪率').fill('');
  await button(page, '保存').click();
  await expect(field(page, '体重')).toBeHidden();
  await expect(button(page, '体脂肪率 なし。体脂肪率の推移を見る')).toBeVisible();
  await expect(button(page, '除脂肪体重 なし。除脂肪体重の推移を見る')).toBeVisible();
  await page.reload();
  await openBody(page);
  await expect(button(page, '体脂肪率 なし。体脂肪率の推移を見る')).toBeVisible();
  await expect(weight(page)).toContainText('68.4');
});

test('身長がないとき BMI は「—」。不正な値は保存せずエラーを出し、閉じれば何も変わらない', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  await enterBody(page, { weight: '70', bodyFat: '20' });
  await expect(button(page, 'BMI なし（設定で身長を入れると出ます）。BMIの推移を見る')).toBeVisible();
  await expect(see(page, 'BMI は、設定で身長を入れると出ます')).toBeVisible();

  await openBodySheet(page);
  await field(page, '体重').fill('abc');
  await field(page, '体脂肪率').fill('100.1');
  await button(page, '保存').click();
  // 保存せず、シートは開いたまま。どちらの欄の間違いも出す
  await expect(see(page, '体重は 30〜300kg で入れてください', { exact: true })).toBeVisible();
  await expect(see(page, '体脂肪率は 0〜100% で入れてください', { exact: true })).toBeVisible();
  await expect(field(page, '体重')).toBeVisible();
  // 正しい値にすると保存できる
  await field(page, '体重').fill('71');
  await field(page, '体脂肪率').fill('99.9');
  await button(page, '保存').click();
  await expect(field(page, '体重')).toBeHidden();
  await expect(weight(page)).toContainText('71.0');

  // 直してから閉じる（後ろを押す）と、保存しない
  await openBodySheet(page);
  await field(page, '体重').fill('72');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(field(page, '体重')).toBeHidden();
  await page.reload();
  await openBody(page);
  await expect(weight(page)).toContainText('71.0');

  // 体重を空にして保存すると消える（取り込みがないので「—」）
  await enterBody(page, { weight: '' });
  await expect(weight(page)).toContainText('—');
  await expect(summary(page)).toHaveCount(0);

  // 推移の画面でも、BMI は身長がないと出ない
  await button(page, 'BMI なし（設定で身長を入れると出ます）。BMIの推移を見る').click();
  await expect(see(page, 'BMI の推移', { exact: true })).toBeVisible();
  await expect(see(page, 'BMI は、設定で身長を入れると出ます')).toBeVisible();
  await expect(see(page, 'この期間の記録がありません')).toBeVisible();
});

test('メモは 1000 文字で止まる', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  await openBodySheet(page);
  await field(page, '体組成のメモ').fill('あ'.repeat(1001));
  await expect(field(page, '体組成のメモ')).toHaveValue('あ'.repeat(1000));
  await button(page, '保存').click();
  await expect(field(page, '体重')).toBeHidden();
  await page.reload();
  await openBody(page);
  await openBodySheet(page);
  await expect(field(page, '体組成のメモ')).toHaveValue('あ'.repeat(1000));
});

test('日付の移動。先の日には進めない。記録のない日は前回の体重。週の平均は月曜始まりの週の記録の平均', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  // 今日より先には進めない（押せない）
  await expect(button(page, '次の日')).toBeDisabled();

  // 11/5（木）69.0、11/8（日）68.4。11/2〜11/8 が同じ週
  await goBackDays(page, 3);
  await expect(see(page, '11月5日（木）', { exact: true })).toBeVisible();
  await enterBody(page, { weight: '69' });
  await button(page, '次の日').click();
  await expect(see(page, '11月6日（金）', { exact: true })).toBeVisible();
  await expect(see(page, '前回 69.0 kg（11月5日）')).toBeVisible();
  await button(page, '次の日').click();
  await button(page, '次の日').click();
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();
  await enterBody(page, { weight: '68.4' });
  await expect(summary(page)).toHaveText('週の平均 68.7 kg');
  await button(page, '前の日').click();
  await expect(see(page, '前回 69.0 kg（11月5日）')).toBeVisible();
});

test('推移のタブ：体重の推移（1か月、7日の平均）から項目の推移へ。睡眠・心拍は記録なし', async ({ page }) => {
  await openApp(page);
  await setBodyInfo(page, { height: '170' });
  await openBody(page);
  // 10/1（38日前）70.5、10/25 70.0、11/8 68.4
  await goBackDays(page, 38);
  await expect(see(page, '10月1日（木）', { exact: true })).toBeVisible();
  await enterBody(page, { weight: '70.5' });
  for (let i = 0; i < 24; i++) await button(page, '次の日').click();
  await expect(see(page, '10月25日（日）', { exact: true })).toBeVisible();
  await enterBody(page, { weight: '70', memo: '夜' });
  for (let i = 0; i < 14; i++) await button(page, '次の日').click();
  await enterBody(page, { weight: '68.4' });

  // 推移のタブの「体重の推移」：1か月（10/8〜）で 70.0 → 68.4
  await goPane(page, '推移');
  await expect(see(page, '1か月で −1.6 kg')).toBeVisible();
  await expect(see(page, '7日の平均', { exact: true }).first()).toBeVisible();
  // Health Connect をつないでいないので、睡眠・心拍は記録なし
  await expect(page.getByTestId('sleep-week').filter({ visible: true })).toContainText('この7日の記録はありません');
  await expect(page.getByTestId('heart-week').filter({ visible: true })).toContainText('この7日の記録はありません');

  await see(page, '体重の推移', { exact: true }).click();
  await expect(see(page, '体重の推移', { exact: true })).toBeVisible();
  await expect(see(page, '68.4', { exact: true }).first()).toBeVisible();
  await expect(see(page, '1か月で −1.6kg')).toBeVisible();
  await expect(see(page, '7日の平均', { exact: true })).toBeVisible();
  await expect(see(page, '11月8日（日） 時点')).toBeVisible();
  await expect(see(page, '10月25日（日）', { exact: true })).toBeVisible();
  await expect(see(page, '夜', { exact: true })).toBeVisible();
  await expect(see(page, '10月1日（木）', { exact: true })).toHaveCount(0);

  // 3か月にすると 10/1 も入る：70.5 → 68.4
  await button(page, '3か月').click();
  await expect(see(page, '3か月で −2.1kg')).toBeVisible();
  await expect(see(page, '10月1日（木）', { exact: true })).toBeVisible();

  // BMI に切り替え：68.4 ÷ 1.7² = 23.7。筋肉率・ウエスト・筋肉量の項目はない
  await button(page, 'BMI').click();
  await expect(see(page, 'BMI の推移', { exact: true })).toBeVisible();
  await expect(see(page, '23.7', { exact: true }).first()).toBeVisible();
  for (const name of ['筋肉率', 'ウエスト', '筋肉量']) await expect(button(page, name)).toHaveCount(0);

  // 記録のない項目
  await button(page, '体脂肪率').click();
  await expect(see(page, 'この期間の記録がありません')).toBeVisible();
  await button(page, '戻る').click();

  // 睡眠のカードから睡眠の推移へ
  await page.getByTestId('sleep-week').filter({ visible: true }).click();
  await expect(see(page, '睡眠の推移', { exact: true })).toBeVisible();
});

test('目標体重：今日の「目標まで」と、推移の「目標体重まで」。目標がない・届いたとき・消したとき', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  await enterBody(page, { weight: '68.4' });
  await expect(summary(page)).toHaveText('週の平均 68.4 kg');
  await goPane(page, '推移');
  await expect(see(page, '目標体重まで')).toHaveCount(0);

  // 目標を入れると出る（からだの歯車から設定へ）
  await setBodyInfo(page, { goal: '65' });
  await expect(see(page, '目標体重まで')).toBeVisible();
  await expect(see(page, '目標 65.0kg')).toBeVisible();
  await expect(see(page, '3.4', { exact: true })).toBeVisible();
  await expect(see(page, '直近28日の記録が2つ以上あるとペースが出ます')).toBeVisible();
  await goPane(page, '今日');
  await expect(summary(page)).toHaveText('週の平均 68.4 kg ・ 目標まで あと 3.4 kg');

  // 前の日に 69.0：ペース (68.4 − 69.0) ÷ 1 × 7 = −4.2kg／週、残り 3.4 ÷ 4.2 → 約1週
  await button(page, '前の日').click();
  await enterBody(page, { weight: '69' });
  await expect(summary(page)).toHaveText('週の平均 68.7 kg ・ 目標まで あと 4.0 kg');
  await button(page, '次の日').click();
  await goPane(page, '推移');
  await expect(see(page, '直近28日のペース −4.2kg／週')).toBeVisible();
  await expect(see(page, 'このペースで約1週')).toBeVisible();

  // 項目の推移の画面（体重）にも「目標まで」
  await see(page, '体重の推移', { exact: true }).click();
  await expect(page.getByTestId('trend-goal').filter({ visible: true })).toHaveText('目標まで あと 3.4 kg');
  await button(page, '戻る').click();

  // 届いたとき
  await setBodyInfo(page, { goal: '68.4' });
  await expect(see(page, '目標に届きました')).toBeVisible();

  // 目標を空にすると消える
  await setBodyInfo(page, { goal: '' });
  await expect(see(page, '目標体重まで')).toHaveCount(0);
  await goPane(page, '今日');
  await expect(summary(page)).toHaveText('週の平均 68.7 kg');
});
