import { expect, Locator, Page, test } from '@playwright/test';
import { button, enter, openApp, openBody, see, setBodyInfo } from './helpers';

/** 自動で計算のカード（BMI など）の値 */
const computed = (page: Page, label: string): Locator => page.getByRole('button', { name: `${label}の推移` }).filter({ visible: true }).last();
const field = (page: Page, label: string) => page.getByRole('textbox', { name: label, exact: true }).filter({ visible: true });

/**
 * 推移の画面に、保存した値が出るのを待つ。体組成の画面は欄を離れたときに非同期で保存し、
 * ウエストやメモは画面のほかの数字に出ないので、推移の画面を開き直して確かめる
 */
async function expectInTrend(page: Page, label: string, texts: string[]) {
  await expect(async () => {
    if ((await see(page, `${label}の推移`, { exact: true }).count()) > 0) await button(page, '戻る').click();
    await button(page, `${label}の推移`).first().click();
    await expect(see(page, `${label}の推移`, { exact: true })).toBeVisible();
    for (const t of texts) await expect(see(page, t, { exact: true }).first()).toBeVisible({ timeout: 1000 });
  }).toPass();
  await button(page, '戻る').click();
  await expect(see(page, '自動で計算', { exact: false }).first()).toBeVisible();
}

async function goBackDays(page: Page, n: number) {
  for (let i = 0; i < n; i++) await button(page, '前の日').click();
}

test('入力と保存、身長からの計算。再読み込みしても残る', async ({ page }) => {
  await openApp(page);
  await setBodyInfo(page, { height: '170' });
  await openBody(page);
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();
  await expect(see(page, '自動で計算（身長 170cm）')).toBeVisible();

  await enter(page, '体重', '68.4');
  await enter(page, '体脂肪率', '16.2');
  await enter(page, '筋肉率', '33.5');
  await enter(page, 'ウエスト', '80');
  await page.getByPlaceholder('メモ（例：朝・起床後に計測）').fill('朝・起床後');
  await page.getByPlaceholder('メモ（例：朝・起床後に計測）').press('Tab');

  // BMI = 68.4 ÷ 1.7² = 23.67、体脂肪量 = 68.4 × 16.2% = 11.08、除脂肪体重 = 57.32、筋肉量 = 68.4 × 33.5% = 22.91
  await expect(computed(page, 'BMI')).toContainText('BMI23.7');
  await expect(computed(page, '体脂肪量')).toContainText('体脂肪量11.1kg');
  await expect(computed(page, '除脂肪体重')).toContainText('除脂肪体重57.3kg');
  await expect(computed(page, '筋肉量')).toContainText('筋肉量22.9kg');
  // ウエストとメモは計算に出ないので、推移の画面で保存を確かめる
  await expectInTrend(page, 'ウエスト', ['80.0', '朝・起床後']);

  await page.reload();
  await openBody(page);
  await expect(field(page, '体重')).toHaveValue('68.4');
  await expect(field(page, '体脂肪率')).toHaveValue('16.2');
  await expect(field(page, '筋肉率')).toHaveValue('33.5');
  await expect(field(page, 'ウエスト')).toHaveValue('80');
  await expect(page.getByPlaceholder('メモ（例：朝・起床後に計測）')).toHaveValue('朝・起床後');
  await expect(computed(page, 'BMI')).toContainText('BMI23.7');

  // 「×」で項目を消すと、計算も消える
  await button(page, '体脂肪率を消す').click();
  await expect(field(page, '体脂肪率')).toHaveValue('');
  await expect(computed(page, '体脂肪量')).toContainText('体脂肪量—');
  await page.reload();
  await openBody(page);
  await expect(field(page, '体脂肪率')).toHaveValue('');
  await expect(field(page, '体重')).toHaveValue('68.4');
});

test('身長がないとき、BMI は出ない', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  await expect(see(page, '自動で計算', { exact: true })).toBeVisible();
  await expect(see(page, 'BMI は、設定で身長を入れると出ます')).toBeVisible();
  await enter(page, '体重', '70');
  await enter(page, '体脂肪率', '20');
  await expect(computed(page, 'BMI')).toContainText('BMI—');
  await expect(computed(page, '体脂肪量')).toContainText('体脂肪量14.0kg');
  // 推移の画面でも、BMI は身長がないと出ない
  await computed(page, 'BMI').click();
  await expect(see(page, 'BMI の推移', { exact: true })).toBeVisible();
  await expect(see(page, 'BMI は、設定で身長を入れると出ます')).toBeVisible();
  await expect(see(page, 'この期間の記録がありません')).toBeVisible();
});

test('不正な値（範囲の外、負の数、数字でない）は保存しない。空にすると消える', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  await enter(page, '体脂肪率', '20');
  await enter(page, '体重', '70');
  await expect(computed(page, '体脂肪量')).toContainText('14.0kg');
  for (const bad of ['0', '-1', 'abc', '29.9', '300.1']) {
    await enter(page, '体重', bad);
    await expect(see(page, '体重は 30〜300kg で入れてください', { exact: true })).toBeVisible();
  }
  await enter(page, '体脂肪率', '100.1');
  await expect(see(page, '体脂肪率は 0〜100% で入れてください')).toBeVisible();
  await enter(page, '筋肉率', '150');
  await expect(see(page, '筋肉率は 0〜100% で入れてください')).toBeVisible();
  for (const bad of ['29', '201']) {
    await enter(page, 'ウエスト', bad);
    await expect(see(page, 'ウエストは 30〜200cm で入れてください')).toBeVisible();
  }
  // 正しい値を入れるとエラーは消える（体重は 70 のまま：70 × 99.9% = 69.9）
  await enter(page, '体脂肪率', '99.9');
  await expect(see(page, 'ウエストは 30〜200cm で入れてください')).toBeHidden();
  await expect(computed(page, '体脂肪量')).toContainText('69.9kg');

  // 保存されているのは最後の正しい値だけ
  await page.reload();
  await openBody(page);
  await expect(field(page, '体重')).toHaveValue('70');
  await expect(field(page, '体脂肪率')).toHaveValue('99.9');
  await expect(field(page, '筋肉率')).toHaveValue('');
  await expect(field(page, 'ウエスト')).toHaveValue('');

  // 空にして離れると消える
  await enter(page, '体重', '');
  await expect(computed(page, '体脂肪量')).toContainText('体脂肪量—');
  await page.reload();
  await openBody(page);
  await expect(field(page, '体重')).toHaveValue('');
});

test('範囲の両端は受ける：体重 30〜300kg、体脂肪率と筋肉率 0〜100%、ウエスト 30〜200cm', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  await enter(page, '体重', '300');
  await enter(page, '体脂肪率', '100');
  await expect(computed(page, '体脂肪量')).toContainText('300.0kg');
  await enter(page, '筋肉率', '0');
  await expect(computed(page, '筋肉量')).toContainText('0.0kg');
  await enter(page, '体重', '30');
  await expect(computed(page, '体脂肪量')).toContainText('30.0kg');
  await enter(page, 'ウエスト', '200');
  await expectInTrend(page, 'ウエスト', ['200.0']);
  await enter(page, 'ウエスト', '30');
  await expectInTrend(page, 'ウエスト', ['30.0']);
  await expect(see(page, /で入れてください/)).toHaveCount(0);
});

test('日付の移動。先の日には進めず、入力中に日を変えても元の日に保存する', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  await button(page, '次の日').click();
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();

  await enter(page, '体重', '68.4');
  await button(page, '前の日').click();
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  await expect(field(page, '体重')).toHaveValue('');
  // 欄を離れずに日を変える
  await field(page, '体重').fill('69');
  await button(page, '次の日').click();
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();
  await expect(field(page, '体重')).toHaveValue('68.4');
  await button(page, '前の日').click();
  await expect(field(page, '体重')).toHaveValue('69');
});

test('1日に何度か入れたときは、その日の値をまとめて出す', async ({ page }) => {
  // 手入力は1日1件の記録を書き換える。体重計の取り込み（複数の記録）は第2段階で、web の E2E では作れない（jest で確かめている）
  await openApp(page);
  await openBody(page);
  await enter(page, '体脂肪率', '18');
  await expectInTrend(page, '体脂肪率', ['18.0']);
  await page.reload();
  await openBody(page);
  await enter(page, '体重', '70');
  await expect(computed(page, '体脂肪量')).toContainText('12.6kg'); // 朝の体脂肪率と、あとの体重をまとめる
  await enter(page, '体重', '69.5');
  await expect(computed(page, '体脂肪量')).toContainText('12.5kg'); // 69.5 × 18%
  await computed(page, '体脂肪量').click();
  // 推移の記録の一覧には、その日が1行だけ出る
  await expect(see(page, '体脂肪量の推移', { exact: true })).toBeVisible();
  await expect(see(page, '11月8日（日）', { exact: true })).toHaveCount(1);
  await expect(see(page, '記録が2日以上になると、グラフが出ます')).toBeVisible();
});

test('推移の画面：項目と期間の切り替え、記録がないとき', async ({ page }) => {
  await openApp(page);
  await setBodyInfo(page, { height: '170' });
  await openBody(page);
  // 10/1（38日前）70.5、10/25 70.0、11/8 68.4
  await goBackDays(page, 38);
  await expect(see(page, '10月1日（木）', { exact: true })).toBeVisible();
  await enter(page, '体重', '70.5');
  for (let i = 0; i < 24; i++) await button(page, '次の日').click();
  await expect(see(page, '10月25日（日）', { exact: true })).toBeVisible();
  await enter(page, '体重', '70');
  await page.getByPlaceholder('メモ（例：朝・起床後に計測）').fill('夜');
  await page.getByPlaceholder('メモ（例：朝・起床後に計測）').press('Tab');
  for (let i = 0; i < 14; i++) await button(page, '次の日').click();
  await enter(page, '体重', '68.4');

  // 体組成の画面の「体重の推移」：1か月（10/8〜）で 70.0 → 68.4
  await expect(see(page, '1か月で −1.6kg')).toBeVisible();
  await see(page, '体重の推移', { exact: true }).click();
  await expect(see(page, '体重の推移', { exact: true })).toBeVisible();
  await expect(see(page, '68.4', { exact: true }).first()).toBeVisible();
  await expect(see(page, '1か月で −1.6kg')).toBeVisible();
  await expect(see(page, '11月8日（日） 時点')).toBeVisible();
  await expect(see(page, '10月25日（日）', { exact: true })).toBeVisible();
  await expect(see(page, '夜', { exact: true })).toBeVisible();
  await expect(see(page, '10月1日（木）', { exact: true })).toHaveCount(0);

  // 3か月にすると 10/1 も入る：70.5 → 68.4
  await button(page, '3か月').click();
  await expect(see(page, '3か月で −2.1kg')).toBeVisible();
  await expect(see(page, '10月1日（木）', { exact: true })).toBeVisible();

  // BMI に切り替え：68.4 ÷ 1.7² = 23.7
  await button(page, 'BMI').click();
  await expect(see(page, 'BMI の推移', { exact: true })).toBeVisible();
  await expect(see(page, '23.7', { exact: true }).first()).toBeVisible();

  // 記録のない項目
  await button(page, 'ウエスト').click();
  await expect(see(page, 'この期間の記録がありません')).toBeVisible();
});

test('目標体重のカード：目標がない・体重がないと出ない。残り、ペース、届いたとき', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  await enter(page, '体重', '68.4');
  await expect(see(page, '目標体重まで')).toHaveCount(0);

  // 目標を入れると出る（体組成の歯車から設定へ）
  await setBodyInfo(page, { goal: '65' });
  await expect(see(page, '目標体重まで')).toBeVisible();
  await expect(see(page, '目標 65.0kg')).toBeVisible();
  await expect(see(page, '3.4', { exact: true })).toBeVisible();
  await expect(see(page, '直近28日の記録が2つ以上あるとペースが出ます')).toBeVisible();

  // 14日前に 70.0：ペース (68.4 − 70.0) ÷ 14 × 7 = −0.8kg／週、残り 3.4 ÷ 0.8 = 4.25 → 約5週
  await goBackDays(page, 14);
  await enter(page, '体重', '70');
  for (let i = 0; i < 14; i++) await button(page, '次の日').click();
  await expect(see(page, '直近28日のペース −0.8kg／週')).toBeVisible();
  await expect(see(page, 'このペースで約5週')).toBeVisible();

  // 増やす目標なのに減っているときは、週数を出さない
  await setBodyInfo(page, { goal: '72' });
  await expect(see(page, '目標 72.0kg')).toBeVisible();
  await expect(see(page, /このペースで約/)).toHaveCount(0);

  // 届いたとき
  await setBodyInfo(page, { goal: '68.4' });
  await expect(see(page, '目標に届きました')).toBeVisible();

  // 目標を空にすると消える
  await setBodyInfo(page, { goal: '' });
  await expect(see(page, '目標体重まで')).toHaveCount(0);
});

test('体重の記録がない日を開いても、目標は最新の体重で見る', async ({ page }) => {
  await openApp(page);
  await setBodyInfo(page, { goal: '65' });
  await openBody(page);
  await expect(see(page, '目標体重まで')).toHaveCount(0);
  await button(page, '前の日').click();
  await enter(page, '体重', '66');
  await button(page, '次の日').click();
  await expect(see(page, '目標体重まで')).toBeVisible();
  await expect(see(page, '1.0', { exact: true })).toBeVisible();
});
