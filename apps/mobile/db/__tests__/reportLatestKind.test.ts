// レポートの latest / latestOfKind：'other'（分析レポート）はアプリに出さないので、latest では除く（データは消さない）。
// latestOfKind は詳細画面の期間タブ（日／週／月）が使う
import { device, Device } from '@/test-utils/syncHarness';

const WEEK = 'bbbbbbbb-0000-4000-8000-000000000001';
const DAY = 'bbbbbbbb-0000-4000-8000-000000000002';
const DAY2 = 'bbbbbbbb-0000-4000-8000-000000000003';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000004';

/** MCP の save_report が書いたもの（サーバーが受け付けた時刻 at） */
function saveReport(d: Device, id: string, at: string, fields: Record<string, unknown>) {
  d.server.setClock(() => at);
  d.server.append([{
    change_id: crypto.randomUUID(), entity_type: 'report', entity_id: id, parent_id: null, op: 'create',
    fields: { body: '', kind: 'other', period_start: null, period_end: null, ...fields }, changed_at: at, origin: 'mcp', device_id: null,
  }]);
}

describe('latest と latestOfKind（other は出さない）', () => {
  test('latest は、いちばん新しくても other を選ばない。other だけなら null（データ自体は一覧に残る）', async () => {
    const d = await device();
    saveReport(d, WEEK, '2026-11-09T01:00:00.000Z', { title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08' });
    saveReport(d, OTHER, '2026-11-10T01:00:00.000Z', { title: 'ベンチプレスの分析', kind: 'other' });
    await d.engine.run();
    expect((await d.r.reports.latest())?.id).toBe(WEEK);
    expect((await d.r.reports.list()).map((r) => r.id).sort()).toEqual([OTHER, WEEK].sort()); // 消してはいない
    await d.r.reports.remove(WEEK);
    expect(await d.r.reports.latest()).toBeNull();
  });

  test('latestOfKind は種類ごとの最新を返し、ない種類は null。other はどの種類にも混ざらない', async () => {
    const d = await device();
    saveReport(d, DAY, '2026-11-09T01:00:00.000Z', { title: '11月8日のまとめ', kind: 'daily', period_start: '2026-11-08', period_end: '2026-11-08' });
    saveReport(d, DAY2, '2026-11-10T01:00:00.000Z', { title: '11月9日のまとめ', kind: 'daily', period_start: '2026-11-09', period_end: '2026-11-09' });
    saveReport(d, OTHER, '2026-11-11T01:00:00.000Z', { title: '分析', kind: 'other', period_start: '2026-11-09', period_end: '2026-11-09' });
    await d.engine.run();
    expect((await d.r.reports.latestOfKind('daily'))?.id).toBe(DAY2);
    expect(await d.r.reports.latestOfKind('weekly')).toBeNull();
    expect(await d.r.reports.latestOfKind('monthly')).toBeNull();
  });

  test('unread は other を出さない（ホームの「新しいレポート」の帯にも出ない）', async () => {
    const d = await device();
    saveReport(d, DAY, '2026-11-09T01:00:00.000Z', { title: '11月8日のまとめ', kind: 'daily', period_start: '2026-11-08', period_end: '2026-11-08' });
    await d.engine.run();
    await d.r.reports.seenIds(); // 初期化：今あるものは見たことにする
    saveReport(d, OTHER, '2026-11-10T01:00:00.000Z', { title: 'ベンチプレスの分析', kind: 'other' });
    saveReport(d, DAY2, '2026-11-11T01:00:00.000Z', { title: '11月10日のまとめ', kind: 'daily', period_start: '2026-11-10', period_end: '2026-11-10' });
    await d.engine.run();
    expect((await d.r.reports.unread()).map((r) => r.id)).toEqual([DAY2]);
  });
});

describe('listWithoutBody（本文を読まない一覧）', () => {
  test('本文は空になり、それ以外（種類・期間・次の一歩）は list と同じ。list は本文を返す', async () => {
    const d = await device();
    saveReport(d, DAY, '2026-11-09T01:00:00.000Z', {
      title: '11月8日のまとめ', kind: 'daily', period_start: '2026-11-08', period_end: '2026-11-08',
      body: 'くわしい本文', next_steps: ['朝ごはんに卵を足す'], next_steps_done: [0],
    });
    saveReport(d, WEEK, '2026-11-10T01:00:00.000Z', {
      title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08', body: '週の本文',
    });
    await d.engine.run();
    const light = await d.r.reports.listWithoutBody();
    expect(light.map((r) => r.id)).toEqual([WEEK, DAY]); // 新しい順は list と同じ
    expect(light.every((r) => r.body === '')).toBe(true);
    const day = light.find((r) => r.id === DAY)!;
    expect(day.kind).toBe('daily');
    expect(day.periodStart).toBe('2026-11-08');
    expect(day.nextSteps).toEqual(['朝ごはんに卵を足す']);
    expect(day.nextStepsDone).toEqual([0]);
    expect((await d.r.reports.list()).find((r) => r.id === DAY)?.body).toBe('くわしい本文');
  });
});

describe('forLink（チャットの「KARADA で見る」：reports?date=…&kind=… で開くレポート）', () => {
  const MONTH = 'bbbbbbbb-0000-4000-8000-000000000005';
  const WEEK2 = 'bbbbbbbb-0000-4000-8000-000000000006';

  test('その日を含む期間のその種類のレポート。なければその種類の最新、それもなければ最新', async () => {
    const d = await device();
    saveReport(d, WEEK, '2026-11-05T01:00:00.000Z', { title: '先週のまとめ', kind: 'weekly', period_start: '2026-10-26', period_end: '2026-11-01' });
    saveReport(d, WEEK2, '2026-11-09T01:00:00.000Z', { title: '今週のまとめ', kind: 'weekly', period_start: '2026-11-02', period_end: '2026-11-08' });
    saveReport(d, DAY, '2026-11-10T01:00:00.000Z', { title: '11月8日のまとめ', kind: 'daily', period_start: '2026-11-08', period_end: '2026-11-08' });
    saveReport(d, DAY2, '2026-11-11T01:00:00.000Z', { title: '11月9日のまとめ', kind: 'daily', period_start: '2026-11-09', period_end: '2026-11-09' });
    await d.engine.run();
    // その日を含む期間（週は途中の日でも、作った順が新しくなくても）
    expect((await d.r.reports.forLink('weekly', '2026-10-28'))?.id).toBe(WEEK);
    expect((await d.r.reports.forLink('weekly', '2026-11-08'))?.id).toBe(WEEK2);
    expect((await d.r.reports.forLink('daily', '2026-11-08'))?.id).toBe(DAY);
    // その日を含む期間がなければ、その種類の最新（日付がないときも）
    expect((await d.r.reports.forLink('weekly', '2026-11-12'))?.id).toBe(WEEK2);
    expect((await d.r.reports.forLink('daily', '2026-11-12'))?.id).toBe(DAY2);
    expect((await d.r.reports.forLink('daily', null))?.id).toBe(DAY2);
    // その種類が1件もなければ、最新（いちばん新しく作った、other でないもの）
    expect((await d.r.reports.forLink('monthly', '2026-11-09'))?.id).toBe(DAY2);
    saveReport(d, MONTH, '2026-11-01T01:00:00.000Z', { title: '10月のまとめ', kind: 'monthly', period_start: '2026-10-01', period_end: '2026-10-31' });
    await d.engine.run();
    expect((await d.r.reports.forLink('monthly', '2026-11-09'))?.id).toBe(MONTH);
    expect((await d.r.reports.forLink('monthly', '2026-10-15'))?.id).toBe(MONTH);
  });

  test('other は、日付が合っても選ばない。何もなければ null', async () => {
    const d = await device();
    expect(await d.r.reports.forLink('daily', '2026-11-09')).toBeNull();
    saveReport(d, OTHER, '2026-11-11T01:00:00.000Z', { title: '分析', kind: 'other', period_start: '2026-11-09', period_end: '2026-11-09' });
    await d.engine.run();
    expect(await d.r.reports.forLink('daily', '2026-11-09')).toBeNull();
  });
});
