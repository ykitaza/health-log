// 日のまとめの「明日の一歩」のストリーク（連続達成）。レポート詳細の日次ビューで、明日の一歩の横に出す。
// 計算は純粋な関数で、DB は読まない（呼ぶ側が reports.list() の一覧を渡す）
import { addDays, type DateKey } from './date';
import { reportDate, type Report } from './reports';

type StreakSource = Pick<Report, 'id' | 'kind' | 'periodStart' | 'periodEnd' | 'createdAt' | 'nextSteps' | 'nextStepsDone'>;

/**
 * 明日の一歩のストリークの定義（「◯日連続」の表示どおり、カレンダーの日数で数える）：
 * 表示中の日のまとめの日付から、1日ずつ過去へ歩く。各日について、その日の日のまとめがあり、
 * 「次の一歩が1つ以上チェック済み（nextStepsDone が空でない）」なら連続に数える。
 * - 起点のまとめ自体が未チェック（または次の一歩がない）なら 0。
 * - まとめが作られなかった日、未チェックの日、次の一歩のない日が1日でも挟まれば、そこで連続は切れる。
 * - 同じ日に日のまとめが複数あれば（置き換え前の重複など）、作った時刻がいちばん新しいものをその日の分とする。
 */
export function dailyReportStreak(reports: readonly StreakSource[], targetId: string): number {
  const dailies = reports.filter((r) => r.kind === 'daily');
  const target = dailies.find((r) => r.id === targetId);
  if (!target) return 0;
  const byDate = new Map<DateKey | '', StreakSource>();
  for (const r of dailies) {
    const d = reportDate(r);
    const cur = byDate.get(d);
    if (!cur || r.createdAt > cur.createdAt || (r.createdAt === cur.createdAt && r.id > cur.id)) byDate.set(d, r);
  }
  let streak = 0;
  let d = reportDate(target);
  for (;;) {
    const r = byDate.get(d);
    if (!r || r.nextSteps.length === 0 || r.nextStepsDone.length === 0) break;
    streak++;
    d = addDays(d as DateKey, -1);
  }
  return streak;
}

/** ストリークの表示文（「3日連続で達成」）。0 なら null（出さない） */
export function dailyStreakText(streak: number): string | null {
  return streak > 0 ? `${streak}日連続で達成` : null;
}
