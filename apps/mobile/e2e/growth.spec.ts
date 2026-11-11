import { expect, Page, test } from '@playwright/test';
import { button, openApp, recordOn, see, TODAY } from './helpers';

// 成長を見る画面（タイムラプス）。web では形（Skia）を描かないので、文字と操作が出ることを見る。
// 再生の位置・前後の日の値のつなぎ方・字幕の選び方・指の量と日の数・数え上がりの計算・累計の文字は jest（lib/__tests__/growthPlayer.test.ts）。
// E2E の時計（Date.now）は止まっているので、再生中の日の数字は確かめず、止めたあと・終わったあとの値を見る

const day = (page: Page) => page.getByTestId('growth-day').filter({ visible: true });
const totals = (page: Page) => page.getByTestId('growth-totals').filter({ visible: true });
const timeline = (page: Page) => page.getByRole('slider', { name: '日を移す', exact: true });
const pausedMark = (page: Page) => page.getByTestId('growth-paused');
const shapeImage = (page: Page, name: string) => page.getByRole('img', { name: new RegExp(`^記録で育つ形（${name}）`) });
const totalsLabel = (t: string, food: number, sleep: number) => `累計。筋トレの負荷量 ${t} トン、食事の目標に届いた日 ${food}日、7時間以上眠った日 ${sleep}日`;
const HINT = 'タップで再生・左右になぞると日を移せます';

async function openGrowth(page: Page) {
  await page.goto('/growth');
  await expect(day(page)).toBeVisible();
}

/** 形のまん中あたりを1回押す（画面全体のタップ） */
async function tapScreen(page: Page) {
  await page.mouse.click(206, 300);
}

/** 画面の (x, 300) から横に dx だけなぞる */
async function dragScreen(page: Page, x: number, dx: number) {
  await page.mouse.move(x, 300);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, 300, { steps: 4 });
  await page.mouse.move(x + dx, 300, { steps: 4 });
  await page.mouse.up();
}

/** 下の線の帯を、左はしから x の位置で押す（x が負なら右はしから） */
async function pressTimeline(page: Page, x: number) {
  const box = await page.getByTestId('growth-timeline').filter({ visible: true }).boundingBox();
  if (!box) throw new Error('線が見えていません');
  await page.mouse.click(x >= 0 ? box.x + x : box.x + box.width + x, box.y + box.height / 2);
}

async function recordTwoDays(page: Page) {
  await recordOn(page, '2026-11-06', [{ exercise: 'ベンチプレス', sets: [{ weight: '80', reps: '8' }] }]);
  await recordOn(page, TODAY, [{ exercise: 'ベンチプレス', sets: [{ weight: '85', reps: '8' }] }]);
}

test.describe('動きを減らす設定がオフ', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('記録がまだないとき：案内の文、DAY 0、線は使えない。タップもなぞるのも何もしない', async ({ page }) => {
    await openApp(page);
    await openGrowth(page);
    await expect(see(page, '記録を始めると、ここから育ちます')).toBeVisible();
    await expect(day(page)).toHaveAttribute('aria-label', 'DAY 0、2026年11月8日（日）');
    await expect(see(page, '今日', { exact: true })).toHaveCount(1); // 線の下の左はし
    await expect(timeline(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(totals(page)).toHaveAttribute('aria-label', totalsLabel('0.0', 0, 0));

    await tapScreen(page);
    await dragScreen(page, 150, 120);
    await pressTimeline(page, 2);
    await expect(day(page)).toHaveAttribute('aria-label', 'DAY 0、2026年11月8日（日）');
    await expect(pausedMark(page)).toHaveCount(0);
    for (const name of ['再生', '一時停止', 'もう一度']) await expect(button(page, name)).toHaveCount(0);
  });

  test('開くと自動で再生。タップで一時停止（初回はヒント）と再生、点の帯で日へ飛ぶ、終わると「もう一度」', async ({ page }) => {
    await recordTwoDays(page);
    await openGrowth(page);

    // 開くと最初の日から再生する（読み上げ用のボタンは「一時停止」）
    await expect(button(page, '一時停止')).toHaveCount(1);
    await expect(pausedMark(page)).toHaveCount(0);

    // 画面を1回押すと一時停止。まん中に一時停止の印、初めてなのでヒント
    await tapScreen(page);
    await expect(button(page, '再生')).toHaveCount(1);
    await expect(pausedMark(page)).toBeVisible();
    await expect(see(page, HINT)).toBeVisible();

    // もう1回押すと再生。印とヒントは消える
    await tapScreen(page);
    await expect(button(page, '一時停止')).toHaveCount(1);
    await expect(pausedMark(page)).toHaveCount(0);
    await expect(see(page, HINT)).toHaveCount(0);

    // 線の帯の左はしを押すと、最初の日へ飛んで止まる
    await pressTimeline(page, 2);
    await expect(day(page)).toHaveAttribute('aria-label', 'DAY 1、2026年11月6日（金）');
    await expect(button(page, '再生')).toHaveCount(1);
    await expect(pausedMark(page)).toBeVisible();
    await expect(totals(page)).toHaveAttribute('aria-label', totalsLabel('0.6', 0, 0));

    // 続きを再生すると、終わりまで行って今日の姿で止まり、「もう一度」が出る（3日は 8秒）
    await tapScreen(page);
    await expect(button(page, 'もう一度')).toBeVisible({ timeout: 15_000 });
    await expect(day(page)).toHaveAttribute('aria-label', 'DAY 3、2026年11月8日（日）');
    // 累計は本当の値まで数え上がって止まる（640 kg ＋ 680 kg）
    await expect(totals(page)).toHaveAttribute('aria-label', totalsLabel('1.3', 0, 0));
    await expect(pausedMark(page)).toHaveCount(0);
    for (const name of ['再生', '一時停止']) await expect(button(page, name)).toHaveCount(0);

    // 「もう一度」で最初から
    await button(page, 'もう一度').click();
    await expect(button(page, '一時停止')).toHaveCount(1);
    await expect(button(page, 'もう一度')).toHaveCount(0);

    // 再生中に「形を選ぶ」を押すと、一時停止してシートを出す
    await button(page, '形を選ぶ').click();
    await expect(page.getByTestId('shape-picker').filter({ visible: true })).toBeVisible();
    await button(page, '閉じる').click();
    await expect(button(page, '再生')).toHaveCount(1);

    // 開き直して一時停止しても、ヒントはもう出ない
    await openGrowth(page);
    await expect(button(page, '一時停止')).toHaveCount(1);
    await tapScreen(page);
    await expect(pausedMark(page)).toBeVisible();
    await expect(see(page, HINT)).toHaveCount(0);
  });
});

test('動きを減らす設定：自動で再生せず今日の姿。タップでは何も起きず、なぞる・点の帯で日を移す', async ({ page }) => {
  await recordTwoDays(page);
  await openGrowth(page);

  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 3、2026年11月8日（日）');
  await expect(see(page, '11月6日', { exact: true })).toBeVisible();
  await expect(see(page, '11月8日', { exact: true })).toBeVisible();
  await expect(totals(page)).toHaveAttribute('aria-label', totalsLabel('1.3', 0, 0));
  // 再生のボタンも「もう一度」も出さない
  for (const name of ['再生', '一時停止', 'もう一度']) await expect(button(page, name)).toHaveCount(0);

  // タップでは何も起きない
  await tapScreen(page);
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 3、2026年11月8日（日）');
  await expect(pausedMark(page)).toHaveCount(0);

  // 左へなぞると前の日へ（3日なら 1日 40dp。100dp で 2日）
  await dragScreen(page, 250, -100);
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 1、2026年11月6日（金）');
  await expect(totals(page)).toHaveAttribute('aria-label', totalsLabel('0.6', 0, 0));

  // 画面の左右の端から始まる指は使わない（Android の「戻る」のため）
  await dragScreen(page, 8, 200);
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 1、2026年11月6日（金）');

  // 線の帯の右はし近く（今日の点のそば）を押すと、その日へ飛んで、その日のハイライトを字幕に出す
  await pressTimeline(page, -16);
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 3、2026年11月8日（日）');
  await expect(see(page, 'ベンチプレス 自己ベスト 107.7 kg')).toBeVisible();

  // 帯のまん中（点から遠い）は、その位置の日
  const box = await page.getByTestId('growth-timeline').filter({ visible: true }).boundingBox();
  await pressTimeline(page, box!.width / 2);
  await expect(day(page)).toHaveAttribute('aria-label', 'DAY 2、2026年11月7日（土）');
});

test('形を選ぶ：シートに3つ並び、木を選ぶと形が変わって閉じる。開き直しても、ホームに戻っても木のまま', async ({ page }) => {
  await openApp(page);
  await button(page, '成長を見る').click();
  await expect(shapeImage(page, '点の軌跡')).toBeVisible();

  // 記録がまだない日にもボタンは出る。押すとシートに3つ並び、最初は点の軌跡を選んでいる
  await button(page, '形を選ぶ').click();
  const sheet = page.getByTestId('shape-picker').filter({ visible: true });
  await expect(see(sheet, '形を選ぶ', { exact: true })).toBeVisible();
  await expect(see(sheet, 'どの形でも、育ち方と衛星の意味は同じです')).toBeVisible();
  const radios = sheet.getByRole('radio');
  await expect(radios).toHaveCount(3);
  const attractor = sheet.getByRole('radio', { name: '点の軌跡。点が増えて形が浮かび、広がる', exact: true });
  const tree = sheet.getByRole('radio', { name: '木。枝が伸び、葉が増え、光の粒が増える', exact: true });
  const galaxy = sheet.getByRole('radio', { name: '銀河。腕が伸び、星が増え、中心が光る', exact: true });
  await expect(attractor).toHaveAttribute('aria-checked', 'true');
  await expect(tree).toHaveAttribute('aria-checked', 'false');
  await expect(galaxy).toHaveAttribute('aria-checked', 'false');

  // 木を選ぶと、形が木になり、シートが閉じる
  await tree.click();
  await expect(shapeImage(page, '木')).toBeVisible();
  await expect(page.getByTestId('shape-picker')).toHaveCount(0);

  // 開き直しても木を選んでいる。外を押して閉じる
  await button(page, '形を選ぶ').click();
  await expect(tree).toHaveAttribute('aria-checked', 'true');
  await expect(attractor).toHaveAttribute('aria-checked', 'false');
  await button(page, '閉じる').click();
  await expect(page.getByTestId('shape-picker')).toHaveCount(0);

  // ホームに戻っても、形の段は木
  await button(page, '戻る').click();
  await expect(button(page, '成長の形（木）。押すと成長を見る画面を開く')).toBeVisible();
  // 開き直しても（端末に置いた値を読む）木のまま
  await page.reload();
  await expect(button(page, '成長の形（木）。押すと成長を見る画面を開く')).toBeVisible();
});
