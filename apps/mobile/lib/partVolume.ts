// ホームと週のまとめの「部位の量」：期間の、部位（6軸）ごとのセット数と、1週間10〜20セットの目安との差。
// サーバー（MCP の period_overview）と同じ数字を出す（共有のテストデータ testdata/training/part_sets.json で突き合わせる）。
// 数え方は lib/partBalance.ts の partBalanceBetween と同じ（1行が1セット、done は見ない、回数だけのセットも数える）。
// 色は持たない（theme を読まない）。段（0〜5）と筋肉ごとの段だけを返し、色は画面が theme の volumePalette から取る
import { addDays, DateKey, daysBetween, formatMonthDay } from './date';
import type { Muscle } from './muscleFigure';
import { BALANCE_PARTS, BalancePart, partBalanceBetween } from './partBalance';
import { recoveryMeshesFor, recoveryMusclesFor } from './recoveryMap';
import type { TrainingSetRow } from './training';

/** 1週間のセット数の目安（部位ごと） */
export const VOLUME_BAND = { min: 10, max: 20 } as const;

/** 目安を出す期間の長さの上限（日）。これより長い期間（月）は、数だけ */
const BAND_MAX_DAYS = 7;

/** 前の期間の呼び方：ホームは「先週」、週のまとめは「前週」 */
export type PrevWord = '先週' | '前週';

/** 目安に近づいた（toward）、遠ざかった（away）、同じ（same） */
export type VolumeTrend = 'toward' | 'away' | 'same';

export type PartVolumeRow = {
  part: BalancePart;
  sets: number;
  /** 1つ前の期間のセット数 */
  previous: number;
  /** sets − previous */
  delta: number;
  /** 目安の下限（10）まであと何セットか。届いていれば 0（期間が7日以内のときだけ） */
  short?: number;
  /** 目安の上限（20）より何セット多いか。超えていなければ 0（期間が7日以内のときだけ） */
  over?: number;
  /** 目安までの距離（下限より下か上限より上なら、その差）が、前の期間より縮んだか（期間が7日以内のときだけ） */
  trend?: VolumeTrend;
};

export type PartVolume = {
  /** 数えた期間（今日までに切る） */
  from: DateKey;
  to: DateKey;
  /** 比べる1つ前の期間（今の期間を 7 日の倍数だけ前へずらしたもの） */
  previous_from: DateKey;
  previous_to: DateKey;
  /** 目安（期間が7日以内のときだけ） */
  band?: { min: number; max: number };
  /** BALANCE_PARTS の順 */
  parts: PartVolumeRow[];
};

/** セット数の、目安からの距離（目安の中なら 0） */
const distance = (n: number) => (n < VOLUME_BAND.min ? VOLUME_BAND.min - n : n > VOLUME_BAND.max ? n - VOLUME_BAND.max : 0);

/**
 * start〜end（週なら月曜〜日曜、今週の途中なら月曜〜今日）の、部位ごとのセット数。
 * 今の期間は start〜min(end, today)。1つ前の期間は、それを 7×ceil(日数÷7) 日前へずらしたもの
 * （月曜〜今日なら先週の月曜〜同じ曜日まで、月曜〜日曜なら前の週の月曜〜日曜）
 */
export function partVolume(
  rows: TrainingSetRow[], partName: (bodyPartId: string) => string, start: DateKey, end: DateKey, today: DateKey,
): PartVolume {
  const days = daysBetween(start, end) + 1;
  const shift = 7 * Math.ceil(days / 7);
  const to = end < today ? end : today;
  const previousFrom = addDays(start, -shift);
  const previousTo = addDays(to, -shift);
  const cur = partBalanceBetween(rows, partName, start, to).sets;
  const prev = partBalanceBetween(rows, partName, previousFrom, previousTo).sets;
  const banded = days <= BAND_MAX_DAYS;
  const parts = BALANCE_PARTS.map((part, i): PartVolumeRow => {
    const sets = cur[i];
    const previous = prev[i];
    const d = distance(sets);
    const dp = distance(previous);
    return {
      part, sets, previous, delta: sets - previous,
      ...(banded ? {
        short: Math.max(0, VOLUME_BAND.min - sets), over: Math.max(0, sets - VOLUME_BAND.max),
        trend: d < dp ? 'toward' as const : d > dp ? 'away' as const : 'same' as const,
      } : {}),
    };
  });
  return {
    from: start, to, previous_from: previousFrom, previous_to: previousTo,
    ...(banded ? { band: { min: VOLUME_BAND.min, max: VOLUME_BAND.max } } : {}),
    parts,
  };
}

/** セット数の段（0〜5）：0 / 1〜4 / 5〜9 / 10〜14 / 15〜20 / 21 以上。10〜20 が目安の中 */
export function volumeLevel(n: number): number {
  if (n <= 0) return 0;
  if (n < 5) return 1;
  if (n < 10) return 2;
  if (n < 15) return 3;
  if (n <= 20) return 4;
  return 5;
}

/** 行の文字：「6／10 あと4」（目安に届かない）、「12 目安内」、「24 目安より多い」。目安のない期間（月）は数だけ */
export function volumeRowText(p: PartVolumeRow): string {
  if (p.short == null || p.over == null) return String(p.sets);
  if (p.short > 0) return `${p.sets}／${VOLUME_BAND.min} あと${p.short}`;
  return p.over > 0 ? `${p.sets} 目安より多い` : `${p.sets} 目安内`;
}

/** 前の期間との差の文字：「先週比 +2」「先週比 −3」「先週比 ±0」（report の週のまとめは prev に「前週」）（マイナスは全角の「−」。lib/format.ts の formatSigned と同じ書き方で整数）。目安のない期間（月）は「前の期間」 */
export function volumeDeltaText(p: PartVolumeRow, banded: boolean, prev: PrevWord = '先週'): string {
  return `${banded ? prev : '前の期間'}比 ${p.delta === 0 ? '±0' : `${p.delta > 0 ? '+' : '−'}${Math.abs(p.delta)}`}`;
}

/** 読み上げの、前の期間との差：「先週比で 2 セット増えた」「先週比で変わらず」 */
function deltaSpoken(p: PartVolumeRow, banded: boolean, prevWord: PrevWord): string {
  const prev = `${banded ? prevWord : '前の期間'}比`;
  if (p.delta === 0) return `${prev}で変わらず`;
  return `${prev}で ${Math.abs(p.delta)} セット${p.delta > 0 ? '増えた' : '減った'}`;
}

const TREND_SPOKEN: Record<VolumeTrend, string> = { toward: '目安に近づいた', away: '目安から離れた', same: '' };

/**
 * 読み上げ：「今週の部位、11月2日から11月8日のセット数（目安は 1 週間 10〜20）。胸 6 セット、あと4、先週より 2 セット増えた、…」。
 * hurt はケガ（直している途中）の部位。記録がまったくなければそのことを
 */
export function volumeLabel(v: PartVolume, title: string, hurt: ReadonlySet<BalancePart> = new Set(), prevWord: PrevWord = '先週'): string {
  const banded = v.band != null;
  const head = `${title}、${formatMonthDay(v.from)}から${formatMonthDay(v.to)}のセット数${banded ? `（目安は 1 週間 ${v.band!.min}〜${v.band!.max}）` : ''}。`;
  if (v.parts.every((p) => p.sets === 0 && p.previous === 0)) return `${head}まだ記録がありません`;
  return head + v.parts.map((p) => {
    const note = p.short == null || p.over == null ? '' : p.short > 0 ? `あと${p.short}` : p.over > 0 ? '目安より多い' : '目安内';
    return [`${p.part} ${p.sets} セット`, note, deltaSpoken(p, banded, prevWord), p.trend ? TREND_SPOKEN[p.trend] : '', hurt.has(p.part) ? 'ケガ' : '']
      .filter(Boolean).join('、');
  }).join('。');
}

/** 軸ごとに、2D の図で塗る部位の名前（種目と部位の管理の名前。腕は二頭筋と三頭筋の両方） */
const AXIS_PARTS: Record<BalancePart, string[]> = {
  胸: ['胸'], 肩: ['肩'], 背中: ['背中'], 腕: ['上腕二頭筋', '上腕三頭筋'], 脚: ['脚'], 腹: ['腹筋'],
};

/** 2D の図の筋肉ごとの段（0〜5）。どの軸にもない筋肉は入れない（0 として扱う）。いくつかの軸にある筋肉（前腕）は高いほう */
export function volumeMuscleLevels(v: PartVolume): Partial<Record<Muscle, number>> {
  const levels: Partial<Record<Muscle, number>> = {};
  for (const p of v.parts) {
    const level = volumeLevel(p.sets);
    for (const m of AXIS_PARTS[p.part].flatMap(recoveryMusclesFor)) levels[m] = Math.max(levels[m] ?? 0, level);
  }
  return levels;
}

/** 段（0〜5）のいちばん上（21 セット以上）。theme の volumePalette.steps の数と同じ */
export const VOLUME_MAX_LEVEL = 5;

/** ホームの 3D の体の色：回復（ふだん）か、部位の量（今週の部位）か */
export type HeroBodyMode = 'recovery' | 'volume';

/** 覚えていた値を色の見方に。知らない値・覚えていないときは回復 */
export function parseHeroBodyMode(v: string | null): HeroBodyMode {
  return v === 'volume' ? 'volume' : 'recovery';
}

/**
 * ホームの 3D の体の部品ごとの段（0〜5）。6 つの軸の部品（recoveryMeshesFor）に、その軸のセット数の段を入れる。
 * 0 セットの軸の部品も 0 で入れる（空の色にするため）。知らない部位は部品がないので入らない。
 * いくつかの軸にある部品は高いほう。色は持たない（画面が theme の volumePalette から取る）
 */
export function heroVolumeLevels(v: PartVolume): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const p of v.parts) {
    const level = volumeLevel(p.sets);
    for (const m of recoveryMeshesFor(p.part)) levels[m] = Math.max(levels[m] ?? 0, level);
  }
  return levels;
}

/**
 * 3D の体の場面に渡す形：部品ごとの光の明るさ k（段 ÷ 5。0 の部品は入れない）と、空の部品（段 0。灰色にする）。
 * 色は段 = round(k × 5) で引く（volumeGlowLevel）
 */
export function heroVolumeGlow(levels: Record<string, number>): { glow: Record<string, number>; idle: string[] } {
  const glow: Record<string, number> = {};
  const idle: string[] = [];
  for (const [m, l] of Object.entries(levels)) {
    if (l > 0) glow[m] = l / VOLUME_MAX_LEVEL;
    else idle.push(m);
  }
  return { glow, idle };
}

/** 光の明るさ k から段に戻す */
export const volumeGlowLevel = (k: number): number => Math.round(Math.min(1, Math.max(0, k)) * VOLUME_MAX_LEVEL);

/** ホームの体を部位の量の色にしているときの読み上げ：「今週の部位の量、11月2日から11月8日のセット数。胸 10、…」 */
export function heroVolumeSpoken(v: PartVolume): string {
  return `今週の部位の量、${formatMonthDay(v.from)}から${formatMonthDay(v.to)}のセット数。${v.parts.map((p) => `${p.part} ${p.sets}`).join('、')}`;
}
