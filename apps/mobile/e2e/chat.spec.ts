import { expect, Page, test } from '@playwright/test';
import { button, goPane, goTab, homeLatest, moveToDate, openApp, openSettings, recordOn, see } from './helpers';

// チャット（ChatGPT・Claude）を開くショートカット。web では Linking.openURL が window.open を呼ぶので、
// それを見張って、開いた URL（決まった文だけ・エンコード・選んだアプリ）を確かめる

const AI_RECORD = 'AI で記録。ChatGPT か Claude を開きます';
const REPORT_CHAT = 'チャットで作る。ChatGPT か Claude を開きます';
const C = 'KARADA（健康記録の MCP コネクタ）';
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
// 戻るリンクの行き先（lib/auth/config.ts の authzUrl）
const OPEN = 'https://urfpbaok5e.execute-api.ap-northeast-1.amazonaws.com';
const back = (path: string, label = 'KARADA に戻る') => `最後に [${label}](${OPEN}/open/${path}) を押せるリンクの形で添えてください。`;
const training = (when: string, day: string) => `${C}に${when}の筋トレを記録してください。`
  + `これから伝える種目・重さ・回数・セットを list_exercises の一覧と照らし、record_workout（day=${day}）で保存してください。`
  + '一覧にない種目は、add_exercise で足す前に名前と部位を確かめてください。' + SAVED + back(`training?date=${day}`);
const meal = (what: string, args: string, date: string) => `${C}に${what}を記録してください。`
  + 'これから送る写真や説明から品目と量を推定してカロリーと PFC を出し、量が分からなければ先に1つだけ質問してください。'
  + `推定を見せて了承を得たら record_meal（${args}）で保存し、推定の根拠を basis に書いてください。` + SAVED + back(`meals?date=${date}`);

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
// 押したあと、URL を開くのは非同期（最後に選んだアプリを保存してから）。開いた数がそろうのを待ってから読む
const waitOpened = (page: Page, count: number) => expect.poll(async () => (await opened(page)).length).toBe(count);
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
  await waitOpened(page, 1);
  expect((await opened(page)).map(parse)).toEqual([{ app: CLAUDE, q: training('今日（11月8日）', '2026-11-08') }]);

  await button(page, AI_RECORD).click();
  await expect(appRows(page)).toHaveText(['Claude で開く', 'ChatGPT で開く']);
});

test('過去の日の筋トレは、その日付を文に入れる', async ({ page }) => {
  await openApp(page);
  await page.goto('/workout?date=2026-11-06');
  await button(page, AI_RECORD).click();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  await waitOpened(page, 1);
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
  await waitOpened(page, 1);
  expect((await opened(page)).map(parse)).toEqual([{ app: CHATGPT, q: meal('今日（11月8日）の朝食', 'date=2026-11-08、slot=breakfast', '2026-11-08') }]);
});

test('食事のタブの下の「AI で記録」：今日は「今日（11月8日）」、過去の日はその日付で開く', async ({ page }) => {
  await openApp(page);
  await goTab(page, '食事');
  await button(page, AI_RECORD).click();
  await expect(see(sheet(page), '今日の食事を記録するための文を入れて開きます')).toBeVisible();
  await button(page, 'Claude で開く（外のアプリ）').click();
  await expect(sheet(page)).toBeHidden();
  await waitOpened(page, 1);
  expect((await opened(page)).map(parse)).toEqual([{ app: CLAUDE, q: meal('今日（11月8日）の食事', 'date=2026-11-08', '2026-11-08') }]);

  await button(page, '前の日').click();
  await button(page, '前の日').click();
  await button(page, AI_RECORD).click();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  await waitOpened(page, 2);
  expect((await opened(page)).map(parse)).toEqual([
    { app: CLAUDE, q: meal('今日（11月8日）の食事', 'date=2026-11-08', '2026-11-08') },
    { app: CHATGPT, q: meal('11月6日の食事', 'date=2026-11-06', '2026-11-06') },
  ]);
});

test('レポートの「チャットで作る」：期間を選んでから開く（初めは今日）', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('latest-report').getByRole('button', { name: REPORT_CHAT, exact: true }).click();
  await expect(see(sheet(page), '今日のまとめを作るための文を入れて開きます')).toBeVisible();
  await button(sheet(page), '今月').click();
  await expect(see(sheet(page), '今月のまとめを作るための文を入れて開きます')).toBeVisible();
  await button(page, 'Claude で開く（外のアプリ）').click();
  await waitOpened(page, 1);
  const [{ app, q }] = (await opened(page)).map(parse);
  expect(app).toBe(CLAUDE);
  expect(q).toContain(`${C}で今月（11月1日〜今日（11月8日））のまとめを作ってください。`);
  expect(q).toContain('period_overview(start=2026-11-01, end=2026-11-08)を読み');
  expect(q).toContain('目標の見直しを review に、今月の課題を3つまで');
  expect(q).toContain('/open/reports?date=2026-11-08&kind=monthly)');
  expect(q).toContain('save_report(kind=monthly, period_start=2026-11-01, period_end=2026-11-08)で保存してください。');
});

// おすすめの帯（components/ReportSuggestion.tsx）はホームだけに出る（新IAのレポートのタブは詳細へ直行し、帯は置かない）。
// 記録を画面で作るのに時間がかかるので、1回作ってホームの帯とレポートのタブの「レポートを作る」を確かめる
test('まだ作っていないまとめのおすすめ：ホームの帯と、レポートのタブの右下の「レポートを作る」。閉じると出ない', async ({ page }) => {
  // 11月6日（金）・7日（土）に記録し、火曜の11月10日に開く：先週（11月2日〜8日）の週のまとめと、6日・7日の日のまとめがまだ
  await openApp(page, '2026-11-06');
  await recordOn(page, '2026-11-06', [{ exercise: 'ベンチプレス', sets: [{ weight: '60', reps: '10' }] }]);
  await recordOn(page, '2026-11-07', [{ exercise: 'スクワット', sets: [{ weight: '80', reps: '8' }] }]);
  await moveToDate(page, '2026-11-10');

  await test.step('ホームのおすすめ：件数と中身。「作る」でまとめて頼む文を開く', async () => {
    const banner = page.getByTestId('report-suggestion').filter({ visible: true });
    await expect(see(banner, 'まとめがまだ 3 件あります', { exact: true })).toBeVisible();
    await expect(see(banner, '先週の分と、11月6日・7日の分', { exact: true })).toBeVisible();

    await button(banner, 'まとめを作る。ChatGPT か Claude を開きます').click();
    await expect(see(sheet(page), 'チャットで作る', { exact: true })).toBeVisible();
    await expect(see(sheet(page), 'まだのまとめ 3 件を作るための文を入れて開きます')).toBeVisible();
    await button(page, 'Claude で開く（外のアプリ）').click();
    await expect(sheet(page)).toBeHidden();
    await waitOpened(page, 1);
    const [{ app, q }] = (await opened(page)).map(parse);
    expect(app).toBe(CLAUDE);
    expect(q).toBe(`${C}で、まだ作っていないまとめを1件ずつ作り、save_report で保存してください。`
      + '対象は3件：weekly(2026-11-02..2026-11-08), daily(2026-11-06), daily(2026-11-07)。'
      + '期間ごとに period_overview を読み、数字は記録の値だけを使ってください。'
      + '日は明日の一歩を1つ（体重は週の平均と比べる）、週は links と来週の一歩を3つまで。'
      + '記録がない期間は作らず、そう伝えてください。'
      + `終わったら、${back('reports')}`);
  });

  await test.step('レポートのタブ：おすすめの帯は出さない。右下の「レポートを作る」は、まだのまとめをまとめて頼む文で開く', async () => {
    await goTab(page, 'レポート');
    // レポートはまだ1件もないので、タブは空の状態（直行する詳細がない）。帯はホームだけなので、ここには出ない
    // 後ろに重なったホームのタブ（aria-hidden）の帯は数えない
    await expect(see(page, 'レポートはまだありません')).toBeVisible();
    await expect(page.getByTestId('report-suggestion').filter({ visible: true }).and(page.locator(':not([aria-hidden="true"] *)'))).toHaveCount(0);

    // 右下の「レポートを作る」：まだのまとめがあれば、それをまとめて頼む文で開く
    await button(page, 'レポートを作る').click();
    await expect(see(sheet(page), 'まだのまとめ 3 件を作るための文を入れて開きます')).toBeVisible();
    await button(page, 'ChatGPT で開く（外のアプリ）').click();
    await expect(sheet(page)).toBeHidden();
    await waitOpened(page, 2);
    const { app, q } = parse((await opened(page))[1]);
    expect(app).toBe(CHATGPT);
    expect(q).toContain('対象は3件：weekly(2026-11-02..2026-11-08), daily(2026-11-06), daily(2026-11-07)。');
  });

  await test.step('ホームでおすすめを閉じると、レポートのタブの「レポートを作る」も期間を選ぶシートになる。開き直しても出ない', async () => {
    await goTab(page, 'ホーム');
    const banner = page.getByTestId('report-suggestion').filter({ visible: true });
    await expect(see(banner, 'まとめがまだ 3 件あります', { exact: true })).toBeVisible();
    await button(banner, 'おすすめを閉じる。今出ている分は、もう出しません').click();
    await expect(banner).toHaveCount(0);
    // 閉じたあとの「レポートを作る」は期間を選ぶシート（閉じたことは同じ所に覚える）
    await goTab(page, 'レポート');
    await button(page, 'レポートを作る').click();
    await expect(see(sheet(page), '今日のまとめを作るための文を入れて開きます')).toBeVisible();
    await button(page, 'Claude で開く（外のアプリ）').click();
    await expect(sheet(page)).toBeHidden();
    await goTab(page, 'ホーム');
    await expect(homeLatest(page)).toBeVisible();
    await expect(page.getByTestId('report-suggestion').filter({ visible: true })).toHaveCount(0);
    // 開き直しても出ない
    await moveToDate(page, '2026-11-10');
    await expect(homeLatest(page)).toBeVisible();
    await expect(page.getByTestId('report-suggestion').filter({ visible: true })).toHaveCount(0);
  });
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
  await waitOpened(page, 2);
  expect(await opened(page)).toEqual(['https://claude.ai/new', 'https://chatgpt.com/']);
});

test('自動で作る：設定の「チャットとの連携」からシートを開き、ChatGPT にスケジュールを頼む文で開く。頼んだ日を次に出す', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.getByRole('button', { name: /^チャットとの連携/ }).filter({ visible: true }).click();
  const SCHEDULE = '自動で作る。ChatGPT のスケジュールに、まとめを作る予定を入れます';
  await button(page, SCHEDULE).click();
  const schedule = page.getByTestId('schedule-sheet').filter({ visible: true });
  await expect(see(schedule, 'ChatGPT のスケジュール（タスク）に、まとめを作る予定を入れます。すでに入っていれば、作り直しません。')).toBeVisible();
  await expect(schedule.getByLabel('週のまとめ、毎週月曜 8:00、先週の分', { exact: true })).toBeVisible();
  await expect(see(schedule, 'Claude のスケジュールは、いまは KARADA のコネクタを使えないため、ChatGPT だけです。')).toBeVisible();
  await expect(see(schedule, /^前回/)).toHaveCount(0); // まだ頼んでいない
  await button(schedule, 'ChatGPT で設定する（外のアプリ）').click();
  await expect(schedule).toBeHidden();
  await waitOpened(page, 1);
  const [{ app, q }] = (await opened(page)).map(parse);
  expect(app).toBe(CHATGPT);
  expect(q).toContain(`${C}で、まとめのスケジュールを3つ入れてください。KARADA のまとめのタスクがもうあれば、作らず教えてください。`);
  expect(q).toContain('各回：list_reports(kind)に同じ期間があれば作らない。');

  await button(page, SCHEDULE).click();
  await expect(see(page.getByTestId('schedule-sheet').filter({ visible: true }), '前回 11月8日に設定を頼みました', { exact: true })).toBeVisible();
});

// SHOT_DIR を渡すと、ケガの「AI で記録」のシートのスクリーンショットを残す（見た目の確認用）
const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
};

test('ケガの「ケガを記録」：記録の方法のシートから「AI で記録」を選ぶと、ケガを聞き取って記録する文で開く（ケガの一覧へ戻る）', async ({ page }) => {
  await openApp(page);
  await goTab(page, '筋トレ');
  await goPane(page, 'ケガ');
  await page.getByTestId('injury-new').click();
  const add = page.getByTestId('injury-add-sheet').filter({ visible: true });
  await expect(see(add, '記録の方法を選びます', { exact: true })).toBeVisible();
  await expect(button(add, '自分で入力 図で部位を選んで書きます')).toBeVisible();
  await shot(page, 'injury-add-sheet');
  await button(add, `${AI_RECORD}（ケガ）`).click();
  await expect(add).toBeHidden();
  await expect(see(sheet(page), 'ケガを記録するための文を入れて開きます')).toBeVisible();
  await shot(page, 'injury-chat-sheet');
  await button(page, 'Claude で開く（外のアプリ）').click();
  await expect(sheet(page)).toBeHidden();
  const [{ app, q }] = (await opened(page)).map(parse);
  expect(app).toBe(CLAUDE);
  expect(q).toBe(`${C}にケガを記録してください。`
    + '種目・場面・部位と左右・何が起きたか・原因（自分の分析）・次の直し方を聞き取り、record_injury で保存してください。'
    + '種目は list_exercises の名前で、痛めた日が今日（11月8日）でなければ day に。'
    + '原因と直し方は私の言葉のまま、分からない所は推測で埋めず空に。痛みの強さは聞かず、診断しないでください。'
    + SAVED + back('injuries'));
});

test('ケガの1件の「振り返りを足す」から「AI で書く」：痛めた日を手がかりに探して add_injury_review で記録する文で開く', async ({ page }) => {
  await openApp(page);
  await goTab(page, '筋トレ');
  await goPane(page, 'ケガ');
  await page.getByTestId('injury-new').click();
  await page.getByTestId('injury-new-manual').filter({ visible: true }).click();
  await button(page, '一覧から選ぶ').click();
  await button(page, '腰').click();
  await page.getByTestId('injury-save').filter({ visible: true }).click();
  await page.getByRole('button', { name: /^腰、直している途中/ }).filter({ visible: true }).click();
  await page.getByTestId('injury-review').filter({ visible: true }).click();
  await button(page, `${AI_RECORD}（振り返り）`).click();
  await expect(see(sheet(page), 'ケガの振り返りを記録するための文を入れて開きます')).toBeVisible();
  await button(page, 'ChatGPT で開く（外のアプリ）').click();
  const [{ app, q }] = (await opened(page)).map(parse);
  expect(app).toBe(CHATGPT);
  expect(q).toContain(`${C}にケガの振り返りを記録してください。list_injuries で11月8日に痛めたケガを探して私に確かめ、`);
  expect(q).toContain('add_injury_review で保存してください。');
  expect(q).toContain('痛みの強さは聞かず、診断しないでください。');
  expect(q).not.toContain('腰');
  expect(q.endsWith(back('injuries'))).toBe(true);
});
