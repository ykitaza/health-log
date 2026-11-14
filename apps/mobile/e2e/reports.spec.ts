import { BrowserContext, expect, Locator, Page, test } from '@playwright/test';
import { createFakeSyncServer, FakeSyncServer } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { button, goTab, homeIcon, moveToDate, openApp, openSettings, recordOn, see, settle, tab, TODAY } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// レポート（Claude・ChatGPT が MCP の save_report で書いたまとめ）と、食事の推定の根拠。
// サーバーは偽物（test-utils/fakeSyncServer.ts）。MCP で保存したものを偽のサーバーに入れ、同期で受け取って画面に出ることと、
// 消すとサーバーに delete が届くことを確かめる。読み方・消し方・積み直さない決まりは jest（db/__tests__/reports.test.ts）
//
// 新IA（#192）：レポートのタブは一覧ではなく、最新の生成済みレポートの詳細（app/reports/[id].tsx）へ直行する。
// 詳細の中に 日・週・月 の期間タブ（testID report-period-tabs）があり、種類ごとの最新に切り替わる。一覧画面と
// 「やること」ペインはない（次の一歩は各期間ビューの締めブロック。日のまとめは詳細でチェックでき、週の分はホームの
// 「今週やること」でチェックする）。kind=other のレポートはアプリのどこにも出さない。

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };
const REPORT = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEAL = 'bbbbbbbb-0000-4000-8000-000000000001';
const DAILY = 'aaaaaaaa-0000-4000-8000-000000000002';
const MONTHLY = 'aaaaaaaa-0000-4000-8000-000000000003';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000004';
const INJURY = 'cccccccc-0000-4000-8000-000000000001';
// 初期の種目（db/seed.ts）。同期で届く筋トレ・ケガの参照先に使う
const BENCH = 'd41c7096-c246-4dfa-945a-e1cb329977a6';
const SQUAT = 'a902b077-031a-4de6-814b-9ffb69b96778';
const DEADLIFT = '2b2e0dc4-c98d-4656-95f6-e9a21cf03004';

async function connect(page: Page, context: BrowserContext, server: FakeSyncServer) {
  await fakeCognito(context, { status: 200, body: { access_token: fakeAccessToken('user-a'), refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' } });
  await fakeLoginPopup(page, { code: 'test-code' });
  await context.route(/^https:\/\/[^/]+\.execute-api\.[^/]+\.amazonaws\.com\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS }); return; }
    const res = server.handle(req.method(), req.url(), req.postData() ? JSON.parse(req.postData()!) : undefined);
    await route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body), headers: CORS });
  });
}

/** ログインして同期し、ホームに戻る */
async function signInAndSync(page: Page) {
  await openSettings(page);
  await page.getByTestId('settings-account').click();
  await button(page, 'パスキーでログイン').click();
  await expect(page.getByTestId('sync-pending').filter({ visible: true })).toHaveText('0件');
  await button(page, '戻る').click();
  await button(page, '戻る').click();
}

const band = (page: Page) => page.getByTestId('report-band').filter({ visible: true });
/** 詳細のいちばん下の「日のまとめ ・ 11月9日に作成」（種類と作った日） */
const created = (page: Page) => page.getByTestId('report-created').filter({ visible: true });
const periodTabs = (page: Page) => page.getByTestId('report-period-tabs').filter({ visible: true });
const periodTab = (page: Page, label: '日' | '週' | '月') =>
  periodTabs(page).getByRole('button', { name: label, exact: true });

/** レポートのタブを開き、最新の詳細へ直行するのを待つ（レポートがある前提） */
async function openReportsTab(page: Page) {
  await tab(page, 'レポート').click();
  await expect(tab(page, 'レポート')).toHaveAttribute('aria-selected', 'true');
  await settle(periodTabs(page));
  await expect(periodTabs(page)).toBeVisible();
}

/** 同期で届く筋トレ1種目分（entry＋1セット）。レーダー・BIG3・成長スコアの材料 */
function workoutChanges(at: string, entryId: string, date: string, exerciseId: string, weight: number, reps: number) {
  const mcp = { parent_id: null, changed_at: at, origin: 'mcp' as const, device_id: null };
  return [
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'workout_entry', entity_id: entryId, op: 'create' as const, fields: { date, exercise_id: exerciseId, sort_order: 0 } },
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'workout_set', entity_id: `${entryId}-set1`, op: 'create' as const, fields: { entry_id: entryId, set_index: 0, weight_kg: weight, reps, memo: '', done: true } },
  ];
}

function serverWithReport() {
  const server = createFakeSyncServer({ clock: () => '2026-11-08T01:00:00.000Z' });
  const at = '2026-11-08T01:00:00.000Z';
  const mcp = { parent_id: null, changed_at: at, origin: 'mcp' as const, device_id: null };
  server.append([
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'report', entity_id: REPORT, op: 'create', fields: {
      title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08', overall_tone: 'caution',
      headline: '睡眠が短い日が多かった',
      highlights: [
        { area: 'sleep', tone: 'caution', text: '6時間を切る日が3日', metric: { label: '睡眠（平均）', value: 5.8, unit: '時間', delta: -0.6, delta_good: false } },
        { area: 'training', tone: 'good', text: '脚の日が2回に増えた' },
      ],
      next_steps: ['平日は 23時半までに寝る'],
      body: '## 睡眠\n- **木曜と金曜**に短い\n[ここを押す](https://example.invalid)',
    } },
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'meal', entity_id: MEAL, op: 'create', fields: {
      date: '2026-11-08', slot: 'lunch', time: '12:30', description: '鶏むね肉の定食', source: 'photo', basis: 'ごはんは茶碗1杯 150g として計算',
    } },
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'meal_item', entity_id: 'i1', parent_id: MEAL, op: 'create', fields: {
      name: 'ごはん', amount: 150, unit: 'g', kcal: 234, protein_g: 3.8, fat_g: 0.5, carbs_g: 55.7, confidence: 'medium', sort_order: 0,
    } },
  ]);
  return server;
}

test('レポートがないときは、ホームのカードにチャットで頼む方法を出す', async ({ page }) => {
  await openApp(page);
  await expect(see(page.getByTestId('latest-report'), 'まだありません。チャット（Claude・ChatGPT）で「今週のまとめを作って」と頼むと、ここに出ます。')).toBeVisible();
  await expect(button(page, 'すべてのレポート。最新のレポートを開き、日・週・月のタブで切り替えます')).toHaveCount(0);
});

test('レポートのタブは最新のレポートの詳細へ直行する。中身が出て、消すとサーバーに届く', async ({ page, context }) => {
  const server = serverWithReport();
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);

  // ホームの最新のレポート：調子は色だけでなく言葉でも出す
  const card = page.getByRole('button', { name: /^気をつけたい、今週のまとめ、睡眠が短い日が多かった、/ }).filter({ visible: true });
  await expect(card).toBeVisible();
  await expect(card).toHaveAccessibleName(/睡眠（平均） 5\.8 時間、前より 0\.6 減った、気をつけたい変化/);
  // 「すべて」は一覧ではなく、最新の詳細を直接開く（日・週・月は詳細の期間タブで切り替える）
  await button(page, 'すべてのレポート。最新のレポートを開き、日・週・月のタブで切り替えます').click();
  await expect(periodTabs(page)).toBeVisible();
  const latestLine = page.getByTestId('report-latest-line').filter({ visible: true });
  await expect(latestLine).toContainText('11月2日（月）〜11月8日（日）のレポート');
  // その種類の最新なので「最新の生成済み」と書く
  await expect(latestLine).toContainText('最新の生成済みレポートを表示しています');
  // 2回目も詳細に着く（レポートのタブを通さないので、タブが裏に残っていても止まらない）
  await button(page, '戻る').click();
  await expect(tab(page, 'ホーム')).toHaveAttribute('aria-selected', 'true');
  await button(page, 'すべてのレポート。最新のレポートを開き、日・週・月のタブで切り替えます').click();
  await expect(periodTabs(page)).toBeVisible();
  await expect(latestLine).toContainText('11月2日（月）〜11月8日（日）のレポート');
  // 一覧のUIはない：説明文・「やること」ペイン（primary-tabs）・戻るのない一覧画面、ではない
  await expect(see(page, 'チャット（Claude・ChatGPT）で作ったまとめです。期間の日付の新しい順に、月ごとに並びます。')).toHaveCount(0);
  await expect(page.getByTestId('primary-tabs').filter({ visible: true })).toHaveCount(0);

  // 中身：帯・指標・分野ごと・来週の焦点・本文（リンクは文字のまま）
  const b = band(page);
  await expect(see(b, '気をつけたい', { exact: true })).toBeVisible();
  await expect(see(b, '11月2日（月）〜11月8日（日）')).toBeVisible();
  // 今週の目標（アプリが記録から出す。WEEKLY STATUS の表）
  await expect(page.getByTestId('report-achievement').filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel(/^睡眠、睡眠（平均） 5\.8 時間/).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('筋トレ、良い。脚の日が2回に増えた').filter({ visible: true })).toBeVisible();
  // 部位バランスのレーダー（週ビュー）
  await expect(page.getByTestId('report-weekly-radar').filter({ visible: true })).toBeVisible();
  // 週のまとめは、まとめだけ（「まとめ ／ 次の週にやること」の切り替えはない）。締めは「来週の焦点」
  await expect(button(page, 'まとめ')).toHaveCount(0);
  await expect(see(page, '来週の焦点', { exact: true })).toBeVisible();
  await expect(see(page, '平日は 23時半までに寝る', { exact: true })).toBeVisible();
  // 前の週のまとめがなければ「先週やることの振り返り」は出さない
  await expect(see(page, '先週やることの振り返り', { exact: true })).toHaveCount(0);
  // つながり・目標の見直し・本文は、たたんで下に置く（押すと開く）
  await button(page, 'つながり・目標の見直し・本文').click();
  const body = page.getByTestId('report-body').filter({ visible: true });
  await expect(see(body, '[ここを押す](https://example.invalid)')).toBeVisible();
  await expect(body.locator('a')).toHaveCount(0);

  // 期間タブで、まだない種類（日）は空の状態。週に戻れる
  await periodTab(page, '日').click();
  await expect(see(page, '日のまとめはまだありません')).toBeVisible();
  await periodTab(page, '週').click();
  await expect(see(band(page), '11月2日（月）〜11月8日（日）')).toBeVisible();

  // 来週の焦点は、詳細の週ビューでチェックできる（ホームの「今週やること」と同じ next_steps_done）。チェックするとサーバーに届く
  const wsteps = page.getByTestId('report-weekly-steps').filter({ visible: true });
  await expect(wsteps).toBeVisible();
  const wstep = wsteps.getByRole('checkbox', { name: '平日は 23時半までに寝る' });
  await expect(wstep).toHaveAttribute('aria-checked', 'false');
  await wstep.click();
  await expect(wstep).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => server.state('report', REPORT)?.fields.next_steps_done, { timeout: 15_000 }).toEqual([0]);

  // ホームの「今週やること」にも、同じチェックが反映される（全部できて1行にたたまれる）
  await button(page, '戻る').click();
  await goTab(page, 'ホーム');
  const todo = page.getByTestId('weekly-todo').filter({ visible: true });
  await expect(todo.getByRole('button', { name: '今週やることを全部できた。1つのうち1つ済み' })).toBeVisible();

  // ホームの最新のレポートのカードから、詳細を開き直す
  await page.getByTestId('latest-report').filter({ visible: true })
    .getByRole('button', { name: /^気をつけたい、今週のまとめ、/ }).click();
  await expect(see(band(page), '11月2日（月）〜11月8日（日）')).toBeVisible();

  // 消す：確認のダイアログ → サーバーにも delete が届く。レポートのタブは空の状態になる
  await button(page, 'メニュー').click();
  await button(page, 'このレポートを消す').click();
  await expect(see(page, 'レポートを消しますか？')).toBeVisible();
  await button(page, 'やめる').click();
  await expect(see(page, 'レポートを消しますか？')).toHaveCount(0);
  await button(page, 'メニュー').click();
  await button(page, 'このレポートを消す').click();
  await button(page, '消す').click();
  await expect.poll(() => server.state('report', REPORT)?.deleted, { timeout: 15_000 }).toBe(true);
  await expect(homeIcon(page)).toBeVisible();
  await tab(page, 'レポート').click();
  await expect(tab(page, 'レポート')).toHaveAttribute('aria-selected', 'true');
  await expect(see(page, 'レポートはまだありません')).toBeVisible();
});

test('週のまとめの「先週やることの振り返り」：前の週の次の一歩と済んだ数を、詳細に見るだけで出す', async ({ page, context }) => {
  const server = serverWithReport(); // 今週のまとめ（11月2日〜8日）
  // 先週のまとめ（10月26日〜11月1日）。作った時刻は今週のまとめより前にして、タブの直行先は今週のまとめにする
  server.append([{
    parent_id: null, changed_at: '2026-11-01T09:00:00.000Z', origin: 'mcp', device_id: null,
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: DAILY, op: 'create', fields: {
      title: '先週のまとめ', kind: 'weekly', period_start: '2026-10-26', period_end: '2026-11-01', overall_tone: 'good',
      headline: '', highlights: [], next_steps: ['ベンチプレスを 82.5kg で5回', '水を1日2L飲む'], next_steps_done: [0], body: '',
    },
  }]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  await openReportsTab(page);

  // 直行先は今週のまとめ。その中身に「先週やることの振り返り」（前の週のまとめの次の一歩と済んだか。見るだけ）
  await expect(see(band(page), '11月2日（月）〜11月8日（日）')).toBeVisible();
  await expect(page.getByRole('heading', { name: '先週やることの振り返り', exact: true }).filter({ visible: true })).toBeVisible();
  const prev = page.getByTestId('report-prev-todo').filter({ visible: true });
  await expect(prev.getByRole('heading', { name: '11月2日〜8日にやること', exact: true })).toBeVisible();
  await expect(see(prev, '1／2', { exact: true })).toBeVisible();
  await expect(prev.getByLabel('ベンチプレスを 82.5kg で5回、済み', { exact: true })).toBeVisible();
  await expect(prev.getByLabel('水を1日2L飲む、まだ', { exact: true })).toBeVisible();
  await expect(prev.getByRole('checkbox')).toHaveCount(0);
  // 今週の目標の下
  const goals = await page.getByTestId('report-achievement').filter({ visible: true }).boundingBox();
  expect(goals!.y).toBeLessThan((await prev.boundingBox())!.y);
});

/** 今週の目標を小さくする（筋トレ 2回・食事の記録 3日・睡眠 切）。ホームから設定を開き、ホームに戻る */
async function setSmallGoals(page: Page) {
  await openSettings(page);
  for (const name of ['筋トレ、2回', '食事の記録、3日', '睡眠、切']) {
    await button(page, name).click();
    await expect(button(page, name)).toHaveAttribute('aria-selected', 'true');
  }
  await button(page, '戻る').click();
  await expect(homeIcon(page)).toBeVisible();
}

/** 食事のタブで、今の日の昼食を1品だけ記録して、ホームに戻る */
async function recordMeal(page: Page) {
  await goTab(page, '食事');
  await button(page, '昼食を記録').click();
  await button(page, '品目を入力').click();
  const field = (label: string) => page.getByRole('textbox', { name: label, exact: true }).filter({ visible: true });
  await field('品目1の品名').fill('おにぎり');
  await field('品目1の量').fill('1');
  await field('品目1のエネルギー').fill('200');
  await button(page, '記録する').click();
  await expect(page.getByTestId('meal-fuel').filter({ visible: true })).toHaveAttribute('aria-label', /^今日の食事 200kcal/);
  await goTab(page, 'ホーム');
}

const settingsGoals = (page: Page) => page.getByTestId('settings-weekly-goals').filter({ visible: true });

// 達成と連続の数え方（任意の週・途切れ・今週を含む・含まない）は jest（lib/__tests__/goals.test.ts、lib/__tests__/reports.test.ts）。ここは画面に出ること。
// 過ぎた週のまとめは新IAでは開く導線がない（詳細は種類ごとの最新だけ）ので、過ぎた週の目標カードはここでは確かめない
test('週のまとめの目標のカード：すべて達成で「✓ 達成」と連続、「目標を変える」で設定の欄へ', async ({ page, context }) => {
  const server = serverWithReport(); // 今週のまとめ（11月2日〜8日）。11/8 の食事が1件届く
  server.append([{
    parent_id: null, changed_at: '2026-11-01T09:00:00.000Z', origin: 'mcp', device_id: null,
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: DAILY, op: 'create', fields: {
      title: '先週のまとめ', kind: 'weekly', period_start: '2026-10-26', period_end: '2026-11-01', overall_tone: 'good',
      headline: '', highlights: [], next_steps: [], body: '',
    },
  }]);
  await connect(page, context, server);
  await openApp(page);
  await setSmallGoals(page);
  // 11/6・11/7 に筋トレと食事。11/8 の食事は同期で届く（筋トレ 2／2 回・食事 3／3 日）
  for (const date of ['2026-11-06', '2026-11-07']) {
    await recordOn(page, date, [{ exercise: 'スクワット', sets: [{ weight: '100', reps: '5' }] }]);
    await recordMeal(page);
  }
  await moveToDate(page, TODAY);
  await signInAndSync(page);

  await openReportsTab(page);
  const goals = page.getByTestId('report-achievement').filter({ visible: true });
  await expect(goals.getByLabel('筋トレ、2 回、目標 2 回、達成', { exact: true })).toBeVisible();
  await expect(goals.getByLabel('食事を記録した日、3 日、目標 3 日、達成', { exact: true })).toBeVisible();
  // 睡眠は切なので出さない
  await expect(see(goals, '7時間以上寝た日')).toHaveCount(0);
  await expect(goals.getByTestId('report-goals-achieved')).toHaveText('✓ 達成');
  await expect(goals.getByTestId('report-goal-streak')).toHaveText('1週連続で達成');
  await expect(goals.getByLabel('設定の目標をすべて達成。1週連続で達成', { exact: true })).toBeVisible();
  // 目標を変える：設定の今週の目標の欄までスクロールして開く。戻るとレポートへ
  await button(goals, '目標を変える').click();
  await expect(see(page, '重さの単位', { exact: true })).toBeVisible();
  await expect(settingsGoals(page)).toBeInViewport();
  await button(page, '戻る').click();
  await expect(see(band(page), '11月2日（月）〜11月8日（日）')).toBeVisible();
});

test('日のまとめ（daily）は、種類の名前・その日だけの期間・前の日との比べ・明日の一歩を出す。チェックはサーバーに届き、連続が出る', async ({ page, context }) => {
  const server = createFakeSyncServer({ clock: () => '2026-11-09T12:00:00.000Z' });
  const at = '2026-11-09T12:00:00.000Z';
  server.append([{
    parent_id: null, changed_at: at, origin: 'mcp', device_id: null,
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: REPORT, op: 'create', fields: {
      title: '今日のまとめ', kind: 'daily', period_start: '2026-11-09', period_end: '2026-11-09', overall_tone: 'good',
      headline: 'たんぱく質が目標に届いた',
      highlights: [{ area: 'meals', tone: 'good', text: 'たんぱく質が目標どおり', metric: { label: 'たんぱく質', value: 130, unit: 'g', delta: 12, delta_good: true } }],
      next_steps: ['23時までに寝る'], body: '',
    },
  }]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  await page.getByRole('button', { name: /^良い調子、今日のまとめ、/ }).filter({ visible: true }).click();

  const b = band(page);
  await expect(created(page)).toHaveText('日のまとめ ・ 11月9日に作成');
  await expect(see(b, '11月9日（月）', { exact: true })).toBeVisible();
  // この日の達成（kcal・たんぱく質・睡眠のリング。アプリが記録から出す。記録がなければ「記録なし」。筋トレの行はステータス表に）。指標のタイルは出さず、指標は分野の行に小さく
  await expect(page.getByTestId('report-achievement').filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('筋トレ、記録なし', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId('report-tiles')).toHaveCount(0);
  await expect(see(page, '前の日より', { exact: true })).toBeVisible();
  await expect(see(page, '明日の一歩', { exact: true })).toBeVisible();
  // くわしく — ステータス（構造化ステータス表）
  const stats = page.getByTestId('report-daily-stats').filter({ visible: true });
  await expect(stats).toBeVisible();
  await expect(see(stats, 'くわしく — ステータス', { exact: true })).toBeVisible();
  await expect(see(stats, '体重', { exact: true })).toBeVisible();
  // 明日の一歩：詳細でチェックできる。チェックすると next_steps_done がサーバーに届き、連続（ストリーク）が出る
  const steps = page.getByTestId('report-daily-steps').filter({ visible: true });
  await expect(steps).toBeVisible();
  const step = steps.getByRole('checkbox', { name: '23時までに寝る' });
  await expect(step).toHaveAttribute('aria-checked', 'false');
  await step.click();
  await expect(step).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('report-daily-streak').filter({ visible: true })).toHaveText('1日連続で達成');
  await expect.poll(() => server.state('report', REPORT)?.fields.next_steps_done, { timeout: 15_000 }).toEqual([0]);
});

test('その日の日のまとめは、筋トレ・食事・からだのタブに分野ごとに出て、押すと中身。レポートのタブは最新の日のまとめの詳細を直接開く', async ({ page, context }) => {
  const server = serverWithReport(); // 今週のまとめ（weekly）
  const at = '2026-11-08T12:00:00.000Z';
  const daily = (id: string, changedAt: string, fields: Record<string, unknown>) => ({
    parent_id: null, changed_at: changedAt, origin: 'mcp' as const, device_id: null,
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: id, op: 'create' as const, fields: {
      kind: 'daily', period_start: TODAY, period_end: TODAY, overall_tone: 'good', next_steps: [], body: '', ...fields,
    },
  });
  // 同じ日の古い日のまとめ（新しいほうだけを出す）。作った時刻はサーバーが受け付けた時刻
  server.setClock(() => '2026-11-08T11:00:00.000Z');
  server.append([daily('cccccccc-0000-4000-8000-000000000001', '2026-11-08T11:00:00.000Z', {
    title: '古いまとめ', headline: '古い', highlights: [{ area: 'training', tone: 'caution', text: '古い文' }],
  })]);
  server.setClock(() => at);
  server.append([
    daily(DAILY, at, {
      title: '11月8日のまとめ', headline: 'ベンチプレスが伸びた日',
      highlights: [
        { area: 'training', tone: 'good', text: 'ベンチプレスを3セット', metric: { label: '合計負荷量', value: 2.33, unit: 't', delta: 0.4, delta_good: true } },
        { area: 'meals', tone: 'steady', text: 'たんぱく質は 98g' },
        { area: 'body', tone: 'caution', text: '体重が 0.6kg 増えた' },
        { area: 'sleep', tone: 'steady', text: '睡眠はいつもどおり' },
      ],
    }),
  ]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  const section = () => page.getByTestId('daily-highlights').filter({ visible: true });

  // 筋トレ：training だけ。押すと日のまとめの中身
  await goTab(page, '筋トレ');
  await expect(see(section(), 'レポートから（今日のまとめ）', { exact: true })).toBeVisible();
  await expect(section().getByRole('button')).toHaveCount(1);
  // 記録のカードと見分けるため、塗りのない点線の枠
  const extract = section().getByTestId('daily-highlight');
  await expect(extract).toHaveCSS('border-top-style', 'dashed');
  await expect(extract).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await button(page, '筋トレ、良い。ベンチプレスを3セット。合計負荷量 2.33 t、前より 0.4 増えた、良い変化').click();
  await expect(created(page)).toHaveText('日のまとめ ・ 11月8日に作成');
  await button(page, '戻る').click();

  // 食事：meals だけ。日のまとめのない前の日は、場所も取らない
  await goTab(page, '食事');
  await expect(section().getByRole('button')).toHaveCount(1);
  await expect(button(section(), '食事、変わらない。たんぱく質は 98g')).toBeVisible();
  await button(page, '前の日').click();
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  // 隠れたタブ（筋トレ）の分は数えない（役割で探すと、隠れたものは入らない）
  await expect(page.getByRole('heading', { name: /^レポートから（/ })).toHaveCount(0);
  await expect(button(page, '食事、変わらない。たんぱく質は 98g')).toHaveCount(0);

  // からだ：body と sleep
  await goTab(page, 'からだ');
  await expect(section().getByRole('button')).toHaveCount(2);
  await expect(button(section(), 'からだ、気をつけたい。体重が 0.6kg 増えた')).toBeVisible();
  await expect(button(section(), '睡眠、変わらない。睡眠はいつもどおり')).toBeVisible();

  // レポートのタブ：最新は日のまとめ（12:00 作成）なので、その詳細を直接開く。種類の絞り込みはない
  await openReportsTab(page);
  await expect(periodTab(page, '日')).toHaveAttribute('aria-selected', 'true');
  await expect(created(page)).toHaveText('日のまとめ ・ 11月8日に作成');
  await expect(see(band(page), '11月8日のまとめ', { exact: true })).toBeVisible();
  // 期間タブで週に切り替えると、週の最新の詳細になる
  await periodTab(page, '週').click();
  await expect(periodTab(page, '週')).toHaveAttribute('aria-selected', 'true');
  await expect(created(page)).toHaveText('週のまとめ ・ 11月8日に作成');
});

test('MCP で推定した食事は、詳しい画面に推定の根拠を出す', async ({ page, context }) => {
  const server = serverWithReport();
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  await goTab(page, '食事');
  await button(page, '鶏むね肉の定食を開く').click();
  await expect(see(page, '推定の根拠', { exact: true })).toBeVisible();
  await expect(see(page, 'ごはんは茶碗1杯 150g として計算')).toBeVisible();
});

test('月のまとめ：つながりのカードと、目標の見直しの「食事の目標を開く」', async ({ page, context }) => {
  const server = createFakeSyncServer({ clock: () => '2026-11-01T01:00:00.000Z' });
  server.append([{
    parent_id: null, changed_at: '2026-11-01T01:00:00.000Z', origin: 'mcp', device_id: null,
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: REPORT, op: 'create', fields: {
      title: '10月のまとめ', kind: 'monthly', period_start: '2026-10-01', period_end: '2026-10-31', overall_tone: 'caution',
      headline: '睡眠が6時間を切る日が多かった', body: '', next_steps: ['寝る1時間前に画面を見ない日をつくる'],
      highlights: [{ area: 'sleep', tone: 'caution', text: '6時間を切る日が14日' }],
      links: [{ from_area: 'sleep', to_area: 'training', text: '睡眠が6時間を切った週は、筋トレの回数が半分だった', basis: '2週' }],
      review: { text: '体重のペースが目標より遅めです。食事の目標を少し下げる案があります。', target: 'meals_goal' },
    },
  }]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  await page.getByRole('button', { name: /^気をつけたい、10月のまとめ、/ }).filter({ visible: true }).click();
  await button(page, 'つながり・目標の見直し・本文').click();
  await expect(see(page, 'つながり', { exact: true })).toBeVisible();
  await expect(page.getByLabel('睡眠から筋トレへ（2週）。睡眠が6時間を切った週は、筋トレの回数が半分だった', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(see(page, '睡眠 → 筋トレ・2週', { exact: true })).toBeVisible();
  // 体重の記録がないので、ヒーローの目標への進捗と、目標への進捗のカードは出さない
  await expect(page.getByTestId('report-hero-monthly')).toHaveCount(0);
  await expect(page.getByTestId('report-goal-bar')).toHaveCount(0);
  const review = page.getByTestId('report-review').filter({ visible: true });
  await expect(see(review, '体重のペースが目標より遅めです。食事の目標を少し下げる案があります。')).toBeVisible();
  await expect(see(page, '今月の課題', { exact: true })).toBeVisible();
  await button(review, '食事の目標を開く').click();
  await expect(page).toHaveURL(/\/meals\/goal$/);
});

test('詳細の期間タブ（日・週・月）：種類ごとの最新のレポートに切り替わる', async ({ page, context }) => {
  const server = createFakeSyncServer({ clock: () => '2026-11-08T12:00:00.000Z' });
  const mk = (id: string, changedAt: string, fields: Record<string, unknown>) => ({
    parent_id: null, changed_at: changedAt, origin: 'mcp' as const, device_id: null,
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: id, op: 'create' as const, fields,
  });
  server.append([
    mk(MONTHLY, '2026-10-31T12:00:00.000Z', {
      title: '10月のまとめ', kind: 'monthly', period_start: '2026-10-01', period_end: '2026-10-31', overall_tone: 'good',
      headline: '体重が増えてきた', highlights: [], next_steps: ['スクワットを続ける'], body: '',
    }),
    mk(REPORT, '2026-11-08T01:00:00.000Z', {
      title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08', overall_tone: 'caution',
      headline: '睡眠が短い日が多かった', highlights: [], next_steps: ['平日は 23時半までに寝る'], body: '',
    }),
    mk(DAILY, '2026-11-08T12:00:00.000Z', {
      title: '今日のまとめ', kind: 'daily', period_start: TODAY, period_end: TODAY, overall_tone: 'good',
      headline: 'たんぱく質が目標に届いた', highlights: [], next_steps: ['23時までに寝る'], body: '',
    }),
  ]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  await openReportsTab(page);

  // まずはいちばん新しい、日のまとめ
  await expect(periodTab(page, '日')).toHaveAttribute('aria-selected', 'true');
  await expect(created(page)).toHaveText('日のまとめ ・ 11月8日に作成');
  await expect(see(band(page), '今日のまとめ', { exact: true })).toBeVisible();

  // 週：週の最新の詳細（帯と締めの見出しが週のものになる）
  await periodTab(page, '週').click();
  await expect(periodTab(page, '週')).toHaveAttribute('aria-selected', 'true');
  await expect(created(page)).toHaveText('週のまとめ ・ 11月8日に作成');
  await expect(see(page, '来週の焦点', { exact: true })).toBeVisible();

  // 月：月の最新の詳細
  await periodTab(page, '月').click();
  await expect(periodTab(page, '月')).toHaveAttribute('aria-selected', 'true');
  await expect(created(page)).toHaveText('月のまとめ ・ 10月31日に作成');
  await expect(see(band(page), '10月のまとめ', { exact: true })).toBeVisible();
  await expect(see(page, '今月の課題', { exact: true })).toBeVisible();

  // 日に戻れる
  await periodTab(page, '日').click();
  await expect(periodTab(page, '日')).toHaveAttribute('aria-selected', 'true');
  await expect(see(band(page), '今日のまとめ', { exact: true })).toBeVisible();
});

test('週のまとめ：部位バランスのレーダーと、期間にケガがあればケガの振り返り。締めは「来週の焦点」', async ({ page, context }) => {
  const server = serverWithReport(); // 今週のまとめ（11月2日〜8日）
  const at = '2026-11-08T01:00:00.000Z';
  server.append([
    // 期間内（11月5日）の筋トレ：レーダーの材料
    ...workoutChanges(at, 'eeeeeeee-0000-4000-8000-000000000001', '2026-11-05', BENCH, 60, 8),
    ...workoutChanges(at, 'eeeeeeee-0000-4000-8000-000000000002', '2026-11-05', SQUAT, 80, 5),
    // 期間内（11月4日）に痛めたケガ：ケガの振り返りの材料（fake server は injury entity_type をそのまま扱う）
    { parent_id: null, changed_at: at, origin: 'mcp' as const, device_id: null,
      change_id: crypto.randomUUID(), entity_type: 'injury', entity_id: INJURY, op: 'create' as const, fields: {
        occurred_on: '2026-11-04', site: 'shoulder_front', side: 'right', exercise_id: BENCH, phase: 'ラックアップ',
        symptom: '肩の前に違和感', cause: '', fix: '', status: 'fixing', fixed_on: null,
      } },
  ]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  await openReportsTab(page);

  const radar = page.getByTestId('report-weekly-radar').filter({ visible: true });
  await expect(radar).toBeVisible();
  await expect(see(radar, '部位のバランス', { exact: true })).toBeVisible();
  await expect(page.getByTestId('report-weekly-radar-chart').filter({ visible: true })).toBeVisible();

  const injury = page.getByTestId('report-injury-review').filter({ visible: true });
  await expect(injury).toBeVisible();
  // 見出しはモックと同じ英字の「INJURY REVIEW」（読み上げはパネルの名前「ケガの振り返り」）
  await expect(see(injury, 'INJURY REVIEW', { exact: true })).toBeVisible();
  await expect(injury).toHaveAttribute('aria-label', 'ケガの振り返り');
  await expect(injury.getByLabel('期間内に痛めた 1件', { exact: true })).toBeVisible();
  await expect(see(injury, '肩の前に違和感', { exact: true })).toBeVisible();

  await expect(see(page, '来週の焦点', { exact: true })).toBeVisible();
});

test('月のまとめ：成長スコア・目標バー（節目つき）・BIG3 が、記録から計算して出る', async ({ page, context }) => {
  const server = createFakeSyncServer({ clock: () => '2026-10-31T12:00:00.000Z' });
  const at = '2026-10-31T12:00:00.000Z';
  const mcp = { parent_id: null, changed_at: at, origin: 'mcp' as const, device_id: null };
  server.append([
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'report', entity_id: MONTHLY, op: 'create', fields: {
      title: '10月のまとめ', kind: 'monthly', period_start: '2026-10-01', period_end: '2026-10-31', overall_tone: 'good',
      headline: '体重が増えてきた', highlights: [], next_steps: ['スクワットを続ける'], body: '',
    } },
    // 目標体重 80kg（設定は setting entity。entity_id が設定のキー）
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'setting', entity_id: 'goal_weight_kg', op: 'create', fields: { value: '80' } },
    // 体重の記録2件（7日平均の点が2つ要る。目標バーと体の変化の材料）
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'body_record', entity_id: 'f0000000-0000-4000-8000-000000000001', op: 'create', fields: {
      date: '2026-10-05', measured_at: '2026-10-05T07:00:00.000Z', weight_kg: 69.0, source: 'manual',
    } },
    { ...mcp, change_id: crypto.randomUUID(), entity_type: 'body_record', entity_id: 'f0000000-0000-4000-8000-000000000002', op: 'create', fields: {
      date: '2026-10-26', measured_at: '2026-10-26T07:00:00.000Z', weight_kg: 69.8, source: 'manual',
    } },
    // BIG3（10月20日。初期の種目は名前で BIG3 に割り当たる）と、成長スコアの材料
    ...workoutChanges(at, 'eeeeeeee-0000-4000-8000-000000000011', '2026-10-20', BENCH, 60, 5),
    ...workoutChanges(at, 'eeeeeeee-0000-4000-8000-000000000012', '2026-10-20', SQUAT, 80, 5),
    ...workoutChanges(at, 'eeeeeeee-0000-4000-8000-000000000013', '2026-10-20', DEADLIFT, 100, 5),
  ]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  await openReportsTab(page);
  await expect(periodTab(page, '月')).toHaveAttribute('aria-selected', 'true');

  const growth = page.getByTestId('report-growth-score').filter({ visible: true });
  await expect(growth).toBeVisible();
  await expect(see(growth, '成長スコア', { exact: true })).toBeVisible();

  const goal = page.getByTestId('report-goal-bar').filter({ visible: true });
  await expect(goal).toBeVisible();
  await expect(page.getByTestId('report-goal-milestone').filter({ visible: true })).toBeVisible();
  await expect(goal).toContainText('69.8');
  await expect(goal).toContainText('目標：80kg');
  await expect(goal).toContainText('次の節目：70kg');
  await expect(goal).toContainText('あと0.2kg');

  const big3 = page.getByTestId('report-big3').filter({ visible: true });
  await expect(big3).toBeVisible();
  await expect(see(big3, 'BIG3 推定1RM 合計', { exact: true })).toBeVisible();

  await expect(see(page, '今月の課題', { exact: true })).toBeVisible();
});

test('kind=other のレポートは出さない：新しくても、タブは最新の（other でない）レポートを開き、その ID を開いても差し替わる', async ({ page, context }) => {
  const server = serverWithReport(); // 今週のまとめ（weekly、11月8日 01:00 作成）
  server.setClock(() => '2026-11-08T03:00:00.000Z');
  server.append([{
    parent_id: null, changed_at: '2026-11-08T03:00:00.000Z', origin: 'mcp', device_id: null,
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: OTHER, op: 'create', fields: {
      title: 'ベンチプレスの分析', kind: 'other', period_start: '2026-11-02', period_end: '2026-11-08', overall_tone: 'good',
      headline: '分析の見出し', highlights: [], next_steps: [], body: '',
    },
  }]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);

  // ホームの最新のレポートも、other ではなく週のまとめ
  await expect(page.getByRole('button', { name: /^気をつけたい、今週のまとめ、/ }).filter({ visible: true })).toBeVisible();
  await expect(see(page, 'ベンチプレスの分析')).toHaveCount(0);

  await openReportsTab(page);
  await expect(see(band(page), '今週のまとめ', { exact: true })).toBeVisible();
  await expect(see(page, 'ベンチプレスの分析')).toHaveCount(0);

  // other の ID を直接開いても、最新の（other でない）レポートに差し替わる
  await page.goto(`/reports/${OTHER}`);
  await expect(periodTabs(page)).toBeVisible();
  await expect(see(band(page), '今週のまとめ', { exact: true })).toBeVisible();
  await expect(see(page, 'ベンチプレスの分析')).toHaveCount(0);
});

test('戻りリンク（/reports?date=…）は、その日を含む期間のタブで詳細を開く。kind 指定も同じ', async ({ page, context }) => {
  const server = serverWithReport(); // 今週のまとめ（11月2日〜8日）
  server.append([{
    parent_id: null, changed_at: '2026-11-05T12:00:00.000Z', origin: 'mcp', device_id: null,
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: DAILY, op: 'create', fields: {
      title: '11月5日のまとめ', kind: 'daily', period_start: '2026-11-05', period_end: '2026-11-05', overall_tone: 'good',
      headline: '', highlights: [], next_steps: [], body: '',
    },
  }]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
  // 同期で届いていること（ホームの最新のレポート）
  await expect(page.getByRole('button', { name: /^気をつけたい、今週のまとめ、/ }).filter({ visible: true })).toBeVisible();

  // date だけ：その日の日のまとめを、日タブで開く
  await page.goto('/reports?date=2026-11-05');
  await expect(periodTabs(page)).toBeVisible();
  await expect(periodTab(page, '日')).toHaveAttribute('aria-selected', 'true');
  await expect(see(band(page), '11月5日（木）', { exact: true })).toBeVisible();

  // date＋kind=weekly：その日を含む週のまとめを、週タブで開く
  await page.goto('/reports?date=2026-11-05&kind=weekly');
  await expect(periodTabs(page)).toBeVisible();
  await expect(periodTab(page, '週')).toHaveAttribute('aria-selected', 'true');
  await expect(see(band(page), '11月2日（月）〜11月8日（日）')).toBeVisible();
});

test('新しいレポートのお知らせ：届いた件数と中身。「見る」で最新の詳細（2件のときも最新）・そのレポート（1件）。開いたら新着が消える', async ({ page, context }) => {
  const server = serverWithReport(); // 今週のまとめ（11月2日〜8日、01:00 作成）
  const at = '2026-11-08T12:00:00.000Z';
  server.setClock(() => at);
  // 10月31日の日のまとめを、あとから作った（作った時刻がいちばん新しいので、最新の詳細はこれ）
  server.append([{
    parent_id: null, changed_at: at, origin: 'mcp', device_id: null,
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: DAILY, op: 'create', fields: {
      title: '10月31日のまとめ', kind: 'daily', period_start: '2026-10-31', period_end: '2026-10-31', overall_tone: 'good',
      headline: '', highlights: [], next_steps: [], body: '',
    },
  }]);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);

  const banner = page.getByTestId('new-report-banner').filter({ visible: true }).and(page.locator(':not([aria-hidden="true"] *)'));
  await expect(see(banner, '新しいレポートが 2 件', { exact: true })).toBeVisible();
  await expect(see(banner, '今週のまとめ・10月31日のまとめ', { exact: true })).toBeVisible();
  // 2件のときの「見る」は、いちばん新しいレポートの詳細を直接開く（一覧はない）
  await button(banner, 'いちばん新しいレポートを見る').click();
  await expect(periodTabs(page)).toBeVisible();
  await expect(periodTab(page, '日')).toHaveAttribute('aria-selected', 'true');
  await expect(see(band(page), '10月31日（土）', { exact: true })).toBeVisible();
  await button(page, '戻る').click();
  await goTab(page, 'ホーム');

  // ホーム：残りの1件。「見る」でそのレポートを開き、戻るとお知らせは消える
  await expect(see(banner, '新しいレポートが 1 件', { exact: true })).toBeVisible();
  await button(banner, '新しいレポートを見る').click();
  await expect(see(band(page), '気をつけたい', { exact: true })).toBeVisible();
  await expect(see(band(page), '今週のまとめ', { exact: true })).toBeVisible();
  await button(page, '戻る').click();
  await expect(tab(page, 'ホーム')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('latest-report').filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId('new-report-banner').filter({ visible: true }).and(page.locator(':not([aria-hidden="true"] *)'))).toHaveCount(0);
});

test('新しいレポートのお知らせの「×」：今の分を全部見たことにする', async ({ page, context }) => {
  await connect(page, context, serverWithReport());
  await openApp(page);
  await signInAndSync(page);
  const banner = page.getByTestId('new-report-banner').filter({ visible: true }).and(page.locator(':not([aria-hidden="true"] *)'));
  await expect(see(banner, '新しいレポートが 1 件', { exact: true })).toBeVisible();
  await button(banner, 'お知らせを閉じる。今出ている分は、見たことにします').click();
  await expect(page.getByTestId('new-report-banner').filter({ visible: true }).and(page.locator(':not([aria-hidden="true"] *)'))).toHaveCount(0);
  // レポートのタブは詳細へ直行する（新着の札つきの一覧はない）
  await openReportsTab(page);
  await expect(see(band(page), '今週のまとめ', { exact: true })).toBeVisible();
});

test('レポートは下のタブの5つ目。空のときは作り方を出し、今までの URL から来てもレポートのタブへ', async ({ page }) => {
  await openApp(page);
  await tab(page, 'レポート').click();
  await expect(tab(page, 'レポート')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'レポート', exact: true }).filter({ visible: true })).toBeVisible();
  await expect(see(page, 'レポートはまだありません')).toBeVisible();
  await expect(button(page, '自動で作る。ChatGPT のスケジュールに、まとめを作る予定を入れます')).toBeVisible();
  await expect(button(page, '戻る')).toHaveCount(0);

  // 前の一覧の URL（/reports、お知らせの /reports?order=newest）は、レポートのタブで開く
  await page.goto('/reports?order=newest');
  await expect(tab(page, 'レポート')).toHaveAttribute('aria-selected', 'true');
  await expect(see(page, 'レポートはまだありません')).toBeVisible();

  // 中身の URL を直接開いたときは、戻るでホームへ（レポートのタブへ戻すと、最新の詳細へ直行して同じ画面に戻ってしまうため）
  await page.goto('/reports/no-such-report');
  await expect(see(page, 'レポートが見つかりません')).toBeVisible();
  await button(page, '戻る').click();
  await expect(tab(page, 'ホーム')).toHaveAttribute('aria-selected', 'true');
  await expect(homeIcon(page)).toBeVisible();
});

test('レポートのタブにお知らせの帯はない（帯はホームだけ）。詳細を開くと見たことになり、ホームの帯も消える', async ({ page, context }) => {
  await connect(page, context, serverWithReport());
  await openApp(page);
  await signInAndSync(page);
  // 後ろに重なったホームのタブ（aria-hidden）の帯は数えない
  const shown = (l: Locator) => l.filter({ visible: true }).and(page.locator(':not([aria-hidden="true"] *)'));

  // ホームには帯が出る
  const banner = shown(page.getByTestId('new-report-banner'));
  await expect(see(banner, '新しいレポートが 1 件', { exact: true })).toBeVisible();
  await expect(see(banner, '今週のまとめ', { exact: true })).toBeVisible();

  // レポートのタブは詳細へ直行し、帯は出ない
  await openReportsTab(page);
  await expect(shown(page.getByTestId('new-report-banner'))).toHaveCount(0);
  await expect(see(band(page), '今週のまとめ', { exact: true })).toBeVisible();

  // 詳細を開いたので見たことになり、ホームに戻っても帯は出ない
  await button(page, '戻る').click();
  await goTab(page, 'ホーム');
  await expect(page.getByTestId('latest-report').filter({ visible: true })).toBeVisible();
  await expect(shown(page.getByTestId('new-report-banner'))).toHaveCount(0);
});
