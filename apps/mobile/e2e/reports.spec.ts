import { BrowserContext, expect, Page, test } from '@playwright/test';
import { createFakeSyncServer, FakeSyncServer } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { button, goTab, openApp, openSettings, see, TODAY } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// レポート（Claude・ChatGPT が MCP の save_report で書いたまとめ）と、食事の推定の根拠。
// サーバーは偽物（test-utils/fakeSyncServer.ts）。MCP で保存したものを偽のサーバーに入れ、同期で受け取って画面に出ることと、
// 消すとサーバーに delete が届くことを確かめる。読み方・消し方・積み直さない決まりは jest（db/__tests__/reports.test.ts）

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };
const REPORT = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEAL = 'bbbbbbbb-0000-4000-8000-000000000001';
const DAILY = 'aaaaaaaa-0000-4000-8000-000000000002';

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
  await page.getByRole('button', { name: /^ログイン ログイン/ }).click();
  await button(page, 'パスキーでログイン').click();
  await expect(page.getByTestId('sync-pending').filter({ visible: true })).toHaveText('0件');
  await button(page, '戻る').click();
  await button(page, '戻る').click();
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
  await expect(button(page, 'すべてのレポート')).toHaveCount(0);
});

test('MCP で保存したレポートが、ホーム → 一覧 → 中身に出て、消すとサーバーに届く', async ({ page, context }) => {
  const server = serverWithReport();
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);

  // ホームの最新のレポート：調子は色だけでなく言葉でも出す
  const card = page.getByRole('button', { name: /^気をつけたい、今週のまとめ、睡眠が短い日が多かった、/ }).filter({ visible: true });
  await expect(card).toBeVisible();
  await expect(card).toHaveAccessibleName(/睡眠（平均） 5\.8 時間、前より 0\.6 減った、気をつけたい変化/);
  await button(page, 'すべてのレポート').click();
  await expect(see(page, 'チャット（Claude・ChatGPT）で作ったまとめです。期間の日付の新しい順に、月ごとに並びます。')).toBeVisible();
  // 同期で届いた、まだ開いていないものには「新着」
  await page.getByRole('button', { name: /^新着、気をつけたい、今週のまとめ/ }).filter({ visible: true }).click();

  // 中身：帯・指標・分野ごと・次の一歩・本文（リンクは文字のまま）
  const band = page.getByTestId('report-band').filter({ visible: true });
  await expect(see(band, '気をつけたい', { exact: true })).toBeVisible();
  await expect(see(band, '11月2日（月）〜11月8日（日）')).toBeVisible();
  // 今週の目標（アプリが記録から出す）
  await expect(page.getByRole('heading', { name: '今週の目標', exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel(/^睡眠、睡眠（平均） 5\.8 時間/).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('筋トレ、良い。脚の日が2回に増えた').filter({ visible: true })).toBeVisible();
  await expect(see(page, '来週の一歩', { exact: true })).toBeVisible();
  const body = page.getByTestId('report-body').filter({ visible: true });
  await expect(see(body, '[ここを押す](https://example.invalid)')).toBeVisible();
  await expect(body.locator('a')).toHaveCount(0);

  // 消す：確認のダイアログ → 一覧に戻り、空の状態。サーバーにも delete が届く
  await button(page, 'このレポートを消す').click();
  await expect(see(page, 'レポートを消しますか？')).toBeVisible();
  await button(page, 'やめる').click();
  await expect(see(page, 'レポートを消しますか？')).toHaveCount(0);
  await button(page, 'このレポートを消す').click();
  await button(page, '消す').click();
  await expect(see(page, 'レポートはまだありません')).toBeVisible();
  await expect.poll(() => server.state('report', REPORT)?.deleted, { timeout: 15_000 }).toBe(true);
});

test('日のまとめ（daily）は、種類の名前・その日だけの期間・前の日との比べ・明日の一歩を出す', async ({ page, context }) => {
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

  const band = page.getByTestId('report-band').filter({ visible: true });
  await expect(see(band, '日のまとめ ・ 11月9日に作成')).toBeVisible();
  await expect(see(band, '11月9日（月）', { exact: true })).toBeVisible();
  // この日の達成（アプリが記録から出す。記録がなければ「記録なし」）。指標のタイルは出さず、指標は分野のカードに小さく
  await expect(page.getByRole('heading', { name: 'この日の達成', exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('筋トレ、記録なし', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId('report-tiles')).toHaveCount(0);
  await expect(see(page, '前の日より', { exact: true })).toBeVisible();
  await expect(see(page, '明日の一歩', { exact: true })).toBeVisible();
});

test('その日の日のまとめは、筋トレ・食事・からだのタブに分野ごとに出て、押すと中身。一覧は種類で絞れる', async ({ page, context }) => {
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
  await expect(see(section(), '今日のまとめから', { exact: true })).toBeVisible();
  await expect(section().getByRole('button')).toHaveCount(1);
  await button(page, '筋トレ、良い。ベンチプレスを3セット。合計負荷量 2.33 t、前より 0.4 増えた、良い変化').click();
  await expect(see(page.getByTestId('report-band').filter({ visible: true }), '日のまとめ ・ 11月8日に作成')).toBeVisible();
  await button(page, '戻る').click();

  // 食事：meals だけ。日のまとめのない前の日は、場所も取らない
  await goTab(page, '食事');
  await expect(section().getByRole('button')).toHaveCount(1);
  await expect(button(section(), '食事、変わらない。たんぱく質は 98g')).toBeVisible();
  await button(page, '前の日').click();
  await expect(see(page, '11月7日（土）', { exact: true })).toBeVisible();
  // 隠れたタブ（筋トレ）の分は数えない（役割で探すと、隠れたものは入らない）
  await expect(page.getByRole('heading', { name: /のまとめから$/ })).toHaveCount(0);
  await expect(button(page, '食事、変わらない。たんぱく質は 98g')).toHaveCount(0);

  // からだ：body と sleep
  await goTab(page, 'からだ');
  await expect(section().getByRole('button')).toHaveCount(2);
  await expect(button(section(), 'からだ、気をつけたい。体重が 0.6kg 増えた')).toBeVisible();
  await expect(button(section(), '睡眠、変わらない。睡眠はいつもどおり')).toBeVisible();

  // 一覧：種類のラベル・月の見出し・絞り込み・0件の空の状態
  await goTab(page, 'ホーム');
  await button(page, 'すべてのレポート').click();
  await expect(page.getByRole('heading', { name: '11月', exact: true }).filter({ visible: true })).toBeVisible();
  // 週のまとめはまだ開いていない（新着）。日のまとめは筋トレのタブから開いた
  const weekly = page.getByRole('button', { name: /^新着、気をつけたい、今週のまとめ、睡眠が短い日が多かった、週のまとめ、/ }).filter({ visible: true });
  const day = page.getByRole('button', { name: /^良い調子、11月8日のまとめ、ベンチプレスが伸びた日、日のまとめ、/ }).filter({ visible: true });
  await expect(weekly).toBeVisible();
  await expect(day).toBeVisible();
  await button(page, '日').click();
  await expect(button(page, '日')).toHaveAttribute('aria-selected', 'true');
  await expect(weekly).toHaveCount(0);
  await expect(day).toBeVisible();
  await expect(see(page, '日のまとめだけを出しています。期間の日付の新しい順に、月ごとに並びます。')).toBeVisible();
  await button(page, '月').click();
  await expect(see(page, '月のまとめはまだありません')).toBeVisible();
  await expect(button(page, 'チャットで作る。ChatGPT か Claude を開きます')).toBeVisible();
  await button(page, 'すべて').click();
  await expect(weekly).toBeVisible();
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
  await expect(see(page, 'つながり', { exact: true })).toBeVisible();
  await expect(page.getByLabel('睡眠から筋トレへ（2週）。睡眠が6時間を切った週は、筋トレの回数が半分だった', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(see(page, '睡眠 → 筋トレ・2週', { exact: true })).toBeVisible();
  // 体重の記録がないので、体の変化は出さない
  await expect(page.getByTestId('report-body-change')).toHaveCount(0);
  const review = page.getByTestId('report-review').filter({ visible: true });
  await expect(see(review, '体重のペースが目標より遅めです。食事の目標を少し下げる案があります。')).toBeVisible();
  await expect(see(page, '来月の一歩', { exact: true })).toBeVisible();
  await button(review, '食事の目標を開く').click();
  await expect(page).toHaveURL(/\/meals\/goal$/);
});

test('新しいレポートのお知らせ：届いた件数と中身。「見る」で一覧（2件）・そのレポート（1件）。開いたら新着が消える。並び順は端末に覚える', async ({ page, context }) => {
  const server = serverWithReport(); // 今週のまとめ（11月2日〜8日）
  const at = '2026-11-08T12:00:00.000Z';
  server.setClock(() => at);
  // 10月31日の日のまとめを、あとから作った（作った日は新しいが、期間の日付で後ろに並ぶ）
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

  const banner = page.getByTestId('new-report-banner').filter({ visible: true });
  await expect(see(banner, '新しいレポートが 2 件', { exact: true })).toBeVisible();
  await expect(see(banner, '今週のまとめ・10月31日のまとめ', { exact: true })).toBeVisible();
  await button(banner, '新しいレポートを一覧で見る').click();

  // 一覧：期間の日付の新しい順。月の見出しも期間の日付。どちらも新着
  const cards = page.getByTestId(/^report-[0-9a-f]{8}-/).filter({ visible: true });
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAccessibleName(/^新着、気をつけたい、今週のまとめ、/);
  await expect(cards.nth(1)).toHaveAccessibleName(/^新着、良い調子、10月31日のまとめ、日のまとめ、期間 10月31日（土）/);
  await expect(page.getByRole('heading', { name: '10月', exact: true }).filter({ visible: true })).toBeVisible();
  await expect(button(page, '自動で作る。ChatGPT のスケジュールに、まとめを作る予定を入れます')).toBeVisible();
  // 要約と指標のない日のまとめも、カードの高さは同じ
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(Math.round(b!.height)).toBe(Math.round(a!.height));

  // 並べ替え：古い順に変えると逆に並ぶ。開き直しても覚えている
  await button(page, '並び順、新しい順。押すと古い順にします').click();
  await expect(cards.nth(0)).toHaveAccessibleName(/10月31日のまとめ/);
  await cards.nth(0).click();
  await expect(page.getByTestId('report-band').filter({ visible: true })).toBeVisible();
  await button(page, '戻る').click();
  await expect(button(page, '並び順、古い順。押すと新しい順にします')).toBeVisible();
  await expect(cards.nth(0)).toHaveAccessibleName(/^良い調子、10月31日のまとめ/); // 開いたので新着が消えた
  // 「新着」の札がなくても、高さは同じ
  const [c, d] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(Math.round(c!.height)).toBe(Math.round(d!.height));
  await button(page, '戻る').click();

  // ホーム：残りの1件。「見る」でそのレポートを開き、戻るとお知らせは消える
  await expect(see(banner, '新しいレポートが 1 件', { exact: true })).toBeVisible();
  await button(banner, '新しいレポートを見る').click();
  await expect(see(page.getByTestId('report-band').filter({ visible: true }), '気をつけたい', { exact: true })).toBeVisible();
  await button(page, '戻る').click();
  await expect(page.getByTestId('latest-report').filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId('new-report-banner').filter({ visible: true })).toHaveCount(0);
});

test('新しいレポートのお知らせの「×」：今の分を全部見たことにする', async ({ page, context }) => {
  await connect(page, context, serverWithReport());
  await openApp(page);
  await signInAndSync(page);
  const banner = page.getByTestId('new-report-banner').filter({ visible: true });
  await expect(see(banner, '新しいレポートが 1 件', { exact: true })).toBeVisible();
  await button(banner, 'お知らせを閉じる。今出ている分は、見たことにします').click();
  await expect(page.getByTestId('new-report-banner').filter({ visible: true })).toHaveCount(0);
  await button(page, 'すべてのレポート').click();
  await expect(page.getByRole('button', { name: /^気をつけたい、今週のまとめ/ }).filter({ visible: true })).toBeVisible();
});
