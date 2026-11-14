import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { DateSwitcher, DayPickerSheet, NotTodayRow, SwipeArea, usePageSlide } from '@/components/DayPicker';
import { InjuryListContent, useInjuryAddSheet } from '@/components/injuries';
import { Screen } from '@/components/Screen';
import { parseTrendFocus, TrainingTrend, TrendFocus } from '@/components/TrainingTrend';
import { Fab, IconButton, PrimaryTabs, TabHeader } from '@/components/ui';
import { WorkoutDayContent, WorkoutFooter } from '@/components/WorkoutDay';
import { useBackToToday } from '@/hooks/backToToday';
import { useToday } from '@/hooks/today';
import { addDays, DateKey, formatJpDate, todayKey } from '@/lib/date';
import { pageDirection, SwipeDirection } from '@/lib/swipe';
import { size, space } from '@/theme';

type Pane = 'record' | 'trend' | 'injury';

/** ほかの画面から開くときの view（前の名前の today・history も受ける） */
const paneOf = (v: string | undefined): Pane | null =>
  v === 'record' || v === 'today' ? 'record' : v === 'trend' || v === 'history' ? 'trend' : v === 'injury' ? 'injury' : null;

/**
 * 筋トレのタブ。上の切り替え（M3 の primary tabs）で「記録」と「推移」（グラフ）と「ケガ」（ケガの記録の一覧。右下に「ケガを記録」。押すと AI で記録か自分で入力かを選ぶ）を分ける。
 * 記録は、上の日付の切り替え（前の日・次の日、日付を押すと「日を選ぶ」のシート、左右のスワイプ）で選んだ日のトレーニングを見て直す。
 * 未来の日へは進めない。ほかの画面から date を渡して開くと、その日の記録になる（/workout?date= もここへ移る）。entry も渡すと、その種目のカードまでスクロールする
 * （ホームの種目の札から）。右上に RM計算機の入口。
 * 推移を focus（big3・load・parts・best）か exercise を付けて開くと（ホームのパネルと LATEST の PR から）、そのグラフ・種目を見せてスクロールする。
 * 総負荷量の日・部位のバランスの 28日 は、覚えた期間を書き換えず、筋トレのタブを離れるか、上の切り替えで移るか、期間を選ぶまで（TrainingTrend）
 */
export default function TrainingScreen() {
  const params = useLocalSearchParams<{ view?: string; date?: string; entry?: string; focus?: string; exercise?: string }>();
  const [view, setView] = useState<Pane>(paneOf(params.view) ?? 'record');
  const [date, setDate] = useState(todayKey);
  // 日をまたいだら、今日を見ていたなら新しい今日へ移す（前の日に記録を足さないように）
  const today = useToday((next, prev) => setDate((d) => (d === prev ? next : d)));
  const [picking, setPicking] = useState(false);
  // 推移で見せるグラフ・種目（ホームから来たときだけ）。記録で見せる種目のカード（ホームの種目の札から）。n は来るたびに変える（同じ所へもう一度スクロールする）
  const [trendFocus, setTrendFocus] = useState<TrendFocus | null>(null);
  const [entryFocus, setEntryFocus] = useState<{ entry: string; n: number } | null>(null);
  useFocusEffect(useCallback(() => () => { setTrendFocus(null); setEntryFocus(null); }, []));
  // ほかの画面から「記録」「推移」や日を指定して開いたとき。受け取ったら消す（次に同じ日を渡されたときも動くように）
  const focusCount = useRef(0);
  useEffect(() => {
    // 受け取った引数を消したあと（すべて undefined）にも呼ばれる。そのときは見せるものを変えない
    if (!params.view && !params.date && !params.entry && !params.focus && !params.exercise) return;
    const p = paneOf(params.view);
    const asked = params.date && params.date <= todayKey() ? params.date : null;
    if (asked) { setDate(asked); setView('record'); } else if (p) setView(p);
    const n = ++focusCount.current;
    setEntryFocus(asked && params.entry ? { entry: params.entry, n } : null);
    setTrendFocus(!asked && p === 'trend' ? parseTrendFocus(params.focus, params.exercise, n) : null);
    router.setParams({ view: undefined, date: undefined, entry: undefined, focus: undefined, exercise: undefined });
  }, [params.view, params.date, params.entry, params.focus, params.exercise]);
  // 日を変えるときは、向きに合わせて中身を横へすべらせる（スワイプ・前後のボタン・日を選ぶ・今日に戻る）
  const slide = usePageSlide();
  // 前の日・次の日。未来の日へは進めない。すべり終わる前に続けて動かしても数を落とさないよう、最新の日から計算する
  const move = (d: SwipeDirection) => setDate((cur) => (d === 'prev' ? addDays(cur, -1) : cur < today ? addDays(cur, 1) : cur));
  const goTo = (to: DateKey) => {
    const d = pageDirection(date, to);
    if (d) slide.go(d, () => setDate(to));
  };
  // 前の日を見ているときは、Android の戻るでまず今日に戻す
  useBackToToday(view !== 'record' || date === today, () => goTo(today));
  const openDay = (d: string) => { setDate(d); setView('record'); };
  const adding = useInjuryAddSheet();

  const injury = view === 'injury';
  return (
    <View style={{ flex: 1 }}>
      <Screen tab footer={view === 'record' ? <WorkoutFooter date={date} /> : undefined} fab={injury} bottomSpace={injury ? size.fab + space.l * 2 : undefined}>
        <TabHeader title="筋トレ" actions={<IconButton name="calc" label="RM計算機" onPress={() => router.push('/rm')} />} />
        <PrimaryTabs<Pane>
          options={[{ key: 'record', label: '記録', icon: 'dumbbell' }, { key: 'trend', label: '推移', icon: 'chart' }, { key: 'injury', label: 'ケガ', icon: 'alert' }]}
          value={view}
          onChange={(v) => { setTrendFocus(null); setEntryFocus(null); setView(v); }}
        />
        {view === 'record' ? (
          <SwipeArea
            slide={slide} onSwipe={move} canNext={date < today} hint="training-day" testID="training-day"
            header={(
              <DateSwitcher
                label={formatJpDate(date)} prevLabel="前の日" nextLabel="次の日" canNext={date < today}
                onPrev={() => slide.go('prev', () => move('prev'))} onNext={() => slide.go('next', () => move('next'))}
                onPick={() => setPicking(true)} style={{ marginTop: space.l }}
              />
            )}
          >
            {date !== today && <NotTodayRow onToday={() => goTo(today)} />}
            <WorkoutDayContent date={date} focus={entryFocus} />
          </SwipeArea>
        ) : view === 'trend' ? (
          <View style={{ marginTop: 8 }}>
            <TrainingTrend onOpenDay={openDay} focus={trendFocus} onRangeChosen={() => setTrendFocus(null)} />
          </View>
        ) : (
          <InjuryListContent />
        )}
        <DayPickerSheet visible={picking} kind="training" value={date} today={today} onClose={() => setPicking(false)} onPick={goTo} />
      </Screen>
      {injury && <Fab label="ケガを記録" onPress={adding.open} style={{ position: 'absolute', right: space.l, bottom: space.l }} testID="injury-new" />}
      {adding.sheet}
    </View>
  );
}
