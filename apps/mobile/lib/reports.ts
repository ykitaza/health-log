// レポート：Claude・ChatGPT が MCP の save_report で書いたまとめ（サーバーは services/reports）。
// 同期で受け取るだけで、アプリからは読むのと消すのだけ。本文（Markdown）はモデルが書いた文なので、
// 文字として表示するだけにする（HTML やリンクを開かない。下の parseMarkdown は見出し・箇条書き・太字・段落だけを見分ける）。
// 端末の値はサーバーで確かめたものだが、前の版や壊れた値でも画面が落ちないよう、読むときにもう一度形を確かめる
import { movingAverage } from './body';
import { addDays, addMonths, DateKey, daysBetween, formatJpDate, formatMonthDay, toDateKey } from './date';
import { tonnes } from './format';
import { DailyAchievement, weekOf, WeeklyAchievement } from './goals';
import { formatHM } from './health';
import { estimated1RM, TrainingSetRow } from './training';
import { fmtInt, WeightUnit } from './units';

export type Tone = 'good' | 'steady' | 'caution';
export type Area = 'training' | 'meals' | 'body' | 'sleep';
export type ReportKind = 'daily' | 'weekly' | 'monthly' | 'other';

export type Metric = { label: string; value: number; unit: string; delta: number | null; deltaGood: boolean | null };
export type Highlight = { area: Area; tone: Tone; text: string; metric: Metric | null };
/** つながり（分野をまたぐ気づき）。from の分野が to の分野に響いた、という向き。basis は根拠の短い言葉（「2日」） */
export type ReportLink = { from: Area; to: Area; text: string; basis: string | null };
/** 目標の見直しの提案。target が meals_goal なら、食事の目標の画面を開くボタンを出す */
export type ReportReview = { text: string; target: 'meals_goal' | null };

export type Report = {
  id: string;
  title: string;
  body: string;
  kind: ReportKind;
  periodStart: DateKey | null;
  periodEnd: DateKey | null;
  /** 全体の調子。構造のない前の形のレポートは steady */
  tone: Tone;
  headline: string;
  highlights: Highlight[];
  nextSteps: string[];
  /** つながり。前の形のレポートは空 */
  links: ReportLink[];
  /** 目標の見直し。前の形のレポートは null */
  review: ReportReview | null;
  /** サーバーが受け付けた時刻（ISO 8601） */
  createdAt: string;
};

/** 端末の reports の表の1行（db/migrations.ts の版7。links と review は版9） */
export type ReportRow = {
  id: string; title: string; body: string; kind: string; period_start: string | null; period_end: string | null;
  overall_tone: string | null; headline: string | null; highlights: string | null; next_steps: string | null;
  links: string | null; review: string | null; created_at: string;
};

export const TONE_LABELS: Record<Tone, string> = { good: '良い調子', steady: 'いつもどおり', caution: '気をつけたい' };
/** 分野ごとのカードの印（短く） */
export const TONE_SHORT: Record<Tone, string> = { good: '良い', steady: '変わらない', caution: '気をつけたい' };
export const KIND_LABELS: Record<ReportKind, string> = { daily: '日のまとめ', weekly: '週のまとめ', monthly: '月のまとめ', other: 'その他' };
/** 一覧のカードの種類の四角の1文字（読み上げは KIND_LABELS） */
export const KIND_SHORT: Record<ReportKind, string> = { daily: '日', weekly: '週', monthly: '月', other: '他' };
export const AREA_LABELS: Record<Area, string> = { training: '筋トレ', meals: '食事', body: 'からだ', sleep: '睡眠' };
/** 次の一歩の見出し（日のまとめなら明日、週のまとめなら来週、月なら来月） */
export const NEXT_TITLES: Record<ReportKind, string> = { daily: '明日の一歩', weekly: '来週の一歩', monthly: '来月の一歩', other: '次の一歩' };

const TONES: Tone[] = ['good', 'steady', 'caution'];
const AREAS: Area[] = ['training', 'meals', 'body', 'sleep'];
const KINDS: ReportKind[] = ['daily', 'weekly', 'monthly', 'other'];
// サーバーの上限（services/reports/reports/domain/report.py）。壊れた値で画面が長くなりすぎないよう、読むときも切る
const MAX_HIGHLIGHTS = 6;
const MAX_NEXT_STEPS = 3;
const MAX_LINKS = 3;

const isTone = (v: unknown): v is Tone => TONES.includes(v as Tone);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown) => (typeof v === 'string' ? v : '');

function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseMetric(v: unknown): Metric | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  if (!text(m.label).trim() || !isNumber(m.value)) return null;
  return {
    label: text(m.label), value: m.value, unit: text(m.unit),
    delta: isNumber(m.delta) ? m.delta : null,
    deltaGood: typeof m.delta_good === 'boolean' && isNumber(m.delta) ? m.delta_good : null,
  };
}

function parseHighlights(raw: string | null): Highlight[] {
  const list = parseJson(raw);
  if (!Array.isArray(list)) return [];
  const out: Highlight[] = [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const h = v as Record<string, unknown>;
    if (!AREAS.includes(h.area as Area) || !isTone(h.tone) || !text(h.text).trim()) continue;
    out.push({ area: h.area as Area, tone: h.tone, text: text(h.text), metric: parseMetric(h.metric) });
  }
  return out.slice(0, MAX_HIGHLIGHTS);
}

function parseSteps(raw: string | null): string[] {
  const list = parseJson(raw);
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && s.trim() !== '').slice(0, MAX_NEXT_STEPS) : [];
}

function parseLinks(raw: string | null): ReportLink[] {
  const list = parseJson(raw);
  if (!Array.isArray(list)) return [];
  const out: ReportLink[] = [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const l = v as Record<string, unknown>;
    const from = l.from_area as Area;
    const to = l.to_area as Area;
    if (!AREAS.includes(from) || !AREAS.includes(to) || from === to || !text(l.text).trim()) continue;
    out.push({ from, to, text: text(l.text), basis: text(l.basis).trim() || null });
  }
  return out.slice(0, MAX_LINKS);
}

function parseReview(raw: string | null): ReportReview | null {
  const v = parseJson(raw);
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!text(r.text).trim()) return null;
  return { text: text(r.text), target: r.target === 'meals_goal' ? 'meals_goal' : null };
}

/** 端末の1行をレポートにする。知らない値は、前の形のレポートと同じ扱い（steady、指標なし）にする */
export function parseReport(row: ReportRow): Report {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind: KINDS.includes(row.kind as ReportKind) ? (row.kind as ReportKind) : 'other',
    periodStart: row.period_start,
    periodEnd: row.period_end,
    tone: isTone(row.overall_tone) ? row.overall_tone : 'steady',
    headline: row.headline ?? '',
    highlights: parseHighlights(row.highlights),
    nextSteps: parseSteps(row.next_steps),
    links: parseLinks(row.links),
    review: parseReview(row.review),
    createdAt: row.created_at,
  };
}

/** 11月2日（日）〜11月8日（土）。期間がなければ null */
export function formatPeriod(r: Pick<Report, 'periodStart' | 'periodEnd'>): string | null {
  if (!r.periodStart || !r.periodEnd) return null;
  if (r.periodStart === r.periodEnd) return formatJpDate(r.periodStart);
  return `${formatJpDate(r.periodStart)}〜${formatJpDate(r.periodEnd)}`;
}

/** 作った日（端末の暦の日付。11月9日） */
export function formatCreated(createdAt: string): string {
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? '' : formatMonthDay(toDateKey(d));
}

/** 指標の値。整数は3桁ごとにカンマ、小数は2桁まで（0 は省く） */
export function formatMetricValue(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [int, frac] = Math.abs(rounded).toString().split('.');
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '-' : ''}${withCommas}${frac ? `.${frac}` : ''}`;
}

/** 変化の文字（+1.3 / -0.6 / ±0） */
export function formatDelta(delta: number): string {
  if (Math.round(delta * 100) === 0) return '±0';
  return `${delta > 0 ? '+' : '-'}${formatMetricValue(Math.abs(delta))}`;
}

/**
 * 変化の向きと、それが良いか。矢印は増減（up・down・flat）、色は利用者の目標にとって良いか（good・bad・neutral）。
 * 減量中の体重の減りのように、下向きでも良いことがある（delta_good はサーバーで AI が決める）
 */
export function deltaLook(m: Metric): { arrow: 'up' | 'down' | 'flat'; quality: 'good' | 'bad' | 'neutral' } | null {
  if (m.delta == null) return null;
  const arrow = Math.round(m.delta * 100) === 0 ? 'flat' : m.delta > 0 ? 'up' : 'down';
  const quality = m.deltaGood == null || arrow === 'flat' ? 'neutral' : m.deltaGood ? 'good' : 'bad';
  return { arrow, quality };
}

/** 読み上げの文（「合計負荷量 12.45 t、前より 1.3 増えた、良い変化」） */
export function metricLabel(m: Metric): string {
  const look = deltaLook(m);
  const value = `${m.label} ${formatMetricValue(m.value)}${m.unit ? ` ${m.unit}` : ''}`;
  if (!look) return value;
  const change = look.arrow === 'flat' ? '前と変わらない' : `前より ${formatMetricValue(Math.abs(m.delta!))}${look.arrow === 'up' ? ' 増えた' : ' 減った'}`;
  const quality = { good: '、良い変化', bad: '、気をつけたい変化', neutral: '' }[look.quality];
  return `${value}、${change}${quality}`;
}

/** 一覧とホームのカードに出す、主な指標（指標のあるハイライトの先頭から） */
export function primaryMetrics(r: Report, n = 2): Metric[] {
  return r.highlights.flatMap((h) => (h.metric ? [h.metric] : [])).slice(0, n);
}

/**
 * 一覧とホームのカードの読み上げの名前。unread（まだ開いていない）なら先頭に「新着」。
 * 日付は一覧の並びと同じ日付（reportDate）：期間があれば「期間 11月2日（月）〜11月8日（日）」、なければ作った日
 */
export function reportCardLabel(r: Report, unread = false): string {
  const period = formatPeriod(r);
  const when = period ? `期間 ${period}` : formatCreated(r.createdAt) && `${formatCreated(r.createdAt)}に作成`;
  return [unread && '新着', TONE_LABELS[r.tone], r.title, r.headline, KIND_LABELS[r.kind], when].filter(Boolean).join('、');
}

// --- 一覧の並び ---

const isDateKey = (v: string | null): v is DateKey => v != null && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * 一覧で並べる日付：期間の最後の日（period_end）。なければ期間の初日、それもなければ作った日（端末の暦の日付）。
 * どれも読めなければ ''（一覧の最後に、見出しなしで出す）
 */
export function reportDate(r: Pick<Report, 'periodStart' | 'periodEnd' | 'createdAt'>): DateKey | '' {
  if (isDateKey(r.periodEnd)) return r.periodEnd;
  if (isDateKey(r.periodStart)) return r.periodStart;
  const d = new Date(r.createdAt);
  return Number.isNaN(d.getTime()) ? '' : toDateKey(d);
}

/** カードに出す日付（reportDate の「11月8日」）。読めなければ '' */
export function formatReportDate(r: Pick<Report, 'periodStart' | 'periodEnd' | 'createdAt'>): string {
  const d = reportDate(r);
  return d === '' ? '' : formatMonthDay(d);
}

/** 期間の日数（両端を含む）。期間がなければ 0 */
function periodDays(r: Pick<Report, 'periodStart' | 'periodEnd'>): number {
  return isDateKey(r.periodStart) && isDateKey(r.periodEnd) && r.periodStart <= r.periodEnd ? daysBetween(r.periodStart, r.periodEnd) + 1 : 0;
}

/** 同じ日付のときの種類の順（期間の長いもの：月→週→日。その他は週と日のあいだ） */
const KIND_RANK: Record<ReportKind, number> = { monthly: 0, weekly: 1, other: 2, daily: 3 };

/** 一覧の並び順。端末だけに覚える（db/repositories/reports.ts） */
export type ReportOrder = 'newest' | 'oldest';
export const REPORT_ORDER_LABELS: Record<ReportOrder, string> = { newest: '新しい順', oldest: '古い順' };
export const isReportOrder = (v: unknown): v is ReportOrder => v === 'newest' || v === 'oldest';
export const otherOrder = (o: ReportOrder): ReportOrder => (o === 'newest' ? 'oldest' : 'newest');

/** 並べ替えの切り替えの読み上げ（「並び順、新しい順。押すと古い順にします」） */
export function orderToggleLabel(o: ReportOrder): string {
  return `並び順、${REPORT_ORDER_LABELS[o]}。押すと${REPORT_ORDER_LABELS[otherOrder(o)]}にします`;
}

/**
 * 一覧の並び。reportDate の新しい順（oldest なら古い順）。同じ日付なら、どちらの順でも、期間の長いもの（月→週→日）を先、
 * その次に作った時刻の新しいもの、最後に ID。日付の読めないものは、どちらの順でも最後
 */
export function sortReports<R extends Pick<Report, 'id' | 'kind' | 'periodStart' | 'periodEnd' | 'createdAt'>>(list: R[], order: ReportOrder = 'newest'): R[] {
  const keyed = list.map((r) => ({ r, date: reportDate(r), days: periodDays(r) }));
  keyed.sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === '') return 1;
      if (b.date === '') return -1;
      return order === 'newest' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
    }
    if (a.days !== b.days) return b.days - a.days;
    if (a.r.kind !== b.r.kind) return KIND_RANK[a.r.kind] - KIND_RANK[b.r.kind];
    if (a.r.createdAt !== b.r.createdAt) return b.r.createdAt.localeCompare(a.r.createdAt);
    return b.r.id.localeCompare(a.r.id);
  });
  return keyed.map((k) => k.r);
}

// --- 新しいレポートのお知らせ（まだ開いていないもの） ---

/**
 * お知らせの補足に出す、1件の呼び名。日は「今日のまとめ」「11月10日のまとめ」、週は「今週のまとめ」「先週のまとめ」「11月2日からの週のまとめ」、
 * 月は「今月のまとめ」「先月のまとめ」「10月のまとめ」（年が違えば「2025年12月のまとめ」）。その他と期間のないものは題
 */
export function reportShortName(r: Pick<Report, 'kind' | 'periodStart' | 'periodEnd' | 'title'>, today: DateKey): string {
  const start = isDateKey(r.periodStart) ? r.periodStart : null;
  if (!start || r.kind === 'other') return r.title;
  if (r.kind === 'daily') return `${start === today ? '今日' : formatMonthDay(start)}のまとめ`;
  if (r.kind === 'weekly') {
    const thisWeek = weekOf(today).start;
    const week = weekOf(start).start;
    if (week === thisWeek) return '今週のまとめ';
    if (week === addDays(thisWeek, -7)) return '先週のまとめ';
    return `${formatMonthDay(start)}からの週のまとめ`;
  }
  const month = start.slice(0, 7);
  if (month === today.slice(0, 7)) return '今月のまとめ';
  if (`${month}-01` === addMonths(`${today.slice(0, 7)}-01`, -1)) return '先月のまとめ';
  return `${month.slice(0, 4) === today.slice(0, 4) ? '' : `${month.slice(0, 4)}年`}${Number(month.slice(5, 7))}月のまとめ`;
}

/** ホームのお知らせの補足（「11月10日のまとめ・先週のまとめ」）。新しい順に2件まで、3件以上なら「ほか n 件」 */
export function newReportsSummary(list: Report[], today: DateKey): string {
  const sorted = sortReports(list);
  const names = sorted.slice(0, 2).map((r) => reportShortName(r, today));
  return names.join('・') + (sorted.length > 2 ? ` ほか ${sorted.length - 2} 件` : '');
}

// --- 一覧の絞り込みと月の見出し ---

/** 一覧の絞り込み（filter chip）。「その他」は「すべて」でだけ出す */
export type ReportFilter = 'all' | 'daily' | 'weekly' | 'monthly';
export const REPORT_FILTERS: { key: ReportFilter; label: string }[] = [
  { key: 'all', label: 'すべて' }, { key: 'daily', label: '日' }, { key: 'weekly', label: '週' }, { key: 'monthly', label: '月' },
];

export function filterReports(list: Report[], filter: ReportFilter): Report[] {
  return filter === 'all' ? list : list.filter((r) => r.kind === filter);
}

/**
 * 並べる日付（reportDate）の月ごとに分ける（並びはそのまま。sortReports で並べたものを渡す）。見出しは「11月」、今年でなければ「2025年12月」。
 * 日付の読めないものは、最後に見出しなしでまとめる
 */
export function groupByMonth(list: Report[], today: DateKey): { key: string; title: string; reports: Report[] }[] {
  const year = today.slice(0, 4);
  const groups: { key: string; title: string; reports: Report[] }[] = [];
  for (const r of list) {
    const key = reportDate(r).slice(0, 7);
    const title = key === '' ? '' : `${key.slice(0, 4) === year ? '' : `${key.slice(0, 4)}年`}${Number(key.slice(5, 7))}月`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.reports.push(r);
    else groups.push({ key, title, reports: [r] });
  }
  return groups;
}

/** 絞り込んで0件のときの題と、チャットでの頼み方 */
export function emptyFilterText(filter: Exclude<ReportFilter, 'all'>): { title: string; body: string } {
  const ask = { daily: '今日のまとめを作って', weekly: '今週のまとめを作って', monthly: '今月のまとめを作って' }[filter];
  return { title: `${KIND_LABELS[filter]}はまだありません`, body: `チャット（Claude・ChatGPT）で「${ask}」と頼むと、ここに出ます。` };
}

// --- 各タブに出す、その日の日のまとめ ---

/** 日のまとめの分野のうち、そのタブに出すもの（からだのタブは体組成と睡眠） */
export const TAB_AREAS = { training: ['training'], meals: ['meals'], body: ['body', 'sleep'] } as const satisfies Record<string, readonly Area[]>;

/** その分野の highlights だけ（並びはそのまま） */
export function highlightsFor(r: Report | null, areas: readonly Area[]): Highlight[] {
  return r ? r.highlights.filter((h) => areas.includes(h.area)) : [];
}

/** 「レポートから（今日のまとめ）」、過去の日は「レポートから（11月6日のまとめ）」 */
export function dailySectionTitle(date: DateKey, today: DateKey): string {
  return `レポートから（${date === today ? '今日' : formatMonthDay(date)}のまとめ）`;
}

/** 分野のカードの読み上げの名前（「筋トレ、良い。文。指標」） */
export function dailyHighlightLabel(h: Highlight): string {
  return [`${AREA_LABELS[h.area]}、${TONE_SHORT[h.tone]}。${h.text}`, h.metric && metricLabel(h.metric)].filter(Boolean).join('。');
}

// --- まだ作っていないまとめ ---

/** まだ作っていないまとめ。key は閉じたことを覚えるときの名前（「daily:2026-11-09」） */
export type PendingReport = { kind: Exclude<ReportKind, 'other'>; periodStart: DateKey; periodEnd: DateKey; key: string };

/** 今日の日のまとめを出し始める時刻（端末の時刻） */
export const TODAY_DAILY_FROM_HOUR = 21;

const pendingKey = (kind: PendingReport['kind'], start: DateKey) => `${kind}:${start}`;

/** 期間が重なる日数（両端を含む。重ならなければ 0） */
function overlapDays(a: { start: DateKey; end: DateKey }, b: { start: DateKey; end: DateKey }): number {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return end < start ? 0 : daysBetween(start, end) + 1;
}

/**
 * まだ作っていないまとめ。日→週→月の順で、それぞれ新しい順。
 * - 日のまとめ：7日前から昨日まで。今日の分は、21時を過ぎていて記録があるときだけ
 * - 週のまとめ：4週前から先週まで（月〜日）
 * - 月のまとめ：先月
 * どれも、その期間に記録（筋トレ・食事・体組成のどれか）がある日があるときだけ出す。
 * 同じ種類のレポートが期間の半分より多く重なっていれば、作ってあるとみなす（日曜始まりの週のまとめなども数える）。
 * dismissed（閉じた分の key）は出さない
 */
export function pendingReports(input: {
  now: Date;
  reports: Pick<Report, 'kind' | 'periodStart' | 'periodEnd'>[];
  recordDates: Iterable<DateKey>;
  dismissed?: Iterable<string>;
}): PendingReport[] {
  const today = toDateKey(input.now);
  const dates = [...input.recordDates];
  const dismissed = new Set(input.dismissed ?? []);
  const hasRecord = (start: DateKey, end: DateKey) => dates.some((d) => d >= start && d <= end);
  const made = (kind: PendingReport['kind'], start: DateKey, end: DateKey) => {
    const length = daysBetween(start, end) + 1;
    return input.reports.some((r) => r.kind === kind && r.periodStart && r.periodEnd
      && overlapDays({ start: r.periodStart, end: r.periodEnd }, { start, end }) * 2 > length);
  };
  const out: PendingReport[] = [];
  const push = (kind: PendingReport['kind'], start: DateKey, end: DateKey) => {
    const key = pendingKey(kind, start);
    if (!dismissed.has(key) && hasRecord(start, end) && !made(kind, start, end)) out.push({ kind, periodStart: start, periodEnd: end, key });
  };

  if (input.now.getHours() >= TODAY_DAILY_FROM_HOUR) push('daily', today, today);
  for (let i = 1; i <= 7; i++) push('daily', addDays(today, -i), addDays(today, -i));
  const thisWeek = weekOf(today).start;
  for (let i = 1; i <= 4; i++) push('weekly', addDays(thisWeek, -7 * i), addDays(thisWeek, -7 * i + 6));
  const thisMonth = `${today.slice(0, 7)}-01`;
  push('monthly', addMonths(thisMonth, -1), addDays(thisMonth, -1));
  return out;
}

/**
 * お知らせの帯に出すおすすめ（まだ作っていないまとめ）。新しいレポートを読み終わるまでは出さない（出てから入れ替わらないように）。
 * ホーム（both=false）は帯を1つだけにするので、新しいレポートがあればおすすめは出さない。レポートのタブ（both=true）は2つとも出す
 */
export function suggestionItems<T>(fresh: readonly unknown[] | null, pending: readonly T[] | null, both: boolean): T[] {
  if (fresh == null || (fresh.length > 0 && !both)) return [];
  return [...(pending ?? [])];
}

/** 「先週の分と、11月6日・7日の分」（ホームのおすすめの補足）。並びは月・週・日 */
export function pendingSummary(items: PendingReport[], today: DateKey): string {
  const lastWeek = addDays(weekOf(today).start, -7);
  const lastMonth = addMonths(`${today.slice(0, 7)}-01`, -1);
  const parts: string[] = [];
  const months = items.filter((p) => p.kind === 'monthly');
  if (months.length > 0) parts.push(months.length === 1 && months[0].periodStart === lastMonth ? '先月の分' : `${months.length}か月分`);
  const weeks = items.filter((p) => p.kind === 'weekly');
  if (weeks.length > 0) parts.push(weeks.length === 1 && weeks[0].periodStart === lastWeek ? '先週の分' : `${weeks.length}週分`);
  const days = items.filter((p) => p.kind === 'daily').map((p) => p.periodStart).sort();
  if (days.length > 3) parts.push(`${days.length}日分`);
  else if (days.length > 0) parts.push(`${dayList(days, today)}の分`);
  return parts.join('と、');
}

/** 「11月6日・7日」（同じ月は月を省く）。今日は「今日」 */
function dayList(dates: DateKey[], today: DateKey): string {
  let month = '';
  return dates.map((d) => {
    if (d === today) return '今日';
    const m = d.slice(0, 7);
    const text = m === month ? `${Number(d.slice(8, 10))}日` : formatMonthDay(d);
    month = m;
    return text;
  }).join('・');
}

// --- 中身の画面で、アプリが自分の記録から出す達成（レポートに保存された数字ではない） ---

/**
 * レポートの期間について、アプリが出す達成のブロック。
 * - 日のまとめ（期間が1日）：その日の達成
 * - 週のまとめ（月曜から、その週の日曜までのどこか）：その週の目標。前の形（今日までの7日など）は出さない
 * - 月のまとめ（31日まで）：体の変化
 * どれでもなければ null（何も出さない）
 */
export function achievementScope(r: Pick<Report, 'kind' | 'periodStart' | 'periodEnd'>):
  | { type: 'day'; date: DateKey } | { type: 'week'; date: DateKey } | { type: 'month'; start: DateKey; end: DateKey } | null {
  const { periodStart: start, periodEnd: end } = r;
  if (!start || !end || end < start) return null;
  if (r.kind === 'daily' && start === end) return { type: 'day', date: start };
  if (r.kind === 'weekly' && weekOf(start).start === start && end <= weekOf(start).end) return { type: 'week', date: start };
  if (r.kind === 'monthly' && daysBetween(start, end) < 31) return { type: 'month', start, end };
  return null;
}

/** 達成の印。reached は届いた（チェック）、short は届いていない（注意）、none は目標がない・記録がない（印なし） */
export type AchievementMark = 'reached' | 'short' | 'none';
export const MARK_LABELS: Record<AchievementMark, string> = { reached: '達成', short: 'まだ届いていない', none: '' };

/** 達成の1行。ratio は棒の長さ（0〜1）、null なら棒を出さない。goal は「／2,600」の数字 */
export type AchievementRow = { key: string; label: string; value: string; goal: string | null; unit: string; ratio: number | null; mark: AchievementMark };

/** kcal は目標の前後 10% に入っていれば達成（減量でも増量でも、目標に近いのが良い） */
export const KCAL_TOLERANCE = 0.1;

const ratioOf = (n: number, goal: number) => (goal > 0 ? Math.min(1, Math.max(0, n / goal)) : null);

/**
 * 日のまとめの「今日の達成」の行：筋トレ（自己ベストの種目）、kcal、たんぱく質、睡眠（昨夜）。
 * names は種目の ID から名前（自己ベストの種目を書くため）。記録がない分野は「記録なし」で印を付けない
 */
export function dailyAchievementRows(a: DailyAchievement, names: ReadonlyMap<string, string>, unit: WeightUnit): AchievementRow[] {
  const trained = a.training.exercises > 0;
  const bests = a.training.personalBestExerciseIds.map((id) => names.get(id)).filter((n): n is string => !!n);
  const best = bests.length === 0 ? '' : bests.length <= 2 ? `（${bests.join('・')}が自己ベスト）` : `（${bests[0]}ほか${bests.length - 1}種目が自己ベスト）`;
  const m = a.meals;
  const meal = (key: string, label: string, n: number, target: number | null, u: string, reached: (n: number, t: number) => boolean): AchievementRow =>
    !m.recorded ? { key, label, value: '記録なし', goal: null, unit: '', ratio: null, mark: 'none' }
      : target == null || target <= 0 ? { key, label, value: fmtInt(n), goal: null, unit: u, ratio: null, mark: 'none' }
        : { key, label, value: fmtInt(n), goal: fmtInt(target), unit: u, ratio: ratioOf(n, target), mark: reached(n, target) ? 'reached' : 'short' };
  const sleep = a.sleep;
  return [
    trained
      ? { key: 'training', label: `筋トレ${best}`, value: tonnes(a.training.volumeKg, unit), goal: null, unit: unit === 'kg' ? 't' : 'k lb', ratio: null, mark: 'reached' }
      : { key: 'training', label: '筋トレ', value: '記録なし', goal: null, unit: '', ratio: null, mark: 'none' },
    meal('kcal', 'kcal', m.kcal, m.kcalTarget, '', (n, t) => Math.abs(n - t) <= t * KCAL_TOLERANCE),
    meal('protein', 'たんぱく質', m.proteinG, m.proteinTarget, 'g', (n, t) => n >= t),
    sleep.asleepMin == null
      ? { key: 'sleep', label: '睡眠（昨夜）', value: '記録なし', goal: null, unit: '', ratio: null, mark: 'none' }
      : { key: 'sleep', label: '睡眠（昨夜）', value: formatHM(sleep.asleepMin), goal: formatHM(sleep.goalMin), unit: '', ratio: ratioOf(sleep.asleepMin, sleep.goalMin), mark: sleep.reached ? 'reached' : 'short' },
  ];
}

/** 週のまとめの「今週の目標」の行と、「4つのうち 3つ達成」。目標がない（たんぱく質の目標がない・睡眠が切）の行は出さない */
export function weeklyAchievementRows(w: WeeklyAchievement): { rows: AchievementRow[]; summary: string } {
  const row = (key: string, label: string, p: { days: number; goal: number | null; reached: boolean }, u: string): AchievementRow[] =>
    p.goal == null ? [] : [{ key, label, value: String(p.days), goal: String(p.goal), unit: u, ratio: ratioOf(p.days, p.goal), mark: p.reached ? 'reached' : 'short' }];
  const rows = [
    ...row('training', '筋トレ', w.training, '回'),
    ...row('meals', '食事を記録した日', w.meals, '日'),
    ...(w.protein ? row('protein', 'たんぱく質が目標に届いた日', w.protein, '日') : []),
    ...row('sleep', '7時間以上寝た日', w.sleep, '日'),
  ];
  return { rows, summary: `${rows.length}つのうち ${rows.filter((r) => r.mark === 'reached').length}つ達成` };
}

/** 達成の1行の読み上げ（「たんぱく質 98 g、目標 150 g、まだ届いていない」） */
export function achievementRowLabel(r: AchievementRow): string {
  const u = r.unit ? ` ${r.unit}` : '';
  return [r.label, `${r.value}${r.value === '記録なし' ? '' : u}`, r.goal && `目標 ${r.goal}${u}`, MARK_LABELS[r.mark]].filter(Boolean).join('、');
}

/**
 * 月のまとめの「体の変化」：期間の体重の7日の平均（期間より前の記録も平均に入れる）、初めと終わりの値、目標までの残りとペース。
 * 平均の点が2つ未満なら null。eta は、今のペースのまま目標に届くまでの目安（目標の向きに動いていなければ null）
 */
export function bodyChange(daily: { date: DateKey; weightKg: number | null }[], goalKg: number | null, start: DateKey, end: DateKey) {
  const weights = daily.filter((d) => d.weightKg != null && d.date <= end).map((d) => ({ date: d.date, value: d.weightKg! }));
  const points = movingAverage(weights).filter((p) => p.date >= start);
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const change = last.value - first.value;
  const diff = goalKg == null ? null : goalKg - last.value;
  const reached = diff != null && Math.abs(diff) < 0.05;
  const span = daysBetween(first.date, last.date);
  let eta: string | null = null;
  if (diff != null && !reached && span > 0 && Math.abs(change) >= 0.05 && Math.sign(change) === Math.sign(diff)) {
    const days = Math.abs(diff) / (Math.abs(change) / span);
    eta = days < 60 ? `約 ${Math.max(1, Math.ceil(days / 7))} 週` : `約 ${Math.round(days / 30)} か月`;
  }
  return { points, first, last, change, goalKg, remaining: diff == null ? null : Math.abs(diff), reached, eta };
}

/** BIG3（スクワット・ベンチプレス・デッドリフト）に割り当てた種目の ID */
export type Big3Lifts = { squat: string; bench: string; deadlift: string };

/**
 * BIG3 の合計（それぞれの期間の中の推定1RMのいちばん高い値を足したもの、kg）と、前の同じ長さの期間からの変化。
 * 割り当てがない、または期間にどれかの記録がなければ null（タイルを出さない）。前の期間にどれかがなければ delta は null
 */
export function big3Total(sets: TrainingSetRow[], lifts: Big3Lifts | null, start: DateKey, end: DateKey): { totalKg: number; deltaKg: number | null } | null {
  if (!lifts) return null;
  const sum = (from: DateKey, to: DateKey) => {
    let total = 0;
    for (const id of [lifts.squat, lifts.bench, lifts.deadlift]) {
      const best = Math.max(0, ...sets.filter((r) => r.exerciseId === id && r.date >= from && r.date <= to).map((r) => estimated1RM(r.weightKg, r.reps)));
      if (best <= 0) return null;
      total += best;
    }
    return total;
  };
  const now = sum(start, end);
  if (now == null) return null;
  const length = daysBetween(start, end) + 1;
  const prev = sum(addDays(start, -length), addDays(start, -1));
  return { totalKg: now, deltaKg: prev == null ? null : now - prev };
}

/** つながりの補足（「睡眠 → 筋トレ・2日」） */
export function linkCaption(l: ReportLink): string {
  return `${AREA_LABELS[l.from]} → ${AREA_LABELS[l.to]}${l.basis ? `・${l.basis}` : ''}`;
}

// --- 本文（Markdown）を、文字のまま見分ける ---

/** 文の中の一続き。bold は **太字** の中 */
export type Span = { text: string; bold: boolean };
export type Block =
  | { type: 'heading'; level: number; spans: Span[] }
  | { type: 'bullet'; marker: string; spans: Span[] }
  | { type: 'paragraph'; spans: Span[] };

/**
 * 本文を、見出し（# から ######）・箇条書き（-・*・+ と 1. 1)）・段落に分け、行の中の **太字**（__太字__）を見分ける。
 * ほかの記法（リンク・画像・表・HTML・コード）は見分けず、書かれた文字のまま出す（開く処理を入れないため）。
 * 段落の中の改行はそのまま残す（日本語の文を空白でつながないため）
 */
export function parseMarkdown(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', spans: parseInline(para.join('\n')) });
    para = [];
  };
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const bullet = /^\s*([-*+])\s+(.*)$/.exec(line);
    const ordered = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length, spans: parseInline(heading[2]) }); }
    else if (bullet) { flush(); blocks.push({ type: 'bullet', marker: '•', spans: parseInline(bullet[2]) }); }
    else if (ordered) { flush(); blocks.push({ type: 'bullet', marker: `${ordered[1]}.`, spans: parseInline(ordered[2]) }); }
    else if (line.trim() === '') flush();
    else para.push(line);
  }
  flush();
  return blocks;
}

/** 行の中の **太字** と __太字__。閉じていない記号は、そのまま文字にする */
export function parseInline(line: string): Span[] {
  const spans: Span[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) spans.push({ text: line.slice(last, m.index), bold: false });
    spans.push({ text: m[1] ?? m[2], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last), bold: false });
  return spans.length ? spans : [{ text: '', bold: false }];
}
