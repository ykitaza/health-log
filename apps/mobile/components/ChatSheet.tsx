import { useState } from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRepos } from '@/hooks/data';
import { CHAT_APP_NAMES, ChatApp, ChatPrompt, openChat, openFailedMessage, orderedApps, promptSummary, REPORT_SCHEDULES, REPORT_SPAN_LABELS, ReportSpan } from '@/lib/chat';
import { DateKey, formatMonthDay, todayKey } from '@/lib/date';
import type { PendingReport } from '@/lib/reports';
import { colors, radius, space } from '@/theme';
import { Icon } from './Icon';
import { Sheet } from './motion';
import { T } from './Text';
import { Button, ListRow, Segmented } from './ui';

/** 押すと、ChatGPT か Claude を選ぶシートを出すボタンの読み上げの名前（外のアプリを開くことを伝える） */
export const AI_RECORD_LABEL = 'AI で記録。ChatGPT か Claude を開きます';
export const REPORT_CHAT_LABEL = 'チャットで作る。ChatGPT か Claude を開きます';
export const SCHEDULE_LABEL = '自動で作る。ChatGPT のスケジュールに、まとめを作る予定を入れます';

/** 記録（筋トレ・食事）とまだのまとめなら決まった文、レポートなら期間をシートの中で選ぶ */
type Request = { prompt: Exclude<ChatPrompt, { kind: 'report' | 'schedule' }> } | { report: true };

/**
 * チャットのアプリを選んで開くシート。open で出し、sheet を画面のどこかに置く。
 * 最後に選んだアプリを上に出す（端末だけに覚える）。開けなかったら、シートの中に案内を出す（もう一方を選べる）
 */
export function useChatChooser() {
  const repos = useRepos();
  const [visible, setVisible] = useState(false);
  // 閉じる動きの間も中身を出しておくため、最後に開いた頼みごとを覚えておく
  const [req, setReq] = useState<Request | null>(null);
  const [last, setLast] = useState<ChatApp | null>(null);
  const [failed, setFailed] = useState<ChatApp | null>(null);
  const [span, setSpan] = useState<ReportSpan>('day');

  const show = async (next: Request) => {
    setFailed(null);
    setSpan('day');
    setReq(next);
    setLast(await repos.settings.lastChatApp().catch(() => null));
    setVisible(true);
  };
  const close = () => setVisible(false);

  const choose = async (app: ChatApp) => {
    if (!req) return;
    const prompt: ChatPrompt = 'report' in req ? { kind: 'report', span, today: todayKey() } : req.prompt;
    if (!(await openChat(app, prompt))) { setFailed(app); return; }
    setVisible(false);
    await repos.settings.setLastChatApp(app).catch(() => {});
  };

  const sheet = (
    <Sheet visible={visible} onClose={close}>
      {req && <ChatSheetBody req={req} last={last} failed={failed} span={span} onSpan={setSpan} onChoose={choose} />}
    </Sheet>
  );
  return {
    /** 記録（筋トレ・食事）の文で開く */
    record: (prompt: Exclude<ChatPrompt, { kind: 'report' | 'schedule' }>) => show({ prompt }),
    /** レポートを頼む（期間はシートで選ぶ） */
    report: () => show({ report: true }),
    /** まだ作っていないまとめを、まとめて頼む（ホームのおすすめ） */
    pending: (items: PendingReport[]) => show({ prompt: { kind: 'pending', items } }),
    sheet,
  };
}

function ChatSheetBody({ req, last, failed, span, onSpan, onChoose }: {
  req: Request; last: ChatApp | null; failed: ChatApp | null; span: ReportSpan; onSpan: (s: ReportSpan) => void; onChoose: (app: ChatApp) => void;
}) {
  const insets = useSafeAreaInsets();
  const report = 'report' in req;
  const making = report || req.prompt.kind === 'pending';
  const text = promptSummary(report ? { kind: 'report', span, today: todayKey() } : req.prompt);
  return (
    <View style={{ padding: space.l, paddingBottom: space.l + insets.bottom, gap: space.m }} testID="chat-sheet">
      <View>
        <T variant="titleL" accessibilityRole="header">{making ? 'チャットで作る' : 'AI で記録'}</T>
        <T variant="bodyM" color={colors.sub}>{text}ための文を入れて開きます</T>
      </View>
      {report && (
        <Segmented<ReportSpan>
          options={(['day', 'week', 'month'] as const).map((k) => ({ key: k, label: REPORT_SPAN_LABELS[k] }))}
          value={span}
          onChange={onSpan}
        />
      )}
      <View style={s.group}>
        {orderedApps(last).map((app, i) => (
          <ListRow
            key={app}
            first={i === 0}
            icon="external"
            chevron={false}
            title={`${CHAT_APP_NAMES[app]} で開く`}
            label={`${CHAT_APP_NAMES[app]} で開く（外のアプリ）`}
            onPress={() => onChoose(app)}
          />
        ))}
      </View>
      {failed && (
        // M3 の snackbar（明るい地）
        <View style={s.snack} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <T variant="bodyM" color={colors.card}>{openFailedMessage(failed)}</T>
        </View>
      )}
    </View>
  );
}

/**
 * 「自動で作る」のシート（Figma の report-schedule-sheet）。ChatGPT のスケジュール（タスク）に、日・週・月のまとめを作る予定を
 * 入れてもらう文で ChatGPT を開く。Claude のスケジュールは、いまは自作のコネクタを使えないため ChatGPT だけ。
 * 頼んだ日を端末に覚えて「前回 11月11日に設定を頼みました」と出す（まだなら出さない）。open で出し、sheet を画面のどこかに置く
 */
export function useScheduleSheet() {
  const repos = useRepos();
  const [visible, setVisible] = useState(false);
  const [requested, setRequested] = useState<DateKey | null>(null);
  const [failed, setFailed] = useState(false);

  const open = async () => {
    setFailed(false);
    setRequested(await repos.reports.scheduleRequestedOn().catch(() => null));
    setVisible(true);
  };
  const close = () => setVisible(false);
  const request = async () => {
    if (!(await openChat('chatgpt', { kind: 'schedule' }))) { setFailed(true); return; }
    setVisible(false);
    await repos.reports.setScheduleRequestedOn(todayKey()).catch(() => {});
  };

  const sheet = (
    <Sheet visible={visible} onClose={close}>
      <ScheduleSheetBody requested={requested} failed={failed} onRequest={request} />
    </Sheet>
  );
  return { open, sheet };
}

function ScheduleSheetBody({ requested, failed, onRequest }: { requested: DateKey | null; failed: boolean; onRequest: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={{ padding: space.l, paddingBottom: space.l + insets.bottom, gap: space.m }} testID="schedule-sheet">
      <View style={{ gap: space.s }}>
        <T variant="titleL" accessibilityRole="header">自動で作る</T>
        <T variant="bodyM" color={colors.sub}>ChatGPT のスケジュール（タスク）に、まとめを作る予定を入れます。すでに入っていれば、作り直しません。</T>
      </View>
      <View style={[s.group, { paddingVertical: space.s }]}>
        {REPORT_SCHEDULES.map((p) => (
          <View key={p.kind} style={s.plan} accessible accessibilityLabel={`${p.title}、${p.when}、${p.period}`}>
            <Icon name="calendar" size={24} color={colors.sub} />
            <View style={{ flex: 1 }}>
              <T variant="titleM">{p.title}</T>
              <T variant="bodyM" color={colors.sub}>{p.when}（{p.period}）</T>
            </View>
          </View>
        ))}
      </View>
      <Button label="ChatGPT で設定する" icon="external" accessibilityLabel="ChatGPT で設定する（外のアプリ）" onPress={onRequest} testID="schedule-open" />
      {failed && (
        <View style={s.snack} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <T variant="bodyM" color={colors.card}>{openFailedMessage('chatgpt')}</T>
        </View>
      )}
      {requested && <T variant="bodyS" color={colors.sub}>前回 {formatMonthDay(requested)}に設定を頼みました</T>}
      <T variant="bodyS" color={colors.sub}>Claude のスケジュールは、いまは hlog のコネクタを使えないため、ChatGPT だけです。</T>
    </ScrollView>
  );
}

/** 「AI で記録」のボタン（筋トレの画面の下）。押すとアプリを選ぶシート */
export function AiRecordButton({ prompt, disabled, style }: { prompt: Exclude<ChatPrompt, { kind: 'report' | 'schedule' }>; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const chat = useChatChooser();
  return (
    <>
      <Button label="AI で記録" icon="chat" variant="tonal" disabled={disabled} accessibilityLabel={AI_RECORD_LABEL} onPress={() => chat.record(prompt)} style={style} testID="ai-record" />
      {chat.sheet}
    </>
  );
}

const s = StyleSheet.create({
  group: { backgroundColor: colors.input, borderRadius: radius.card, overflow: 'hidden' },
  plan: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingHorizontal: space.l, paddingVertical: space.s, minHeight: 56 },
  snack: { minHeight: 48, justifyContent: 'center', backgroundColor: colors.text, borderRadius: radius.xs, paddingHorizontal: space.l, paddingVertical: space.m },
});
