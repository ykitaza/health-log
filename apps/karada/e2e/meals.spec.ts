// 食事タブの代表の流れ（画面でしか確かめられないもの）。合計・目標の残り・週のふり返り・入力の確かめ・複製の中身は
// jest（lib/__tests__/meals*.test.ts、db/__tests__/meals.test.ts）で確かめている
import { expect, Page, test } from '@playwright/test';
import { button, controlDb, enterBody, goTab, homeIcon, openApp, openBody, openMealWeek, see, setBodyInfo, TODAY } from './helpers';

const field = (page: Page, label: string) => page.getByRole('textbox', { name: label, exact: true }).filter({ visible: true });
const bmi = (page: Page) => page.getByRole('button', { name: /^BMI .*BMIの推移を見る$/ }).filter({ visible: true });
/** 合計は、記録の上の FUEL のカード（ホームと同じ）の読み上げで見る */
const fuel = (page: Page) => page.getByTestId('meal-fuel').filter({ visible: true });
const expectTotal = (page: Page, kcal: string) => expect(fuel(page)).toHaveAttribute('aria-label', new RegExp(`^[^。]+の食事 ${kcal}kcal`));

/** 食事タブで、区分の「＋」から品目を入れて記録する */
async function recordItems(page: Page, slot: string, items: { name: string; amount: string; kcal: string; p?: string }[], template?: string) {
  await button(page, `${slot}を記録`).click();
  await button(page, '品目を入力').click();
  await expect(see(page, '品目を入力', { exact: true })).toBeVisible();
  for (const [i, item] of items.entries()) {
    if (i > 0) await button(page, '品目を追加').click();
    await field(page, `品目${i + 1}の品名`).fill(item.name);
    await field(page, `品目${i + 1}の量`).fill(item.amount);
    await field(page, `品目${i + 1}のエネルギー`).fill(item.kcal);
    if (item.p) await field(page, `品目${i + 1}のたんぱく質`).fill(item.p);
  }
  if (template) {
    await page.getByRole('switch', { name: 'いつものとして保存' }).click();
    await field(page, 'いつものの名前').fill(template);
  }
  await button(page, '記録する').click();
  await expect(see(page, '食事', { exact: true }).first()).toBeVisible();
}

test('記録 → 合計と目標の残り → 量を直す → 消す（確認）', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();

  // 目標（休みの日 2000kcal、たんぱく質 70kg × 2g）
  await button(page, '食事の目標を見る・決める').click();
  await button(page, '維持').click();
  await field(page, '体重').fill('70');
  await field(page, 'たんぱく質（体重1kgあたり）').fill('2');
  for (const d of ['筋トレの日', '休みの日']) {
    await field(page, `${d}の kcal`).fill(d === '筋トレの日' ? '2400' : '2000');
    await field(page, `${d}の脂質`).fill('60');
    await field(page, `${d}の炭水化物`).fill('250');
  }
  await button(page, '目標を保存').click();

  await recordItems(page, '昼食', [{ name: '白米', amount: '200', kcal: '312', p: '5' }, { name: '鶏むね肉', amount: '100', kcal: '108', p: '22' }]);
  await expect(button(page, '白米、鶏むね肉を開く')).toBeVisible();
  await expectTotal(page, '420');
  await expect(see(page, '残り 1,580 kcal')).toBeVisible();
  await expect(see(page, '残り 113.0 g')).toBeVisible();

  // 量を半分にすると、kcal も半分になる
  await button(page, '白米、鶏むね肉を開く').click();
  await field(page, '白米の量').fill('100');
  await expect(page.getByTestId('meal-detail-kcal').filter({ visible: true })).toContainText('264');
  await button(page, '保存').click();
  await expectTotal(page, '264');

  // 消す：やめるでは消えない
  await button(page, '白米、鶏むね肉を開く').click();
  await button(page, 'この食事を消す').click();
  await expect(see(page, 'この食事を消しますか？')).toBeVisible();
  await button(page, 'やめる').click();
  await button(page, 'この食事を消す').click();
  await button(page, '消す').click();
  await expect(see(page, '昼食はまだ記録していません')).toBeVisible();
  await expectTotal(page, '0');
});

test('下の「食事を追加」：今の時刻に近い区分を選んだシートが開き、区分を選び直して記録できる', async ({ page }) => {
  // 夜 7 時半なら夕食を選んでおく
  await page.clock.setFixedTime(new Date(`${TODAY}T19:30:00+09:00`));
  await page.goto('/');
  await expect(homeIcon(page)).toBeVisible();
  await goTab(page, '食事');
  await button(page, '食事を追加').click();
  await expect(see(page, '夕食を記録', { exact: true })).toBeVisible();
  await expect(button(page, '夕食')).toHaveAttribute('aria-selected', 'true');
  await button(page, '間食').click();
  await expect(see(page, '間食を記録', { exact: true })).toBeVisible();
  await expect(button(page, '間食')).toHaveAttribute('aria-selected', 'true');
  await button(page, '品目を入力').click();
  await field(page, '品目1の品名').fill('ヨーグルト');
  await field(page, '品目1の量').fill('100');
  await field(page, '品目1のエネルギー').fill('60');
  await button(page, '記録する').click();
  await expect(button(page, 'ヨーグルトを開く')).toBeVisible();
  await expect(see(page, '夕食はまだ記録していません')).toBeVisible();
  await expect(see(page, '間食はまだ記録していません')).toBeHidden();
  await expectTotal(page, '60');
});

test('過去の日に記録 → 次の日に「昨日と同じ」と「いつもの」で記録 → 週のふり返り', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await button(page, '前の日').click();
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  await recordItems(page, '朝食', [{ name: 'オートミール', amount: '40', kcal: '150' }], '朝の定番');
  await expectTotal(page, '150');

  await button(page, '次の日').click();
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();
  await expect(see(page, '朝食はまだ記録していません')).toBeVisible();
  await button(page, '朝食を記録').click();
  await button(page, '昨日と同じ：オートミール').click();
  await expectTotal(page, '150');
  await button(page, '間食を記録').click();
  await button(page, 'いつもの「朝の定番」を記録').click();
  await expect(button(page, 'いつもの：朝の定番を開く')).toBeVisible();
  await expectTotal(page, '300');

  // 週のふり返り（記録した日だけの平均：(150 + 300) ÷ 2）
  await openMealWeek(page);
  await expect(page.getByTestId('weekly-average-kcal').filter({ visible: true })).toContainText('225');
  await expect(see(page, '記録 2／7日')).toBeVisible();
});

test('「記録する」を続けて押しても1つだけ記録し、記録している間は押せない', async ({ page }) => {
  // 記録が終わる前（ボタンが押せなくなる前）に2回目が届くときを、DB の返事を止めて毎回作る
  const db = await controlDb(page);
  await openApp(page);
  await goTab(page, '食事');
  await button(page, '昼食を記録').click();
  await button(page, '品目を入力').click();
  await expect(see(page, '品目を入力', { exact: true })).toBeVisible();
  await field(page, '品目1の品名').fill('白米');
  await field(page, '品目1の量').fill('200');
  await field(page, '品目1のエネルギー').fill('312');
  await db.hold();
  // 2回の押下を、画面が描き直す前に続けて届ける
  await button(page, '記録する').evaluate((el) => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
  await expect(button(page, '記録しています…')).toHaveAttribute('aria-disabled', 'true');
  await expect(button(page, '記録しています…')).toHaveAttribute('aria-busy', 'true');
  await db.release();
  await expect(button(page, '白米を開く')).toBeVisible();
  await page.reload();
  await expect(button(page, '白米を開く')).toHaveCount(1);
});

test('目標の自動で計算：足りない項目を入れる → 値が入る → 直して保存。体重が変わると計算し直すかを聞く', async ({ page }) => {
  // 計算の式・境目・丸めは jest（lib/__tests__/autoGoal.test.ts）。ここは画面の流れと、代表の値が欄に入ること
  await openApp(page);
  await setBodyInfo(page, { height: '170', goal: '65' });
  await openBody(page);
  await enterBody(page, { weight: '68' });
  await expect(bmi(page)).toContainText('BMI23.5'); // 保存を待つ
  await goTab(page, '食事');
  await button(page, '食事の目標を見る・決める').click();

  // 性別・生まれた年・活動の量がないので、先に入れてもらう（身長はアカウントの画面で入れてある）
  await button(page, '自動で計算').click();
  await expect(see(page, '計算に使う項目を入れてください')).toBeVisible();
  await expect(field(page, '身長')).toHaveCount(0);
  await button(page, '保存して計算').click();
  await expect(see(page, '性別を選んでください')).toBeVisible();
  await button(page, '男性').click();
  await field(page, '生まれた年').fill('1991');
  await button(page, '少し動く').click();
  await button(page, '保存して計算').click();

  // 68kg・170cm・35歳・少し動く・目標 65kg → 減量。休み 1810kcal・F50・C204、筋トレ 2090kcal・F58・C256
  await expect(see(page, '計算のもと')).toBeVisible();
  await expect(see(page, '1,573kcal（Mifflin-St Jeor の式）')).toBeVisible();
  await expect(see(page, '−350kcal')).toBeVisible();
  await expect(field(page, '休みの日の kcal')).toHaveValue('1810');
  await expect(field(page, '休みの日の炭水化物')).toHaveValue('204');
  await expect(field(page, '筋トレの日の kcal')).toHaveValue('2090');
  await expect(field(page, '筋トレの日の脂質')).toHaveValue('58');
  await expect(field(page, '筋トレの日の炭水化物')).toHaveValue('256');
  await expect(field(page, '体重')).toHaveValue('68');
  await expect(button(page, '減量')).toHaveAttribute('aria-selected', 'true');

  // 直してから保存する
  await field(page, '筋トレの日の kcal').fill('2100');
  await button(page, '目標を保存').click();
  await button(page, '食事の目標を見る・決める').click();
  await expect(see(page, /2,100kcal/)).toBeVisible();
  await expect(see(page, '体重が変わりました', { exact: false })).toHaveCount(0);
  await button(page, '戻る').click();

  // 体重が 2% 以上変わると、計算し直すかを聞く（勝手に書き換えない）
  await openBody(page);
  await enterBody(page, { weight: '70' });
  await expect(bmi(page)).toContainText('BMI24.2');
  await goTab(page, '食事');
  await button(page, '食事の目標を見る・決める').click();
  await expect(see(page, '体重が変わりました（前回 68.0kg → 今 70.0kg）。計算し直しますか？')).toBeVisible();
  await expect(field(page, '筋トレの日の kcal')).toHaveValue('2100');
  await button(page, '計算し直す').click();
  await expect(see(page, '体重が変わりました', { exact: false })).toHaveCount(0);
  await expect(field(page, '体重')).toHaveValue('70');
});
