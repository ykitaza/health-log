import { Linking } from 'react-native';
import { weekOf } from './goals';
import { SLOT_LABELS, SLOTS, Slot } from './meals';
import type { PendingReport } from './reports';
import { authzUrl } from './auth/config';

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
  /** ケガを記録する（痛めた日は聞き取る。今日は文に入れる） */
  | { kind: 'injury'; today: string }
  /** ケガの振り返りを書く。occurredOn はそのケガの痛めた日（どのケガかを探す手がかり。ほかの中身は入れない） */
  | { kind: 'injury-review'; occurredOn: string; today: string }
  | { kind: 'report'; span: ReportSpan; today: string }
  /** まだ作っていないまとめを、まとめて作る（lib/reports.ts の pendingReports の結果） */
  | { kind: 'pending'; items: PendingReport[] }
  /** まとめを自動で作るスケジュール（ChatGPT のタスク）を入れてもらう（REPORT_SCHEDULES の3つ） */
  | { kind: 'schedule' };

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

/** 「（day=2026-11-09）」のような引数の書き添え。値のないもの（決まった形でない日付など）は省く */
function args(pairs: [string, string | null][]): string {
  const set = pairs.filter((p): p is [string, string] => p[1] !== null).map(([k, v]) => `${k}=${v}`);
  return set.length ? `（${set.join('、')}）` : '';
}

const CONNECTOR = 'hlog（健康記録の MCP コネクタ）';
const FACTS_ONLY = '数字は記録の値だけを使ってください';
const AFTER_SAVE = '保存したら、記録した内容を短く見せてください。';

/**
 * チャットの返事に添えてもらう「戻る」リンクの行き先。認可サーバーの案内のページ（/open/…）で、押すと「hlog で開く」から
 * アプリ（torelog://…。app/+native-intent.tsx が画面の道に変える）を開く。チャットのアプリの中のブラウザは torelog:// を直接は開けないため
 */
export const OPEN_BASE = authzUrl;

/**
 * チャットの返事の最後に、アプリへ戻るリンクを添えてもらう文。path はアプリの中の道（'meals?date=2026-11-12' など）。
 * base（認可サーバーの URL）がなければ、何も添えてもらわない
 */
function backLink(path: string, base: string, label = 'hlog に戻る'): string {
  return base ? `最後に [${label}](${base}/open/${path}) を押せるリンクの形で添えてください。` : '';
}

/** その日の画面へ戻る道（日付が決まった形でなければ、日付を付けない） */
const dayPath = (tab: 'meals' | 'training', date: string | null) => (date ? `${tab}?date=${date}` : tab);

/** URL の長さの上限（エンコードしたあと。BASE のどちらでも） */
export const MAX_URL_LENGTH = 2000;

type ReportKind = PendingReport['kind'];

/**
 * 「period_overview(start=2026-11-01, end=2026-11-30)」のような呼び方。値のないもの（決まった形でない日付など）は省く。
 * まとめの文は長いので、エンコードしても長くならない半角の記号で書く（全角の1文字は URL で9文字になる）
 */
function call(name: string, pairs: [string, string | null][]): string {
  const set = pairs.filter((p): p is [string, string] => p[1] !== null).map(([k, v]) => `${k}=${v}`);
  return set.length ? `${name}(${set.join(', ')})` : name;
}

/**
 * 種類ごとに書くもの。達成の数字（今日の達成・今週の目標・体の変化）はアプリが記録から出すので、AI には並べさせない。
 * 日のまとめの体重は、前の日との差ではなく週の平均と比べてもらう（日々の上下で一喜一憂しないため）。
 * links（つながり）と review（目標の見直し）の形は、MCP の save_report の説明にある
 */
const WRITE: Record<ReportKind, string> = {
  daily: '分野ごとに目標に対して一言（体重は前の日でなく週の平均と比べる）、明日の一歩を1つ',
  weekly: '分野ごとに一言、分野をまたぐ気づきを links に3つまで、来週の一歩を3つまで',
  monthly: '体重の推移と目標までのペース、分野ごとに一言、links、目標の見直しを review に（食事の目標なら target=meals_goal）、来月の一歩を3つまで',
};
const ACHIEVED_BY_APP = '達成の数字はアプリが出します。';
const KIND_OF_SPAN: Record<ReportSpan, ReportKind> = { day: 'daily', week: 'weekly', month: 'monthly' };

/**
 * 1件のまとめを頼む文。同じ期間のまとめがあれば作らないよう、初めに list_reports で確かめてもらう（スケジュールの文と同じ）。
 * URL の上限（2,000 文字）に収めるため文は短く保つ（月がいちばん長く、FACTS_ONLY はその分短くしてある）
 */
function reportText(span: ReportSpan, rawToday: string, base: string): string {
  const today = validDate(rawToday);
  const kind = KIND_OF_SPAN[span];
  // 週は月曜から（アプリの「今週の目標」と同じ区切り）、月はその月の1日から、どちらも今日まで
  const start = !today ? null : span === 'day' ? today : span === 'week' ? weekOf(today).start : `${today.slice(0, 8)}01`;
  const period = span === 'day' ? todayText(today)
    : span === 'week' ? (!start ? '今週' : start === today ? `今週（${todayText(today)}）` : `今週（${dayText(start)}〜${todayText(today)}）`)
    : (start ? `今月（${dayText(start)}〜${todayText(today)}）` : '今月');
  return `${CONNECTOR}で${period}のまとめを作ってください。`
    + `${call('list_reports', [['kind', kind]])}に同じ期間があれば作らない。`
    + `${call('period_overview', [['start', start], ['end', today]])}を読み、${FACTS_ONLY}。${ACHIEVED_BY_APP}`
    + `${WRITE[kind]}、責めない言い方で書き、${call('save_report', [['kind', kind], ['period_start', start], ['period_end', today]])}で保存してください。`
    + (base ? backLink('reports', base, 'hlog で見る') : '');
}

/**
 * まとめて作る文の、種類ごとに書くもの（短く。くわしい決まりは MCP の save_report の説明にあるので、要点だけ）。
 * 全角の文字は URL で長くなるので、件数をなるべく多く入れられるよう、1件ずつの文より短くする
 */
const BATCH_WRITE: Record<ReportKind, string> = {
  daily: '日は明日の一歩を1つ（体重は週の平均と比べる）',
  weekly: '週は links と来週の一歩を3つまで',
  monthly: '月は links・review と来月の一歩を3つまで',
};

/** まとめて作る文の、1件の書き方（「weekly(2026-10-26..2026-11-01)」）。決まった形でなければ null（入れない） */
function pendingItem(p: PendingReport): string | null {
  const start = validDate(p.periodStart);
  const end = validDate(p.periodEnd);
  if (!start || !end || !(p.kind in BATCH_WRITE)) return null;
  return start === end ? `${p.kind}(${start})` : `${p.kind}(${start}..${end})`;
}

function pendingText(items: PendingReport[], rest: number, base: string): string {
  const list = items.map(pendingItem).filter((x): x is string => x !== null);
  const kinds = (['daily', 'weekly', 'monthly'] as const).filter((k) => items.some((p) => p.kind === k));
  return `${CONNECTOR}で、まだ作っていないまとめを1件ずつ作り、save_report で保存してください。`
    + `対象は${list.length}件：${list.join(', ')}。`
    + `期間ごとに period_overview を読み、数字は記録の値だけを使ってください。`
    + `${kinds.map((k) => BATCH_WRITE[k]).join('、')}。`
    + '記録がない期間は作らず、そう伝えてください。'
    + (rest > 0 ? `残りの${rest}件は次に頼みます。` : '')
    + (base ? `終わったら、${backLink('reports', base)}` : '');
}

/** 長いほうの BASE で、エンコードした URL の長さ */
const urlLength = (text: string) => Math.max(...CHAT_APPS.map((a) => BASE[a].length)) + 3 + encodeURIComponent(text).length;

/**
 * まだ作っていないまとめを、まとめて頼む文。古い期間から並べ、URL の上限に収まる件数まで入れる（残りは「次に」と書く）。
 * 収まった件（included）を返す
 */
export function pendingPrompt(items: PendingReport[], base: string = OPEN_BASE): { text: string; included: PendingReport[] } {
  const sorted = items.filter((p) => pendingItem(p) !== null)
    .sort((a, b) => (a.periodStart === b.periodStart ? a.periodEnd.localeCompare(b.periodEnd) : a.periodStart.localeCompare(b.periodStart)));
  for (let n = sorted.length; n > 1; n--) {
    const text = pendingText(sorted.slice(0, n), sorted.length - n, base);
    if (urlLength(text) <= MAX_URL_LENGTH) return { text, included: sorted.slice(0, n) };
  }
  return { text: pendingText(sorted.slice(0, 1), sorted.length - 1, base), included: sorted.slice(0, 1) };
}

/**
 * 「自動で作る」で入れてもらう予定（ChatGPT のスケジュール）。シートの一覧と頼みの文の両方に使う。
 * 日は寝る前にその日の分、週と月は区切りの次の朝に前の期間の分
 */
export const REPORT_SCHEDULES: { kind: ReportKind; title: string; when: string; period: string; prompt: string }[] = [
  { kind: 'daily', title: '日のまとめ', when: '毎日 22:00', period: 'その日の分', prompt: '毎日22:00 その日' },
  { kind: 'weekly', title: '週のまとめ', when: '毎週月曜 8:00', period: '先週の分', prompt: '毎週月曜8:00 先週の月〜日' },
  { kind: 'monthly', title: '月のまとめ', when: '毎月1日 8:00', period: '先月の分', prompt: '毎月1日8:00 先月' },
];

/**
 * 「自動で作る」の文。3つの予定を入れてもらい、すでに hlog のまとめの予定があれば作らずに教えてもらう。
 * 各回は list_reports で同じ種類・期間のまとめを探し、なければ period_overview で読んで save_report で保存する。
 * URL の上限（2,000 文字）に収めるため、種類ごとの書き方は今の頼みの文の要点だけにし、くわしくは save_report の説明に任せる
 */
function scheduleText(): string {
  const plans = REPORT_SCHEDULES.map((s, i) => `${i + 1}.${s.prompt}(${s.kind})`).join(' ');
  return `${CONNECTOR}で、まとめのスケジュールを3つ入れてください。`
    + 'hlog のまとめのタスクがもうあれば、作らず教えてください。'
    + `${plans}。`
    + '各回：list_reports(kind)に同じ期間があれば作らない。'
    + 'なければ period_overview(start, end)を読み、記録の値だけで書いて save_report(kind, period_start, period_end)で保存。'
    + '記録がなければ作らない。'
    + `${BATCH_WRITE.daily}、${BATCH_WRITE.weekly}、${BATCH_WRITE.monthly}。ほかは save_report の説明どおり。`;
}

/** 原因・直し方は本人の言葉のまま、痛みの強さは聞かず、診断しない（MCP の record_injury の説明の決まりの要点。体調のことは URL の長さのため説明に任せる） */
const OWN_WORDS = '原因と直し方は私の言葉のまま、分からない所は推測で埋めず空に。';
const NO_DIAGNOSIS = '痛みの強さは聞かず、診断しないでください。';

/**
 * ケガの文。戻るリンクはケガの一覧（/open/injuries。アプリでは筋トレのタブの「ケガ」）へ。
 * ケガの中身（部位・症状・ID）は入れない。振り返りは、痛めた日（決まった形の日付）を手がかりに list_injuries で探してもらう。
 * URL の上限（2,000 文字）に収めるため、MCP のツールの説明にある決まりは要点だけにする
 */
function injuryText(p: Extract<ChatPrompt, { kind: 'injury' | 'injury-review' }>, base: string): string {
  const today = validDate(p.today);
  if (p.kind === 'injury') {
    return `${CONNECTOR}にケガを記録してください。`
      + '種目・場面・部位と左右・何が起きたか・原因（自分の分析）・次の直し方を聞き取り、record_injury で保存してください。'
      + `種目は list_exercises の名前で、痛めた日が${todayText(today)}でなければ day に。`
      + OWN_WORDS + NO_DIAGNOSIS + AFTER_SAVE + backLink('injuries', base);
  }
  const occurred = validDate(p.occurredOn);
  return `${CONNECTOR}にケガの振り返りを記録してください。`
    + `list_injuries で${occurred ? `${dayText(occurred)}に痛めた` : ''}ケガを探して私に確かめ、`
    + '試したことと結果を聞き取り、add_injury_review で保存してください。'
    + `試した日が${todayText(today)}でなければ day に。`
    + 'メモは私の言葉のまま、推測で埋めずに。直せたなら mark_injury_fixed も呼ぶか聞いてください。'
    + NO_DIAGNOSIS + AFTER_SAVE + backLink('injuries', base);
}

/** URL に入れる文（決まった文だけ。記録の中身や個人の情報は入れない。日付は入れる） */
export function promptText(p: ChatPrompt, base: string = OPEN_BASE): string {
  if (p.kind === 'report') return reportText(p.span, p.today, base);
  if (p.kind === 'schedule') return scheduleText();
  if (p.kind === 'pending') return pendingPrompt(p.items, base).text;
  if (p.kind === 'injury' || p.kind === 'injury-review') return injuryText(p, base);
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
      + AFTER_SAVE + backLink(dayPath('meals', date), base);
  }
  return `${CONNECTOR}に${when}の筋トレを記録してください。`
    + `これから伝える種目・重さ・回数・セットを list_exercises の一覧と照らし、record_workout${args([['day', date]]) || ' '}で保存してください。`
    + '一覧にない種目は、add_exercise で足す前に名前と部位を確かめてください。'
    + AFTER_SAVE + backLink(dayPath('training', date), base);
}

/** シートに出す短い説明（URL には入れない） */
export function promptSummary(p: ChatPrompt): string {
  if (p.kind === 'report') return `${REPORT_SPAN_LABELS[p.span]}のまとめを作る`;
  if (p.kind === 'pending') return `まだのまとめ ${pendingPrompt(p.items).included.length} 件を作る`;
  if (p.kind === 'schedule') return 'まとめを自動で作る予定を入れる';
  if (p.kind === 'injury') return 'ケガを記録する';
  if (p.kind === 'injury-review') return 'ケガの振り返りを記録する';
  const day = p.date === p.today || !validDate(p.date) ? '今日' : dayText(p.date);
  if (p.kind === 'training') return `${day}の筋トレを記録する`;
  const slot = p.slot && SLOTS.includes(p.slot) ? SLOT_LABELS[p.slot] : '食事';
  return `${day}の${slot}を記録する`;
}

/** 開く URL。prompt がなければ、アプリを開くだけ */
export function chatUrl(app: ChatApp, prompt?: ChatPrompt, base: string = OPEN_BASE): string {
  return prompt ? `${BASE[app]}?q=${encodeURIComponent(promptText(prompt, base))}` : BASE[app];
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
