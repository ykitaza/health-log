import { router, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { REPORT_CHAT_LABEL, SCHEDULE_LABEL, useChatChooser, useScheduleSheet } from '@/components/ChatSheet';
import { LoadError } from '@/components/LoadError';
import { ReportCard } from '@/components/reports';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Button, Card, EmptyState, Fab, TabHeader } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { colors, size, space } from '@/theme';

const EXAMPLES = ['「今週のまとめを作って」', '「10月の筋トレと食事をふり返って、レポートに残して」', '「先月のまとめを作って」'];

/** 期間タブの種類（'other'＝分析レポートはアプリに出さないので、ここでも受けない） */
type PeriodKind = 'daily' | 'weekly' | 'monthly';
const isPeriodKind = (v: string | undefined): v is PeriodKind => v === 'daily' || v === 'weekly' || v === 'monthly';
/** 日付のパラメータ（'YYYY-MM-DD' の形だけ受ける。db/repositories/reports.ts の scheduleRequestedOn と同じ確かめ方） */
const isDateParam = (v: string | undefined): v is string => v != null && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** チャットの戻りリンク（torelog://reports?date=…&kind=…）から受けた、開くレポートの指定 */
type LinkRequest = { date: string | null; kind: PeriodKind };

/**
 * レポートのタブ（下のタブの5つ目）。一覧（カードの並び）と「やること」のペインは廃止し、開いたらレポートの詳細
 * （/reports/[id]）へ直行する入口だけの画面（app/workout/index.tsx の移行画面と同じ形）。行き先は：
 * - 通常は、最新の生成済みレポート（kind が 'other' のものは除く。db/repositories/reports.ts の latest）
 * - チャットの返事の「hlog で見る」リンク（torelog://reports?date=…。app/+native-intent.tsx が /reports?date=… に変える）から
 *   開いたときは、その日付の期間のレポート：date だけなら日のまとめ（その日の daily。なければその種類の最新）、
 *   kind（weekly・monthly）が付いていれば、その期間に date を含むその種類のレポート（なければその種類の最新）。
 *   どれもなければ、最新の生成済みレポートに落ちる
 * - 新しいレポートのお知らせ（components/ReportSuggestion、お知らせの /reports?order=newest）も、ここを通って詳細へ着く
 * 通常の入口は、読み込めた時点で1回だけ詳細へ移る（戻るで戻ってきたときは移り直さず、下の入口を出す。
 * 移り直すと、戻る操作が詳細との往復になってしまうため）。リンクからの指定は、その都度移る。
 * まだ1件もなければ、チャットで作る方法と頼み方の例を出す。
 * 右上の「自動で作る」（ChatGPT のスケジュール）と右下の「レポートを作る」（チャットのシート）は、これまでどおりこの画面に置く。
 * 種類の切り替えは詳細の中の期間タブで行う（order・view のパラメータは、もう行き先を変えない）
 */
export default function ReportsScreen() {
  const params = useLocalSearchParams<{ date?: string; kind?: string }>();
  const [request, setRequest] = useState<LinkRequest | null>(null);
  const [hadRequest, setHadRequest] = useState(false);
  // リンクのパラメータを受けたら取り込み、URL からは消す（次に同じリンクを開いたときも動くように）
  useEffect(() => {
    if (!isDateParam(params.date) && !isPeriodKind(params.kind)) return;
    setRequest({ date: isDateParam(params.date) ? params.date : null, kind: isPeriodKind(params.kind) ? params.kind : 'daily' });
    setHadRequest(true);
    router.setParams({ date: undefined, kind: undefined });
  }, [params.date, params.kind]);

  // 読み込み中（data が null）と、レポートがまだない（latest が null）を分けるため、latest を包んで返す
  const { data, error, reload, repos } = useFocusData(async (r) => {
    if (request) {
      const { date, kind } = request;
      let target = date && kind === 'daily' ? await r.reports.dailyFor(date) : null;
      if (!target && date) {
        const list = await r.reports.list();
        target = list.find((x) => x.kind === kind && x.periodStart != null && x.periodEnd != null && x.periodStart <= date && date <= x.periodEnd) ?? null;
      }
      target ??= await r.reports.latestOfKind(kind);
      target ??= await r.reports.latest();
      return { latest: target, forRequest: true };
    }
    return { latest: await r.reports.latest(), forRequest: false };
  }, request ? `link:${request.kind}:${request.date ?? ''}` : 'latest');
  const chat = useChatChooser();
  const schedule = useScheduleSheet();
  // 通常の入口で詳細へ移ったかどうか（この画面が裏に残っているあいだは1回だけ。戻ってきたら入口を出す）
  const moved = useRef(false);
  const latest = data?.latest ?? null;
  useEffect(() => {
    if (!latest || !data) return;
    if (data.forRequest) {
      // リンクからの指定は、通常の入口の「1回だけ」とは別に、その都度移る
      router.push({ pathname: '/reports/[id]', params: { id: latest.id } });
      setRequest(null);
      moved.current = true;
      return;
    }
    if (moved.current) return;
    moved.current = true;
    router.push({ pathname: '/reports/[id]', params: { id: latest.id } });
  }, [latest, data]);
  // 押したときに読む（まだ作っていないまとめがあれば、それをまとめて頼む文で開く）
  const make = async () => {
    const items = await repos.achievements.pending().catch(() => []);
    if (items.length > 0) chat.pending(items); else chat.report();
  };
  const header = (
    <TabHeader title="レポート"
      actions={<Button label="自動で作る" icon="calendar" variant="text" small accessibilityLabel={SCHEDULE_LABEL} onPress={schedule.open}
        style={{ paddingLeft: 12, paddingRight: 12 }} testID="report-schedule" />} />
  );
  const frame = (body: ReactNode) => (
    <View style={{ flex: 1 }}>
      <Screen tab fab bottomSpace={size.fab + space.l * 2}>
        {header}
        {body}
      </Screen>
      <Fab label="レポートを作る" onPress={make} style={{ position: 'absolute', right: space.l, bottom: space.l }} testID="report-make" />
      {chat.sheet}
      {schedule.sheet}
    </View>
  );
  if (error) return frame(<LoadError onRetry={reload} />);
  if (data == null) return frame(null);
  if (latest == null) {
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
  // 詳細への入口（自動で移る前と、戻るで戻ってきたときに出る）
  return frame(
    <View style={{ gap: space.m, marginTop: space.l }}>
      <T size={14} color={colors.sub}>{hadRequest ? '選んだ期間のレポートを開きます。' : '最新の生成済みレポートを開きます。'}</T>
      <ReportCard report={latest} onPress={() => router.push({ pathname: '/reports/[id]', params: { id: latest.id } })} />
    </View>,
  );
}
