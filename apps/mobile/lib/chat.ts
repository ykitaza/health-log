import { Linking } from 'react-native';
import { addDays, daysBetween } from './date';
import { SLOT_LABELS, SLOTS, Slot } from './meals';

/**
 * チャット（ChatGPT・Claude）を開くショートカット。https の URL を開くだけ（Android の App Links で、
 * アプリが入っていればアプリ、なければブラウザが開く）。URL の q には、ここで決めた文だけを入れる。
 * 記録の中身や個人の情報は入れない（日付は「11月6日」と「2026-11-06」の形だけ）
 */
export type ChatApp = 'chatgpt' | 'claude';

export const CHAT_APPS: ChatApp[] = ['chatgpt', 'claude'];
export const CHAT_APP_NAMES: Record<ChatApp, string> = { chatgpt: 'ChatGPT', claude: 'Claude' };
const BASE: Record<ChatApp, string> = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new' };

/** まとめの期間（レポートの「チャットで作る」で選ぶ） */
export type ReportSpan = 'day' | 'week' | 'month';
export const REPORT_SPAN_LABELS: Record<ReportSpan, string> = { day: '今日', week: '今週', month: '今月' };

/** 頼むこと。date は記録する日、today は今日（どちらも 'YYYY-MM-DD'）。食事の slot は、区分を選んでいるときだけ */
export type ChatPrompt =
  | { kind: 'meal'; date: string; today: string; slot?: Slot }
  | { kind: 'training'; date: string; today: string }
  | { kind: 'report'; span: ReportSpan; today: string };

/** 決まった形の日付（'YYYY-MM-DD'）ならそのまま、でなければ null（文に入れない） */
function validDate(date: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** 「11月6日」 */
function dayText(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/** 「今日（11月9日）」。今日が決まった形でなければ「今日」だけ */
function todayText(today: string | null): string {
  return today ? `今日（${dayText(today)}）` : '今日';
}

/** 「（day=2026-11-09）」のような引数の書き添え。値のないもの（決まった形でない日付など）は省く。rest は最後に足す言葉 */
function args(pairs: [string, string | null][], ...rest: string[]): string {
  const set = [...pairs.filter((p): p is [string, string] => p[1] !== null).map(([k, v]) => `${k}=${v}`), ...rest];
  return set.length ? `（${set.join('、')}）` : '';
}

const CONNECTOR = 'hlog（健康記録の MCP コネクタ）';
const FACTS_ONLY = '数字は記録の値だけを使い推測で補わないでください';
const AFTER_SAVE = '保存したら、記録した内容を短く見せてください。';

/** まとめの期間ごとの決まり。start は期間の初日（today から求める） */
const REPORT_RULES: Record<ReportSpan, { kind: string; points: string; steps: string }> = {
  day: { kind: 'daily', points: '3つほど', steps: '1〜2つ' },
  week: { kind: 'weekly', points: '6つまで', steps: '3つまで' },
  month: { kind: 'monthly', points: '6つまで', steps: '3つまで' },
};

function reportText(span: ReportSpan, rawToday: string): string {
  const today = validDate(rawToday);
  const rule = REPORT_RULES[span];
  // 週は MCP の weekly_review と同じ「その日までの7日」、月はその月の1日から
  const start = !today ? null : span === 'day' ? today : span === 'week' ? addDays(today, -6) : `${today.slice(0, 8)}01`;
  const days = today && start ? Math.max(7, daysBetween(start, today) + 1) : 7;
  const period = span === 'day' ? todayText(today)
    : span === 'week' ? (start ? `${dayText(start)}〜${todayText(today)}の7日間` : '今日までの7日間')
    : (start ? `${dayText(start)}〜${todayText(today)}` : '今月の1日から今日まで');
  const reads = span === 'day'
    ? `get_workout と today_status${args([['day', today]])}`
    : span === 'week'
      ? `list_workouts${args([['start', start], ['end', today]])}、weekly_review${args([['last_day', today]])}`
      : `list_workouts と list_meals${args([['start', start], ['end', today]])}`;
  const save = args([['kind', rule.kind], ['period_start', start], ['period_end', today]], 'overall_tone', 'headline', 'highlights の area と tone');
  return `${CONNECTOR}で${period}のまとめを作ってください。`
    + `${reads}、body_progress・sleep_summary・heart_rate_summary（days=${days}）を読み、${FACTS_ONLY}。`
    + `良い点と気をつける点を${rule.points}、次の一歩を${rule.steps}、責めない言い方で書き、save_report で保存してください${save}。`
    + '保存したら、アプリで画面を下に引っぱって同期すると見られると一言添えてください。';
}

/** URL に入れる文（決まった文だけ。記録の中身や個人の情報は入れない。日付は入れる） */
export function promptText(p: ChatPrompt): string {
  if (p.kind === 'report') return reportText(p.span, p.today);
  // 決まった形でない日付は、今日として扱う
  const today = validDate(p.today);
  const date = validDate(p.date) ?? today;
  const when = date === today ? todayText(today) : dayText(date as string);
  if (p.kind === 'meal') {
    // 区分は決まった4つだけ（それ以外は文に入れない）
    const slot = p.slot && SLOTS.includes(p.slot) ? p.slot : null;
    return `${CONNECTOR}に${when}の${slot ? SLOT_LABELS[slot] : '食事'}を記録してください。`
      + 'これから送る写真や説明から品目と量を推定してカロリーと PFC を出し、量が分からなければ先に1つだけ質問してください。'
      + `推定を見せて了承を得たら record_meal${args([['date', date], ['slot', slot]]) || ' '}で保存し、推定の根拠を basis に書いてください。`
      + AFTER_SAVE;
  }
  return `${CONNECTOR}に${when}の筋トレを記録してください。`
    + `これから伝える種目・重さ・回数・セットを list_exercises の一覧と照らし、record_workout${args([['day', date]]) || ' '}で保存してください。`
    + '一覧にない種目は、add_exercise で足す前に名前と部位を確かめてください。'
    + AFTER_SAVE;
}

/** シートに出す短い説明（URL には入れない） */
export function promptSummary(p: ChatPrompt): string {
  if (p.kind === 'report') return `${REPORT_SPAN_LABELS[p.span]}のまとめを作る`;
  const day = p.date === p.today || !validDate(p.date) ? '今日' : dayText(p.date);
  if (p.kind === 'training') return `${day}の筋トレを記録する`;
  const slot = p.slot && SLOTS.includes(p.slot) ? SLOT_LABELS[p.slot] : '食事';
  return `${day}の${slot}を記録する`;
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
