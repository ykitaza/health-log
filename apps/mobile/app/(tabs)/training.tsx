import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { TrainingHistory } from '@/components/TrainingHistory';
import { PrimaryTabs, TabHeader } from '@/components/ui';
import { AddExerciseButton, WorkoutDayContent } from '@/components/WorkoutDay';
import { useToday } from '@/hooks/today';

type Pane = 'today' | 'history';

/**
 * 筋トレのタブ。上の切り替え（M3 の primary tabs）で「今日」のトレーニングと「履歴」（カレンダー・グラフ）を分ける。
 * 1画面にまとめると、今日の記録と履歴のチップ・グラフが縦に長く並んで見づらいため
 */
export default function TrainingScreen() {
  const params = useLocalSearchParams<{ view?: Pane }>();
  const [view, setView] = useState<Pane>(params.view === 'history' ? 'history' : 'today');
  // ほかの画面から「今日」「履歴」を指定して開いたとき
  useEffect(() => { if (params.view === 'today' || params.view === 'history') setView(params.view); }, [params.view]);
  const today = useToday();
  return (
    <Screen tab footer={view === 'today' ? <AddExerciseButton date={today} /> : undefined}>
      <TabHeader title="筋トレ" />
      <PrimaryTabs<Pane>
        options={[{ key: 'today', label: '今日', icon: 'dumbbell' }, { key: 'history', label: '履歴', icon: 'calendar' }]}
        value={view}
        onChange={setView}
      />
      <View style={{ marginTop: 8 }}>
        {view === 'today' ? <WorkoutDayContent date={today} /> : <TrainingHistory />}
      </View>
    </Screen>
  );
}
