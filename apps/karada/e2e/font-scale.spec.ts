import { expect, Page, test } from '@playwright/test';
import { button, chooseExercise, goTab, see } from './helpers';
import { change, EXERCISE, openWith, workout } from './seed';

// 端末の文字の大きさ 130%・200%（#323）で、360 の幅の主な画面（ホーム・筋トレの記録・食事の記録・レポート）が崩れないか。
// Android は文字（sp）を OS が大きくするが、web の書き出しは px のままなので、globalThis.__KARADA_FONT_SCALE__ で
// 文字と入力欄の文字を同じ倍率で大きくしてまねる（lib/textSize の WEB_FONT_SCALE。グラフの軸の文字は大きくしない。Android の 200% の
// 非線形の縮め方はまねない、近似）。確かめるのは粗く：文字が画面の左右からはみ出して切れていないこと（横にスクロールする列は除く）と、
// 主なボタンが見えること。SHOT_DIR を渡すと、各画面を撮る（<SHOT_DIR>/font-<見た目>-<倍率>-<画面>.png）
test.use({ viewport: { width: 360, height: 800 } });

const REPORT = 'aaaaaaaa-0000-4000-8000-0000000003a1';
const seed = () => [
  ...workout('2026-11-06', EXERCISE.squat, 3),
  ...workout('2026-11-08', EXERCISE.bench, 3),
  change('report', REPORT, {
    title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08', overall_tone: 'caution',
    headline: '睡眠が短い日が多かった',
    highlights: [
      { area: 'sleep', tone: 'caution', text: '6時間を切る日が3日', metric: { label: '睡眠（平均）', value: 5.8, unit: '時間', delta: -0.6, delta_good: false } },
      { area: 'training', tone: 'good', text: '脚の日が2回に増えた' },
    ],
    next_steps: ['平日は 23時半までに寝る'],
    body: '## 睡眠\n- **木曜と金曜**に短い',
  }),
];

/** 画面の左右からはみ出して切れている文字（横にスクロールする列の中と、隠れた画面は数えない） */
const clipped = (page: Page) => page.evaluate(() => {
  const w = window.innerWidth;
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('div[dir="auto"], span, input'))) {
    if (el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight * 4) continue;
    if (r.right <= w + 1 && r.left >= -1) continue;
    // ボタン（components/ui の Button）の 1 行の文字は、Android では adjustsFontSizeToFit で枠に収まるまで小さくなる（web は小さくならない）。
    // ボタンの文字は数えず、ボタンの枠が画面の中にあるかを見る
    const btn = el.closest<HTMLElement>('[role="button"]');
    if (btn && btn !== el) {
      const b = btn.getBoundingClientRect();
      if (b.right <= w + 1 && b.left >= -1) continue;
    }
    let scroller = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const st = getComputedStyle(p);
      if ((st.overflowX === 'auto' || st.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) { scroller = true; break; }
    }
    // 中身のない入れ物・左右へ動く途中のもの（スワイプのページ）は数えない。文字のある葉だけ
    const text = (el.tagName === 'INPUT' ? (el as HTMLInputElement).value : el.childElementCount === 0 ? el.textContent ?? '' : '').trim();
    if (!scroller && text) out.push(`${text} [${Math.round(r.left)}〜${Math.round(r.right)}]`);
  }
  return out;
});

/** 12px より小さい和文（かな・漢字を含む文字の葉。隠れた画面は数えない）。クラシックの 100% で見る（#323） */
const smallJa = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('div[dir="auto"], span'))) {
    if (el.closest('[aria-hidden="true"]') || el.childElementCount > 0) continue;
    const text = (el.textContent ?? '').trim();
    if (!/[぀-ヿ一-鿿]/.test(text)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 12) out.push(`${text} ${size}px`);
  }
  return out;
});

/** 「…」で切れている文字（数えるだけ。PR に残すための一覧。確かめには使わない） */
const truncated = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('div[dir="auto"]'))) {
    if (el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const st = getComputedStyle(el);
    if (st.textOverflow === 'ellipsis' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) out.push((el.textContent ?? '').trim());
  }
  return out;
});

async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR;
  if (!dir) return;
  // スクロールの中の画面なので、中身がすべて入る高さまで画面を縦に伸ばして撮る
  const h = await page.evaluate(() => {
    let best = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) best = Math.max(best, el.scrollHeight);
    }
    return best;
  });
  await page.setViewportSize({ width: 360, height: Math.max(800, h + 120) });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${name}.png` });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(300);
}

for (const look of ['hud', 'classic'] as const) {
  // 100% のクラシックは、和文を 12px に上げた（#323）あとも 360 の幅で切れないかを見る
  for (const scale of look === 'classic' ? [1, 1.3, 2] : [1.3, 2]) {
    const tag = `${look}-${Math.round(scale * 100)}`;
    test(`文字 ${Math.round(scale * 100)}%・${look === 'hud' ? 'HUD' : 'クラシック'}：360 の幅で、ホーム・筋トレの記録・食事の記録・レポートの文字が左右で切れず、主なボタンが見える`, async ({ page, context }) => {
      test.setTimeout(150_000);
      await page.addInitScript(([s, l]) => {
        (globalThis as { __KARADA_FONT_SCALE__?: number }).__KARADA_FONT_SCALE__ = s as number;
        if (l === 'classic') localStorage.setItem('appearance.look', 'classic');
      }, [scale, look] as const);
      await openWith(page, context, seed());
      const check = async (screen: string) => {
        expect(await clipped(page)).toEqual([]);
        if (look === 'classic' && scale === 1) expect(await smallJa(page)).toEqual([]);
        const cut = await truncated(page);
        if (cut.length > 0) test.info().annotations.push({ type: `truncated ${tag} ${screen}`, description: cut.join(' | ') });
        await shot(page, `font-${tag}-${screen}`);
      };

      await test.step('ホーム', async () => {
        await goTab(page, 'ホーム');
        await expect(button(page, '記録する')).toBeVisible();
        await check('home');
      });

      await test.step('筋トレの記録', async () => {
        await goTab(page, '筋トレ');
        await button(page, '種目を追加').click();
        await chooseExercise(page, 'デッドリフト');
        await expect(page.getByLabel('セット1の重量')).toBeVisible();
        await expect(button(page, '今日のトレーニングに追加')).toBeVisible();
        await check('workout-entry');
        await button(page, '戻る').click();
      });

      await test.step('食事の記録', async () => {
        await goTab(page, '食事');
        await button(page, '昼食を記録').click();
        await button(page, '品目を入力').click();
        await expect(see(page, '品目を入力', { exact: true })).toBeVisible();
        await expect(button(page, '記録する')).toBeVisible();
        await check('meal-new');
        await button(page, '戻る').click();
      });

      await test.step('レポート', async () => {
        await goTab(page, 'レポート');
        await expect(page.getByTestId('report-period-tabs').filter({ visible: true })).toBeVisible();
        await check('report');
      });
    });
  }
}
