import { expect, test } from '@playwright/test';
import { button, byTest, capture, goTab, openApp } from './helpers';

// 探す（文字と絞り込み）、聞く（大きな再生と前・次、聞いたの記録）、AI で拾うのシート

test('文字で探すと、表現・場面・例文に当たる。場面のタグと硬さで絞れる', async ({ page }) => {
  await openApp(page);
  await capture(page, { text: '気に病むことはない', source: '会話', title: '母と', scene: '落ち込んでいる人に' });
  await capture(page, { text: '急がば回れ', source: '動画', example: '焦らずいこう、急がば回れだよ' });
  await capture(page, { text: '筋がいい', source: '会話', scene: '企画をほめられて' });

  await goTab(page, 'collected');
  await byTest(page, 'open-search').click();
  await expect(byTest(page, 'search-intent')).toContainText('言いたいことから探す');
  await byTest(page, 'search-input').fill('焦らず');
  await expect(byTest(page, 'search-count')).toHaveText('1 件');
  await expect(byTest(page, 'search-row')).toContainText('急がば回れ');
  await byTest(page, 'search-input').fill('ホメラレ'); // カタカナでも、ひらがなの場面に当たる
  await expect(byTest(page, 'search-row')).toContainText('筋がいい');

  // 絞り込み：出会った場所
  await byTest(page, 'search-input').fill('');
  await byTest(page, 'facet-source-会話').click();
  await expect(byTest(page, 'search-count')).toHaveText('2 件');
  await byTest(page, 'add-condition').click();
  await byTest(page, 'facet-話し言葉').click();
  await expect(byTest(page, 'search-count')).toHaveText('0 件');
  await button(page, '硬さ：話し言葉を外す').click();
  await expect(byTest(page, 'search-count')).toHaveText('2 件');
});

test('聞く：手札から並び、再生・次・前で動き、聞き終えたら記録に出る', async ({ page }) => {
  await openApp(page);
  await capture(page, { text: '肩の荷が下りる', want: true });
  await capture(page, { text: '腑に落ちる', want: true });
  await goTab(page, 'listen');
  await expect(byTest(page, 'listen-position')).toHaveText('1 / 2');
  // 同じ優先度の手札は ID の順（サーバーと同じ）なので、どちらが先かはテストでは決めない
  const current = byTest(page, 'listen-current');
  const first = await current.getAttribute('aria-label');
  const second = first === '肩の荷が下りる' ? '腑に落ちる' : '肩の荷が下りる';
  expect([first, second].sort()).toEqual(['肩の荷が下りる', '腑に落ちる'].sort());
  await byTest(page, 'listen-play').click();
  await expect(byTest(page, 'listen-pause')).toBeVisible();
  await byTest(page, 'listen-next').click();
  await expect(current).toHaveAccessibleName(second);
  await byTest(page, 'listen-prev').click();
  await expect(current).toHaveAccessibleName(first!);
  // 最後まで聞く（web は音を出さず、文の長さの分だけ時計で進める。1つ3秒ほど）
  await expect(current).toHaveAccessibleName(second, { timeout: 15_000 });
  await expect(byTest(page, 'listen-play')).toBeVisible({ timeout: 15_000 });

  await goTab(page, 'collected');
  await byTest(page, 'open-menu').click();
  await byTest(page, 'open-records').click();
  await expect(byTest(page, 'records-listen')).toContainText('2 語');
});

test('AI で拾う：決まった文だけを入れて Claude を開く。場所は初期の5つのときだけ文に入る', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = ((url: string) => { w.__opened.push(url); return null; }) as typeof window.open;
  });
  await openApp(page);
  await byTest(page, 'source-紙の本').click();
  await byTest(page, 'capture-text').fill('私だけの言葉');
  await byTest(page, 'ai-capture').click();
  await expect(byTest(page, 'chat-prompt')).toContainText('紙の本で出会ったものです。');
  await byTest(page, 'chat-open-claude').click();
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(1);
  expect(opened[0].startsWith('https://claude.ai/new?q=')).toBe(true);
  expect(decodeURIComponent(opened[0])).not.toContain('私だけの言葉');
});
