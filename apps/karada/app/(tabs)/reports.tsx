import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { REPORT_CHAT_LABEL, SCHEDULE_LABEL, useChatChooser, useScheduleSheet } from '@/components/ChatSheet';
import { ReportDetail, ReportSource } from '@/components/report/ReportDetail';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, EmptyState, Fab, TabHeader } from '@/components/ui';
import { useRepos } from '@/hooks/data';
import { size, space } from '@/theme';

const EXAMPLES = ['「今週のまとめを作って」', '「10月の筋トレと食事をふり返って、レポートに残して」', '「先月のまとめを作って」'];

/** 期間タブの種類（'other'＝分析レポートはアプリに出さないので、ここでも受けない） */
type PeriodKind = 'daily' | 'weekly' | 'monthly';
const isPeriodKind = (v: string | undefined): v is PeriodKind => v === 'daily' || v === 'weekly' || v === 'monthly';
/** 日付のパラメータ（'YYYY-MM-DD' の形だけ受ける。db/repositories/reports.ts の scheduleRequestedOn と同じ確かめ方） */
const isDateParam = (v: string | undefined): v is string => v != null && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * レポートのタブ（下のタブの5つ目）。最新の生成済みレポートの詳細（components/report/ReportDetail.tsx）を、タブの中にそのまま出す。
 * 詳細へ移る入口の画面はない（以前は /reports/[id] へ1回だけ移り、戻ると入口のカードが出ていた）。
 * - 通常は、最新の生成済みレポート（kind が 'other' のものは除く。db/repositories/reports.ts の latest）。種類の切り替えは詳細の中の期間タブで行う
 * - チャットの返事の「KARADA で見る」リンク（torelog://reports?date=…&kind=…。app/+native-intent.tsx が /reports?date=…&kind=… に変える）から
 *   開いたときは、その期間に date を含む、その種類（kind。なければ日）のレポート。なければその種類の最新、
 *   それもなければ最新の生成済みレポート（db/repositories/reports.ts の forLink）。そのままタブに出す（画面は増やさない）。
 *   別のタブへ移ったら、その指定は忘れる（次に開いたときは最新）
 * - ホームの「すべて」とお知らせの「見る」（2件以上）は、このタブへ移る。1件を指す入口（最新のカード・お知らせの1件・今週やること・
 *   日のまとめのカード）は /reports/[id] を開く（戻るで来た画面へ戻る）
 * まだ1件もなければ、チャットで作る方法と頼み方の例を出す。
 * 右上の「自動で作る」（ChatGPT のスケジュール）と右下の「レポートを作る」（チャットのシート）は、詳細の上にそのまま置く
 */
export default function ReportsScreen() {
  const params = useLocalSearchParams<{ date?: string; kind?: string }>();
  const [source, setSource] = useState<ReportSource>({ type: 'latest' });
  // リンクのパラメータを受けたら取り込み、URL からは消す（次に同じリンクを開いたときも動くように）
  useEffect(() => {
    if (!isDateParam(params.date) && !isPeriodKind(params.kind)) return;
    setSource((s) => ({
      type: 'link', kind: isPeriodKind(params.kind) ? params.kind : 'daily', date: isDateParam(params.date) ? params.date : null,
      nonce: s.type === 'link' ? s.nonce + 1 : 0,
    }));
    router.setParams({ date: undefined, kind: undefined });
  }, [params.date, params.kind]);
  // 別のタブへ移ったら、リンクの指定は忘れる
  useFocusEffect(useCallback(() => () => setSource((s) => (s.type === 'link' ? { type: 'latest' } : s)), []));

  const repos = useRepos();
  const chat = useChatChooser();
  const schedule = useScheduleSheet();
  // 押したときに読む（まだ作っていないまとめがあれば、それをまとめて頼む文で開く）
  const make = async () => {
    const items = await repos.achievements.pending().catch(() => []);
    if (items.length > 0) chat.pending(items); else chat.report();
  };
  const scheduleButton = (
    <Button label="自動で作る" icon="calendar" variant="text" small accessibilityLabel={SCHEDULE_LABEL} onPress={schedule.open}
      style={{ paddingLeft: 12, paddingRight: 12 }} testID="report-schedule" />
  );
  const empty = (
    <Screen tab fab bottomSpace={size.fab + space.l * 2}>
      <TabHeader title="レポート" actions={scheduleButton} />
      <EmptyState icon="chart" title="レポートはまだありません" body="チャット（Claude・ChatGPT）で「今週のまとめを作って」と頼むと、ここに出ます。"
        action={<Button label="チャットで作る" icon="chat" variant="tonal" accessibilityLabel={REPORT_CHAT_LABEL} onPress={chat.report} />} />
      <Card style={{ gap: 8 }}>
        <T bold size={14} accessibilityRole="header">頼み方の例</T>
        {EXAMPLES.map((e) => <T key={e} size={14}>・{e}</T>)}
      </Card>
    </Screen>
  );
  return (
    <View style={{ flex: 1 }}>
      <ReportDetail source={source} action={scheduleButton} empty={empty} />
      <Fab label="レポートを作る" onPress={make} style={{ position: 'absolute', right: space.l, bottom: space.l }} testID="report-make" />
      {chat.sheet}
      {schedule.sheet}
    </View>
  );
}
