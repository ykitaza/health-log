// 日のまとめの「明日の一歩」のストリーク（連続達成）。レポート詳細の日次ビューで、明日の一歩の横に出す。
// 計算は純粋な関数で、DB は読まない（呼ぶ側が reports.list() の一覧を渡す）
import { reportDate, type Report } from './reports';

type StreakSource = Pick<Report, 'id' | 'kind' | 'periodStart' | 'periodEnd' | 'createdAt' | 'nextSteps' | 'nextStepsDone'>;

/**
 * 明日の一歩のストリークの定義（シンプルに固定する）：
 * 表示中の日のまとめを起点に、日次レポートだけを期間の日付（lib/reports.ts の reportDate）の新しい順にたどり、
 * 「次の一歩が1つ以上チェック済み（nextStepsDone が空でない）」である間だけ数える。
 * - 起点のまとめ自体が未チェック（または次の一歩がない）なら 0。
 * - 未チェックのまとめ、次の一歩のないまとめが1つでも挟まれば、そこで連続は切れる。
 * - カレンダー上で日が空いているか（まとめが作られなかった日があるか）は見ない。まとめの並びだけで数える。
 */
export function dailyReportStreak(reports: readonly StreakSource[], targetId: string): number {
  const dailies = reports
    .filter((r) => r.kind === 'daily')
    .sort((a, b) => {
      const byDate = reportDate(a).localeCompare(reportDate(b));
      if (byDate !== 0) return byDate;
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.id.localeCompare(b.id);
    });
  const start = dailies.findIndex((r) => r.id === targetId);
  if (start < 0) return 0;
  let streak = 0;
  for (let i = start; i >= 0; i--) {
    const r = dailies[i];
    if (r.nextSteps.length === 0 || r.nextStepsDone.length === 0) break;
    streak++;
  }
  return streak;
}

/** ストリークの表示文（「3日連続で達成」）。0 なら null（出さない） */
export function dailyStreakText(streak: number): string | null {
  return streak > 0 ? `${streak}日連続で達成` : null;
}
