import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRepos } from '@/hooks/data';
import { CHAT_APP_NAMES, ChatApp, ChatPrompt, openChat, openFailedMessage, orderedApps, promptText } from '@/lib/chat';
import { colors, radius, space } from '@/theme';
import { Icon } from './Icon';
import { Button, Notice, Sheet, T } from './ui';

/** 「AI で拾う」のボタンの読み上げの名前（外のアプリを開くことを伝える） */
export const AI_CAPTURE_LABEL = 'AI で拾う。Claude か ChatGPT を開きます';

/**
 * 「AI で拾う」のシート（Figma の 1b）。Claude か ChatGPT を選び、決まった頼みの文を入れて開く（KARADA の ChatSheet と同じ作り）。
 * 最後に選んだアプリを上に出す（端末だけに覚える）。開けなかったら、シートの中に案内を出す（もう一方を選べる）
 */
export function useChatChooser() {
  const repos = useRepos();
  const [visible, setVisible] = useState(false);
  const [prompt, setPrompt] = useState<ChatPrompt | null>(null);
  const [last, setLast] = useState<ChatApp | null>(null);
  const [failed, setFailed] = useState<ChatApp | null>(null);

  const open = async (p: ChatPrompt) => {
    setFailed(null);
    setPrompt(p);
    setLast(await repos.local.lastChatApp().catch(() => null));
    setVisible(true);
  };
  const close = () => setVisible(false);
  const choose = async (app: ChatApp) => {
    if (!prompt) return;
    if (!(await openChat(app, prompt))) { setFailed(app); return; }
    setVisible(false);
    await repos.local.setLastChatApp(app).catch(() => {});
  };

  const sheet = (
    <Sheet visible={visible} onClose={close} testID="chat-sheet">
      {prompt && (
        <View style={{ gap: space.l }}>
          <View style={{ gap: space.s }}>
            <T variant="page" accessibilityRole="header">AI で拾う</T>
            <T variant="body" color={colors.sub}>開いた先で、話しかける・ページを撮る・ハイライトを共有するだけ。拾った言葉はここに届きます</T>
          </View>
          <View style={{ gap: space.s }}>
            <T variant="label" color={colors.sub}>はじめに送る言葉</T>
            <View style={s.prompt}><T variant="bodyS" testID="chat-prompt">{promptText(prompt)}</T></View>
          </View>
          {orderedApps(last).map((app, i) => (
            <Pressable
              key={app}
              accessibilityRole="button"
              accessibilityLabel={`${CHAT_APP_NAMES[app]} で開く（外のアプリ）`}
              onPress={() => choose(app)}
              testID={`chat-open-${app}`}
              style={({ pressed }) => [s.app, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="body">{CHAT_APP_NAMES[app]} で開く</T>
                <T variant="label" color={colors.sub}>{i === 0 ? 'アプリが開き、この言葉が入った状態で始まります' : '同じ言葉で始まります'}</T>
              </View>
              <Icon name="external" size={20} color={colors.accent} />
            </Pressable>
          ))}
          <Notice message={failed ? openFailedMessage(failed) : null} />
          <Pressable accessibilityRole="link" onPress={() => { setVisible(false); router.push('/connect'); }}>
            <T variant="label" color={colors.sub}>初回だけ、設定の「AI とつなぐ」で追加が必要です</T>
          </Pressable>
        </View>
      )}
    </Sheet>
  );
  return { open, sheet };
}

/** 「AI で拾う」のボタン（書き留める）。small は拾った・手札の見出しの横の丸いボタン */
export function AiCaptureButton({ prompt, small }: { prompt: () => ChatPrompt; small?: boolean }) {
  const chat = useChatChooser();
  return (
    <>
      {small ? (
        <Pressable accessibilityRole="button" accessibilityLabel={AI_CAPTURE_LABEL} onPress={() => chat.open(prompt())} testID="ai-capture"
          style={({ pressed }) => [s.small, pressed && { opacity: 0.7 }]}>
          <Icon name="chat" size={18} color={colors.accent} />
          <T variant="bodyS" color={colors.accent}>AI で拾う</T>
        </Pressable>
      ) : (
        <Button label="AI で拾う" icon="chat" variant="outline" accessibilityLabel={AI_CAPTURE_LABEL} onPress={() => chat.open(prompt())} testID="ai-capture" />
      )}
      {chat.sheet}
    </>
  );
}

const s = StyleSheet.create({
  prompt: { backgroundColor: colors.card, borderRadius: radius.l, borderWidth: 1, borderColor: colors.line, padding: space.l },
  app: {
    flexDirection: 'row', alignItems: 'center', gap: space.l, borderWidth: 1, borderColor: colors.line, borderRadius: radius.l,
    paddingHorizontal: space.l, paddingVertical: space.m, minHeight: 64,
  },
  small: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, borderWidth: 1, borderColor: colors.line, borderRadius: 999,
    paddingHorizontal: space.l, minHeight: 40,
  },
});
