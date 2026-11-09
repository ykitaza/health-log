import { expect, Page, test } from '@playwright/test';
import { button, goTab, openApp, openSettings, see } from './helpers';

// チャット（ChatGPT・Claude）を開くショートカット。web では Linking.openURL が window.open を呼ぶので、
// それを見張って、開いた URL（決まった文だけ・エンコード・選んだアプリ）を確かめる

const AI_RECORD = 'AI で記録。ChatGPT か Claude を開きます';
const REPORT_CHAT = 'チャットで作る。ChatGPT か Claude を開きます';
const chatgpt = (q: string) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`;
const claude = (q: string) => `https://claude.ai/new?q=${encodeURIComponent(q)}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[]; __failOpen?: boolean };
    w.__opened = [];
    window.open = (url?: string | URL) => {
      if (w.__failOpen) throw new Error('blocked');
      w.__opened.push(String(url));
      return null;
    };
  });
});

const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
const sheet = (page: Page) => page.getByTestId('chat-sheet').filter({ visible: true });
const appRows = (page: Page) => sheet(page).getByRole('button', { name: /で開く（外のアプリ）$/ });

test('筋トレの「AI で記録」：選んだアプリを今日の文で開き、次は最後に選んだほうを上に出す', async ({ page }) => {
  await openApp(page);
  await goTab(page, '筋トレ');
  await button(page, AI_RECORD).click();
  await expect(see(sheet(page), '「hlog に今日の筋トレを記録して」と入れて開きます')).toBeVisible();
  // 初めは ChatGPT が上
  await expect(appRows(page)).toHaveText(['ChatGPT で開く', 'Claude で開く']);
  await button(page, 'Claude で開く（外のアプリ）').click();
  await expect(sheet(page)).toBeHidden();
  expect(await opened(page)).toEqual([claude('hlog に今日の筋トレを記録して')]);

  await button(page, AI_RECORD).click();
  await expect(appRows(page)).toHaveText(['Claude で開く', 'ChatGPT で開く']);
});

test('過去の日の筋トレは、その日付を文に入れる', async ({ page }) => {
  await openApp(page);
  await page.goto('/workout?date=2026-11-06');
  await button(page, AI_RECORD).click();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  expect(await opened(page)).toEqual([chatgpt('hlog に 11月6日 の筋トレを記録して')]);
});

test('食事の記録の方法に「AI で記録」があり、食事の文で開く', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await button(page, '朝食を記録').click();
  await expect(see(page, '写真や文を送ると、推定して記録します')).toBeVisible();
  await page.getByTestId('meal-ai-record').filter({ visible: true }).click();
  // 区分を選んでいるので、決まった形で区分を入れる
  await expect(see(sheet(page), '「hlog に今日の朝食を記録して」と入れて開きます')).toBeVisible();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  expect(await opened(page)).toEqual([chatgpt('hlog に今日の朝食を記録して')]);
});

test('食事のタブの下の「AI で記録」：今日は日付なし、過去の日はその日付で開く', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await button(page, AI_RECORD).click();
  await expect(see(sheet(page), '「hlog に食事を記録して」と入れて開きます')).toBeVisible();
  await button(page, 'Claude で開く（外のアプリ）').click();
  await expect(sheet(page)).toBeHidden();
  expect(await opened(page)).toEqual([claude('hlog に食事を記録して')]);

  await button(page, '前の日').click();
  await button(page, '前の日').click();
  await button(page, AI_RECORD).click();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  expect(await opened(page)).toEqual([claude('hlog に食事を記録して'), chatgpt('hlog に 11月6日 の食事を記録して')]);
});

test('レポートの「チャットで作る」：期間を選んでから開く（初めは今日）', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('latest-report').getByRole('button', { name: REPORT_CHAT, exact: true }).click();
  await expect(see(sheet(page), '「今日のまとめを作って」と入れて開きます')).toBeVisible();
  await button(sheet(page), '今月').click();
  await expect(see(sheet(page), '「今月のまとめを作って」と入れて開きます')).toBeVisible();
  await button(page, 'Claude で開く（外のアプリ）').click();
  expect(await opened(page)).toEqual([claude('今月のまとめを作って')]);
});

test('開けなかったら、シートの中に案内を出し、もう一方を選べる', async ({ page }) => {
  await openApp(page);
  await goTab(page, '筋トレ');
  await page.evaluate(() => { (window as unknown as { __failOpen: boolean }).__failOpen = true; });
  await button(page, AI_RECORD).click();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  await expect(sheet(page).getByRole('alert')).toHaveText('ChatGPT を開けませんでした。ブラウザで開けるか確かめてください。');
  await expect(button(page, 'Claude で開く（外のアプリ）')).toBeVisible();
  expect(await opened(page)).toEqual([]);
});

test('設定の「チャットとの連携」：つなぎ方と、アプリを開くボタン', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.getByRole('button', { name: /^チャットとの連携/ }).filter({ visible: true }).click();
  await expect(see(page, 'コネクタのつなぎ方', { exact: true })).toBeVisible();
  await button(page, 'Claude を開く').click();
  await button(page, 'ChatGPT を開く').click();
  expect(await opened(page)).toEqual(['https://claude.ai/new', 'https://chatgpt.com/']);
});
