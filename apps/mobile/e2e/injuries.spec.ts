import { expect, Page, test } from '@playwright/test';
import { button, goPane, goTab, openApp, see } from './helpers';

// ケガの記録：筋トレのタブの「ケガ」→ 記録（図を押して部位を選ぶ・一覧から選ぶ）→ 一覧 → 1件 → 振り返り → 直せた → 消す。
// 部位の左右・押した点の部位・入力の確かめ・同期で送るものは jest（lib/__tests__/muscleFigure.test.ts、injuries.test.ts、db/__tests__/injuries.test.ts）。
// SHOT_DIR を渡すと、一覧・記録する・1件の画面のスクリーンショットを残す（見た目の確認用）

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
};

/**
 * 一覧の体の図：図が大きい（人の高さが枠の 7 割以上。前は 6 割ほど）。図に重ねた札（count 枚）が枠からはみ出さず、
 * 文字が切れず（中身が札の幅に収まる）、札どうしが重ならない
 */
async function expectBodyMapFits(page: Page, count: number) {
  const map = page.getByTestId('injury-map').filter({ visible: true });
  const frame = (await map.boundingBox())!;
  const figs = (await map.getByTestId('injury-map-figures').boundingBox())!;
  expect(figs.height / frame.height).toBeGreaterThanOrEqual(0.7);
  expect(figs.height).toBeGreaterThanOrEqual(240);
  const callouts = map.getByTestId('injury-callout');
  await expect(callouts).toHaveCount(count);
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const c = callouts.nth(i);
    const b = (await c.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(frame.x);
    expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(b.y).toBeGreaterThanOrEqual(frame.y);
    expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height);
    // 文字が切れない：中身の幅が見えている幅に収まる
    expect(await c.evaluate((el) => [...el.querySelectorAll('div')].every((d) => d.scrollWidth <= d.clientWidth + 1))).toBe(true);
    boxes.push(b);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      expect(apart).toBe(true);
    }
  }
}

async function openInjuries(page: Page) {
  await goTab(page, '筋トレ');
  await goPane(page, 'ケガ');
}

/** 右下の「ケガを記録」→ 記録の方法のシートで「自分で入力」 */
async function newInjury(page: Page) {
  await page.getByTestId('injury-new').click();
  await page.getByTestId('injury-new-manual').filter({ visible: true }).click();
}

test('ケガを記録して、一覧と1件で見る。振り返りで直せたを選ぶと直せたにするか聞き、直せたにして、消す', async ({ page }) => {
  await openApp(page);
  await openInjuries(page);
  await expect(see(page, 'ケガの記録はありません', { exact: true })).toBeVisible();

  // 記録する：前の図の画面の左の肩（本人の右肩）を押す
  await newInjury(page);
  // 記録する画面の見出し（右下の FAB も「ケガを記録」なので、見出しで確かめる）
  await expect(page.getByRole('heading', { name: 'ケガを記録', exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId('injury-new')).toBeHidden();
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
  await newInjury(page);
  await button(page, '一覧から選ぶ').click();
  await button(page, '腰').click();
  await expect(page.getByTestId('injury-selected').filter({ visible: true })).toHaveText('腰');
  await expect(button(page, '右側')).toHaveCount(0);
  await page.getByTestId('injury-save').filter({ visible: true }).click();
  await expect(see(page, 'ACTIVE 02 / CLEARED 00')).toBeVisible();
  await shot(page, 'injury-list');
  await expectBodyMapFits(page, 2);

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
    await newInjury(page);
    await button(page, '一覧から選ぶ').click();
    await button(page, 'ひざ').click();
    await page.getByTestId('injury-save').filter({ visible: true }).click();
    await expect(page.getByRole('button', { name: /^右ひざ、直している途中/ }).filter({ visible: true })).toBeVisible();
    await expect(see(page, '▲ 1 ALERT')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('脈打つ印は、スクロールして見えないあいだは止まり、見えると動く', async ({ page }) => {
    await openApp(page);
    await openInjuries(page);
    for (const site of ['ひざ', '肩']) {
      await newInjury(page);
      await button(page, '一覧から選ぶ').click();
      await button(page, site).click();
      await page.getByTestId('injury-save').filter({ visible: true }).click();
      await expect(page.getByTestId('injury-map').filter({ visible: true })).toBeVisible();
    }
    const pulse = page.getByTestId('injury-pulse').filter({ visible: true }).first();
    // 20 コマのあいだに輪の大きさか濃さが変わったか（決まった時間ではなく、描画のコマで待つ）
    const moving = () => pulse.evaluate(async (el) => {
      const look = () => { const st = getComputedStyle(el); return `${st.transform} ${st.opacity}`; };
      const before = look();
      for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
      return look() !== before;
    });
    await expect.poll(moving).toBe(true);
    // 図が画面の外へ出るまでスクロールできるよう、画面を低くする
    await page.setViewportSize({ width: 412, height: 360 });
    // 下のタブの上ではなく、スクロールする中身の上で回す
    await page.mouse.move(206, 150);
    await page.mouse.wheel(0, 3000);
    // 見えている範囲の上の外（止めずに描いておく余白 64 より外）まで出す
    await expect.poll(async () => { const b = (await pulse.boundingBox())!; return b.y + b.height; }).toBeLessThan(-64);
    await expect.poll(moving).toBe(false);
    // 戻す（脈打つ輪は動いていて「止まった要素」にならないので、動かない図の枠を見えるところまで戻す）
    await page.getByTestId('injury-map').filter({ visible: true }).scrollIntoViewIfNeeded();
    await expect.poll(moving).toBe(true);
  });
});

test.describe('狭い画面（360）', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('記録する画面の図と選んだ部位が枠に収まる', async ({ page }) => {
    await openApp(page);
    await openInjuries(page);
    await newInjury(page);
    await button(page, '一覧から選ぶ').click();
    await button(page, '肩の関節').click();
    const frame = (await page.getByTestId('injury-site').filter({ visible: true }).boundingBox())!;
    const back = (await page.getByTestId('injury-figure-back').filter({ visible: true }).boundingBox())!;
    expect(back.x + back.width).toBeLessThanOrEqual(frame.x + frame.width);
    // 押しやすいよう図は大きく（360 で 140×280。前は 81×162）
    expect(back.height).toBeGreaterThanOrEqual(260);
    await expect(page.getByTestId('injury-selected').filter({ visible: true })).toHaveText('右肩の関節');
    await shot(page, 'injury-new-360');
  });

  test('一覧の体の図が大きく、左右2つずつの札（長い部位の名前も）が切れず重ならず枠に収まる', async ({ page }) => {
    await openApp(page);
    await openInjuries(page);
    // 前の図に2つ（肩・ひざ）、後ろの図に2つ（ふくらはぎ・腰の筋肉）。「右のふくらはぎ」がいちばん長い名前
    for (const site of ['肩', 'ふくらはぎ', 'ひざ', '腰の筋肉']) {
      await newInjury(page);
      await button(page, '一覧から選ぶ').click();
      await button(page, site).click();
      await page.getByTestId('injury-save').filter({ visible: true }).click();
      await expect(page.getByTestId('injury-map').filter({ visible: true })).toBeVisible();
    }
    await expect(see(page, 'ACTIVE 04 / CLEARED 00')).toBeVisible();
    await expect(see(page.getByTestId('injury-map'), '右のふくらはぎ', { exact: true })).toBeVisible();
    await expectBodyMapFits(page, 4);
    await shot(page, 'injury-list-360');
  });
});
