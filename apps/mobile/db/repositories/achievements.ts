import { addDays, DateKey, toDateKey, weekStart } from '@/lib/date';
import {
  DailyAchievement, dailyAchievement, GoalStreak, goalStreak, STREAK_MAX_WEEKS, weekOf, WeeklyAchievement, weeklyAchievement,
} from '@/lib/goals';
import { pendingReports, PendingReport } from '@/lib/reports';
import type { Db, Deps } from '../types';
import { healthRepository } from './health';
import { mealRepository } from './meals';
import { reportRepository } from './reports';
import { settingsRepository, weeklyGoalsOf } from './settings';
import { workoutRepository } from './workouts';

/** まだ作っていないまとめを見る範囲：先月の1日か、4週前の週の月曜の、早いほう（今日から最大で 62 日前） */
const PENDING_LOOKBACK_DAYS = 62;

/**
 * 週・日の達成と、まだ作っていないまとめ（読むだけ）。計算は lib/goals.ts・lib/reports.ts の純粋な関数で、ここは DB から集めて渡す。
 * 画面からは hooks/data.ts の useWeeklyAchievement・useGoalStreak・useDailyAchievement・usePendingReports で使う
 */
export function achievementRepository(db: Db, deps: Deps) {
  const settings = settingsRepository(db, deps);
  const meals = mealRepository(db, deps);
  const health = healthRepository(db);
  const workouts = workoutRepository(db, deps);
  const reports = reportRepository(db, deps);

  /** from〜to（両端を含む）に記録（筋トレのセット・食事・体組成のどれか）がある日。重なりなし、古い順 */
  async function recordDates(from: DateKey, to: DateKey): Promise<DateKey[]> {
    const rows = await db.getAllAsync<{ date: string }>(
      `SELECT w.date FROM workout_sets s JOIN workout_entries w ON w.id = s.entry_id
         WHERE s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.date BETWEEN ? AND ?
       UNION SELECT date FROM meals WHERE deleted_at IS NULL AND date BETWEEN ? AND ?
       UNION SELECT date FROM body_records WHERE deleted_at IS NULL AND date BETWEEN ? AND ?
       ORDER BY 1`, [from, to, from, to, from, to],
    );
    return rows.map((r) => r.date);
  }

  return {
    recordDates,

    /** その日を含む週（月〜日）の達成。目標は設定の今週の目標 */
    async week(date: DateKey): Promise<WeeklyAchievement> {
      const { start, end } = weekOf(date);
      const [s, summaries, trained, sleep] = await Promise.all([
        settings.get(), meals.summaries(start, end), meals.trainingDays(start, end), health.sleepDays(start, end),
      ]);
      return weeklyAchievement({ date, goals: weeklyGoalsOf(s), trainingDates: trained, meals: summaries.days, sleep });
    },

    /** すべての目標を達成した週の連続（今週から STREAK_MAX_WEEKS 週前まで）。目標は設定の今の値 */
    async streak(date: DateKey): Promise<GoalStreak> {
      const from = addDays(weekStart(date), -7 * (STREAK_MAX_WEEKS - 1));
      const { end } = weekOf(date);
      const [s, trained, mealDates, sleep] = await Promise.all([
        settings.get(), meals.trainingDays(from, end),
        db.getAllAsync<{ date: string }>('SELECT DISTINCT date FROM meals WHERE deleted_at IS NULL AND date BETWEEN ? AND ?', [from, end]),
        health.sleepDays(from, end),
      ]);
      return goalStreak({ date, goals: weeklyGoalsOf(s), trainingDates: trained, mealDates: mealDates.map((r) => r.date), sleep });
    },

    /** その日の達成（自己ベストを見るため、セットはすべて読む） */
    async day(date: DateKey): Promise<DailyAchievement> {
      const [sets, summaries, sleep] = await Promise.all([workouts.allSetRows(), meals.summaries(date, date), health.sleepDay(date)]);
      return dailyAchievement({ date, sets, meal: summaries.days[0], sleep });
    },

    /** まだ作っていないまとめ（閉じた分を除く）。now は端末の時刻 */
    async pending(now: Date = deps.now()): Promise<PendingReport[]> {
      const today = toDateKey(now);
      const [list, dates, dismissed] = await Promise.all([
        reports.list(), recordDates(addDays(today, -PENDING_LOOKBACK_DAYS), today), reports.dismissedPending(),
      ]);
      return pendingReports({ now, reports: list, recordDates: dates, dismissed });
    },
  };
}
