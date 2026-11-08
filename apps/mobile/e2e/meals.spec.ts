// 食事タブの代表の流れ（画面でしか確かめられないもの）。合計・目標の残り・週のふり返り・入力の確かめ・複製の中身は
// jest（lib/__tests__/meals*.test.ts、db/__tests__/meals.test.ts）で確かめている
import { expect, Page, test } from '@playwright/test';
import { button, goTab, openApp, see } from './helpers';

const field = (page: Page, label: string) => page.getByRole('textbox', { name: label, exact: true }).filter({ visible: true });
const totalKcal = (page: Page) => page.getByTestId('total-kcal').filter({ visible: true });

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
  await button(page, '目標').click();
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
  await expect(totalKcal(page)).toHaveText('420');
  await expect(see(page, '残り 1,580kcal')).toBeVisible();
  await expect(see(page, '残り 113.0g')).toBeVisible();

  // 量を半分にすると、kcal も半分になる
  await button(page, '白米、鶏むね肉を開く').click();
  await field(page, '白米の量').fill('100');
  await expect(page.getByTestId('meal-detail-kcal').filter({ visible: true })).toContainText('264');
  await button(page, '保存').click();
  await expect(totalKcal(page)).toHaveText('264');

  // 消す：キャンセルでは消えない
  await button(page, '白米、鶏むね肉を開く').click();
  await button(page, 'この食事を消す').click();
  await expect(see(page, 'この食事を消しますか？')).toBeVisible();
  await button(page, 'キャンセル').click();
  await button(page, 'この食事を消す').click();
  await button(page, '消す').click();
  await expect(see(page, '昼食はまだ記録していません')).toBeVisible();
  await expect(totalKcal(page)).toHaveText('0');
});

test('過去の日に記録 → 次の日に「昨日と同じ」と「いつもの」で記録 → 週のふり返り', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await button(page, '前の日').click();
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  await recordItems(page, '朝食', [{ name: 'オートミール', amount: '40', kcal: '150' }], '朝の定番');
  await expect(totalKcal(page)).toHaveText('150');

  await button(page, '次の日').click();
  await expect(see(page, '11月8日（日）', { exact: true })).toBeVisible();
  await expect(see(page, '朝食はまだ記録していません')).toBeVisible();
  await button(page, '朝食を記録').click();
  await button(page, '昨日と同じ：オートミール').click();
  await expect(totalKcal(page)).toHaveText('150');
  await button(page, '間食を記録').click();
  await button(page, 'いつもの「朝の定番」を記録').click();
  await expect(button(page, 'いつもの：朝の定番を開く')).toBeVisible();
  await expect(totalKcal(page)).toHaveText('300');

  // 週のふり返り（記録した日だけの平均：(150 + 300) ÷ 2）
  await goTab(page, '履歴／分析');
  await button(page, '食事').click();
  await expect(page.getByTestId('weekly-average-kcal').filter({ visible: true })).toContainText('225');
  await expect(see(page, '記録 2／7日')).toBeVisible();
});
