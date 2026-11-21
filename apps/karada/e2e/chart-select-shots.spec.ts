import { expect, Page, test } from '@playwright/test';
import { button, goPane, goTab, openMealWeek, see } from './helpers';
import { change, EXERCISE, openWith, workout } from './seed';

// グラフの棒を押して選んだ札の見た目（#327）と、期間の切り替え（#336）を 360 の幅で撮る（HUD とクラシック）。
// SHOT_DIR を渡したときだけ撮る。押したときの動きは trend.spec.ts（総負荷量）と home-phase.spec.ts（睡眠）
test.use({ viewport: { width: 360, height: 800 } });

const sleeps = ([['2026-11-08', 450], ['2026-11-07', 380], ['2026-11-06', 410], ['2026-11-05', 420], ['2026-11-04', 335], ['2026-11-03', 465], ['2026-11-02', 300]] as const)
  .map(([date, min], i) => change('sleep_session', `aaaa0000-0000-4000-8000-00000000010${i}`, {
    date, start_at: `${date}T00:${String(10 + i * 5).padStart(2, '0')}:00+09:00`, end_at: `${date}T07:00:00+09:00`, asleep_min: min, awake_min: 0, source: 'health_connect',
  }));

const meal = (date: string, n: number, kcal: number, p: number, f: number, c: number) => {
  const id = `dddddddd-0000-4000-8000-00000000010${n}`;
  return [
    change('meal', id, { date, slot: 'lunch', time: '12:00', description: '定食', source: 'text' }),
    { ...change('meal_item', `${id}-i1`, { name: '定食', amount: 1, unit: '個', kcal, protein_g: p, fat_g: f, carbs_g: c, confidence: 'high', sort_order: 0 }), parent_id: id },
  ];
};

const data = [
  ...sleeps,
  ...workout('2026-11-03', EXERCISE.bench, 5), ...workout('2026-11-03', EXERCISE.shoulderPress, 3),
  ...workout('2026-11-05', EXERCISE.squat, 5), ...workout('2026-11-07', EXERCISE.pullUp, 4), ...workout('2026-11-07', EXERCISE.curl, 3),
  ...workout('2026-10-28', EXERCISE.bench, 4), ...workout('2026-10-21', EXERCISE.squat, 6),
  ...meal('2026-11-03', 1, 2100, 120, 60, 260), ...meal('2026-11-04', 2, 1850, 100, 55, 230), ...meal('2026-11-06', 3, 2400, 140, 70, 300),
  ...meal('2026-11-07', 4, 2250, 130, 65, 280), ...meal('2026-11-08', 5, 1500, 90, 40, 190),
];

async function shoot(page: Page, name: string, target: ReturnType<Page['getByTestId']>) {
  // 札の下の端を画面の下にそろえ、上のグラフも入れる
  await expect(target).toBeVisible();
  await target.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

for (const look of ['hud', 'classic'] as const) {
  test(`グラフの選んだ札と期間の切り替えを撮る（${look}、SHOT_DIR）`, async ({ page, context }) => {
    test.skip(!process.env.SHOT_DIR, 'SHOT_DIR を渡したときだけ撮る');
    test.setTimeout(120_000);
    if (look === 'classic') await page.addInitScript(() => localStorage.setItem('appearance.look', 'classic'));
    await openWith(page, context, data);

    // 睡眠の推移：期間の切り替え（3か月）と、選んだ棒の札
    await goTab(page, 'からだ');
    await goPane(page, '推移');
    await page.getByTestId('sleep-week').filter({ visible: true }).click();
    await expect(see(page, '睡眠の推移', { exact: true })).toBeVisible();
    await button(page, '3か月').click();
    await expect(button(page, '3か月')).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: `${process.env.SHOT_DIR}/${look}-period-360.png`, clip: { x: 0, y: 0, width: 360, height: 400 } });
    await button(page, '1か月').click();
    await page.getByRole('button', { name: '11月4日（水） 5時間35分', exact: true }).filter({ visible: true }).click();
    await shoot(page, `${look}-sleep-360`, page.getByTestId('sleep-chart-detail').filter({ visible: true }));
    await button(page, '戻る').click();

    // 筋トレの推移：総負荷量の週と日
    await goTab(page, '筋トレ');
    await goPane(page, '推移');
    await button(page, '週').click();
    await page.getByRole('button', { name: /^11月2日からの週 /, exact: false }).filter({ visible: true }).click();
    await shoot(page, `${look}-training-week-360`, page.getByTestId('volume-week-detail').filter({ visible: true }));
    await button(page, '日').click();
    await page.getByRole('button', { name: /^11月7日（土） /, exact: false }).filter({ visible: true }).click();
    await shoot(page, `${look}-training-day-360`, page.getByTestId('volume-day-detail').filter({ visible: true }));

    // 食事の推移：週の kcal
    await openMealWeek(page);
    await page.getByRole('button', { name: /^11月6日（金） /, exact: false }).filter({ visible: true }).click();
    await shoot(page, `${look}-meals-week-360`, page.getByTestId('meal-kcal-detail').filter({ visible: true }));
  });
}
