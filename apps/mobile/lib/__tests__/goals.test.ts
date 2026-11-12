import { addDays } from '../date';
import { allGoalsReached, dailyAchievement, goalStreak, STREAK_MAX_WEEKS, weekOf, weeklyAchievement, WeeklyGoals } from '../goals';
import type { DaySummary } from '../meals';
import type { TrainingSetRow } from '../training';

const GOALS: WeeklyGoals = { trainingDays: 3, mealDays: 5, sleepDays: 4 };
const meal = (date: string, protein: number, target: number | null, recorded = true): Pick<DaySummary, 'date' | 'meals' | 'total' | 'target'> => ({
  date,
  meals: recorded ? [{} as DaySummary['meals'][number]] : [],
  total: { kcal: 2000, protein_g: protein, fat_g: 60, carbs_g: 250 },
  target: target == null ? null : { kcal: 2200, protein_g: target, fat_g: 60, carbs_g: 280 },
});

describe('週（月曜始まり）', () => {
  test('どの曜日でも、その日を含む月〜日', () => {
    // 2026-11-09 は月曜、11-15 は日曜
    expect(weekOf('2026-11-09')).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(weekOf('2026-11-12')).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(weekOf('2026-11-15')).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    // 月と年をまたぐ
    expect(weekOf('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });
});

describe('週の達成', () => {
  test('筋トレ・食事・たんぱく質・睡眠の日数と、目標に届いたか。週の外の日は数えない', () => {
    const a = weeklyAchievement({
      date: '2026-11-11',
      goals: GOALS,
      trainingDates: ['2026-11-08', '2026-11-09', '2026-11-11', '2026-11-13'], // 11/8 は先週
      meals: [
        meal('2026-11-09', 130, 120),
        meal('2026-11-10', 100, 120),
        meal('2026-11-11', 120, 120), // ちょうど届いた
        meal('2026-11-12', 0, 120, false), // 記録なし
        meal('2026-11-16', 200, 120), // 次の週
      ],
      sleep: [
        { date: '2026-11-09', asleepMin: 420 }, // ちょうど7時間
        { date: '2026-11-10', asleepMin: 419 },
        { date: '2026-11-14', asleepMin: 480 },
      ],
    });
    expect(a).toMatchObject({
      start: '2026-11-09', end: '2026-11-15',
      training: { days: 3, goal: 3, reached: true },
      meals: { days: 3, goal: 5, reached: false },
      protein: { days: 2, goal: 5, reached: false },
      sleep: { days: 2, goal: 4, reached: false },
    });
    expect(a.days.map((d) => d.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(a.days[0]).toEqual({ date: '2026-11-09', trained: true, mealRecorded: true, proteinReached: true, sleptEnough: true });
  });

  test('たんぱく質の目標がなければ protein は null。睡眠の目標が切（0）なら goal は null で、届いたことにしない', () => {
    const a = weeklyAchievement({
      date: '2026-11-09', goals: { ...GOALS, sleepDays: 0 }, trainingDates: [],
      meals: [meal('2026-11-09', 150, null)], sleep: [{ date: '2026-11-09', asleepMin: 500 }],
    });
    expect(a.protein).toBeNull();
    expect(a.sleep).toEqual({ days: 1, goal: null, reached: false });
    expect(a.training).toEqual({ days: 0, goal: 3, reached: false });
  });
});

describe('過ぎた週の達成', () => {
  test('その週（月〜日）の記録だけを数える。前後の週の記録は入れない', () => {
    const a = weeklyAchievement({
      date: '2026-10-30', goals: { trainingDays: 2, mealDays: 3, sleepDays: 0 },
      trainingDates: ['2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02'],
      meals: ['2026-10-25', '2026-10-27', '2026-10-28', '2026-11-02'].map((d) => meal(d, 100, null)),
      sleep: [],
    });
    expect([a.start, a.end]).toEqual(['2026-10-26', '2026-11-01']);
    expect(a.training).toEqual({ days: 2, goal: 2, reached: true });
    expect(a.meals).toEqual({ days: 2, goal: 3, reached: false });
    expect(allGoalsReached(a)).toBe(false);
  });
});

describe('日の達成', () => {
  const set = (date: string, exerciseId: string, weightKg: number | null, reps: number, bodyweightLoadKg: number | null = null): TrainingSetRow =>
    ({ date, exerciseId, bodyPartId: 'p', weightKg, reps, bodyweightLoadKg });

  test('合計負荷量・種目数・自己ベスト。前に記録のない種目は自己ベストにしない', () => {
    const sets = [
      set('2026-11-01', 'bench', 80, 5), // 推定1RM 93.3
      set('2026-11-01', 'squat', 100, 5),
      set('2026-11-10', 'bench', 80, 8), // 101.3：自己ベスト
      set('2026-11-10', 'bench', 60, 10),
      set('2026-11-10', 'squat', 90, 5), // 自己ベストではない
      set('2026-11-10', 'deadlift', 120, 5), // 初めての種目
      set('2026-11-10', 'pushup', null, 10, 35), // 回数だけ（自重の負荷 35kg）
      set('2026-11-12', 'squat', 200, 5), // 後の日は見ない
    ];
    const a = dailyAchievement({
      date: '2026-11-10', sets,
      meal: { dayType: 'training', meals: [], total: { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }, target: null },
      sleep: null,
    });
    expect(a.training).toEqual({ volumeKg: 640 + 600 + 450 + 600 + 350, exercises: 4, personalBestExerciseIds: ['bench'] });
    expect(a.meals).toEqual({ recorded: false, dayType: 'training', kcal: 0, proteinG: 0, kcalTarget: null, proteinTarget: null });
    expect(a.sleep).toEqual({ asleepMin: null, goalMin: 420, reached: false });
  });

  test('kcal とたんぱく質の合計と、その日の種類の目標。前の夜の睡眠を7時間に対して見る', () => {
    const m = meal('2026-11-10', 110, 120);
    const a = dailyAchievement({ date: '2026-11-10', sets: [], meal: { ...m, dayType: 'rest' }, sleep: { asleepMin: 430 } });
    expect(a.training).toEqual({ volumeKg: 0, exercises: 0, personalBestExerciseIds: [] });
    expect(a.meals).toEqual({ recorded: true, dayType: 'rest', kcal: 2000, proteinG: 110, kcalTarget: 2200, proteinTarget: 120 });
    expect(a.sleep).toEqual({ asleepMin: 430, goalMin: 420, reached: true });
  });
});

describe('今週の目標をすべて達成したか', () => {
  const p = (days: number, goal: number | null) => ({ days, goal, reached: goal != null && days >= goal });
  test('筋トレ・食事の記録・睡眠（切でなければ）がすべて届いたら達成。たんぱく質は見ない', () => {
    expect(allGoalsReached({ training: p(3, 3), meals: p(5, 5), sleep: p(4, 4) })).toBe(true);
    expect(allGoalsReached({ training: p(4, 3), meals: p(6, 5), sleep: p(0, null) })).toBe(true); // 睡眠が切
  });
  test('1つでも途中なら、まだ', () => {
    expect(allGoalsReached({ training: p(2, 3), meals: p(5, 5), sleep: p(0, null) })).toBe(false);
    expect(allGoalsReached({ training: p(3, 3), meals: p(4, 5), sleep: p(0, null) })).toBe(false);
    expect(allGoalsReached({ training: p(3, 3), meals: p(5, 5), sleep: p(3, 4) })).toBe(false);
  });
  test('週の達成（weeklyAchievement）から：最後の1つが届くと達成になる', () => {
    const goals: WeeklyGoals = { trainingDays: 2, mealDays: 3, sleepDays: 0 };
    const meals = ['2026-11-09', '2026-11-10', '2026-11-11'].map((d) => meal(d, 0, null));
    const base = { date: '2026-11-11', goals, meals, sleep: [] };
    expect(allGoalsReached(weeklyAchievement({ ...base, trainingDates: ['2026-11-09'] }))).toBe(false);
    expect(allGoalsReached(weeklyAchievement({ ...base, trainingDates: ['2026-11-09', '2026-11-11'] }))).toBe(true);
  });
});

describe('すべて達成した週の連続', () => {
  const goals: WeeklyGoals = { trainingDays: 2, mealDays: 3, sleepDays: 0 };
  /** monday の週を達成させる日（筋トレ2日・食事3日） */
  const reachedWeek = (monday: string) => ({
    training: [monday, addDays(monday, 2)],
    meals: [monday, addDays(monday, 1), addDays(monday, 2)],
  });
  const streak = (date: string, mondays: string[], extra: Partial<Parameters<typeof goalStreak>[0]> = {}) => {
    const weeks = mondays.map(reachedWeek);
    return goalStreak({
      date, goals, sleep: [],
      trainingDates: weeks.flatMap((w) => w.training), mealDates: weeks.flatMap((w) => w.meals), ...extra,
    });
  };
  // 2026-11-11（水）の週は 11/9（月）から
  test('今週も達成していれば、今週を含めて数える', () => {
    expect(streak('2026-11-11', ['2026-11-09', '2026-11-02', '2026-10-26'])).toEqual({ weeks: 3, thisWeek: true });
  });
  test('今週はまだなら、先週から数える（今週は途切れとしない）', () => {
    expect(streak('2026-11-11', ['2026-11-02', '2026-10-26'])).toEqual({ weeks: 2, thisWeek: false });
  });
  test('途切れた週より前は数えない', () => {
    // 10/26 の週が抜けている
    expect(streak('2026-11-11', ['2026-11-09', '2026-11-02', '2026-10-19', '2026-10-12'])).toEqual({ weeks: 2, thisWeek: true });
  });
  test('先週も今週もまだなら 0', () => {
    expect(streak('2026-11-11', ['2026-10-26', '2026-10-19'])).toEqual({ weeks: 0, thisWeek: false });
    expect(streak('2026-11-11', [])).toEqual({ weeks: 0, thisWeek: false });
  });
  test('週は月曜始まり：日曜は同じ週、次の月曜から新しい週', () => {
    expect(streak('2026-11-15', ['2026-11-09'])).toEqual({ weeks: 1, thisWeek: true });
    expect(streak('2026-11-16', ['2026-11-09'])).toEqual({ weeks: 1, thisWeek: false });
  });
  test('睡眠の目標があれば、7時間以上寝た日も数える', () => {
    const withSleep = { ...goals, sleepDays: 1 };
    expect(streak('2026-11-11', ['2026-11-09'], { goals: withSleep })).toEqual({ weeks: 0, thisWeek: false });
    expect(streak('2026-11-11', ['2026-11-09'], { goals: withSleep, sleep: [{ date: '2026-11-10', asleepMin: 420 }] })).toEqual({ weeks: 1, thisWeek: true });
    expect(streak('2026-11-11', ['2026-11-09'], { goals: withSleep, sleep: [{ date: '2026-11-10', asleepMin: 419 }] })).toEqual({ weeks: 0, thisWeek: false });
  });
  test('過ぎた週（週のまとめの週）でも、その週の時点で数える。その週より後の週は数えない', () => {
    // 10/26 の週のまとめ：10/26・10/19 の週を達成。後の 11/2・11/9 の週の達成は入れない
    expect(streak('2026-10-28', ['2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19'])).toEqual({ weeks: 2, thisWeek: true });
    // 10/26 の週は届かなかった：その前の週から数える（thisWeek は false。画面では過ぎた週なら連続を出さない）
    expect(streak('2026-11-01', ['2026-11-02', '2026-10-19', '2026-10-12'])).toEqual({ weeks: 2, thisWeek: false });
  });
  test('数えるのは今週を含めて上限の週まで', () => {
    const mondays = Array.from({ length: STREAK_MAX_WEEKS + 5 }, (_, i) => addDays('2026-11-09', -7 * i));
    expect(streak('2026-11-11', mondays)).toEqual({ weeks: STREAK_MAX_WEEKS, thisWeek: true });
    expect(streak('2026-11-11', mondays, { maxWeeks: 4 })).toEqual({ weeks: 4, thisWeek: true });
  });
});
