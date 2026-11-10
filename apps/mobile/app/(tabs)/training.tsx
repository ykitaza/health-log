import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { DateSwitcher, DayPickerSheet, NotTodayRow, SwipeArea } from '@/components/DayPicker';
import { Screen } from '@/components/Screen';
import { TrainingTrend } from '@/components/TrainingTrend';
import { IconButton, PrimaryTabs, TabHeader } from '@/components/ui';
import { WorkoutDayContent, WorkoutFooter } from '@/components/WorkoutDay';
import { useBackToToday } from '@/hooks/backToToday';
import { useToday } from '@/hooks/today';
import { addDays, formatJpDate, todayKey } from '@/lib/date';
import { space } from '@/theme';

type Pane = 'record' | 'trend';

/** ほかの画面から開くときの view（前の名前の today・history も受ける） */
const paneOf = (v: string | undefined): Pane | null =>
  v === 'record' || v === 'today' ? 'record' : v === 'trend' || v === 'history' ? 'trend' : null;

/**
 * 筋トレのタブ。上の切り替え（M3 の primary tabs）で「記録」と「推移」（グラフ）を分ける。
 * 記録は、上の日付の切り替え（前の日・次の日、日付を押すと「日を選ぶ」のシート、左右のスワイプ）で選んだ日のトレーニングを見て直す。
 * 未来の日へは進めない。ほかの画面から date を渡して開くと、その日の記録になる（/workout?date= もここへ移る）。右上に RM計算機の入口
 */
export default function TrainingScreen() {
  const params = useLocalSearchParams<{ view?: string; date?: string }>();
  const [view, setView] = useState<Pane>(paneOf(params.view) ?? 'record');
  const [date, setDate] = useState(todayKey);
  // 日をまたいだら、今日を見ていたなら新しい今日へ移す（前の日に記録を足さないように）
  const today = useToday((next, prev) => setDate((d) => (d === prev ? next : d)));
  const [picking, setPicking] = useState(false);
  // ほかの画面から「記録」「推移」や日を指定して開いたとき。受け取ったら消す（次に同じ日を渡されたときも動くように）
  useEffect(() => {
    const p = paneOf(params.view);
    const asked = params.date && params.date <= todayKey() ? params.date : null;
    if (asked) { setDate(asked); setView('record'); } else if (p) setView(p);
    if (params.view || params.date) router.setParams({ view: undefined, date: undefined });
  }, [params.view, params.date]);
  // 前の日を見ているときは、Android の戻るでまず今日に戻す
  useBackToToday(view !== 'record' || date === today, () => setDate(today));

  const move = (d: 'prev' | 'next') => {
    if (d === 'prev') setDate(addDays(date, -1));
    else if (date < today) setDate(addDays(date, 1));
  };
  const openDay = (d: string) => { setDate(d); setView('record'); };

  return (
    <Screen tab footer={view === 'record' ? <WorkoutFooter date={date} /> : undefined}>
      <TabHeader title="筋トレ" actions={<IconButton name="calc" label="RM計算機" onPress={() => router.push('/rm')} />} />
      <PrimaryTabs<Pane>
        options={[{ key: 'record', label: '記録', icon: 'dumbbell' }, { key: 'trend', label: '推移', icon: 'chart' }]}
        value={view}
        onChange={setView}
      />
      {view === 'record' ? (
        <SwipeArea onSwipe={move} testID="training-day">
          <DateSwitcher
            label={formatJpDate(date)} prevLabel="前の日" nextLabel="次の日" canNext={date < today}
            onPrev={() => move('prev')} onNext={() => move('next')} onPick={() => setPicking(true)} style={{ marginTop: space.l }}
          />
          {date !== today && <NotTodayRow onToday={() => setDate(today)} />}
          <WorkoutDayContent date={date} />
        </SwipeArea>
      ) : (
        <View style={{ marginTop: 8 }}>
          <TrainingTrend onOpenDay={openDay} />
        </View>
      )}
      <DayPickerSheet visible={picking} kind="training" value={date} today={today} onClose={() => setPicking(false)} onPick={setDate} />
    </Screen>
  );
}
