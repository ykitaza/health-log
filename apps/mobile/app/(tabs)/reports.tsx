import { router, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { REPORT_CHAT_LABEL, SCHEDULE_LABEL, useChatChooser, useScheduleSheet } from '@/components/ChatSheet';
import { LoadError } from '@/components/LoadError';
import { easeOut, useListMotion } from '@/components/motion';
import { WeeklyGoalsNowCard } from '@/components/reportBlocks';
import { ReportCard } from '@/components/reports';
import { ReportSuggestion } from '@/components/ReportSuggestion';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, Chip, ChipRow, EmptyState, Fab, PrimaryTabs, TabHeader } from '@/components/ui';
import { TodoWeekCard } from '@/components/WeeklyTodo';
import { useFocusData } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { todoWeeks } from '@/lib/home';
import {
  emptyFilterText, filterReports, groupByMonth, isReportOrder, KIND_LABELS, orderToggleLabel, otherOrder, REPORT_FILTERS, REPORT_ORDER_LABELS, ReportFilter,
  ReportOrder, sortReports,
} from '@/lib/reports';
import { colors, size, space } from '@/theme';
import { duration } from '@/theme/motion';

const EXAMPLES = ['「今週のまとめを作って」', '「10月の筋トレと食事をふり返って、レポートに残して」', '「ベンチプレスが伸びない理由を分析して保存して」'];

type Pane = 'report' | 'todo';
const paneOf = (v: string | undefined): Pane | null => (v === 'report' || v === 'todo' ? v : null);

/**
 * レポートのタブ（下のタブの5つ目）。上の切り替え（M3 の primary tabs。筋トレ・食事の「記録／推移」と同じ）で「レポート」と「やること」を分ける。
 * どちらを開いていたかは画面の状態で覚える（タブを移っても、戻ったら同じ）。ほかの画面から view=todo で開くと「やること」
 * （ホームの今週やることの「すべて」）。お知らせから order=newest で開くと「レポート」。
 *
 * やること：いちばん上に今週の目標（今週の途中経過。押すと設定の今週の目標の欄へ。ホームから外したカードの代わりの入口）。
 * その下に、週のまとめの次の一歩を、やることの週（まとめの期間の次の週）の新しい順にカードで（lib/home.ts の todoWeeks）。
 * 今週の分は見出しに「今週」。どの週もチェックを付け外しでき、ホームの今週やることと同じ next_steps_done を変える。
 * 見出しの行を押すと、もとの週のまとめを開く。絞り込みと並べ替え、お知らせの帯は出さない。
 *
 * レポート：レポートの一覧（ホームの「最新のレポート」の「すべて」と、新しいレポートのお知らせからもこのタブへ移る）。
 * 期間の日付（lib/reports.ts の reportDate）の新しい順（右の切り替えで古い順）に並べ、その月の見出しで区切る。
 * 上の filter chip で種類（日・週・月）に絞る。「その他」は「すべて」でだけ出す。まだ開いていないものに「新着」の札。
 * 並び順は端末に覚える。お知らせから開いたとき（order=newest）は、種類の絞り込みを「すべて」に戻し、新しい順にする（端末には覚えない）。
 * 中身（/reports/[id]）は、この一覧の上に開き、戻るでこの一覧へ戻る。
 * 右上の「自動で作る」で、ChatGPT のスケジュールにまとめを作る予定を入れるシート。
 * ホームは近道で、こちらが本体なので、ホームのレポートの操作をそろえる：いちばん上に新しいレポートのお知らせとまだのまとめのおすすめ
 * （ホームと同じ部品。2つとも出し、新着を上に）、右下の「レポートを作る」（ホームの「チャットで作る」と同じシート。
 * まだ作っていないまとめ（閉じていないもの）があれば、それをまとめて頼む文で開く）
 */
export default function ReportsScreen() {
  const params = useLocalSearchParams<{ order?: string; view?: string }>();
  const [pane, setPane] = useState<Pane>(paneOf(params.view) ?? 'report');
  const { data, error, reload, repos } = useFocusData(async (r) => {
    const [reports, seen, order] = await Promise.all([r.reports.list(), r.reports.seenIds(), r.reports.listOrder()]);
    return { reports, seen, order };
  });
  const list = useListMotion(data != null);
  const chat = useChatChooser();
  const schedule = useScheduleSheet();
  const today = useToday();
  // 押したときに読む（帯の「×」で閉じた分は入れない。帯は別の部品なので、ここで覚えた一覧は古くなる）
  const make = async () => {
    const items = await repos.achievements.pending().catch(() => []);
    if (items.length > 0) chat.pending(items); else chat.report();
  };
  const [filter, setFilter] = useState<ReportFilter>('all');
  // 選んだ順（null なら、お知らせから開いたときの順か、端末に覚えた順）
  const [picked, setPicked] = useState<ReportOrder | null>(null);
  // 開いたときはカードを順に出す。チップで切り替えたあとは、一覧の全体を 150ms でふわっと入れ替える（カードは順に出さない）
  const [switched, setSwitched] = useState(false);
  const reduced = useReducedMotion();
  // ほかの画面から並び順を指定して移ってきたとき。受け取ったら消す（次に同じ順を渡されたときも動くように）
  useEffect(() => {
    if (!isReportOrder(params.order)) return;
    setPicked(params.order);
    setFilter('all');
    setPane('report');
    router.setParams({ order: undefined });
  }, [params.order]);
  useEffect(() => {
    const p = paneOf(params.view);
    if (!p) return;
    setPane(p);
    router.setParams({ view: undefined });
  }, [params.view]);
  const swap = switched && !reduced && Platform.OS !== 'web' ? FadeIn.duration(duration.text).easing(easeOut) : undefined;
  const header = (
    <TabHeader title="レポート"
      actions={<Button label="自動で作る" icon="calendar" variant="text" small accessibilityLabel={SCHEDULE_LABEL} onPress={schedule.open}
        style={{ paddingLeft: 12, paddingRight: 12 }} testID="report-schedule" />} />
  );
  // 上の段・切り替え・右下の「レポートを作る」・シートは、どの状態でも同じ。お知らせの帯は「レポート」の側だけ
  const frame = (body: ReactNode) => (
    <View style={{ flex: 1 }}>
      <Screen tab fab bottomSpace={size.fab + space.l * 2}>
        {header}
        <PrimaryTabs<Pane>
          options={[{ key: 'report', label: 'レポート', icon: 'report' }, { key: 'todo', label: 'やること', icon: 'check' }]}
          value={pane}
          onChange={setPane}
        />
        {data != null && pane === 'report' && <ReportSuggestion both onSeen={reload} />}
        {pane === 'todo' && <WeeklyGoalsNowCard today={today} />}
        {body}
      </Screen>
      <Fab label="レポートを作る" onPress={make} style={{ position: 'absolute', right: space.l, bottom: space.l }} testID="report-make" />
      {chat.sheet}
      {schedule.sheet}
    </View>
  );
  if (error) return frame(<LoadError onRetry={reload} />);
  if (data == null) return frame(null);
  if (pane === 'todo') {
    const weeks = todoWeeks(data.reports);
    if (weeks.length === 0) {
      return frame(
        <EmptyState icon="check" title="やることはまだありません" body="週のまとめに次の一歩があると、ここに週ごとに並びます。" />,
      );
    }
    return frame(
      <View style={{ gap: space.m, marginTop: space.l }} testID="todo-weeks">
        {weeks.map((w) => <TodoWeekCard key={w.start} week={w} today={today} />)}
        <T size={12} color={colors.sub}>チェックは次の週のまとめで Claude・ChatGPT が振り返ります。</T>
      </View>,
    );
  }
  if (data.reports.length === 0) {
    return frame(
      <>
        <EmptyState icon="chart" title="レポートはまだありません" body="チャット（Claude・ChatGPT）で「今週のまとめを作って」と頼むと、ここに出ます。"
          action={<Button label="チャットで作る" icon="chat" variant="tonal" accessibilityLabel={REPORT_CHAT_LABEL} onPress={chat.report} />} />
        <Card style={{ gap: 8 }}>
          <T bold size={14} accessibilityRole="header">頼み方の例</T>
          {EXAMPLES.map((e) => <T key={e} size={14}>・{e}</T>)}
        </Card>
      </>,
    );
  }
  const order: ReportOrder = picked ?? (isReportOrder(params.order) ? params.order : data.order);
  const toggleOrder = () => {
    const next = otherOrder(order);
    setPicked(next);
    setSwitched(true);
    repos.reports.setListOrder(next).catch(() => {});
  };
  const shown = sortReports(filterReports(data.reports, filter), order);
  const groups = groupByMonth(shown, today);
  const empty = filter === 'all' ? null : emptyFilterText(filter);
  return frame(
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <View style={{ flex: 1 }}>
          <ChipRow>
            {REPORT_FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => { setFilter(f.key); setSwitched(true); }} />
            ))}
          </ChipRow>
        </View>
        <Button label={REPORT_ORDER_LABELS[order]} icon={order === 'newest' ? 'down' : 'up'} variant="text" small accessibilityLabel={orderToggleLabel(order)}
          onPress={toggleOrder} style={{ paddingLeft: 8, paddingRight: 8, marginRight: -8 }} testID="report-order" />
      </View>
      <Animated.View key={`${filter}|${order}`} entering={swap}>
        {empty && shown.length === 0 ? (
          <EmptyState icon="chart" title={empty.title} body={empty.body}
            action={<Button label="チャットで作る" icon="chat" variant="tonal" accessibilityLabel={REPORT_CHAT_LABEL} onPress={chat.report} />} />
        ) : (
          <>
            {groups.map((g) => (
              <View key={g.key} style={{ gap: space.m, marginTop: space.m }}>
                {g.title !== '' && <T variant="titleS" color={colors.sub} accessibilityRole="header">{g.title}</T>}
                {g.reports.map((r) => (
                  <Animated.View key={r.id} entering={switched ? undefined : list.entering(shown.indexOf(r))} exiting={list.exiting} layout={list.layout}>
                    <ReportCard report={r} unread={!data.seen.has(r.id)} onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })} />
                  </Animated.View>
                ))}
              </View>
            ))}
            <T size={12} color={colors.sub} style={{ marginTop: 12 }}>
              {filter === 'all' ? 'チャット（Claude・ChatGPT）で作ったまとめです。' : `${KIND_LABELS[filter]}だけを出しています。`}
              期間の日付の{REPORT_ORDER_LABELS[order]}に、月ごとに並びます。
            </T>
          </>
        )}
      </Animated.View>
    </>,
  );
}
