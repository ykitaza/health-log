import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/Screen';
import { DayNote, Header } from '@/components/ui';
import { AddExerciseButton, WorkoutDayContent } from '@/components/WorkoutDay';
import { formatJpDate, todayKey } from '@/lib/date';

/** その日のトレーニング（ホームのカード・筋トレの履歴から開く）。今日なら筋トレのタブの「今日」と同じ中身 */
export default function WorkoutDayScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const today = todayKey();
  const date = params.date ?? today;
  return (
    <Screen footer={<AddExerciseButton date={date} />}>
      <Header overline={date === today ? '今日のトレーニング' : 'トレーニング'} title={formatJpDate(date)} onBack={() => router.back()} />
      <DayNote date={date} today={today} />
      <WorkoutDayContent date={date} />
    </Screen>
  );
}
