// 週のまとめの次の一歩のチェック：ホームの「今週やること」、週のまとめの中身の「来週の焦点」と「先週やることの振り返り」。
// チェックはレポートの next_steps_done（端末の表に書き、同期でサーバーに送る。次の週のまとめで Claude・ChatGPT が振り返る）。
// どの画面も同じレポートの同じ値を見る
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusData, useRepos } from '@/hooks/data';
import { DateKey } from '@/lib/date';
import { TodoWeek, todoAllDone, todoCount, toggleTodo, weekRangeLabel, weeklyTodo } from '@/lib/home';
import { colors, radius, space } from '@/theme';
import { duration, HOLD_MS, motionDuration } from '@/theme/motion';
import { Icon } from './Icon';
import { CheckPop, Collapse, DrawCheck, easeOut, PressableScale } from './motion';
import { T } from './Text';

/**
 * そのレポートの済んだ番号と、切り替え。押したらすぐに見た目を変え、保存は後ろで行う（書き込みの列に並び、終わると同期が動く）。
 * 保存した値（saved）が読み直しで変わったら（ほかの画面でチェックした、同期で届いた）、そちらを使う
 */
export function useTodoChecks(reportId: string | undefined, saved: number[]) {
  const repos = useRepos();
  const basis = `${reportId}:${saved.join(',')}`;
  const [local, setLocal] = useState<{ basis: string; done: number[] } | null>(null);
  const done = local?.basis === basis ? local.done : saved;
  const toggle = (i: number) => {
    if (!reportId) return;
    const next = toggleTodo(done, i);
    setLocal({ basis, done: next });
    void repos.reports.setStepsDone(reportId, next).catch(() => {});
  };
  return { done, toggle };
}

/**
 * チェックの一覧（押せる大きさ 48 以上。読み上げは checkbox と、その一歩の文）。
 * onToggle がなければ見るだけ（押せない。読み上げは「その一歩の文、済み」「…、まだ」）
 */
export function TodoList({ steps, done, onToggle }: { steps: string[]; done: number[]; onToggle?: (i: number) => void }) {
  return (
    <View>
      {steps.map((step, i) => {
        const checked = done.includes(i);
        const content = (<>
          <View style={[s.box, checked ? { backgroundColor: colors.accent, borderColor: colors.accent } : { borderColor: colors.outline }]}>
            <CheckPop done={checked}>{checked && <Icon name="check" size={16} color={colors.onAccent} strokeWidth={3} />}</CheckPop>
          </View>
          <T variant="bodyL" color={checked ? colors.sub : colors.text} style={[{ flex: 1 }, checked && { textDecorationLine: 'line-through' }]}>{step}</T>
        </>);
        if (!onToggle) {
          return <View key={i} accessible accessibilityLabel={`${step}、${checked ? '済み' : 'まだ'}`} style={s.todoRow} testID={`todo-${i}`}>{content}</View>;
        }
        return (
          <PressableScale
            key={i}
            accessibilityRole="checkbox"
            aria-checked={checked}
            accessibilityState={{ checked }}
            accessibilityLabel={step}
            scaleTo={0.98}
            onPress={() => onToggle(i)}
            style={s.todoRow}
            testID={`todo-${i}`}
          >
            {content}
          </PressableScale>
        );
      })}
    </View>
  );
}

/** 済んだ数「2／3」。全部できたら緑の文字（読み上げは「3つのうち2つ済み」） */
function TodoCount({ steps, done }: { steps: string[]; done: number[] }) {
  const count = todoCount(steps, done);
  return (
    <T variant="bodyM" color={todoAllDone(steps, done) ? colors.accent : colors.sub} accessibilityLabel={`${steps.length}つのうち${count}つ済み`}>
      {count}／{steps.length}
    </T>
  );
}

/**
 * ホームの今週やることから、その一歩を書いた週のまとめの詳細（締めの「来週の焦点」で同じチェックができる）を直接開く入口（押せる大きさ 48）。
 * レポートのタブを通すと、タブが裏に残るため2回目以降は詳細に着かない
 */
function TodoAllLink({ reportId }: { reportId: string }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="週のまとめで、来週の焦点を見る"
      onPress={() => router.push({ pathname: '/reports/[id]', params: { id: reportId } })}
      style={s.allLink}
      testID="weekly-todo-all"
    >
      <T bold size={14} color={colors.accent}>すべて</T>
    </PressableScale>
  );
}

/** 開くと上を向く「⌄」（行き帰り同じ 250ms） */
function Chevron({ open }: { open: boolean }) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: motionDuration(duration.toggle, reduced), easing: easeOut }));
  }, [open, reduced, turn]);
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 180}deg` }] }));
  return <Animated.View style={anim}><Icon name="down" size={24} color={colors.text} /></Animated.View>;
}

/** 線を描き終えてからたたむまでの待ち（描く 250ms ＋ 順に見せる待ち 80ms） */
const COLLAPSE_AFTER_DRAW = duration.enter + HOLD_MS;

/**
 * ホームの「今週やること」：最新の週のまとめの次の一歩をチェックの一覧で。週のまとめがなければ出さない。
 * 全部できたら1行にたたむ（［✓］今週やることを全部できた［3／3］［⌄］）。押すと一覧を開き、見直し・チェックを外せる。
 * 最後の1つをチェックした瞬間だけ、✓ が線を描くように出てから、たたむ（250ms。開くのも同じ）。動きを減らす設定なら動かさない。
 * 右上（たたんだ行の右）の「すべて」で、その一歩を書いた週のまとめの詳細を開く
 */
export function WeeklyTodoCard({ today }: { today: DateKey }) {
  const { data } = useFocusData(async (r) => weeklyTodo(await r.reports.list(), today), today);
  const { done, toggle } = useTodoChecks(data?.reportId, data?.done ?? []);
  const [expanded, setExpanded] = useState(false);
  // この画面で最後の1つをチェックした回数（そのときだけ線を描いてから、待ってたたむ。読み直しや、押して閉じるときは待たない）
  const [completed, setCompleted] = useState(0);
  const [afterDraw, setAfterDraw] = useState(false);
  if (!data) return null;
  const total = data.steps.length;
  const count = todoCount(data.steps, done);
  const allDone = todoAllDone(data.steps, done);
  const open = !allDone || expanded;
  const onToggle = (i: number) => {
    const next = toggleTodo(done, i);
    if (todoAllDone(data.steps, next)) {
      setExpanded(false);
      setCompleted((n) => n + 1);
      setAfterDraw(true);
    }
    toggle(i);
  };
  const countLabel = `${total}つのうち${count}つ済み`;
  return (
    <View style={s.card} testID="weekly-todo">
      {allDone ? (
        <View style={s.head}>
          <PressableScale
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            aria-expanded={expanded}
            accessibilityLabel={`今週やることを全部できた。${countLabel}`}
            accessibilityHint={expanded ? '一覧を閉じます' : '一覧を開いて、見直したりチェックを外したりできます'}
            scaleTo={0.98}
            onPress={() => { setAfterDraw(false); setExpanded((v) => !v); }}
            style={s.doneRow}
            testID="weekly-todo-toggle"
          >
            <DrawCheck key={completed} animate={completed > 0} size={24} color={colors.accent} />
            <T variant="titleM" style={{ flex: 1 }} numberOfLines={1}>今週やることを全部できた</T>
            <T variant="bodyM" color={colors.sub}>{count}／{total}</T>
            <Chevron open={expanded} />
          </PressableScale>
          <TodoAllLink reportId={data.reportId} />
        </View>
      ) : (
        <View style={s.head}>
          <T variant="titleM" accessibilityRole="header" style={{ flex: 1 }}>今週やること</T>
          <T variant="bodyM" color={colors.sub} accessibilityLabel={countLabel}>{count}／{total}</T>
          <TodoAllLink reportId={data.reportId} />
        </View>
      )}
      <Collapse open={open} closeDelay={afterDraw ? COLLAPSE_AFTER_DRAW : 0} testID="weekly-todo-list">
        <View style={{ marginTop: space.xs }}>
          <TodoList steps={data.steps} done={done} onToggle={onToggle} />
        </View>
      </Collapse>
    </View>
  );
}

/**
 * 週のまとめの中身の「先週やることの振り返り」：そのまとめの週にやることだった一覧（前の週のまとめの次の一歩と、済んだか）。見るだけ。
 * 振り返りの文は Claude・ChatGPT が本文に書くので、ここでは一覧だけ
 */
export function PreviousTodoCard({ week }: { week: TodoWeek }) {
  const title = `${weekRangeLabel(week.start)}にやること`;
  return (
    <View style={s.card} testID="report-prev-todo">
      <View style={s.head}>
        <T variant="titleM" accessibilityRole="header" style={{ flex: 1 }}>{title}</T>
        <TodoCount steps={week.steps} done={week.done} />
      </View>
      <View style={{ marginTop: space.xs }}>
        <TodoList steps={week.steps} done={week.done} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.l, padding: space.l },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s },
  doneRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 48, marginVertical: -space.s },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: space.l, minHeight: 48, paddingVertical: space.xs },
  allLink: { minHeight: 48, minWidth: 48, paddingHorizontal: space.s, marginRight: -space.s, marginVertical: -space.s, alignItems: 'center', justifyContent: 'center' },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
