// 明日の一歩のストリーク（lib/reportStreak.ts）：表示中の日のまとめから過去へ、チェック済みの日のまとめが連続する数
import { dailyReportStreak, dailyStreakText } from '../reportStreak';
import type { Report } from '../reports';

const rep = (id: string, date: string, done: number[], kind: Report['kind'] = 'daily', steps = ['一歩']): Report => ({
  id, title: '日のまとめ', body: '', kind,
  periodStart: date, periodEnd: date, tone: 'steady', headline: '',
  highlights: [], nextSteps: steps, nextStepsDone: done, links: [], review: null, phaseId: null,
  createdAt: `${date}T13:00:00.000Z`,
});

describe('明日の一歩のストリーク', () => {
  const list = [
    rep('d4', '2026-11-11', [0]),
    rep('d3', '2026-11-10', [0]),
    rep('d2', '2026-11-09', []), // 未チェックで切れる
    rep('d1', '2026-11-08', [0]),
    rep('w1', '2026-11-08', [0], 'weekly'), // 週のまとめは数えない
  ];

  test('起点から過去へ、チェック済みが連続する数。週のまとめは混ぜない', () => {
    expect(dailyReportStreak(list, 'd4')).toBe(2);
    expect(dailyReportStreak(list, 'd3')).toBe(1);
    expect(dailyReportStreak(list, 'd1')).toBe(1);
  });

  test('起点が未チェックなら 0。次の一歩がないまとめでも切れる', () => {
    expect(dailyReportStreak(list, 'd2')).toBe(0);
    expect(dailyReportStreak([rep('a', '2026-11-10', [0]), rep('b', '2026-11-11', [0], 'daily', [])], 'a')).toBe(1);
    expect(dailyReportStreak([rep('b', '2026-11-11', [], 'daily', [])], 'b')).toBe(0);
  });

  test('まとめが作られなかった日が挟まれば切れる（日数で数える）', () => {
    const gapped = [rep('g3', '2026-11-11', [0]), rep('g1', '2026-11-09', [0])]; // 11-10 のまとめがない
    expect(dailyReportStreak(gapped, 'g3')).toBe(1);
    expect(dailyReportStreak(gapped, 'g1')).toBe(1);
  });

  test('対象が一覧にない・日次でなければ 0', () => {
    expect(dailyReportStreak(list, 'none')).toBe(0);
    expect(dailyReportStreak(list, 'w1')).toBe(0);
    expect(dailyReportStreak([], 'd4')).toBe(0);
  });

  test('表示文は 0 なら出さない', () => {
    expect(dailyStreakText(3)).toBe('3日連続で達成');
    expect(dailyStreakText(0)).toBeNull();
  });
});
