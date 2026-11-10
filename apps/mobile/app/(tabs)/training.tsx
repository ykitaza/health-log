import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { TrainingTrend } from '@/components/TrainingTrend';
import { IconButton, PrimaryTabs, TabHeader } from '@/components/ui';
import { WorkoutDayContent, WorkoutFooter } from '@/components/WorkoutDay';
import { useToday } from '@/hooks/today';

type Pane = 'today' | 'trend';

/** ほかの画面から開くときの view（前の名前の history も推移として受ける） */
const paneOf = (v: string | undefined): Pane | null => (v === 'today' ? 'today' : v === 'trend' || v === 'history' ? 'trend' : null);

/**
 * 筋トレのタブ。上の切り替え（M3 の primary tabs）で「今日」のトレーニングと「推移」（記録・グラフ）を分ける。
 * 1画面にまとめると、今日の記録と推移のチップ・グラフが縦に長く並んで見づらいため。右上に RM計算機の入口
 */
export default function TrainingScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<Pane>(paneOf(params.view) ?? 'today');
  // ほかの画面から「今日」「推移」を指定して開いたとき
  useEffect(() => { const p = paneOf(params.view); if (p) setView(p); }, [params.view]);
  const today = useToday();
  return (
    <Screen tab footer={view === 'today' ? <WorkoutFooter date={today} /> : undefined}>
      <TabHeader title="筋トレ" actions={<IconButton name="calc" label="RM計算機" onPress={() => router.push('/rm')} />} />
      <PrimaryTabs<Pane>
        options={[{ key: 'today', label: '今日', icon: 'dumbbell' }, { key: 'trend', label: '推移', icon: 'chart' }]}
        value={view}
        onChange={setView}
      />
      <View style={{ marginTop: 8 }}>
        {view === 'today' ? <WorkoutDayContent date={today} /> : <TrainingTrend />}
      </View>
    </Screen>
  );
}
