// レポート：Claude・ChatGPT が MCP の save_report で書いたまとめ（サーバーは services/reports）。
// 同期で受け取るだけで、アプリからは読むのと消すのだけ。本文（Markdown）はモデルが書いた文なので、
// 文字として表示するだけにする（HTML やリンクを開かない。下の parseMarkdown は見出し・箇条書き・太字・段落だけを見分ける）。
// 端末の値はサーバーで確かめたものだが、前の版や壊れた値でも画面が落ちないよう、読むときにもう一度形を確かめる
import { DateKey, formatJpDate, formatMonthDay, toDateKey } from './date';

export type Tone = 'good' | 'steady' | 'caution';
export type Area = 'training' | 'meals' | 'body' | 'sleep';
export type ReportKind = 'daily' | 'weekly' | 'monthly' | 'other';

export type Metric = { label: string; value: number; unit: string; delta: number | null; deltaGood: boolean | null };
export type Highlight = { area: Area; tone: Tone; text: string; metric: Metric | null };

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
  /** サーバーが受け付けた時刻（ISO 8601） */
  createdAt: string;
};

/** 端末の reports の表の1行（db/migrations.ts の版7） */
export type ReportRow = {
  id: string; title: string; body: string; kind: string; period_start: string | null; period_end: string | null;
  overall_tone: string | null; headline: string | null; highlights: string | null; next_steps: string | null; created_at: string;
};

export const TONE_LABELS: Record<Tone, string> = { good: '良い調子', steady: 'いつもどおり', caution: '気をつけたい' };
/** 分野ごとのカードの印（短く） */
export const TONE_SHORT: Record<Tone, string> = { good: '良い', steady: '変わらない', caution: '気をつけたい' };
export const KIND_LABELS: Record<ReportKind, string> = { daily: '日のまとめ', weekly: '週のまとめ', monthly: '月のまとめ', other: 'その他' };
export const AREA_LABELS: Record<Area, string> = { training: '筋トレ', meals: '食事', body: 'からだ', sleep: '睡眠' };
/** 次の一歩の見出し（日のまとめなら明日、週のまとめなら来週、月なら来月） */
export const NEXT_TITLES: Record<ReportKind, string> = { daily: '明日の一歩', weekly: '来週の一歩', monthly: '来月の一歩', other: '次の一歩' };

const TONES: Tone[] = ['good', 'steady', 'caution'];
const AREAS: Area[] = ['training', 'meals', 'body', 'sleep'];
const KINDS: ReportKind[] = ['daily', 'weekly', 'monthly', 'other'];
// サーバーの上限（services/reports/reports/domain/report.py）。壊れた値で画面が長くなりすぎないよう、読むときも切る
const MAX_HIGHLIGHTS = 6;
const MAX_NEXT_STEPS = 3;

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

/** 一覧のカードの読み上げの名前 */
export function reportCardLabel(r: Report): string {
  return [TONE_LABELS[r.tone], r.title, r.headline, KIND_LABELS[r.kind], formatCreated(r.createdAt) && `${formatCreated(r.createdAt)}に作成`]
    .filter(Boolean).join('、');
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
 * 作った月ごとに分ける（並びはそのまま。一覧は新しい順）。見出しは「11月」、今年でなければ「2025年12月」。
 * 作った時刻が読めないものは、最後に見出しなしでまとめる
 */
export function groupByMonth(list: Report[], today: DateKey): { key: string; title: string; reports: Report[] }[] {
  const year = today.slice(0, 4);
  const groups: { key: string; title: string; reports: Report[] }[] = [];
  for (const r of list) {
    const d = new Date(r.createdAt);
    const key = Number.isNaN(d.getTime()) ? '' : toDateKey(d).slice(0, 7);
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

/** 「今日のまとめから」、過去の日は「11月6日のまとめから」 */
export function dailySectionTitle(date: DateKey, today: DateKey): string {
  return `${date === today ? '今日' : formatMonthDay(date)}のまとめから`;
}

/** 分野のカードの読み上げの名前（「筋トレ、良い。文。指標」） */
export function dailyHighlightLabel(h: Highlight): string {
  return [`${AREA_LABELS[h.area]}、${TONE_SHORT[h.tone]}。${h.text}`, h.metric && metricLabel(h.metric)].filter(Boolean).join('。');
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
