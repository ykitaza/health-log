import { expect, Page, test } from '@playwright/test';
import { button, goPane, goTab, openApp, see } from './helpers';

// ケガの記録：筋トレのタブの「ケガ」→ 記録（図を押して部位を選ぶ・一覧から選ぶ）→ 一覧 → 1件 → 振り返り → 直せた → 消す。
// 部位の左右・押した点の部位・入力の確かめ・同期で送るものは jest（lib/__tests__/muscleFigure.test.ts、injuries.test.ts、db/__tests__/injuries.test.ts）。
// SHOT_DIR を渡すと、一覧・記録する・1件の画面のスクリーンショットを残す（見た目の確認用）

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
};

/** 図の横の吹き出しの状態（「● 直し中」）が 1 行（2 行に折り返さない） */
async function expectCalloutStatusOneLine(page: Page) {
  const status = see(page.getByTestId('injury-map'), '● 直し中');
  await expect(status).toHaveCount(2);
  for (const i of [0, 1]) {
    const box = (await status.nth(i).boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(17); // labelS の行の高さは 16
  }
}

async function openInjuries(page: Page) {
  await goTab(page, '筋トレ');
  await goPane(page, 'ケガ');
}

test('ケガを記録して、一覧と1件で見る。振り返りで直せたを選ぶと直せたにするか聞き、直せたにして、消す', async ({ page }) => {
  await openApp(page);
  await openInjuries(page);
  await expect(see(page, 'ケガの記録はありません', { exact: true })).toBeVisible();

  // 記録する：前の図の画面の左の肩（本人の右肩）を押す
  await page.getByTestId('injury-new').click();
  await expect(see(page, 'ケガを記録', { exact: true })).toBeVisible();
  const front = page.getByTestId('injury-figure-front').filter({ visible: true });
  const box = (await front.boundingBox())!;
  await front.click({ position: { x: box.width * 0.27, y: box.height * 0.22 } });
  await expect(page.getByTestId('injury-selected').filter({ visible: true })).toHaveText('右肩');
  await expect(see(page, '三角筋（前）', { exact: true })).toBeVisible();
  await shot(page, 'injury-new');
  // 近くの部位のチップで選び直せる。左右は「右・左」で直せる
  await expect(see(page, '近くの部位', { exact: true })).toBeVisible();
  await button(page, '左側').click();
  await expect(page.getByTestId('injury-selected').filter({ visible: true })).toHaveText('左肩');
  await button(page, '右側').click();

  // 種目を選ぶと、BIG3 の場面の候補が出る
  await page.getByTestId('injury-exercise').filter({ visible: true }).click();
  await button(page, 'ベンチプレス 胸').click();
  await button(page, 'ラックアップ').click();
  await expect(button(page, 'ラックアップ')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('textbox', { name: '症状のひとこと' }).fill('前側にピリッとした痛み');
  await page.getByRole('textbox', { name: '原因（自分の分析）' }).fill('肩でバーベルを持ち上げてしまっている');
  await page.getByRole('textbox', { name: '次はこう直す' }).fill('肩甲骨を寄せてから、腕を伸ばして外す');
  await page.getByTestId('injury-save').filter({ visible: true }).click();

  // 一覧：体の図と、直している途中のカード
  await expect(page.getByTestId('injury-map').filter({ visible: true })).toBeVisible();
  await expect(see(page, 'ACTIVE 01 / CLEARED 00')).toBeVisible();
  const card = page.getByRole('button', { name: /^右肩、直している途中/ }).filter({ visible: true });
  await expect(card).toContainText('NEXT 肩甲骨を寄せてから、腕を伸ばして外す');
  await expect(card).toContainText('振り返り 0回');

  // 2件目は一覧から選ぶ（読み上げでも選べる入口）。左右のない部位
  await page.getByTestId('injury-new').click();
  await button(page, '一覧から選ぶ').click();
  await button(page, '腰').click();
  await expect(page.getByTestId('injury-selected').filter({ visible: true })).toHaveText('腰');
  await expect(button(page, '右側')).toHaveCount(0);
  await page.getByTestId('injury-save').filter({ visible: true }).click();
  await expect(see(page, 'ACTIVE 02 / CLEARED 00')).toBeVisible();
  await shot(page, 'injury-list');
  await expectCalloutStatusOneLine(page);

  // 1件：振り返りを足す（まだ）→ もう1つ（直せた）で、直せたにするか聞く
  await card.click();
  await expect(see(page, '次はこう直す', { exact: true })).toBeVisible();
  await expect(see(page, 'ケガ ・ ベンチプレスで11月8日')).toBeVisible();
  await page.getByTestId('injury-review').filter({ visible: true }).click();
  await button(page, '昨日').click();
  await button(page, '△ まだ').click();
  await page.getByRole('textbox', { name: 'メモ' }).fill('まだ肩が前に出る');
  await page.getByTestId('review-save').filter({ visible: true }).click();
  await expect(see(page, 'まだ肩が前に出る', { exact: true })).toBeVisible();
  await page.getByTestId('injury-review').filter({ visible: true }).click();
  await button(page, '✓ 直せた').click();
  await page.getByRole('textbox', { name: 'メモ' }).fill('寄せてから外せた');
  await page.getByTestId('review-save').filter({ visible: true }).click();
  await expect(see(page, 'このケガを直せたにしますか？', { exact: true })).toBeVisible();
  await shot(page, 'injury-detail-ask');
  // いったん途中のまま
  await button(page, '途中のままにする').click();
  await expect(see(page, 'このケガを直せたにしますか？', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('injury-fixed').filter({ visible: true })).toBeVisible();
  const log = page.getByTestId('injury-log').filter({ visible: true });
  await expect(log).toContainText('11/07');
  await expect(log).toContainText('△まだ');
  await expect(log).toContainText('✓直せた');
  await shot(page, 'injury-detail');

  // 直せたにする → 戻すボタンに変わる。一覧の「直せた」に移る
  await page.getByTestId('injury-fixed').filter({ visible: true }).click();
  await expect(page.getByTestId('injury-reopen').filter({ visible: true })).toBeVisible();
  await expect(see(page, '11/8 直せた', { exact: false })).toBeVisible();
  await button(page, '戻る').click();
  await expect(see(page, 'ACTIVE 01 / CLEARED 01')).toBeVisible();
  await expect(page.getByRole('button', { name: /^右肩、直せた/ }).filter({ visible: true })).toBeVisible();

  // 直す：場面を自由に書く
  await page.getByRole('button', { name: /^右肩、直せた/ }).filter({ visible: true }).click();
  await page.getByTestId('injury-edit').filter({ visible: true }).click();
  await expect(see(page, 'ケガを直す', { exact: true })).toBeVisible();
  await button(page, '自由に書く').click();
  await page.getByRole('textbox', { name: '場面', exact: true }).fill('3セット目のラックアップ');
  await page.getByTestId('injury-save').filter({ visible: true }).click();
  await expect(see(page, '3セット目のラックアップ', { exact: true })).toBeVisible();

  // 消す：確認のダイアログ（振り返りも消える）
  await page.getByTestId('injury-delete').filter({ visible: true }).click();
  await expect(see(page, 'ケガの記録を消しますか？', { exact: true })).toBeVisible();
  await expect(see(page, /振り返り（2件）も一緒に消えます/)).toBeVisible();
  await button(page, '消す').click();
  await expect(see(page, 'ACTIVE 01 / CLEARED 00')).toBeVisible();

  // 再読み込みしても残る
  await page.reload();
  await openInjuries(page);
  await expect(page.getByRole('button', { name: /^腰、直している途中/ }).filter({ visible: true })).toBeVisible();
});

test.describe('動きを減らす設定がオフ', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('直している途中の印が脈打つ（画面のエラーなしで出る）', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await openInjuries(page);
    await page.getByTestId('injury-new').click();
    await button(page, '一覧から選ぶ').click();
    await button(page, 'ひざ').click();
    await page.getByTestId('injury-save').filter({ visible: true }).click();
    await expect(page.getByRole('button', { name: /^右ひざ、直している途中/ }).filter({ visible: true })).toBeVisible();
    await expect(see(page, '▲ 1 ALERT')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('狭い画面（360）', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('記録する画面の図と選んだ部位が枠に収まる', async ({ page }) => {
    await openApp(page);
    await openInjuries(page);
    await page.getByTestId('injury-new').click();
    await button(page, '一覧から選ぶ').click();
    await button(page, '肩の関節').click();
    const frame = (await page.getByTestId('injury-site').filter({ visible: true }).boundingBox())!;
    const back = (await page.getByTestId('injury-figure-back').filter({ visible: true }).boundingBox())!;
    expect(back.x + back.width).toBeLessThanOrEqual(frame.x + frame.width);
    await expect(page.getByTestId('injury-selected').filter({ visible: true })).toHaveText('右肩の関節');
    await shot(page, 'injury-new-360');
  });
});
