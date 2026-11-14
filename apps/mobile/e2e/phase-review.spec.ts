import { BrowserContext, expect, Page, test } from '@playwright/test';
import { createFakeSyncServer, FakeSyncServer } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { button, enterBody, goPane, goTab, openApp, openBody, openSettings, settle } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// フェーズ ⑤ のアプリ側：振り返り（/phase/review/[id]）と療養（ケガの詳細から入る・直せたら終えるかを聞く・終える）。
// 計算（終わりの時点の記録・達成の度合い・維持を挟む案・療養の対象のケガ）は jest（lib/__tests__/phaseReview.test.ts・phaseView.test.ts）。
// ここでは画面の流れ。記録は偽の同期サーバーから入れる（フェーズを画面で始める流れは phase.spec.ts）。今日は 2026-11-08（日）。
// SHOT_DIR を渡すと、412 の幅で振り返り（レポートあり・なし）と療養の入口・詳細を <SHOT_DIR>/phase5-*.png に撮る

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };
const AT = '2026-11-08T01:00:00.000Z';
const BULK = 'ffffffff-0000-4000-8000-000000000011';
const INJURY = 'cccccccc-0000-4000-8000-000000000011';
const REPORT = 'aaaaaaaa-0000-4000-8000-000000000011';
const BENCH = 'd41c7096-c246-4dfa-945a-e1cb329977a6';

const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const phaseLine = (page: Page) => visible(page, 'hero-phase');
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).filter({ visible: true });
const mcp = { parent_id: null, changed_at: AT, origin: 'mcp' as const, device_id: null };
type Change = Parameters<FakeSyncServer['append']>[0][number];
const change = (entity_type: string, entity_id: string, fields: Record<string, unknown>): Change =>
  ({ ...mcp, change_id: crypto.randomUUID(), entity_type, entity_id, op: 'create', fields }) as Change;

async function shot(page: Page, name: string) {
  if (!process.env.SHOT_DIR) return;
  await page.setViewportSize({ width: 412, height: 1600 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/phase5-${name}.png` });
  await page.setViewportSize({ width: 412, height: 915 });
}

async function openWith(page: Page, context: BrowserContext, changes: Change[]) {
  const server = createFakeSyncServer({ clock: () => AT });
  server.append(changes);
  await fakeCognito(context, { status: 200, body: { access_token: fakeAccessToken('user-a'), refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' } });
  await fakeLoginPopup(page, { code: 'test-code' });
  await context.route(/^https:\/\/[^/]+\.execute-api\.[^/]+\.amazonaws\.com\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS }); return; }
    const res = server.handle(req.method(), req.url(), req.postData() ? JSON.parse(req.postData()!) : undefined);
    await route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body), headers: CORS });
  });
  await openApp(page);
  await openSettings(page);
  await page.getByTestId('settings-account').click();
  await button(page, 'パスキーでログイン').click();
  await expect(page.getByTestId('sync-pending').filter({ visible: true })).toHaveText('0件');
  await button(page, '戻る').click();
  await button(page, '戻る').click();
}

/** 体重（日付, kg） */
const weights = (list: [string, number][]) => list.map(([date, kg], i) =>
  change('body_record', `bbbbbbbb-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, { date, measured_at: `${date}T07:00:00+09:00`, weight_kg: kg, source: 'manual' }));
/** ベンチプレスの 1 セット（日付, kg, 回） */
const benches = (list: [string, number, number][]) => list.flatMap(([date, kg, reps], i) => {
  const entry = `eeeeeeee-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;
  return [
    change('workout_entry', entry, { date, exercise_id: BENCH, sort_order: 0 }),
    change('workout_set', `${entry}-set1`, { entry_id: entry, set_index: 0, weight_kg: kg, reps, memo: '', done: true }),
  ];
});

test('早めに終える → 振り返り（レポートなし）→ ホームの 1 行 → 次のフェーズ（減量のすぐあとの増量は維持を挟む案）→ これまでのフェーズ', async ({ page }) => {
  await openApp(page);
  await openBody(page);
  await enterBody(page, { weight: '82', bodyFat: '21' });
  await goTab(page, 'ホーム');

  await test.step('減量を始めて、すぐに早めに終える。振り返りの画面へ移る', async () => {
    await button(page, 'フェーズは未設定。フェーズを始める').click();
    await settle(visible(page, 'phase-direction-cut'));
    await visible(page, 'phase-direction-cut').click();
    await button(page, '次へ').click();
    await visible(page, 'phase-target').fill('78');
    await button(page, '次へ').click();
    await button(page, 'スキップ（今の目標のまま）').click();
    await button(page, 'この内容で始める').click();
    await expect(phaseLine(page)).toHaveText('CUT 01/12 · NO DATA');
    await phaseLine(page).click();
    await visible(page, 'phase-end').click();
    await expect(page.getByRole('heading', { name: 'フェーズを終えますか？' })).toBeVisible();
    await button(page, '終える').click();
    await expect(heading(page, 'フェーズの振り返り')).toBeVisible();
  });

  await test.step('振り返り：before／after は開始時の記録から、レポートはないのでチャットで作る入口', async () => {
    await expect(visible(page, 'phase-review-hero')).toContainText('減量 12週');
    await expect(visible(page, 'phase-review-before-after')).toContainText('82.0');
    await expect(visible(page, 'phase-review-before-after')).toContainText('21.0');
    await expect(visible(page, 'phase-review-empty')).toBeVisible();
    await expect(button(page, 'チャットで振り返りを作る')).toBeVisible();
    await expect(visible(page, 'phase-review-option-maintain')).toContainText('おすすめ');
    await shot(page, 'review-empty');
  });

  await test.step('戻るとホームの 1 行は CUT DONE · REVIEW。押すと振り返り', async () => {
    await button(page, '戻る').click();
    await expect(phaseLine(page)).toHaveText('CUT DONE · REVIEW');
    await phaseLine(page).click();
    await expect(heading(page, 'フェーズの振り返り')).toBeVisible();
  });

  await test.step('次のフェーズで増量を選ぶと、維持を挟む案が出る。挟むと維持 4 週になる', async () => {
    await visible(page, 'phase-review-option-bulk').click();
    await expect(heading(page, '先に維持を挟みませんか')).toBeVisible();
    await expect(visible(page, 'phase-bridge')).toContainText('減量 12週を終えたばかりです');
    await visible(page, 'phase-bridge-maintain').click();
    await expect(visible(page, 'phase-direction-maintain')).toHaveAttribute('aria-checked', 'true');
    await button(page, '次へ').click();
    await expect(page.getByRole('radio', { name: '期間 4週' }).filter({ visible: true })).toHaveAttribute('aria-checked', 'true');
    // 増量を選び直すと、もう聞かない（強制しない）
    await button(page, '戻る').click();
    await visible(page, 'phase-direction-bulk').click();
    await expect(visible(page, 'phase-direction-bulk')).toHaveAttribute('aria-checked', 'true');
    await expect(heading(page, '先に維持を挟みませんか')).toHaveCount(0);
  });

  await test.step('「このまま増量へ」を選べば増量のまま', async () => {
    await button(page, '戻る').click();
    await expect(heading(page, 'フェーズの振り返り')).toBeVisible();
    await button(page, '次のフェーズを始める').click();
    await settle(visible(page, 'phase-direction-bulk'));
    await visible(page, 'phase-direction-bulk').click();
    await visible(page, 'phase-bridge-keep').click();
    await expect(visible(page, 'phase-direction-bulk')).toHaveAttribute('aria-checked', 'true');
    await button(page, '戻る').click();
  });

  await test.step('設定の「これまでのフェーズ」から振り返りを開く', async () => {
    await button(page, '今は様子見にする').click();
    await openSettings(page);
    await visible(page, 'settings-phase-history').click();
    await expect(heading(page, 'これまでのフェーズ')).toBeVisible();
    await page.getByRole('button', { name: /^減量 12週/ }).filter({ visible: true }).click();
    await expect(heading(page, 'フェーズの振り返り')).toBeVisible();
  });
});

test('振り返りのレポートがあれば文章を出す。レポートの詳細の URL で開いても振り返りの画面へ移る', async ({ page, context }) => {
  // 増量 16 週（7/6〜10/25）。11/1 に終えた。開始時 76.0kg・ベンチ 100（推定1RM）→ 終わり 79.6kg・最後の 28 日のベンチ 105
  const bulk = change('phase', BULK, {
    kind: 'normal', direction: 'bulk', name: '', start_date: '2026-07-06', end_date: '2026-10-25', target_weight_kg: 80, meal_targets: null,
    snapshot: { weight_kg: 76, body_fat_pct: 18.2, big3: { bench: 100, squat: null, deadlift: null }, growth_score: null },
    status: 'ended', paused_phase_id: null, target_history: [], ended_on: '2026-11-01',
  });
  const report = change('report', REPORT, {
    title: '増量 16週の振り返り', kind: 'phase', phase_id: BULK, period_start: '2026-07-06', period_end: '2026-10-31', overall_tone: 'good',
    headline: '体重は目標の 9 割まで増え、ベンチプレスも伸びた',
    highlights: [
      { area: 'meals', tone: 'good', text: '筋トレの日のたんぱく質は 16 週のうち 14 週で目標に届いた' },
      { area: 'meals', tone: 'caution', text: '10〜11 週目は休みの日のカロリーが目標に届かない日が多かった' },
    ],
    next_steps: ['次に減量するなら 8 週ほどで戻せる見込み'], body: '## 次のフェーズ\n\n維持 4 週をはさむのがおすすめ。',
  });
  await openWith(page, context, [bulk, report, ...weights([['2026-10-27', 79.5], ['2026-10-30', 79.7]]), ...benches([['2026-07-01', 100, 1], ['2026-10-20', 90, 5]])]);

  await expect(phaseLine(page)).toHaveText('BULK DONE · REVIEW');
  await phaseLine(page).click();
  await expect(heading(page, 'フェーズの振り返り')).toBeVisible();
  await expect(visible(page, 'phase-review-tier')).toHaveText('ほぼ届いた');
  await expect(visible(page, 'phase-review-summary')).toHaveText('体重は目標の 90%（+3.6 kg / +4.0 kg）・BIG3 は伸びた');
  const r = visible(page, 'phase-review-report');
  await expect(r).toContainText('体重は目標の 9 割まで増え、ベンチプレスも伸びた');
  await expect(r).toContainText('良かった');
  await expect(r).toContainText('課題');
  await expect(visible(page, 'phase-review-handoff')).toContainText('次に減量するなら 8 週ほどで戻せる見込み');
  await expect(visible(page, 'phase-review-empty')).toHaveCount(0);
  await shot(page, 'review-report');

  await page.goto(`/reports/${REPORT}`);
  await expect(heading(page, 'フェーズの振り返り')).toBeVisible();
  await expect(visible(page, 'phase-review-report')).toBeVisible();
});

test('ケガの詳細から療養に入る（増量を止める）→ ケガを直せたにすると終えるかを聞く → 療養を終えて再開する', async ({ page, context }) => {
  const bulk = change('phase', BULK, {
    kind: 'normal', direction: 'bulk', name: '', start_date: '2026-09-28', end_date: '2027-01-17', target_weight_kg: 80, meal_targets: null,
    snapshot: { weight_kg: 74, body_fat_pct: null, big3: null, growth_score: null },
    status: 'active', paused_phase_id: null, target_history: [], ended_on: null,
  });
  const injury = change('injury', INJURY, {
    occurred_on: '2026-11-06', site: 'shoulder_joint', side: 'right', exercise_id: BENCH, phase: 'ラックアップ', symptom: '肩の前に違和感', cause: '', fix: '',
    status: 'fixing', fixed_on: null,
  });
  await openWith(page, context, [bulk, injury]);

  await test.step('ケガの詳細の「このケガで療養に入る」：止めるフェーズと、ペースを判定しないことを確かめてから入る', async () => {
    await goTab(page, '筋トレ');
    await goPane(page, 'ケガ');
    await page.getByRole('button', { name: /^右肩の関節、直している途中/ }).filter({ visible: true }).click();
    await visible(page, 'injury-rehab').click();
    await expect(heading(page, '右肩の関節のケガで療養に入る')).toBeVisible();
    const notes = visible(page, 'rehab-start-notes');
    await expect(notes).toContainText('増量 16週（6週目）。時計を止め、療養の日数だけ終わりの日を後ろにずらします。');
    await expect(notes).toContainText('体重のペースを判定しません');
    await expect(visible(page, 'phase-rehab-name')).toHaveValue('右肩の関節');
    await shot(page, 'rehab-entry');
    await visible(page, 'phase-rehab-save').click();
    await expect(heading(page, '右肩の関節')).toBeVisible();
    await expect(visible(page, 'phase-paused')).toContainText('止めているフェーズ：増量 16週');
    await expect(visible(page, 'phase-rehab-watch')).toContainText('療養中に見るもの');
    await expect(visible(page, 'phase-rehab-ready')).toHaveCount(0);
  });

  await test.step('戻ると、療養中なのでケガの詳細に入口はない。直せたにする', async () => {
    await button(page, '戻る').click();
    await expect(visible(page, 'injury-rehab')).toHaveCount(0);
    await visible(page, 'injury-fixed').click();
    await expect(visible(page, 'injury-reopen')).toBeVisible();
  });

  await test.step('療養の詳細に「直せたになりました。療養を終えますか」。まだ続けるで閉じる', async () => {
    await button(page, '戻る').click();
    await goTab(page, 'ホーム');
    await expect(phaseLine(page)).toHaveText('REHAB DAY 01 · BULK PAUSED');
    await phaseLine(page).click();
    await expect(visible(page, 'phase-rehab-ready')).toContainText('右肩の関節が「直せた」になりました');
    await shot(page, 'rehab-detail');
    await visible(page, 'phase-rehab-ready-keep').click();
    await expect(visible(page, 'phase-rehab-ready')).toHaveCount(0);
  });

  await test.step('療養を終える：再開すると増量に戻る', async () => {
    await visible(page, 'phase-end-rehab').click();
    await expect(visible(page, 'phase-resume')).toBeVisible();
    await visible(page, 'phase-resume').click();
    await expect(heading(page, '増量 16週')).toBeVisible();
    await button(page, '戻る').click();
    await expect(phaseLine(page)).toHaveText('BULK 06/16 · NO DATA');
  });
});

test('療養を終えて「振り返って次へ」：止めていたフェーズも終え、その振り返りへ', async ({ page, context }) => {
  const bulk = change('phase', BULK, {
    kind: 'normal', direction: 'bulk', name: '', start_date: '2026-09-28', end_date: '2027-01-17', target_weight_kg: 80, meal_targets: null,
    snapshot: { weight_kg: 74, body_fat_pct: null, big3: null, growth_score: null },
    status: 'active', paused_phase_id: null, target_history: [], ended_on: null,
  });
  const rehab = change('phase', 'ffffffff-0000-4000-8000-000000000012', {
    kind: 'rehab', direction: null, name: '', start_date: '2026-11-06', end_date: null, target_weight_kg: null, meal_targets: null, snapshot: null,
    status: 'active', paused_phase_id: BULK, target_history: [], ended_on: null,
  });
  await openWith(page, context, [bulk, rehab]);
  await phaseLine(page).click();
  await visible(page, 'phase-end-rehab').click();
  await visible(page, 'phase-rehab-finish').click();
  await expect(heading(page, 'フェーズの振り返り')).toBeVisible();
  await expect(visible(page, 'phase-review-hero')).toContainText('増量 16週');
  // 療養で止めた日（11/6・11/7）は週の数に入れない
  await expect(visible(page, 'phase-review-hero')).toContainText('療養で止めた 2日');
  await button(page, '戻る').click();
  await expect(phaseLine(page)).toHaveText('BULK DONE · REVIEW');
});
