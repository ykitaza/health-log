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
});
