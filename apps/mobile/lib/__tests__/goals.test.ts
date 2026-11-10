import { dailyAchievement, weekOf, weeklyAchievement, WeeklyGoals } from '../goals';
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
