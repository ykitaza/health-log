import { expect, Page, test } from '@playwright/test';
import { goTab, moveToDate, setBodyInfo } from './helpers';
import { AT, bulkPhase, change, EXERCISE, mcp, openWith, workout } from './seed';

// ホームの並び（ヒーロー → 部位の量 → FUEL → BIG3・LOAD・SLEEP と BODY → LOG → レポート）と、
// 「部位の量」はフェーズの累計（やる気のための見方）、「回復」は今日どこを鍛えるかを決める見方、であること。
// 集計・札の選び方は jest（partVolume.test.ts・heroTags.test.ts）。ここは画面：ブロックの並び、ヒーローの見出しと札（両方の見方）、
// 部位の量の一覧の行、BODY の行、レポートの 1 枚のカード。記録は偽の同期サーバーから入れる。今日は 2026-11-08（日）。
// スクリーンショットは SHOT_DIR を渡したときだけ撮る（このファイルの最後のテスト）

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const BULK = 'ffffffff-0000-4000-8000-0000000000a1';
const INJURY = 'cccccccc-0000-4000-8000-0000000000a1';
const REPORT = 'aaaaaaaa-0000-4000-8000-0000000000a1';

/**
 * 増量 8 週（10/26〜12/20。今日は 14 日目 = 2 週目）。フェーズの累計：
 * 胸 23（ベンチ 14 + 9）、脚 20（スクワット 12 + 8）、背中 16（懸垂）、肩 12、腕 9（カール）、腹 0。合計 80 セット。
 * 脚は昨日、胸は 3 日前、背中は 2 日前、肩は 6 日前（回復済み）、腕は 10/31
 */
const seed = () => [
  bulkPhase(BULK, '2026-10-26', '2026-12-20'),
  ...workout('2026-10-28', EXERCISE.bench, 14), ...workout('2026-11-05', EXERCISE.bench, 9),
  ...workout('2026-10-30', EXERCISE.squat, 12), ...workout('2026-11-07', EXERCISE.squat, 8),
  ...workout('2026-11-02', EXERCISE.shoulderPress, 12), ...workout('2026-11-06', EXERCISE.pullUp, 16),
  ...workout('2026-10-31', EXERCISE.curl, 9),
  // 右肩のケガを直している途中
  change('injury', INJURY, {
    occurred_on: '2026-11-04', site: 'shoulder_joint', side: 'right', exercise_id: EXERCISE.bench, phase: 'ラックアップ', symptom: '肩の前に違和感', cause: '', fix: '',
    status: 'fixing', fixed_on: null,
  }),
  // 体重 76.2kg（目標 80kg まで あと 3.8kg）
  change('body_record', 'bbbbbbbb-0000-4000-8000-0000000000a1', { date: '2026-11-08', measured_at: '2026-11-08T07:00:00+09:00', weight_kg: 76.2, source: 'manual' }),
  // 先週の週のまとめ（次の一歩は 4 つ。ホームは 3 つまで）
  { ...mcp, change_id: crypto.randomUUID(), entity_type: 'report', entity_id: REPORT, op: 'create' as const, changed_at: AT, fields: {
    title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08', overall_tone: 'good', headline: '脚の日が2回に増えた',
    highlights: [{ area: 'training', tone: 'good', text: '脚の日が2回に増えた' }],
    next_steps: ['脚の日を2回入れる', 'たんぱく質を毎日 120g とる', '平日は 23時半までに寝る', 'ここは 4 つ目で出さない'], body: '## 筋トレ\n- 脚が増えた',
  } },
];

test('ホームの並びと、部位の量（フェーズの累計）・回復・BODY・レポートの 1 枚のカード', async ({ page, context }) => {
  test.setTimeout(150_000);
  await openWith(page, context, seed());
  await setBodyInfo(page, { goal: '80' });
  await goTab(page, 'ホーム');
  await moveToDate(page, '2026-11-08');

  const y = async (id: string) => (await visible(page, id).boundingBox())!.y;

  await test.step('ブロックの並び：ヒーロー → 部位の量 → FUEL → 計器の段 → BODY → LOG → レポート', async () => {
    const ids = ['home-hero', 'home-parts', 'home-fuel', 'home-big3', 'home-body', 'home-log', 'home-reports'];
    const ys = [];
    for (const id of ids) ys.push(await y(id));
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(ys).size).toBe(ids.length);
    // 計器の段は 3 つ横並び、BODY はその下の細い 1 行（同じ幅の全幅）
    expect(await y('volume-week')).toBe(await y('home-big3'));
    expect(await y('home-sleep')).toBe(await y('home-big3'));
    const body = (await visible(page, 'home-body').boundingBox())!;
    expect(body.height).toBeLessThan(64);
    // なくしたもの：体調のカード（安静時心拍・睡眠の 2 回目）と、別々の帯・カード
    for (const gone of ['home-condition', 'new-report-banner', 'report-suggestion', 'weekly-todo-card']) await expect(page.getByTestId(gone)).toHaveCount(0);
    await expect(page.getByText('安静時')).toHaveCount(0);
  });

  const mode = visible(page, 'hero-body-mode');
  const caption = visible(page, 'hero-body-caption');
  const tags = visible(page, 'hero-body-tag');
  const tab = (name: string) => mode.getByRole('button', { name, exact: true });

  await test.step('回復：札は回復中の部位の「あと N 日」（今日どこを鍛えるか）。見出しは出さない', async () => {
    await expect(tab('回復')).toHaveAttribute('aria-selected', 'true');
    await expect(caption).toHaveCount(0);
    await expect(tags.first()).toBeVisible();
    expect(await tags.count()).toBeLessThanOrEqual(3);
    for (const t of await tags.allTextContents()) expect(t).toMatch(/あと\d+日$/);
    await expect(visible(page, 'home-latest')).toHaveAttribute('aria-label', /回復中/);
  });

  await test.step('部位の量：見出しは「増量 8週で 80セット」。札は合計の多い 3 つ（胸 23・脚 20・背中 16）で、2 行（部位・「23セット」）。あと・少なめは出さない', async () => {
    await tab('部位の量').click();
    await expect(caption).toHaveText('増量 8週で 80セット');
    await expect(tags).toHaveCount(3);
    await expect(tags.filter({ hasText: '胸' })).toHaveText('胸23セット');
    await expect(tags.filter({ hasText: '脚' })).toHaveText('脚20セット');
    await expect(tags.filter({ hasText: '背中' })).toHaveText('背中16セット');
    await expect(tags.filter({ hasText: 'あと' })).toHaveCount(0);
    await expect(visible(page, 'home-latest')).toHaveAttribute('aria-label', /増量 8週で 80セット、10月26日から11月8日。胸 23 セット、肩 12 セット、背中 16 セット、腕 9 セット、脚 20 セット、腹 0 セット。体の色は 1 週間あたりの量/);
    await expect(visible(page, 'home-latest')).not.toHaveAttribute('aria-label', /回復中/);
    // 部位の量の見方では、一覧の行も同じ数
    await expect(visible(page, 'home-hero')).not.toContainText('少なめ');
  });

  await test.step('部位の量の一覧：図なし。四角・部位・「23セット」（主）・小さな「週12」。あと・少なめ・目安の言葉なし。ケガの ▲ は残る', async () => {
    const card = visible(page, 'home-parts');
    await expect(card).toContainText('増量 8週の部位');
    await expect(card).toContainText('10/26–11/8');
    await expect(card.getByTestId('home-parts-body-figure-front')).toHaveCount(0);
    // 週あたり = 合計 ÷ 2 週（14 日）：胸 23 → 11.5 → 12、脚 20 → 10、背中 16 → 8、肩 12 → 6、腕 9 → 4.5 → 5、腹 0
    const row = (part: string) => visible(page, `home-parts-body-row-${part}`);
    await expect(row('胸')).toHaveText('胸23セット週12');
    await expect(row('脚')).toHaveText('脚20セット週10');
    await expect(row('背中')).toHaveText('背中16セット週8');
    await expect(row('肩')).toHaveText('肩12セット週6');
    await expect(row('腕')).toHaveText('腕9セット週5');
    await expect(row('腹')).toHaveText('腹0セット週0');
    for (const gone of ['あと', '少なめ', '目安']) await expect(card).not.toContainText(gone);
    await expect(visible(page, 'home-parts-body-injury-肩')).toBeVisible();
    await expect(card).toHaveAttribute('aria-label', /^増量 8週の部位、10月26日から11月8日のセット数。胸 23 セット、週 12。肩 12 セット、週 6、ケガ。/);
  });

  await test.step('体を押した部位は、0 セットでも札が出る（腹 0セット）', async () => {
    const press = visible(page, 'day-body-2d-press-front');
    const box = (await press.boundingBox())!;
    await press.click({ position: { x: box.width * 0.5, y: box.height * 0.36 } }); // 腹のあたり
    await expect(tags.filter({ hasText: '腹' })).toHaveText('腹0セット');
    await expect(tags).toHaveCount(4);
  });

  await test.step('BODY：体重と目標まで。押すとからだのタブ。睡眠・心拍は出さない', async () => {
    const bodyLine = visible(page, 'home-body');
    await expect(bodyLine).toContainText('BODY');
    await expect(bodyLine).toContainText('76.2');
    await expect(bodyLine).toContainText('目標まで あと 3.8 kg');
    await expect(bodyLine).toHaveAttribute('aria-label', '体重 76.2 kg。目標まで あと 3.8 kg。からだのタブを開く');
    await expect(bodyLine).not.toContainText('睡眠');
  });

  await test.step('レポートは 1 枚のカード：最新のレポート・新しいレポートのお知らせの行・今週やること（3 つまで）', async () => {
    const card = visible(page, 'home-reports');
    await expect(card.getByRole('heading', { name: 'レポート', exact: true })).toBeVisible();
    await expect(card.getByTestId(`report-${REPORT}`)).toBeVisible();
    await expect(card.getByTestId('home-report-new')).toContainText('新しいレポートが 1 件');
    await expect(card.getByRole('button', { name: '新しいレポートを見る' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'お知らせを閉じる。今出ている分は、見たことにします' })).toBeVisible();
    await expect(card.getByTestId('latest-report').getByRole('button', { name: /チャットで作る/ })).toBeVisible();
    const todo = card.getByTestId('weekly-todo');
    await expect(todo).toContainText('今週やること');
    await expect(todo.getByRole('checkbox')).toHaveCount(3);
    await expect(todo).toContainText('0／3');
    await expect(todo.getByRole('button', { name: '週のまとめで、来週の焦点を見る' })).toBeVisible();
    // 最新のレポート → お知らせ → 今週やること の順
    const ys = [await card.getByTestId(`report-${REPORT}`).boundingBox(), await card.getByTestId('home-report-new').boundingBox(), await todo.boundingBox()];
    expect(ys[0]!.y).toBeLessThan(ys[1]!.y);
    expect(ys[1]!.y).toBeLessThan(ys[2]!.y);
    // 記録する（FAB）は残る
    await expect(page.getByRole('button', { name: '記録する' }).filter({ visible: true })).toBeVisible();
  });
});

// 見た目の確認（スクリーンショット）：SHOT_DIR を渡したときだけ撮る。412 の幅で、全体（スクロールの全部）と、ヒーローの近く
test('ホームの全体とヒーローを撮る（SHOT_DIR）', async ({ page, context }) => {
  test.skip(!process.env.SHOT_DIR, 'SHOT_DIR を渡したときだけ撮る');
  test.setTimeout(150_000);
  const dir = process.env.SHOT_DIR!;
  await openWith(page, context, seed());
  await setBodyInfo(page, { goal: '80' });
  await goTab(page, 'ホーム');
  await moveToDate(page, '2026-11-08');
  const mode = visible(page, 'hero-body-mode');
  const hero = visible(page, 'hero-swipe');

  // ページの中身がすべて入る高さまで、画面を縦に伸ばす（スクロールの中の画面なので、そのままでは 1 画面ぶんしか写らない）
  const full = async (name: string) => {
    const h = await page.evaluate(() => {
      let best = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
        const st = getComputedStyle(el);
        if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) best = Math.max(best, el.scrollHeight);
      }
      return best;
    });
    await page.setViewportSize({ width: 412, height: Math.max(915, h + 120) });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/${name}.png` });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForTimeout(400);
  };

  await mode.getByRole('button', { name: '部位の量', exact: true }).click();
  await page.waitForTimeout(800);
  await hero.screenshot({ path: `${dir}/hero-volume.png` });
  await full('home-full-volume');
  await mode.getByRole('button', { name: '回復', exact: true }).click();
  await page.waitForTimeout(800);
  await hero.screenshot({ path: `${dir}/hero-recovery.png` });
  await full('home-full-recovery');
});
