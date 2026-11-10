import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Screen } from '@/components/Screen';

/**
 * 前のその日のトレーニングの画面の道（/workout?date=）。同じことは筋トレのタブの「記録」でできるので、
 * ホームのカードなどから開かれたら、筋トレのタブのその日へ移る（下のタブの画面まで戻ってから切り替える）
 */
export default function WorkoutDayRedirect() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  useEffect(() => {
    router.dismissTo({ pathname: '/training', params: date ? { view: 'record', date } : { view: 'record' } });
  }, [date]);
  return <Screen scroll={false}>{null}</Screen>;
}
