import { useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRepos } from '@/hooks/data';
import { CHAT_APP_NAMES, ChatApp, ChatPrompt, openChat, openFailedMessage, orderedApps, promptSummary, REPORT_SPAN_LABELS, ReportSpan } from '@/lib/chat';
import { todayKey } from '@/lib/date';
import { colors, radius, space } from '@/theme';
import { Sheet } from './motion';
import { T } from './Text';
import { Button, ListRow, Segmented } from './ui';

/** 押すと、ChatGPT か Claude を選ぶシートを出すボタンの読み上げの名前（外のアプリを開くことを伝える） */
export const AI_RECORD_LABEL = 'AI で記録。ChatGPT か Claude を開きます';
export const REPORT_CHAT_LABEL = 'チャットで作る。ChatGPT か Claude を開きます';

/** 記録（筋トレ・食事）なら決まった文、レポートなら期間をシートの中で選ぶ */
type Request = { prompt: Exclude<ChatPrompt, { kind: 'report' }> } | { report: true };

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
    record: (prompt: Exclude<ChatPrompt, { kind: 'report' }>) => show({ prompt }),
    /** レポートを頼む（期間はシートで選ぶ） */
    report: () => show({ report: true }),
    sheet,
  };
}

function ChatSheetBody({ req, last, failed, span, onSpan, onChoose }: {
  req: Request; last: ChatApp | null; failed: ChatApp | null; span: ReportSpan; onSpan: (s: ReportSpan) => void; onChoose: (app: ChatApp) => void;
}) {
  const insets = useSafeAreaInsets();
  const report = 'report' in req;
  const text = promptSummary(report ? { kind: 'report', span, today: todayKey() } : req.prompt);
  return (
    <View style={{ padding: space.l, paddingBottom: space.l + insets.bottom, gap: space.m }} testID="chat-sheet">
      <View>
        <T variant="titleL" accessibilityRole="header">{report ? 'チャットで作る' : 'AI で記録'}</T>
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

/** 「AI で記録」のボタン（筋トレの画面の下）。押すとアプリを選ぶシート */
export function AiRecordButton({ prompt, disabled, style }: { prompt: Exclude<ChatPrompt, { kind: 'report' }>; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
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
  snack: { minHeight: 48, justifyContent: 'center', backgroundColor: colors.text, borderRadius: radius.xs, paddingHorizontal: space.l, paddingVertical: space.m },
});
