import { BrowserContext, expect, Page, test } from '@playwright/test';
import { createFakeSyncServer, FakeSyncServer } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { button, openApp, openSettings, settle, tab } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// レポート詳細の見た目の確認用（Issue #203）。SHOT_DIR を渡したときだけ動く（ふだんの e2e では飛ばす）。
// 承認済みのモック（ブランチ docs/report-mock の docs/report-mock/index.html）と同じ 2026-11-12 のデータを偽のサーバーに入れ、
// 日・週・月の詳細を 412 の幅で上から下まで撮る（<SHOT_DIR>/report-{daily,weekly,monthly}.png）。モックと並べて見比べる
test.skip(!process.env.SHOT_DIR, 'SHOT_DIR を渡したときだけ撮る');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };
const BENCH = 'd41c7096-c246-4dfa-945a-e1cb329977a6';
const SQUAT = 'a902b077-031a-4de6-814b-9ffb69b96778';
const DEADLIFT = '2b2e0dc4-c98d-4656-95f6-e9a21cf03004';
const DAY = '2026-11-12';

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

function seed() {
  const server = createFakeSyncServer({ clock: () => '2026-11-12T03:00:00.000Z' });
  const at = '2026-11-12T03:00:00.000Z';
  const mcp = { parent_id: null, changed_at: at, origin: 'mcp' as const, device_id: null };
  const c = (entity_type: string, entity_id: string, fields: Record<string, unknown>, parent_id: string | null = null) =>
    ({ ...mcp, parent_id, change_id: crypto.randomUUID(), entity_type, entity_id, op: 'create' as const, fields });
  // 体重：10/16 の 71.2kg から 11/11 の 69.4kg へ下がり、11/12 に 69.8kg（28日の傾向は下向き、前日より +0.4）
  const weights: [string, number][] = [
    ['2026-10-16', 71.2], ['2026-10-20', 70.9], ['2026-10-24', 70.6], ['2026-10-28', 70.3], ['2026-11-01', 70.0], ['2026-11-04', 69.7],
    ['2026-11-07', 69.5], ['2026-11-09', 69.3], ['2026-11-10', 69.2], ['2026-11-11', 69.4], [DAY, 69.8],
  ];
  const sets: [string, string, number, number][] = [
    ['2026-11-02', BENCH, 50, 5], ['2026-11-03', SQUAT, 60, 5], ['2026-11-05', DEADLIFT, 30, 5],
    ['2026-11-09', BENCH, 60, 8], ['2026-11-10', SQUAT, 70, 5], ['2026-11-11', DEADLIFT, 40, 5],
  ];
  server.append([
    c('setting', 'goal_weight_kg', { value: '80' }),
    ...weights.map(([date, kg], i) => c('body_record', `f0000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, {
      date, measured_at: `${date}T07:00:00+09:00`, weight_kg: kg, body_fat_pct: date === DAY ? 21.2 : null, source: 'manual',
    })),
    ...sets.flatMap(([date, ex, w, reps], i) => {
      const id = `eeeeeeee-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;
      return [
        c('workout_entry', id, { date, exercise_id: ex, sort_order: 0 }),
        ...[0, 1, 2].map((k) => c('workout_set', `${id}-${k}`, { entry_id: id, set_index: k, weight_kg: w, reps, memo: '', done: true })),
      ];
    }),
    c('nutrition_goal', 'current', {
      policy: 'bulk', body_weight_kg: 70, protein_per_kg: 2,
      targets: { training_day: { kcal: 2600, fat_g: 70, carbs_g: 330 }, rest_day: { kcal: 2290, fat_g: 65, carbs_g: 280 } },
    }),
    c('day_type', DAY, { day_type: 'rest' }),
    c('meal', 'bbbbbbbb-0000-4000-8000-000000000001', { date: DAY, slot: 'lunch', time: '11:00', description: '定食', source: 'text' }),
    c('meal_item', 'i1', { name: '定食', amount: 1, unit: '個', kcal: 2396, protein_g: 122, fat_g: 60, carbs_g: 300, confidence: 'high', sort_order: 0 }, 'bbbbbbbb-0000-4000-8000-000000000001'),
    c('sleep_session', 'aaaa0000-0000-4000-8000-000000000001', {
      date: DAY, start_at: '2026-11-11T14:34:00.000Z', end_at: '2026-11-11T21:09:00.000Z', asleep_min: 387, awake_min: 8, source: 'health_connect',
    }),
    c('heart_rate_day', DAY, { date: DAY, resting_bpm: 51, avg_bpm: 64, min_bpm: 50, max_bpm: 120, samples: 100 }),
    c('step_day', DAY, { date: DAY, steps: 830 }),
    c('injury', 'cccccccc-0000-4000-8000-000000000002', {
      occurred_on: '2026-11-11', site: 'shoulder_joint', side: 'right', exercise_id: BENCH, phase: 'ラックアップ時', symptom: 'ラックアップした瞬間に右肩に違和感が走った', cause: '', fix: '', status: 'fixing', fixed_on: null,
    }),
    c('injury', 'cccccccc-0000-4000-8000-000000000001', {
      occurred_on: '2026-11-10', site: 'lower_back', side: null, exercise_id: SQUAT, phase: '', symptom: 'トレーニング中ではなく終わった頃に発症', cause: '', fix: '', status: 'fixing', fixed_on: null,
    }),
    c('report', 'aaaaaaaa-0000-4000-8000-000000000003', {
      title: '11月のまとめ', kind: 'monthly', period_start: '2026-11-01', period_end: '2026-11-30', overall_tone: 'good',
      headline: '節目70kgまであと0.2kg。目標80kgへ、良い方向に進んでいます。', highlights: [], next_steps: ['70kgの節目に到達'], body: '',
    }),
  ]);
  server.setClock(() => '2026-11-12T03:10:00.000Z');
  server.append([{ ...mcp, changed_at: '2026-11-12T03:10:00.000Z', change_id: crypto.randomUUID(), entity_type: 'report', entity_id: 'aaaaaaaa-0000-4000-8000-000000000002', op: 'create', fields: {
    title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-09', period_end: '2026-11-15', overall_tone: 'good',
    headline: '月〜水で筋トレ3日。今日（木）は休みの日で、体重は週間平均を上回っています。',
    highlights: [
      { area: 'body', tone: 'good', text: '体重は週間平均を上回っています', metric: { label: '週の平均体重', value: 69.4, unit: 'kg', delta: -0.6, delta_good: false } },
      { area: 'training', tone: 'good', text: '月〜水で筋トレ3日', metric: { label: '筋トレ', value: 3, unit: '日', delta: 1, delta_good: true } },
    ],
    next_steps: ['肩の種目を増やす（部位バランスで最も手薄）'], body: '',
  } }]);
  server.setClock(() => '2026-11-12T03:20:00.000Z');
  server.append([{ ...mcp, changed_at: '2026-11-12T03:20:00.000Z', change_id: crypto.randomUUID(), entity_type: 'report', entity_id: 'aaaaaaaa-0000-4000-8000-000000000001', op: 'create', fields: {
    title: '増量方向へ', kind: 'daily', period_start: DAY, period_end: DAY, overall_tone: 'good',
    headline: '今日は今週の平均を超えた。ただ28日の流れは週あたり−0.35kgで、まだ下向き。食べる量を保てると流れが変わりやすくなります。',
    highlights: [
      { area: 'body', tone: 'good', text: '体重69.8kgは、今週の平均69.4kgより上。目標80kgに向けて良い方向です' },
      { area: 'meals', tone: 'steady', text: '11時の同期時点で309kcal・たんぱく質31.2g。休みの日の目標2290kcal・139.6gに向けて、まだこれからです' },
      { area: 'sleep', tone: 'steady', text: '23:34に寝て6:09に起床、387分。安静時心拍51' },
      { area: 'training', tone: 'steady', text: '3日続けて筋トレしたあとの休みの日。体を回復させる日です（今週は月〜水の3日で筋トレ済み）' },
    ],
    next_steps: ['朝ごはんに、たんぱく質のおかずを1品足す'], body: '',
  } }]);
  return server;
}

async function shoot(page: Page, name: string) {
  await page.setViewportSize({ width: 412, height: 4200 });
  const end = page.getByTestId('report-created').filter({ visible: true });
  await expect(end).toBeVisible();
  await page.waitForTimeout(800);
  const box = (await end.boundingBox())!;
  await page.screenshot({ path: `${process.env.SHOT_DIR}/report-${name}.png`, clip: { x: 0, y: 0, width: 412, height: Math.ceil(box.y + box.height + 40) } });
  await page.setViewportSize({ width: 412, height: 915 });
}

test('レポート詳細を日・週・月で撮る（モックとの見比べ用）', async ({ page, context }) => {
  test.setTimeout(120_000);
  const server = seed();
  await connect(page, context, server);
  await openApp(page, DAY);
  await openSettings(page);
  await page.getByTestId('settings-account').click();
  await button(page, 'パスキーでログイン').click();
  await expect(page.getByTestId('sync-pending').filter({ visible: true })).toHaveText('0件');
  // 同期が終わるまで待つ。「0件」は同期の前から 0件で、ホームの表示も当てはめの途中（COMMIT の前）から読めるので、終わった印にならない。
  // 最後に同期した時刻は、当てはめを書き終えたあとに入る。web はログインをメモリーにだけ置くので、終わる前に読み込み直すと、
  // 当てはめの途中が捨てられ、同期し直しもしない
  await expect(page.getByTestId('sync-last').filter({ visible: true })).toHaveText(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
  await button(page, '戻る').click();
  await button(page, '戻る').click();
  await tab(page, 'レポート').click();
  const tabs = page.getByTestId('report-period-tabs').filter({ visible: true });
  await settle(tabs);
  await expect(tabs).toBeVisible();
  await expect(page.getByTestId('report-hero-daily').filter({ visible: true })).toBeVisible();
  await shoot(page, 'daily');
  await tabs.getByRole('button', { name: '週', exact: true }).click();
  await expect(page.getByTestId('report-weekly-radar').filter({ visible: true })).toBeVisible();
  await shoot(page, 'weekly');
  await tabs.getByRole('button', { name: '月', exact: true }).click();
  await expect(page.getByTestId('report-big3').filter({ visible: true })).toBeVisible();
  await shoot(page, 'monthly');
});
