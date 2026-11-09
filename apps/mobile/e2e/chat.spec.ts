import { expect, Page, test } from '@playwright/test';
import { button, goTab, openApp, openSettings, see } from './helpers';

// チャット（ChatGPT・Claude）を開くショートカット。web では Linking.openURL が window.open を呼ぶので、
// それを見張って、開いた URL（決まった文だけ・エンコード・選んだアプリ）を確かめる

const AI_RECORD = 'AI で記録。ChatGPT か Claude を開きます';
const REPORT_CHAT = 'チャットで作る。ChatGPT か Claude を開きます';
const C = 'hlog（健康記録の MCP コネクタ）';
const SAVED = '保存したら、記録した内容を短く見せてください。';
// 開いた URL を、アプリの URL（origin + path）と q の文に分ける。q 以外の引数は入れない
const parse = (url: string) => {
  const u = new URL(url);
  expect([...u.searchParams.keys()]).toEqual(['q']);
  expect(url).toBe(`${u.origin}${u.pathname}?q=${encodeURIComponent(u.searchParams.get('q')!)}`);
  return { app: u.origin + u.pathname, q: u.searchParams.get('q')! };
};
const CHATGPT = 'https://chatgpt.com/';
const CLAUDE = 'https://claude.ai/new';
const training = (when: string, day: string) => `${C}に${when}の筋トレを記録してください。`
  + `これから伝える種目・重さ・回数・セットを list_exercises の一覧と照らし、record_workout（day=${day}）で保存してください。`
  + '一覧にない種目は、add_exercise で足す前に名前と部位を確かめてください。' + SAVED;
const meal = (what: string, args: string) => `${C}に${what}を記録してください。`
  + 'これから送る写真や説明から品目と量を推定してカロリーと PFC を出し、量が分からなければ先に1つだけ質問してください。'
  + `推定を見せて了承を得たら record_meal（${args}）で保存し、推定の根拠を basis に書いてください。` + SAVED;

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
  await expect(see(sheet(page), '今日の筋トレを記録するための文を入れて開きます')).toBeVisible();
  // 初めは ChatGPT が上
  await expect(appRows(page)).toHaveText(['ChatGPT で開く', 'Claude で開く']);
  await button(page, 'Claude で開く（外のアプリ）').click();
  await expect(sheet(page)).toBeHidden();
  expect((await opened(page)).map(parse)).toEqual([{ app: CLAUDE, q: training('今日（11月8日）', '2026-11-08') }]);

  await button(page, AI_RECORD).click();
  await expect(appRows(page)).toHaveText(['Claude で開く', 'ChatGPT で開く']);
});

test('過去の日の筋トレは、その日付を文に入れる', async ({ page }) => {
  await openApp(page);
  await page.goto('/workout?date=2026-11-06');
  await button(page, AI_RECORD).click();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  expect((await opened(page)).map(parse)).toEqual([{ app: CHATGPT, q: training('11月6日', '2026-11-06') }]);
});

test('食事の記録の方法に「AI で記録」があり、食事の文で開く', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await button(page, '朝食を記録').click();
  await expect(see(page, '写真や文を送ると、推定して記録します')).toBeVisible();
  await page.getByTestId('meal-ai-record').filter({ visible: true }).click();
  // 区分を選んでいるので、決まった形で区分を入れる
  await expect(see(sheet(page), '今日の朝食を記録するための文を入れて開きます')).toBeVisible();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  expect((await opened(page)).map(parse)).toEqual([{ app: CHATGPT, q: meal('今日（11月8日）の朝食', 'date=2026-11-08、slot=breakfast') }]);
});

test('食事のタブの下の「AI で記録」：今日は「今日（11月8日）」、過去の日はその日付で開く', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await button(page, AI_RECORD).click();
  await expect(see(sheet(page), '今日の食事を記録するための文を入れて開きます')).toBeVisible();
  await button(page, 'Claude で開く（外のアプリ）').click();
  await expect(sheet(page)).toBeHidden();
  expect((await opened(page)).map(parse)).toEqual([{ app: CLAUDE, q: meal('今日（11月8日）の食事', 'date=2026-11-08') }]);

  await button(page, '前の日').click();
  await button(page, '前の日').click();
  await button(page, AI_RECORD).click();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  expect((await opened(page)).map(parse)).toEqual([
    { app: CLAUDE, q: meal('今日（11月8日）の食事', 'date=2026-11-08') },
    { app: CHATGPT, q: meal('11月6日の食事', 'date=2026-11-06') },
  ]);
});

test('レポートの「チャットで作る」：期間を選んでから開く（初めは今日）', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('latest-report').getByRole('button', { name: REPORT_CHAT, exact: true }).click();
  await expect(see(sheet(page), '今日のまとめを作るための文を入れて開きます')).toBeVisible();
  await button(sheet(page), '今月').click();
  await expect(see(sheet(page), '今月のまとめを作るための文を入れて開きます')).toBeVisible();
  await button(page, 'Claude で開く（外のアプリ）').click();
  const [{ app, q }] = (await opened(page)).map(parse);
  expect(app).toBe(CLAUDE);
  expect(q).toContain(`${C}で11月1日〜今日（11月8日）のまとめを作ってください。`);
  expect(q).toContain('list_workouts と list_meals（start=2026-11-01、end=2026-11-08）');
  expect(q).toContain('heart_rate_summary（days=8）');
  expect(q).toContain('save_report で保存してください（kind=monthly、period_start=2026-11-01、period_end=2026-11-08、');
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
