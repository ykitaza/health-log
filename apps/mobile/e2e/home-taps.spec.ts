import { expect, Locator, Page, test } from '@playwright/test';
import { button, expectTrainingDay, goTab, moveToDate, recordOn, see, swipe, tab, TODAY } from './helpers';

// ホームの押せるもの（#219）：見た目が押せるものは押せる。グラフを見せたら、行き先にもそのグラフがある。
// - 計器の段：BIG3 は推移の BIG3、LOAD は推移の総負荷量を日ごと（今週と先週の日ごとの棒）、部位の量（PARTS）は推移の部位のバランスを、覚えている期間のままで。
//   BIG3・LOAD・FUEL の行き先には、ホームと同じカードがあり、そこまでスクロールする（SLEEP は home-phase.spec.ts。睡眠を同期で入れる）
// - LATEST の四隅：日付・種目の数・合計負荷量はその日の記録、自己ベストは 1 種目ならその種目の推移
// - 体の札は部位の札（回復中・目安から外れた部位。押しても何も開かない）。種目の札（EX-01〜）はヒーローの体から外した。体を押して部位の札を足すのは part-volume.spec.ts
// INJURY・GROWTH の四隅とケガの札は home-phase.spec.ts（フェーズと療養の記録を同期で作る）

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const pane = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).filter({ visible: true });

/**
 * - 10/5  スクワット 100×5（2週の外）
 * - 11/3  スクワット 100×5
 * - 11/8（今日）ベンチ 60×10 → スクワット 110×5（自己ベスト）→ デッドリフト 120×5 → ショルダープレス 30×10
 */
async function seed(page: Page) {
  await recordOn(page, '2026-10-05', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  await recordOn(page, '2026-11-03', [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
  await recordOn(page, TODAY, [
    { exercise: 'ベンチプレス', sets: [{ weight: '60', reps: '10' }, { weight: '60', reps: '10' }, { weight: '60', reps: '10' }] },
    { exercise: 'スクワット', sets: [{ weight: '110', reps: '5' }, { weight: '110', reps: '5' }] },
    { exercise: 'デッドリフト', sets: [{ weight: '120', reps: '5' }] },
    { exercise: 'ショルダープレス', sets: [{ weight: '30', reps: '10' }] },
  ]);
  await moveToDate(page, TODAY);
}

/** 上の端が画面の上のほう（スクロールして見せた）で、全体が見えている */
async function expectScrolledTo(target: ReturnType<typeof visible>) {
  await expect(target).toBeInViewport({ ratio: 0.9 });
  await expect.poll(async () => (await target.boundingBox())?.y ?? 9999).toBeLessThan(300);
}

/** 行き先のカードは、ホームの計器と同じ文字と読み上げ（行き先では押せないので「…を開く」がない）。ホームの計器は押す前に読む */
async function gaugeOf(home: Locator) {
  return { text: (await home.textContent())!, label: (await home.getAttribute('aria-label'))!.replace(/。[^。]+を開く$/, '') };
}
async function expectSameGauge(dest: Locator, home: { text: string; label: string }) {
  await expect(dest).toHaveText(home.text);
  await expect(dest).toHaveAttribute('aria-label', home.label);
  await expect(dest).not.toHaveAttribute('role', 'button');
}

async function backHome(page: Page) {
  await goTab(page, 'ホーム');
  await expect(visible(page, 'home-latest')).toBeVisible();
}

test('ホームの体の札・LATEST の四隅・計器の段を押すと、その日・そのグラフへ', async ({ page }) => {
  await seed(page);
  const latest = visible(page, 'home-latest');
  await expect(latest).toContainText('TODAY');

  await test.step('体の札は種目の札ではない（EX-01〜は出ない）。部位の札は押しても記録を開かない', async () => {
    await expect(visible(page, 'day-body-tag')).toHaveCount(0);
    const tags = visible(page, 'hero-body-tag');
    await expect(tags).toHaveCount(3); // 回復中の 4 部位（脚 あと4日・背中 あと4日・胸 あと3日・肩 あと3日）のうち、あと日数の大きい 3 つ
    await expect(tags.filter({ hasText: '脚' })).toHaveText('脚あと4日');
    await tags.first().click({ force: true });
    await expect(tab(page, 'ホーム')).toHaveAttribute('aria-selected', 'true');
    await expect(latest).toBeVisible();
  });

  await test.step('札や四隅からの横のなぞりは、押したことにならず、ヒーローのページの切り替え（押すのは短いタップだけ）', async () => {
    await backHome(page);
    for (const from of [visible(page, 'hero-body-tag').first(), visible(page, 'home-latest-ex')]) {
      await expect(visible(page, 'hero-page-latest')).toHaveAttribute('aria-selected', 'true');
      await swipe(from, 'next');
      await expect(visible(page, 'hero-page-growth')).toHaveAttribute('aria-selected', 'true');
      await expect(tab(page, 'ホーム')).toHaveAttribute('aria-selected', 'true');
      await visible(page, 'hero-page-latest').click();
    }
  });

  await test.step('LATEST の四隅：日付・種目の数・合計負荷量はその日の記録', async () => {
    for (const id of ['home-latest', 'home-latest-ex', 'home-latest-load']) {
      await backHome(page);
      await visible(page, id).click();
      await expectTrainingDay(page, '11月8日（日）');
    }
    await backHome(page);
    await expect(visible(page, 'home-latest-ex')).toHaveAccessibleName('4種目 7セット。その日の記録を開く');
    await expect(visible(page, 'home-latest-load')).toHaveAccessibleName('合計負荷量 3.80トン。その日の記録を開く');
  });

  await test.step('PR：自己ベストが 1 種目なら、その種目の推移（推定1RM の折れ線）', async () => {
    const pr = visible(page, 'home-latest-pr');
    await expect(pr).toHaveAccessibleName('自己ベスト 1（スクワット）。スクワットの推移を開く');
    await pr.click();
    await expect(pane(page, '推移')).toHaveAttribute('aria-selected', 'true');
    await expect(button(page, 'スクワット')).toHaveAttribute('aria-selected', 'true');
    await expect(see(page, 'スクワットの推定1RM', { exact: true })).toBeInViewport();
  });

  await test.step('LOAD：推移の「すべて」の、ホームと同じカードと、総負荷量を日ごとで（覚えた「週」は書き換えない）', async () => {
    await backHome(page);
    const home = await gaugeOf(visible(page, 'volume-week'));
    expect(home.label).toBe('今週の合計負荷量 4.30トン');
    await visible(page, 'volume-week').click();
    await expect(pane(page, '推移')).toHaveAttribute('aria-selected', 'true');
    // 前の手順で選んだ種目から「すべて」に戻す
    await expect(button(page, 'すべて')).toHaveAttribute('aria-selected', 'true');
    await expect(button(page, '日')).toHaveAttribute('aria-selected', 'true');
    await expect(visible(page, 'volume-chart-day')).toBeVisible();
    // ホームと同じ BIG3・LOAD の段が上の端に来る（総負荷量のグラフはその下に残す）
    await expectScrolledTo(visible(page, 'trend-gauges'));
    await expectSameGauge(visible(page, 'trend-load-gauge'), home);
    await expect(visible(page, 'trend-volume')).toBeAttached();
    // 下のタブで開き直すと、覚えた「週」
    await goTab(page, 'ホーム');
    await goTab(page, '筋トレ');
    await expect(button(page, '週')).toHaveAttribute('aria-selected', 'true');
  });

  await test.step('部位の量（PARTS）：推移の部位のバランスを、覚えている期間（2週）のままで', async () => {
    await backHome(page);
    await expect(visible(page, 'home-parts')).toHaveAttribute('aria-label', /^直近4週の部位、10月12日から11月8日。/);
    await visible(page, 'home-parts').click();
    await expect(pane(page, '推移')).toHaveAttribute('aria-selected', 'true');
    const card = visible(page, 'trend-part-balance');
    await expect(card).toHaveAttribute('aria-label', '部位のバランス、直近2週のセット数。胸 3、肩 1、背中 1、腕 0、脚 3、腹 0');
    await expect(button(page, '2週')).toHaveAttribute('aria-selected', 'true');
    await expectScrolledTo(card);
    // 期間を選ぶと、ふつうの切り替えに戻る
    await button(page, '3か月').click();
    await expect(card).toHaveAttribute('aria-label', /^部位のバランス、直近3か月のセット数。/);
  });

  await test.step('BIG3：推移の、ホームと同じカードと BIG3 の推定1RM', async () => {
    await backHome(page);
    const home = await gaugeOf(visible(page, 'home-big3'));
    await visible(page, 'home-big3').click();
    await expect(tab(page, '筋トレ')).toHaveAttribute('aria-selected', 'true');
    await expectScrolledTo(visible(page, 'trend-gauges'));
    await expectSameGauge(visible(page, 'trend-big3-gauge'), home);
    // BIG3 と LOAD は 1 つの段に、同じ幅で並ぶ
    const [b, l] = [(await visible(page, 'trend-big3-gauge').boundingBox())!, (await visible(page, 'trend-load-gauge').boundingBox())!];
    expect(Math.abs(b.y - l.y)).toBeLessThan(1);
    expect(Math.abs(b.width - l.width)).toBeLessThan(1);
    await expect(visible(page, 'trend-big3-gauge').locator('svg polyline')).toHaveCount(1);
    await expect(see(page, 'BIG3 の推定1RM（合計）', { exact: true })).toBeInViewport();
  });

  await test.step('FUEL：食事のタブの記録の、ホームと同じカード。ほかの日を見ていても、来ると今日に戻る', async () => {
    await goTab(page, '食事');
    await button(page, '前の日').click();
    await expect(visible(page, 'meal-fuel')).toHaveAttribute('aria-label', /^11月7日（土）の食事 /);
    await backHome(page);
    const home = await gaugeOf(visible(page, 'home-fuel'));
    await visible(page, 'home-fuel').click();
    await expect(tab(page, '食事')).toHaveAttribute('aria-selected', 'true');
    await expectScrolledTo(visible(page, 'meal-fuel'));
    await expectSameGauge(visible(page, 'meal-fuel'), home);
    await expect(visible(page, 'meal-fuel').locator('circle')).not.toHaveCount(0);
  });
});
