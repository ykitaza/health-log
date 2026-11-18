import { expect, Page, test } from '@playwright/test';
import { button, byTest, createFakeSyncServer, goTab, mcpExpression, setNow, signedInWith } from './helpers';

// 画面の写し（PR に貼るもの）。SHOTS_DIR があるときだけ流す（CI では流さない）
const DIR = process.env.SHOTS_DIR;
test.skip(!DIR, 'SHOTS_DIR があるときだけ');

const KINDLE = 'a109a3dc-f225-52aa-bf2d-ecb3e3b3640d';
const AUDIBLE = '24892adf-fd1d-5589-9062-d28dfd19e755';
const TALK = '165b9d87-a526-5a6c-a5fc-b626c218babf';
const VIDEO = '3a710c88-d0ae-5036-b7fe-7a383f0a6fe3';
const CHAT = 'c017b117-0d7d-5e2e-86e8-8b3c9590f92f'; // 雑談で
const CHEER = '468ef762-a375-555a-9987-acb91ff8de1f'; // 励ます

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/${name}.png` });
};

test('画面の写し', async ({ page, context }) => {
  test.setTimeout(120_000);
  const server = createFakeSyncServer();
  mcpExpression(server, 1, {
    text: '腑に落ちる', reading: 'ふにおちる', meaning: '説明や出来事に、心から納得する。頭でわかるだけでなく、気持ちのうえでもすっと受け入れられる感じ',
    scene: '辞書づくりの部署に来たばかりの主人公が、先輩の説明を聞いて納得する場面', source_id: KINDLE, title: '舟を編む',
    surrounding_text: '長い説明を聞き終えて、彼はようやく腑に落ちたという顔をした。', wording: '腑に落ちた', place: 'hand', due_on: '2026-11-18',
    examples: ['先輩のひと言で、ようやく腑に落ちた。', '理屈はわかるけれど、どうも腑に落ちない。'], similar: ['合点がいく', '得心する'], register: 'spoken',
    tag: { id: CHAT, status: 'proposed' }, star: true, created: '2026-11-15T01:00:00.000Z',
  });
  mcpExpression(server, 2, { text: '言わずもがな', scene: '', source_id: AUDIBLE, title: '街とその不確かな壁', place: 'hand', due_on: '2026-11-18', created: '2026-11-16T01:00:00.000Z' });
  mcpExpression(server, 3, { text: 'とりとめのない', scene: '夢の話をする場面', source_id: AUDIBLE, title: '街とその不確かな壁', created: '2026-11-16T02:00:00.000Z' });
  mcpExpression(server, 4, { text: '筋がいい', scene: '企画をほめられて。言われてうれしかった', source_id: TALK, title: '編集の田中さん', place: 'hand', use_count: 1, stage: 'used', star: true, created: '2026-11-16T03:00:00.000Z', tag: { id: CHEER, status: 'confirmed' } });
  mcpExpression(server, 5, { text: '身につまされる', scene: '', source_id: VIDEO, title: 'PERFECT DAYS', place: 'hand', due_on: '2026-11-22', created: '2026-11-10T03:00:00.000Z' });
  mcpExpression(server, 6, { text: '気に病むことはない', scene: '落ち込んでいる人に', source_id: TALK, title: '母と', place: 'own', use_count: 2, created: '2026-11-05T03:00:00.000Z', tag: { id: CHEER, status: 'confirmed' }, register: 'spoken' });
  mcpExpression(server, 7, { text: '一目置く', scene: '', source_id: KINDLE, title: '舟を編む', created: '2026-11-17T03:00:00.000Z' });

  await page.setViewportSize({ width: 412, height: 915 });
  await signedInWith(page, context, server);
  await setNow(page);
  await page.goto('/');
  await shot(page, '01-signin');
  await byTest(page, 'signin').click();
  await expect(byTest(page, 'capture-screen')).toBeVisible();
  await expect(byTest(page, 'recent-row').first()).toBeVisible();

  // 書き留める（手がかりを開いて）
  await byTest(page, 'source-Audible').click();
  await byTest(page, 'capture-title').fill('『街とその不確かな壁』 村上春樹');
  await byTest(page, 'capture-text').fill('肩の荷が下りる');
  await byTest(page, 'capture-scene').fill('役目を譲った場面の、ほっとした感じ');
  await shot(page, '02-capture');
  await byTest(page, 'capture-hints').click();
  await byTest(page, 'hint-安堵').click();
  await shot(page, '03-capture-hints');
  await byTest(page, 'capture-save').click();
  await expect(byTest(page, 'capture-notice')).toBeVisible();
  await shot(page, '04-capture-saved');
  await byTest(page, 'ai-capture').click();
  await expect(byTest(page, 'chat-sheet')).toBeVisible();
  await shot(page, '05-ai-capture-sheet');
  await page.mouse.click(200, 80); // シートの外（暗いところ）を押して閉じる
  await expect(byTest(page, 'chat-sheet')).toBeHidden();

  await goTab(page, 'collected');
  await shot(page, '06-collected');
  await byTest(page, 'open-search').click();
  await shot(page, '07-search');
  await byTest(page, 'facet-source-会話').click();
  await shot(page, '08-search-results');
  await button(page, '戻る').click();

  await button(page, '腑に落ちる').first().click();
  await expect(byTest(page, 'word-text')).toBeVisible();
  await shot(page, '09-detail');
  await page.mouse.wheel(0, 900);
  await shot(page, '10-detail-tags-examples');
  await button(page, '戻る').click();

  await goTab(page, 'hand');
  await shot(page, '11-hand');
  await goTab(page, 'listen');
  await expect(byTest(page, 'listen-current')).toBeVisible();
  await byTest(page, 'listen-play').click();
  await page.waitForTimeout(1200);
  await shot(page, '12-listen');
  await byTest(page, 'listen-pause').click();

  await goTab(page, 'collected');
  await byTest(page, 'open-menu').click();
  await byTest(page, 'open-records').click();
  await expect(byTest(page, 'records-screen')).toBeVisible();
  await shot(page, '13-records');
  await button(page, '戻る').click();
  await byTest(page, 'open-menu').click();
  await byTest(page, 'open-settings').click();
  await shot(page, '14-settings');
  await byTest(page, 'settings-account').click();
  await shot(page, '15-account');
  await byTest(page, 'open-connect').click();
  await shot(page, '16-connect-ai');
  await button(page, '戻る').first().click();
  await button(page, '戻る').first().click();
  await byTest(page, 'settings-sources').click();
  await shot(page, '17-sources');
});
