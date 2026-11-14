import { BrowserContext, expect, Page, test } from '@playwright/test';
import { createFakeSyncServer, FakeSyncServer } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { button, openApp, openSettings, swipe } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// ホームのヒーロー（刷新 A のその 2）：フェーズの 1 行と輪、横スライドの 4 ページ、BIG3 の Δ PHASE、LOG のフェーズの週。
// フェーズ・体重・筋トレ・ケガは偽の同期サーバーから入れる（フェーズを画面で始める流れは phase.spec.ts）。計算は jest（lib/__tests__/homeHero.test.ts）。
// web では 3D の体を描かないので、RECOVERY・INJURY は 2D の図になる。今日は 2026-11-08（日）

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };
const AT = '2026-11-08T01:00:00.000Z';
const BULK = 'ffffffff-0000-4000-8000-000000000001';
const REHAB = 'ffffffff-0000-4000-8000-000000000002';
const INJURY = 'cccccccc-0000-4000-8000-000000000001';
const BENCH = 'd41c7096-c246-4dfa-945a-e1cb329977a6';

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const mcp = { parent_id: null, changed_at: AT, origin: 'mcp' as const, device_id: null };
type Change = Parameters<FakeSyncServer['append']>[0][number];

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

const change = (entity_type: string, entity_id: string, fields: Record<string, unknown>): Change =>
  ({ ...mcp, change_id: crypto.randomUUID(), entity_type, entity_id, op: 'create', fields }) as Change;

/** 増量 16 週（9/28 開始、74kg → 80kg）。開始時のベンチプレスの推定1RM は 60kg。今日は 6 週目 */
const bulk = change('phase', BULK, {
  kind: 'normal', direction: 'bulk', name: '', start_date: '2026-09-28', end_date: '2027-01-17', target_weight_kg: 80, meal_targets: null,
  snapshot: { weight_kg: 74, body_fat_pct: null, big3: { bench: 60, squat: null, deadlift: null }, growth_score: null },
  status: 'active', paused_phase_id: null, target_history: [], ended_on: null,
});
/** 11/4 と 11/7 の体重（7 日に 2 日。予定とほぼ同じなので順調） */
const weights = [['2026-11-04', 76.2], ['2026-11-07', 76.3]].map(([date, kg], i) =>
  change('body_record', `bbbbbbbb-0000-4000-8000-00000000000${i + 1}`, { date, measured_at: `${date}T07:00:00+09:00`, weight_kg: kg, source: 'manual' }));
/** 11/7 のベンチプレス 60kg × 8（推定1RM 76kg） */
const bench = [
  change('workout_entry', 'eeeeeeee-0000-4000-8000-000000000001', { date: '2026-11-07', exercise_id: BENCH, sort_order: 0 }),
  change('workout_set', 'eeeeeeee-0000-4000-8000-000000000001-set1', { entry_id: 'eeeeeeee-0000-4000-8000-000000000001', set_index: 0, weight_kg: 60, reps: 8, memo: '', done: true }),
];
/** 11/6 に右肩の関節を痛め、直している途中 */
const injury = change('injury', INJURY, {
  occurred_on: '2026-11-06', site: 'shoulder_joint', side: 'right', exercise_id: BENCH, phase: 'ラックアップ', symptom: '肩の前に違和感', cause: '', fix: '',
  status: 'fixing', fixed_on: null,
});
/** 11/6 から療養（増量を止める）。今日は 3 日目 */
const rehab = change('phase', REHAB, {
  kind: 'rehab', direction: null, name: '', start_date: '2026-11-06', end_date: null, target_weight_kg: null, meal_targets: null, snapshot: null,
  status: 'active', paused_phase_id: BULK, target_history: [], ended_on: null,
});

async function openWith(page: Page, context: BrowserContext, changes: Change[]) {
  const server = createFakeSyncServer({ clock: () => AT });
  server.append(changes);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
}

test('フェーズ未設定：NO PHASE · + START、輪は灰色の枠だけ。ページは 3 つで、横スワイプと印で切り替える。1 行を押すとフェーズの設定', async ({ page }) => {
  await openApp(page);
  const line = button(page, 'フェーズは未設定。フェーズを始める');
  await expect(line).toHaveText('NO PHASE · + START');
  await expect(visible(page, 'hero-ring-footer')).toHaveCount(0);
  // ケガがないので INJURY のページはない
  await expect(visible(page, 'hero-pages').getByRole('tab')).toHaveCount(3);
  await expect(visible(page, 'hero-page-injury')).toHaveCount(0);
  await expect(visible(page, 'hero-pages')).toContainText('01/03 LATEST');

  // 左へスワイプで RECOVERY（記録がないので回復済み 0／全体、回復中なし）
  await swipe(visible(page, 'hero-swipe'), 'next');
  await expect(visible(page, 'hero-page-recovery')).toHaveAttribute('aria-selected', 'true');
  await expect(visible(page, 'hero-pages')).toContainText('02/03 RECOVERY');
  await expect(page.getByTestId('home-latest')).toHaveCount(0);
  await expect(visible(page, 'hero-recovery')).toHaveAccessibleName(/^回復。回復済み \d+部位（\d+部位のうち）。回復中の部位はありません。回復マップを開く$/);
  await expect(visible(page, 'hero-recovery-2d')).toBeVisible();
  // 縦に大きく動かしたときはページを変えない
  await swipe(visible(page, 'hero-swipe'), 'next', 200);
  await expect(visible(page, 'hero-page-recovery')).toHaveAttribute('aria-selected', 'true');
  // 右へスワイプで LATEST に戻る。いちばん左ではそれ以上動かない
  await swipe(visible(page, 'hero-swipe'), 'prev');
  await expect(visible(page, 'hero-page-latest')).toHaveAttribute('aria-selected', 'true');
  await swipe(visible(page, 'hero-swipe'), 'prev');
  await expect(visible(page, 'hero-page-latest')).toHaveAttribute('aria-selected', 'true');
  // 印を押して GROWTH。フェーズがないので内の輪と白い線は出さない
  await visible(page, 'hero-page-growth').click();
  await expect(visible(page, 'hero-pages')).toContainText('03/03 GROWTH');
  await expect(page.getByTestId('hero-ring-inner')).toHaveCount(0);
  await expect(page.getByTestId('hero-ring-plan')).toHaveCount(0);
  // LOG はふだんの W1〜W4
  await expect(visible(page, 'home-log')).toContainText('LOG // W1-W4');

  await line.click();
  await expect(page.getByRole('heading', { name: 'フェーズを始める' }).filter({ visible: true })).toBeVisible();
  await button(page, '戻る').click();
  await expect(line).toBeVisible();
});

test('フェーズ実施中：BULK 06/16 · ON TRACK と残り 10週、GROWTH の四隅と内の輪、BIG3 の Δ PHASE、LOG はフェーズの週。1 行を押すと進み具合', async ({ page, context }) => {
  await openWith(page, context, [bulk, ...weights, ...bench]);
  const line = button(page, '増量 16週のうち6週目。ペース 順調。フェーズの進み具合を開く');
  await expect(line).toHaveText('BULK 06/16 · ON TRACK');
  await expect(visible(page, 'hero-ring-footer')).toHaveText('残り 10週');
  // 最初は LATEST
  await expect(visible(page, 'hero-page-latest')).toHaveAttribute('aria-selected', 'true');
  // BIG3：開始時（ベンチ 60）から今（76）へ
  await expect(visible(page, 'home-big3')).toContainText('Δ PHASE +16.0');
  await expect(visible(page, 'home-big3')).toHaveAttribute('aria-label', /フェーズの開始より \+16\.0kg/);
  // LOG：今週がフェーズの 6 週目
  await expect(visible(page, 'home-log')).toContainText('LOG // W3-W6');
  await expect(visible(page, 'log-current-week')).toContainText('W6');

  await visible(page, 'hero-page-growth').click();
  await expect(visible(page, 'hero-growth')).toHaveAccessibleName('フェーズ 増量。ペース 順調。体重 週平均 76.3kg、目標 80.0kg。フェーズの進み具合を開く');
  const hero = visible(page, 'hero-swipe');
  await expect(hero).toContainText('PHASE //増量06/16W');
  await expect(hero).toContainText('PACE //順調ON TRACK');
  await expect(hero).toContainText('WEIGHT76.3→ 80.0 KG');
  await expect(page.getByTestId('hero-ring-inner')).toHaveCount(1);
  await expect(page.getByTestId('hero-ring-plan')).toHaveCount(1);

  await line.click();
  await expect(page.getByRole('heading', { name: '増量 16週' }).filter({ visible: true })).toBeVisible();
  await expect(visible(page, 'phase-pace-status')).toHaveText('順調');
  await button(page, '戻る').click();
  await expect(line).toBeVisible();
});

test('療養中：REHAB DAY 03 · BULK PAUSED、最初のページは INJURY（四隅と札）。輪の下は止めたフェーズ。ページは 4 つ', async ({ page, context }) => {
  await openWith(page, context, [bulk, ...weights, ...bench, injury, rehab]);
  await expect(button(page, '療養 3日目。増量は止めています。フェーズの進み具合を開く')).toHaveText('REHAB DAY 03 · BULK PAUSED');
  await expect(visible(page, 'hero-ring-footer')).toHaveText('増量 06/16 · 停止中');
  await expect(visible(page, 'hero-pages').getByRole('tab')).toHaveCount(4);
  await expect(visible(page, 'hero-page-injury')).toHaveAttribute('aria-selected', 'true');
  await expect(visible(page, 'hero-pages')).toContainText('03/04 INJURY');
  const injuryCorner = visible(page, 'hero-injury');
  await expect(injuryCorner).toHaveAccessibleName('ケガ。直している途中 1件。直している部位 右肩の関節、振り返りはまだ。11月6日（金）から 3日目。ケガの一覧を開く');
  const hero = visible(page, 'hero-swipe');
  await expect(hero).toContainText('INJURY //1ACTIVE');
  await expect(hero).toContainText('FIX //右肩の関節NO REVIEW');
  await expect(hero).toContainText('SINCE11/6DAY 03');
  await expect(hero).toContainText('ALERT0REVIEW');
  await expect(visible(page, 'hero-injury-tag')).toContainText('INJ-01 ▲右肩の関節● 直し中');
  // RECOVERY へ戻ると、ケガの数と回復中の胸（11/7 のベンチプレス）
  await swipe(hero, 'prev');
  await expect(visible(page, 'hero-page-recovery')).toHaveAttribute('aria-selected', 'true');
  await expect(hero).toContainText('INJURY1FIXING');
  await expect(visible(page, 'hero-recovery')).toHaveAccessibleName(/回復中 胸 あと\d日。直している途中のケガ 1件。回復マップを開く$/);
  // BIG3 と LOG は止めたフェーズのまま
  await expect(visible(page, 'home-big3')).toContainText('Δ PHASE +16.0');
  await expect(visible(page, 'home-log')).toContainText('LOG // W3-W6');
  // INJURY の左上を押すとケガの一覧
  await swipe(hero, 'next');
  await injuryCorner.click();
  await expect(page.getByRole('tab', { name: 'ケガ', exact: true }).filter({ visible: true })).toHaveAttribute('aria-selected', 'true');
});
