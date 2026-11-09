import { Linking } from 'react-native';
import { SLOT_LABELS, SLOTS, Slot } from './meals';

/**
 * チャット（ChatGPT・Claude）を開くショートカット。https の URL を開くだけ（Android の App Links で、
 * アプリが入っていればアプリ、なければブラウザが開く）。URL の q には、ここで決めた文だけを入れる。
 * 記録の中身や個人の情報は入れない（日付は「11月6日」の形だけ）
 */
export type ChatApp = 'chatgpt' | 'claude';

export const CHAT_APPS: ChatApp[] = ['chatgpt', 'claude'];
export const CHAT_APP_NAMES: Record<ChatApp, string> = { chatgpt: 'ChatGPT', claude: 'Claude' };
const BASE: Record<ChatApp, string> = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new' };

/** まとめの期間（レポートの「チャットで作る」で選ぶ） */
export type ReportSpan = 'day' | 'week' | 'month';
export const REPORT_SPAN_LABELS: Record<ReportSpan, string> = { day: '今日', week: '今週', month: '今月' };

/** 頼むこと。date は記録する日（'YYYY-MM-DD'）。今日なら文に日付を入れない。食事の slot は、区分を選んでいるときだけ */
export type ChatPrompt =
  | { kind: 'meal'; date: string; today: string; slot?: Slot }
  | { kind: 'training'; date: string; today: string }
  | { kind: 'report'; span: ReportSpan };

/** 「11月6日」。決まった形の日付でなければ null（文に入れない） */
function dayText(date: string): string | null {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[1])}月${Number(m[2])}日` : null;
}

/** URL に入れる文（決まった文だけ） */
export function promptText(p: ChatPrompt): string {
  if (p.kind === 'report') return `${REPORT_SPAN_LABELS[p.span]}のまとめを作って`;
  const day = p.date === p.today ? null : dayText(p.date);
  if (p.kind === 'meal') {
    // 区分は決まった4つの名前だけ（それ以外は文に入れない）
    const slot = p.slot && SLOTS.includes(p.slot) ? SLOT_LABELS[p.slot] : null;
    if (slot) return day ? `hlog に ${day} の${slot}を記録して` : `hlog に今日の${slot}を記録して`;
    return day ? `hlog に ${day} の食事を記録して` : 'hlog に食事を記録して';
  }
  return day ? `hlog に ${day} の筋トレを記録して` : 'hlog に今日の筋トレを記録して';
}

/** 開く URL。prompt がなければ、アプリを開くだけ */
export function chatUrl(app: ChatApp, prompt?: ChatPrompt): string {
  return prompt ? `${BASE[app]}?q=${encodeURIComponent(promptText(prompt))}` : BASE[app];
}

/** 開けなかったときの案内 */
export const openFailedMessage = (app: ChatApp) => `${CHAT_APP_NAMES[app]} を開けませんでした。ブラウザで開けるか確かめてください。`;

/** 開けたら true。開けなかったら false（呼ぶ側で案内を出す） */
export async function openChat(app: ChatApp, prompt?: ChatPrompt, open: (url: string) => Promise<unknown> = (u) => Linking.openURL(u)): Promise<boolean> {
  try {
    await open(chatUrl(app, prompt));
    return true;
  } catch {
    return false;
  }
}

/** 選ぶシートの並び。最後に選んだほうを上に */
export function orderedApps(last: ChatApp | null): ChatApp[] {
  return last === 'claude' ? ['claude', 'chatgpt'] : ['chatgpt', 'claude'];
}

export const isChatApp = (v: unknown): v is ChatApp => v === 'chatgpt' || v === 'claude';
