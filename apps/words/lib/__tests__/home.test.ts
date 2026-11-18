import { listenMinutes, thisWeek, weekLine, weekSeals } from '../stats';

// ホームの今週の一文・落款・聞くの分。数は activityStats の今週の行（記録の画面と同じ計算）
const expr = (id: string, created_at: string) => ({
  id, source_id: null, place: 'collected' as const, created_at, hand_since: null, moved_at: null,
});

describe('ホームの今週', () => {
  // 2026-11-18（水）。週は 11/16（月）〜 11/22（日）。日の区切りは日本時間の午前4時
  const today = '2026-11-18';

  it('今週に拾った数と、今週の使えたの記録の数を数える（先週のものは数えない）', () => {
    const items = [expr('a', '2026-11-16T01:00:00.000Z'), expr('b', '2026-11-17T01:00:00.000Z'), expr('c', '2026-11-14T01:00:00.000Z')];
    const usages = [{ used_on: '2026-11-17' }, { used_on: '2026-11-18' }, { used_on: '2026-11-15' }];
    expect(thisWeek(items, usages, today)).toEqual({ from: '2026-11-16', to: '2026-11-22', captured: 2, used: 2 });
  });

  it('0 の週は責めない一文。数があれば「今週は N 語。使えた M。」', () => {
    expect(weekLine({ captured: 0, used: 0 })).toBe('今週はまだ。拾ったら、ここに並びます');
    expect(weekLine({ captured: 5, used: 2 })).toBe('今週は 5 語。使えた 2。');
    expect(weekLine({ captured: 0, used: 1 })).toBe('今週は 0 語。使えた 1。');
  });

  it('今週の落款は、今週に使えた表現を1つずつ、新しく使えた順に', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const usages = [
      { expression_id: 'a', used_on: '2026-11-16' }, { expression_id: 'b', used_on: '2026-11-18' },
      { expression_id: 'a', used_on: '2026-11-17' }, { expression_id: 'c', used_on: '2026-11-10' },
    ];
    expect(weekSeals(items, usages, { from: '2026-11-16', to: '2026-11-22' }).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('聞くの分は切り上げ、短くても 1 分', () => {
    expect(listenMinutes(0)).toBe(1);
    expect(listenMinutes(59)).toBe(1);
    expect(listenMinutes(61)).toBe(2);
  });
});
