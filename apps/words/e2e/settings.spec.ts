import { expect, Page, test } from '@playwright/test';
import { button, byTest, capture, createFakeSyncServer, goTab, mcpExpression, openApp, routeAudio, setNow, signedInWith } from './helpers';

// 設定へ、どのタブからでも行ける（見出しの右の歯車）。設定の「自然な声（Polly）」がオンになり、聞くでサーバーの声を使う。
// 使えないときは端末の声に戻し、理由を聞くに出す（web は音を出さないが、端末と同じく1つごとに POST /v1/audio を取りにいく）

const toggle = (page: Page) => byTest(page, 'natural-voice');

test('ホーム・拾った・手札・聞くの見出しの歯車から設定へ行け、設定から記録へも行ける', async ({ page }) => {
  await openApp(page);
  for (const tab of ['index', 'collected', 'hand', 'listen'] as const) {
    await goTab(page, tab);
    await byTest(page, `${tab === 'index' ? 'home' : tab}-settings`).click();
    await expect(byTest(page, 'settings-screen')).toBeVisible();
    await button(page, '戻る').click();
  }
  await byTest(page, 'listen-settings').click();
  await byTest(page, 'settings-records').click();
  await expect(byTest(page, 'records-screen')).toBeVisible();
});

test('自然な声のトグルがオンになり、画面を開き直しても残る。ログインしていなければ、聞くは端末の声で理由を出す', async ({ page }) => {
  await openApp(page);
  await capture(page, { text: '腑に落ちる', want: true });
  await byTest(page, 'home-settings').click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await button(page, '戻る').click();
  await byTest(page, 'home-settings').click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await button(page, '戻る').click();

  await goTab(page, 'listen');
  await expect(byTest(page, 'listen-voice')).toHaveText('自然な声を使えないので、端末の声で読んでいます（ログインしていません）');

  // オフに戻すと、理由は消える
  await byTest(page, 'listen-settings').click();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await button(page, '戻る').click();
  await goTab(page, 'index');
  await goTab(page, 'listen');
  await expect(byTest(page, 'listen-voice')).toHaveCount(0);
});

async function signIn(page: Page, context: Parameters<typeof signedInWith>[1]) {
  const server = createFakeSyncServer();
  mcpExpression(server, 1, { text: '腑に落ちる', place: 'hand', due_on: '2026-11-18' });
  mcpExpression(server, 2, { text: '一目置く', place: 'hand', due_on: '2026-11-18' });
  mcpExpression(server, 3, { text: '言わずもがな', place: 'hand', due_on: '2026-11-18' });
  await signedInWith(page, context, server);
  await setNow(page);
  await page.goto('/');
  await byTest(page, 'signin').click();
  await expect(byTest(page, 'home-screen')).toBeVisible();
}

test('オンにすると、聞くを開き直さなくても次の表現からサーバーの声（POST /v1/audio）を使う', async ({ page, context }) => {
  await signIn(page, context);
  const ids = await routeAudio(context, 200);
  await goTab(page, 'listen');
  await expect(byTest(page, 'listen-position')).toHaveText('1 / 3');
  // オフのあいだはサーバーを呼ばない
  await expect(byTest(page, 'listen-mode')).toBeVisible();
  expect(ids).toEqual([]);

  // 聞いている途中で、聞くの歯車から設定を開いてオンにし、戻って次へ
  await byTest(page, 'listen-play').click();
  await byTest(page, 'listen-settings').click();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await button(page, '戻る').click();
  await byTest(page, 'listen-next').click();
  await expect(byTest(page, 'listen-voice')).toHaveText('自然な声（Polly）で読んでいます');
  expect(ids.length).toBeGreaterThan(0);
});

test('自然な声には、設定の区切りのあいだの間（pause）を付けて頼む（ふつうは付けない）', async ({ page, context }) => {
  await signIn(page, context);
  const bodies: { expression_id?: string; pause?: string }[] = [];
  await routeAudio(context, 200, bodies);
  await byTest(page, 'home-settings').click();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await byTest(page, 'pace-pause-long').click();
  await button(page, '戻る').click();
  await goTab(page, 'listen');
  await expect(byTest(page, 'listen-voice')).toHaveText('自然な声（Polly）で読んでいます');
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.every((b) => b.pause === 'long')).toBe(true);
});

test('サーバーが自然な声を作れないときは、端末の声に戻して理由を出す', async ({ page, context }) => {
  await signIn(page, context);
  const ids = await routeAudio(context, 500);
  await byTest(page, 'home-settings').click();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await button(page, '戻る').click();
  await goTab(page, 'listen');
  await expect(byTest(page, 'listen-voice')).toHaveText('自然な声を使えないので、端末の声で読んでいます（サーバーの声を作れませんでした（500））');
  expect(ids.length).toBeGreaterThan(0);
  // 端末の声で鳴らし続けられる
  await byTest(page, 'listen-play').click();
  await expect(byTest(page, 'listen-pause')).toBeVisible();
});
