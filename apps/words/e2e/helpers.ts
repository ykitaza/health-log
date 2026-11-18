import { BrowserContext, expect, Locator, Page } from '@playwright/test';
import { createFakeSyncServer, FakeSyncServer, ServerChange } from '../test-utils/fakeSyncServer';
import { fakeAccessToken } from '../test-utils/fakeToken';
import { fakeCognito, fakeLoginPopup } from './login';

/** テストの「今」。2026-11-18（水）の日本時間 10 時 */
export const NOW = '2026-11-18T10:00:00+09:00';

/** 端末の時刻を固定する（タイマーはふつうに進む） */
export async function setNow(page: Page, iso = NOW) {
  await page.clock.setFixedTime(new Date(iso));
}

/** 見えているボタン（画面の切り替わりの途中は、前の画面のボタンも残っている） */
export const button = (scope: Page | Locator, name: string | RegExp) =>
  scope.getByRole('button', { name, exact: typeof name === 'string' }).filter({ visible: true });
export const byTest = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });
export const see = (page: Page, text: string | RegExp) => page.getByText(text, { exact: typeof text === 'string' }).filter({ visible: true });

/** 初めの画面で「ログインせずに使う」を選んで、書き留めるを開く */
export async function openApp(page: Page) {
  await setNow(page);
  await page.goto('/');
  await byTest(page, 'skip-signin').click();
  await expect(byTest(page, 'capture-screen')).toBeVisible();
}

const TAB_SCREENS = { index: 'capture-screen', collected: 'collected-screen', hand: 'hand-screen', listen: 'listen-screen' } as const;

export async function goTab(page: Page, name: keyof typeof TAB_SCREENS) {
  await page.getByTestId(`tab-${name}`).click();
  await expect(byTest(page, TAB_SCREENS[name])).toBeVisible();
}

/** 書き留めるで1つ拾う */
export async function capture(page: Page, o: { text: string; source?: string; title?: string; scene?: string; example?: string; want?: boolean }) {
  if (o.source) {
    const chip = byTest(page, `source-${o.source}`);
    if ((await chip.getAttribute('aria-selected')) !== 'true') await chip.click();
  }
  if (o.title !== undefined) await byTest(page, 'capture-title').fill(o.title);
  await byTest(page, 'capture-text').fill(o.text);
  if (o.scene) await byTest(page, 'capture-scene').fill(o.scene);
  if (o.example) await byTest(page, 'capture-example-0').fill(o.example);
  if (o.want) await byTest(page, 'capture-want').click();
  await byTest(page, 'capture-save').click();
  // 保存が終わると欄が空に戻る（前の知らせが残っていることがあるので、欄で待つ）
  await expect(byTest(page, 'capture-text')).toHaveValue('');
  await expect(byTest(page, 'capture-notice')).toBeVisible();
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST' };

/** アプリ用の API（偽の execute-api）を、偽の同期サーバーにつなぐ */
export async function routeSyncServer(context: BrowserContext, server: FakeSyncServer) {
  await context.route(/^https:\/\/[^/]+\.execute-api\.[^/]+\.amazonaws\.com\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS }); return; }
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    const res = server.handle(req.method(), req.url(), body);
    await route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body), headers: CORS });
  });
}

/** 偽のログイン（本物の Cognito には当てない）と、偽の同期サーバー */
export async function signedInWith(page: Page, context: BrowserContext, server: FakeSyncServer) {
  const token = { status: 200, body: { access_token: fakeAccessToken('user-a'), refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' } };
  await fakeCognito(context, token);
  await fakeLoginPopup(page, { code: 'test-code' });
  // fakeCognito は execute-api を止めるので、そのあとに偽のサーバーをつなぎ直す（後に足したものが先に当たる）
  await routeSyncServer(context, server);
}

/** テスト用の UUID（kind：a 表現・b 出会い・c タグのつながり） */
export const uid = (kind: 'a' | 'b' | 'c', n: number) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** MCP（Claude）で拾った表現を、サーバーに入れる。返すのは表現の ID */
export function mcpExpression(server: FakeSyncServer, n: number, o: { text: string; reading?: string; meaning?: string; scene?: string; place?: 'collected' | 'hand' | 'own'; stage?: string | null;
  due_on?: string | null; examples?: string[]; similar?: string[]; register?: string | null; star?: boolean; use_count?: number;
  source_id?: string | null; title?: string; created?: string; tag?: { id: string; status: 'proposed' | 'confirmed' };
  surrounding_text?: string; wording?: string; listen_count?: number;
}) {
  const id = uid('a', n);
  const at = o.created ?? '2026-11-17T01:00:00.000Z';
  const changes: Omit<ServerChange, 'received_at' | 'seq'>[] = [{
    change_id: `x-${n}`, entity_type: 'expression', entity_id: id, parent_id: null, op: 'create', changed_at: at, origin: 'mcp', device_id: null,
    fields: {
      text: o.text, source_id: o.source_id ?? null, normalized_key: o.text, scene: o.scene ?? '', note: '', star: o.star ?? false,
      place: o.place ?? 'collected', stage: o.stage ?? (o.place === 'hand' ? 'understood' : null), moved_at: at, hand_since: o.place === 'hand' ? '2026-11-15' : null,
      interval_days: 1, due_on: o.due_on ?? (o.place === 'hand' ? '2026-11-18' : null), listened_at: null, listen_count: o.listen_count ?? 0,
      use_count: o.use_count ?? 0, last_used_on: o.use_count ? '2026-11-16' : null, reading: o.reading ?? '', use_note: '',
      register: o.register ?? null, register_by: o.register ? 'claude' : null, meaning: o.meaning ?? '', nuance: '',
      // Claude が補った例文（まだ確かめていない案）
      examples: (o.examples ?? []).map((text) => ({ text, origin: 'claude', confirmed: false, created_at: at, updated_at: at })),
      similar: o.similar ?? [], usefulness: null, usefulness_reason: '', usefulness_until: null, enriched_at: o.meaning ? at : null,
    },
  }, {
    change_id: `y-${n}`, entity_type: 'encounter', entity_id: uid('b', n), parent_id: null, op: 'create', changed_at: at, origin: 'mcp',
    device_id: null,
    fields: {
      expression_id: id, source_id: o.source_id ?? null, title: o.title ?? '', locator: '', met_on: null, time_hint: '', scene: '',
      surrounding_text: o.surrounding_text ?? '', wording: o.wording ?? '', captured_via: 'mcp', note: '',
    },
  }];
  if (o.tag) {
    changes.push({
      change_id: `z-${n}`, entity_type: 'expression_tag', entity_id: uid('c', n), parent_id: null, op: 'create', changed_at: at,
      origin: 'mcp', device_id: null,
      fields: { expression_id: id, tag_id: o.tag.id, added_by: 'claude', status: o.tag.status, confirmed_at: o.tag.status === 'confirmed' ? at : null },
    });
  }
  server.setClock(() => at);
  server.append(changes);
  server.setClock(() => new Date().toISOString());
  return id;
}

export { createFakeSyncServer };
