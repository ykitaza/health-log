import { BrowserContext, expect, Page } from '@playwright/test';
import { createFakeSyncServer, FakeSyncServer } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { button, openApp, openSettings } from './helpers';
import { fakeCognito, fakeLoginPopup } from './login';

// 偽の同期サーバーから、フェーズ・筋トレ・ケガなどを入れる（フェーズを画面で始める流れは phase.spec.ts）。
// 画面の操作で 1 セットずつ記録すると遅いので、たくさんのセットや過去のフェーズが要るテスト（home-phase・part-volume）で使う

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };
/** サーバーが変更を受けた時刻（今日は 2026-11-08） */
export const AT = '2026-11-08T01:00:00.000Z';
export const mcp = { parent_id: null, changed_at: AT, origin: 'mcp' as const, device_id: null };
export type Change = Parameters<FakeSyncServer['append']>[0][number];

export async function connect(page: Page, context: BrowserContext, server: FakeSyncServer) {
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
export async function signInAndSync(page: Page) {
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
}

export const change = (entity_type: string, entity_id: string, fields: Record<string, unknown>): Change =>
  ({ ...mcp, change_id: crypto.randomUUID(), entity_type, entity_id, op: 'create', fields }) as Change;

/** 偽のサーバーに changes を入れて、ログイン・同期してホームを開く */
export async function openWith(page: Page, context: BrowserContext, changes: Change[]) {
  const server = createFakeSyncServer({ clock: () => AT });
  server.append(changes);
  await connect(page, context, server);
  await openApp(page);
  await signInAndSync(page);
}

/** 初期の種目の ID（db/seed.ts） */
export const EXERCISE = {
  bench: 'd41c7096-c246-4dfa-945a-e1cb329977a6',
  squat: 'a902b077-031a-4de6-814b-9ffb69b96778',
  shoulderPress: 'fc03a49d-a1f7-478a-b498-1ffaf4f08c5f',
  pullUp: '11080b36-79ce-4306-a099-c779ae4323b3',
  curl: 'bfea78af-73b3-47a6-a6a2-3a67532f7202',
};

let seq = 0;
const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');

/** date に、exercise を n セット（60kg × 10）。1 日に同じ種目は 1 つの記録（entry）にまとめる */
export function workout(date: string, exerciseId: string, n: number): Change[] {
  seq += 1;
  const entry = `${hex(seq, 8)}-0000-4000-8000-${hex(Number(date.replace(/-/g, '')), 12)}`;
  return [
    change('workout_entry', entry, { date, exercise_id: exerciseId, sort_order: 0 }),
    ...Array.from({ length: n }, (_, i) =>
      change('workout_set', `${entry}-set${i + 1}`, { entry_id: entry, set_index: i, weight_kg: 60, reps: 10, memo: '', done: true })),
  ];
}

/** 増量 8 週（start から。今日は 11/8 なので、10/12 開始なら 4 週目） */
export function bulkPhase(id: string, start: string, end: string, extra: Record<string, unknown> = {}): Change {
  return change('phase', id, {
    kind: 'normal', direction: 'bulk', name: '', start_date: start, end_date: end, target_weight_kg: 80, meal_targets: null,
    snapshot: { weight_kg: 74, body_fat_pct: null, big3: { bench: 60, squat: null, deadlift: null }, growth_score: null },
    status: 'active', paused_phase_id: null, target_history: [], ended_on: null, ...extra,
  });
}
