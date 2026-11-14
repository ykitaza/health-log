import { expect, Locator, Page, test } from '@playwright/test';
import { addEntry, button, goTab, moveToDate, openApp, recordOn, see, TODAY } from './helpers';

// 記録の画面の体の図：種目ごとの札（EX-01・種目・いちばん重いセット）と引き出し線、記録のない日の回復マップ、図の部位から記録。
// 札の並べ方（左右・ずらし・「+N」）と、筋肉 → 部位の逆引きは jest（lib/__tests__/dayCallouts.test.ts）。
// ここは画面に出ること、360 と 412 の幅で札が図とカードに重ならないこと、押して種目の選択に進むこと
const SHOTS = process.env.FIGURE_SHOTS;

const box = async (l: Locator) => (await l.boundingBox())!;
const visible = (l: Locator) => l.filter({ visible: true });

/** 札がカードの中に収まり、前と後ろの図の上に重ならない（線は図の上へ伸びる） */
async function expectCalloutsFit(page: Page, figure: Locator, testId = /^day-callout/) {
  const card = await box(figure);
  const figs = await Promise.all(['front', 'back'].map(async (v) => box(figure.getByTestId(new RegExp(`-press-${v}$`)))));
  const callouts = await figure.getByTestId(testId).all();
  expect(callouts.length).toBeGreaterThan(0);
  const rects = await Promise.all(callouts.map(box));
  for (const r of rects) {
    expect(r.x).toBeGreaterThanOrEqual(card.x - 0.5);
    expect(r.x + r.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    expect(r.y + r.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
    for (const f of figs) expect(r.x + r.width <= f.x + 0.5 || r.x >= f.x + f.width - 0.5).toBe(true);
  }
  // 同じ側の札は重ならない
  for (const [i, a] of rects.entries()) {
    for (const b of rects.slice(i + 1)) {
      if (Math.abs(a.x - b.x) > 1) continue;
      expect(a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5).toBe(true);
    }
  }
}

for (const width of [360, 412]) {
  test.describe(`${width} の幅`, () => {
    test.use({ viewport: { width, height: 915 } });

    test('種目が 2 つの日と 6 つの日（三頭筋を含む）：札と番号。三頭筋は後ろの図。読み上げは番号・種目・部位', async ({ page }) => {
      await openApp(page);
      await goTab(page, '筋トレ');
      await addEntry(page, 'ベンチプレス', [{ weight: '70', reps: '10' }, { weight: '80', reps: '8' }]);
      await addEntry(page, '懸垂', [{ reps: '10' }]);
      const figure = visible(page.getByTestId('day-parts-figure'));
      await expect(figure).toHaveAttribute('aria-label', '鍛えた部位の図。1 ベンチプレス 胸、2 懸垂 背中');
      // 前の図の胸の札は左、後ろの図の背中の札は右
      const bench = figure.getByTestId('day-callout').filter({ hasText: 'EX-01' });
      await expect(bench).toContainText('ベンチプレス');
      await expect(bench).toContainText('80kg × 8');
      const pull = figure.getByTestId('day-callout').filter({ hasText: 'EX-02' });
      await expect(pull).toContainText('10回');
      expect((await box(bench)).x).toBeLessThan((await box(pull)).x);
      await expectCalloutsFit(page, figure);
      if (SHOTS) {
        await figure.locator('..').scrollIntoViewIfNeeded();
        await figure.locator('..').screenshot({ path: `${SHOTS}/record-2-${width}.png` });
        await page.screenshot({ path: `${SHOTS}/record-2-${width}-page.png` });
      }

      // 6 種目（前の図に 4、後ろに 2。上腕三頭筋は後ろの図の三頭筋）：札は 6 つ
      await addEntry(page, 'インクラインダンベルプレス', [{ weight: '26', reps: '10' }]);
      await addEntry(page, 'ダンベルフライ', [{ weight: '14', reps: '12' }]);
      await addEntry(page, 'ショルダープレス', [{ weight: '40', reps: '10' }]);
      await addEntry(page, 'ライイングトライセプスエクステンション', [{ weight: '30', reps: '12' }]);
      await expect(figure.getByTestId('day-callout')).toHaveCount(6);
      await expect(figure.getByTestId('day-callout-more')).toHaveCount(0);
      // 三頭筋の札は後ろの図の側（右）。線の先は後ろの図の三頭筋
      const tri = figure.getByTestId('day-callout').filter({ hasText: 'EX-06' });
      expect((await box(tri)).x).toBeGreaterThan((await box(bench)).x);
      await expectCalloutsFit(page, figure);
      if (SHOTS) {
        await figure.locator('..').scrollIntoViewIfNeeded();
        await figure.locator('..').screenshot({ path: `${SHOTS}/record-6-${width}.png` });
        await page.screenshot({ path: `${SHOTS}/record-6-${width}-page.png` });
      }
    });

    test('上腕三頭筋だけの日：後ろの図の三頭筋を塗り、札もそこを指す（右）', async ({ page }) => {
      await openApp(page);
      await goTab(page, '筋トレ');
      await addEntry(page, 'ライイングトライセプスエクステンション', [{ weight: '30', reps: '12' }]);
      const figure = visible(page.getByTestId('day-parts-figure'));
      await expect(figure).toHaveAttribute('aria-label', '鍛えた部位の図。1 ライイングトライセプスエクステンション 上腕三頭筋');
      const tri = figure.getByTestId('day-callout');
      await expect(tri).toHaveCount(1);
      const back = await box(figure.getByTestId('day-parts-figure-press-back'));
      expect((await box(tri)).x).toBeGreaterThanOrEqual(back.x + back.width - 0.5);
      await expectCalloutsFit(page, figure);
      if (SHOTS) {
        await figure.locator('..').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/triceps-${width}.png` });
      }
    });

    test('記録のない日は回復マップ（今日・過去の日・一度も記録がない日）。回復中に札、回復済みの部位をすすめる、前回の1行', async ({ page }) => {
      test.setTimeout(90_000);
      await openApp(page);
      await goTab(page, '筋トレ');
      // 一度も記録がない：色を付けない体の図と、部位から記録
      await expect(see(page, 'まだ記録がありません')).toBeVisible();
      await expect(see(page, '部位を選んで、最初の記録をつけましょう')).toBeVisible();
      const never = visible(page.getByTestId('recovery-hero'));
      await expect(never).toHaveAttribute('aria-label', '体の図');
      await expect(never.getByTestId(/^recovery-callout/)).toHaveCount(0);
      await expect(page.getByTestId('recovery-hero-suggest')).toHaveCount(0);
      await expect(page.getByTestId('previous-line')).toHaveCount(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/never-${width}.png` });

      await recordOn(page, '2026-11-03', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
      await recordOn(page, '2026-11-06', [{ exercise: 'ラットプルダウン', sets: [{ weight: '50', reps: '10' }] }]);
      await recordOn(page, '2026-11-07', [
        { exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] },
        { exercise: 'ライイングトライセプスエクステンション', sets: [{ weight: '30', reps: '12' }] },
      ]);
      await moveToDate(page, TODAY);
      await goTab(page, '筋トレ');
      // 今日：まだ記録がない → 回復マップ。胸・三頭（昨日）と背中（2日前）は回復中、脚（5日前）は回復済み
      await expect(see(page, 'まだ記録がありません')).toBeVisible();
      await expect(see(page, '回復済みの部位から選べます')).toBeVisible();
      const hero = visible(page.getByTestId('recovery-hero'));
      await expect(hero).toHaveAttribute('aria-label', '回復マップ。緑は回復済み、暖色は回復中、灰色は空いている・まだ、赤はケガ。回復中の部位、胸 あと2日、背中 あと2日、上腕三頭筋 あと2日');
      await expect(visible(page.getByTestId('recovery-hero-legend'))).toHaveText('回復済み回復中空いている・まだケガ');
      await expect(hero.getByTestId('recovery-callout')).toHaveCount(3);
      const chest = hero.getByTestId('recovery-callout').filter({ hasText: '胸' });
      await expect(chest).toContainText('あと2日');
      // 胸の札は前の図の左、背中・三頭の札は後ろの図の右
      expect((await box(chest)).x).toBeLessThan((await box(hero.getByTestId('recovery-callout').filter({ hasText: '上腕三頭筋' }))).x);
      await expectCalloutsFit(page, hero, /^recovery-callout/);
      const suggest = visible(page.getByTestId('recovery-hero-suggest'));
      await expect(suggest).toContainText('今日は脚はどう？5日前・回復済み');
      await expect(button(suggest, '脚の種目を選ぶ')).toBeVisible();
      const prev = visible(page.getByTestId('previous-line'));
      await expect(prev).toContainText('前回 11月7日（土） 胸・上腕三頭筋');
      await expect(button(prev, '11月7日（土）と同じメニューで始める')).toBeVisible();
      // 並び：メッセージ → 回復マップ → すすめ → 前回 → 部位から記録
      const msg = await box(visible(page.getByTestId('no-workout')));
      const ys = await Promise.all([hero, suggest, prev, visible(page.getByTestId('recovery-hero-parts'))].map(async (l) => (await box(l)).y));
      expect([msg.y, ...ys]).toEqual([msg.y, ...ys].sort((a, b) => a - b));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/empty-today-${width}.png` });

      // 過去の日（11-05）：この日の記録はない。その日の時点（脚は 2日前で回復中）。写すボタンは出さない
      await button(page, '前の日').click();
      await button(page, '前の日').click();
      await button(page, '前の日').click();
      await expect(see(page, 'この日の記録はありません')).toBeVisible();
      await expect(see(page, 'この日の時点の回復です')).toBeVisible();
      await expect(visible(page.getByTestId('recovery-hero'))).toHaveAttribute('aria-label', '回復マップ。緑は回復済み、暖色は回復中、灰色は空いている・まだ、赤はケガ。回復中の部位、脚 あと2日');
      await expect(page.getByTestId('recovery-hero-suggest')).toHaveCount(0);
      await expect(visible(page.getByTestId('previous-line'))).toHaveText('前回 11月3日（火） 脚');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/empty-past-${width}.png` });
    });
  });
}

test('図の筋肉を押すと近い部位のチップが先頭に。チップで、その部位で絞った種目の選択へ（記録のある日も同じ）', async ({ page }) => {
  await openApp(page);
  await goTab(page, '筋トレ');
  const parts = visible(page.getByTestId('recovery-hero-parts'));
  await expect(parts).toContainText('部位から記録');
  // 後ろの図のもも裏を押す（図の座標 42, 130。図の大きさは幅で変わるので、押す所の大きさから求める）
  const back = visible(page.getByTestId('recovery-hero-press-back'));
  const bb = await box(back);
  await back.click({ position: { x: bb.width * 0.42, y: bb.height * 0.65 } });
  await expect(parts).toContainText('押した所の部位から記録');
  const first = parts.getByRole('button').first();
  await expect(first).toHaveAccessibleName('脚の種目を選ぶ');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  expect((await box(first)).height).toBeGreaterThanOrEqual(48);
  await first.click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^スクワット / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^ベンチプレス / })).toHaveCount(0);
  await page.getByRole('button', { name: /^スクワット / }).click();
  await page.getByLabel('セット1の重量', { exact: true }).fill('100');
  await page.getByLabel('セット1の回数', { exact: true }).fill('5');
  await page.getByRole('button', { name: '今日のトレーニングに追加', exact: true }).click();

  // 記録のある日：前の図の胸を押すと胸と肩、チップ（読み上げの入口）でも同じ所へ
  const figure = visible(page.getByTestId('day-parts-figure'));
  await expect(figure).toHaveAttribute('aria-label', '鍛えた部位の図。1 スクワット 脚');
  const dayParts = visible(page.getByTestId('day-parts-figure-parts'));
  await visible(page.getByTestId('day-parts-figure-press-front')).click({ position: { x: 27.5, y: 29.2 } });
  await expect(dayParts.locator('[aria-selected="true"]')).toHaveCount(2);
  await expect(dayParts.getByRole('button').first()).toHaveAccessibleName('胸の種目を選ぶ');
  await button(dayParts, '胸の種目を選ぶ').click();
  await expect(see(page, '種目を選ぶ', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^ベンチプレス / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^スクワット / })).toHaveCount(0);
});
