// ホームの「部位のバランス」：直近2週の、部位ごとのセット数（六角形のレーダー）
import { addDays, DateKey } from './date';
import type { TrainingSetRow } from './training';

/** レーダーの6軸（Figma ホーム 1-23 の並び。左上の胸から時計回り） */
export const BALANCE_PARTS = ['胸', '背中', '肩', '腕', '腹', '脚'] as const;
export type BalancePart = (typeof BALANCE_PARTS)[number];

/** 数える日数（今日を含む直近14日） */
export const BALANCE_DAYS = 14;

/**
 * 部位の名前（種目と部位の管理の名前。db/seed.ts の初期の部位）→ レーダーの軸。
 * 上腕二頭筋・上腕三頭筋は腕、腹筋は腹（lib/muscleFigure.ts と同じく、名前を付け替えたとき用に「腕」「腹」も）。知らない部位は数えない
 */
const PART_AXIS: Record<string, BalancePart> = {
  胸: '胸', 背中: '背中', 肩: '肩', 脚: '脚',
  上腕二頭筋: '腕', 上腕三頭筋: '腕', 腕: '腕',
  腹筋: '腹', 腹: '腹',
};

export function balanceAxisOf(partName: string): BalancePart | null {
  return PART_AXIS[partName.trim()] ?? null;
}

export type PartBalance = {
  /** 軸ごとのセット数（BALANCE_PARTS の順） */
  sets: number[];
  /** 軸ごとの、最大の軸を 1 とした割合（記録がなければすべて 0） */
  ratios: number[];
  /** 数えたセットの合計（0 なら記録なし） */
  total: number;
};

/**
 * 直近14日（今日を含む）の、軸ごとのセット数。1行が1セット（ホームの「今日のトレーニング」のセット数と同じ数え方）。
 * partName は部位の ID から名前を引く（非表示の部位も）
 */
export function partBalance(rows: TrainingSetRow[], partName: (bodyPartId: string) => string, today: DateKey): PartBalance {
  const from = addDays(today, -(BALANCE_DAYS - 1));
  const sets = BALANCE_PARTS.map(() => 0);
  for (const r of rows) {
    if (r.date < from || r.date > today) continue;
    const axis = balanceAxisOf(partName(r.bodyPartId));
    if (axis) sets[BALANCE_PARTS.indexOf(axis)] += 1;
  }
  const max = Math.max(...sets);
  return { sets, ratios: sets.map((n) => (max > 0 ? n / max : 0)), total: sets.reduce((a, n) => a + n, 0) };
}

/** 読み上げ：「部位のバランス、直近2週のセット数。胸 18、背中 9、…」。記録がなければそのことを */
export function partBalanceLabel(b: PartBalance | null): string {
  const head = '部位のバランス、直近2週のセット数。';
  if (b == null) return '部位のバランス';
  if (b.total === 0) return `${head}まだ記録がありません`;
  return head + BALANCE_PARTS.map((p, i) => `${p} ${b.sets[i]}`).join('、');
}

/** i 番目の軸の向き（ラジアン）。胸が左上（−120°）で、60° ずつ時計回り */
export function axisAngle(i: number): number {
  return ((-120 + 60 * i) * Math.PI) / 180;
}
