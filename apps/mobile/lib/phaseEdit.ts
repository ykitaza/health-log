// フェーズの計画の編集（始める・直す・計画を変える）の決まり。どれも純粋な関数で、DB は読まない。
// 書き込み（db/repositories/phases.ts）と画面（app/phase/index.tsx・new.tsx）の両方がこれを使い、同じ決まりで確かめる。
//
// 2 つの編集を分ける。予定の線（target_history の1件が1本の線）の扱いが違う：
// - 直す（訂正）：入れ間違い・始め忘れ。最初からこの計画だったことにして、開始日から1本の線に引き直す（今までの「計画を変える」の
//   線は消える）。開始日を変えたら、開始時の記録（snapshot）も新しい開始日までの記録から出し直す（画面が measuresFrom で出して渡す）
// - 計画を変える（変更）：途中で目標や期間を変える。今日から線を引き直し、前の線は薄く残す（lib/phases.ts の決まりのまま）
// 開始日の変更は、いつも「直す」
//
// 入力の範囲：開始日は今日より後にしない・ほかの通常のフェーズと重ねない。実際の終わり（止まった日だけ後ろにずれた終わり）は
// 今日より前にしない（終わったフェーズは「終える」で扱う）。期間は 1〜104 週。目標体重は 20〜300kg
import { DateKey, daysBetween } from './date';
import { TARGET_WEIGHT } from './meals';
import {
  effectiveEnd, endDateFor, pauses, pausedDays, Phase, PHASE_LIMITS, PhaseSnapshot, TargetChange,
} from './phases';

/** 書き換える項目（1 回の UPDATE で、同期の 1 つの変更として送る） */
export type PlanFields = Pick<Phase, 'startDate' | 'endDate' | 'targetWeightKg' | 'targetHistory' | 'snapshot'>;

/**
 * ほかの通常のフェーズと重ならない、いちばん早い開始日（なければ null）。終えた・中断したフェーズは [開始日, 終えた日) を使っていたので、
 * その終えた日から始められる。療養は数えない（通常のフェーズの中に入るものなので）。exceptId は直すフェーズ自身
 */
export function earliestStart(phases: Phase[], exceptId: string | null = null): DateKey | null {
  let floor: DateKey | null = null;
  for (const p of phases) {
    if (p.kind !== 'normal' || p.id === exceptId || p.status === 'active') continue;
    const end = p.endedOn ?? p.startDate;
    if (floor == null || end > floor) floor = end;
  }
  return floor;
}

/** 開始日から今日までの期間を収めるのに要る、いちばん短い週数（止まった日 paused は時計に入らない）。1 より短くしない */
export function minWeeksFor(startDate: DateKey, paused: number, today: DateKey): number {
  const days = daysBetween(startDate, today) + 1 - paused;
  return Math.max(1, Math.ceil(days / 7));
}

const weeksError = (weeks: number, min = 1): string | null => {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > PHASE_LIMITS.weeks) return `期間は1〜${PHASE_LIMITS.weeks}週で入れてください`;
  return weeks < min ? `期間は${min}週より短くできません（終わりが今日より前になります）` : null;
};

export function targetWeightError(kg: number): string | null {
  return Number.isFinite(kg) && kg >= TARGET_WEIGHT.min && kg <= TARGET_WEIGHT.max
    ? null : `目標体重は${TARGET_WEIGHT.min}〜${TARGET_WEIGHT.max}kg で入れてください`;
}

/** 開始日の確かめ（新しく始めるときと、直すとき）。floor はほかのフェーズが終えた日（earliestStart） */
export function startDateError(startDate: DateKey, floor: DateKey | null, today: DateKey): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return '開始日を選んでください';
  if (startDate > today) return '開始日は今日より後にできません';
  if (floor != null && startDate < floor) return `開始日は、前のフェーズを終えた日（${floor.slice(5).replace('-', '/')}）より前にできません`;
  return null;
}

/** 新しく始める（開始日は過去の日でもよい）。断る理由か null */
export function startError(phases: Phase[], today: DateKey, input: { startDate: DateKey; weeks: number; targetWeightKg: number }): string | null {
  return startDateError(input.startDate, earliestStart(phases), today)
    ?? weeksError(input.weeks, minWeeksFor(input.startDate, 0, today))
    ?? targetWeightError(input.targetWeightKg);
}

export type CorrectInput = {
  startDate: DateKey;
  weeks: number;
  targetWeightKg: number;
  /** 新しい開始日までの記録から出した開始時の記録（開始日を変えたときだけ使う。変えないときは今の記録のまま） */
  snapshot: PhaseSnapshot | null;
};

/** 直したあとのフェーズ（止まった日を数え直すため、確かめにも使う） */
function corrected(p: Phase, input: CorrectInput): Phase {
  const moved = input.startDate !== p.startDate;
  const snapshot = moved ? input.snapshot : p.snapshot;
  const endDate = endDateFor(input.startDate, input.weeks);
  const line: TargetChange = { date: input.startDate, target_weight_kg: input.targetWeightKg, end_date: endDate, weight_kg: snapshot?.weight_kg ?? null };
  return { ...p, startDate: input.startDate, endDate, targetWeightKg: input.targetWeightKg, targetHistory: [line], snapshot };
}

/** 直すときの確かめ。断る理由か null */
export function correctError(p: Phase, phases: Phase[], today: DateKey, input: CorrectInput): string | null {
  if (p.kind !== 'normal' || p.status !== 'active') return '終えたフェーズは変えられません';
  const next = corrected(p, input);
  const paused = pausedDays(pauses(next, phases, today));
  return startDateError(input.startDate, earliestStart(phases, p.id), today)
    ?? weeksError(input.weeks, minWeeksFor(input.startDate, paused, today))
    ?? targetWeightError(input.targetWeightKg);
}

/** 直す：開始日から 1 本の線に引き直す。開始日を変えたら開始時の記録も入れ替える */
export function correctFields(p: Phase, input: CorrectInput): PlanFields {
  const { startDate, endDate, targetWeightKg, targetHistory, snapshot } = corrected(p, input);
  return { startDate, endDate, targetWeightKg, targetHistory, snapshot };
}

export type ChangeInput = {
  /** 全体の週数（開始日から。止まった日は数えない） */
  weeks: number;
  targetWeightKg: number;
  /** 今の週平均（目標を変えたとき、新しい線をここから引く。なければ前の線の今日の値から） */
  weekAvgKg: number | null;
};

/** 計画を変えるときの確かめ。断る理由か null */
export function changeError(p: Phase, phases: Phase[], today: DateKey, input: ChangeInput): string | null {
  if (p.kind !== 'normal' || p.status !== 'active') return '終えたフェーズは変えられません';
  const paused = pausedDays(pauses(p, phases, today));
  return weeksError(input.weeks, minWeeksFor(p.startDate, paused, today)) ?? targetWeightError(input.targetWeightKg);
}

/**
 * 計画を変える：今日（開始日より前なら開始日）から線を引き直す。同じ日にもう一度変えたら、その日の1件を置き換える。
 * 線の始まりの体重は、目標を変えたら今の週平均、期間だけなら前の線の今日の値（線が途切れないように）。
 * 履歴のない前の版の行は、最初の線を先に入れる（前の線を薄く残すため）。履歴が上限を超えるなら null
 */
export function changeFields(p: Phase, input: ChangeInput, today: DateKey): PlanFields | null {
  const day = today < p.startDate ? p.startDate : today;
  const endDate = endDateFor(p.startDate, input.weeks);
  const replaced = p.targetHistory.find((c) => c.date === day);
  const history = p.targetHistory.filter((c) => c.date !== day);
  let weightKg = input.targetWeightKg !== p.targetWeightKg ? input.weekAvgKg : null;
  // 同じ日に2回変えたとき、線の始まりの体重がなければ、置き換える1件の体重を残す（開始日なら開始時の体重）
  if (weightKg == null) weightKg = replaced?.weight_kg ?? (day === p.startDate ? p.snapshot?.weight_kg ?? null : null);
  if (history.length === 0 && day !== p.startDate && p.endDate && p.targetWeightKg != null) {
    history.push({ date: p.startDate, target_weight_kg: p.targetWeightKg, end_date: p.endDate, weight_kg: p.snapshot?.weight_kg ?? null });
  }
  history.push({ date: day, target_weight_kg: input.targetWeightKg, end_date: endDate, weight_kg: weightKg });
  if (history.length > PHASE_LIMITS.targetHistory) return null;
  return { startDate: p.startDate, endDate, targetWeightKg: input.targetWeightKg, targetHistory: history, snapshot: p.snapshot };
}

/** 「計画を変える」の回数（最初の線のあとに引き直した線の数）。直すと消えるので、画面で知らせる */
export function planChanges(p: Phase): number {
  return p.targetHistory.filter((c) => c.date > p.startDate).length;
}

/** 編集の画面の範囲：開始日の下限（null ならなし）、期間の下限（直すときは開始日で変わるので、開始日ごと） */
export function editRange(p: Phase, phases: Phase[], today: DateKey) {
  const paused = pausedDays(pauses(p, phases, today));
  return {
    minStart: earliestStart(phases, p.id),
    /** 今の開始日のまま、終わりを今日より前にしない週数 */
    minWeeks: minWeeksFor(p.startDate, paused, today),
    /** 開始日を start にしたときの週数の下限（止まった日は数え直す） */
    minWeeksFrom: (start: DateKey) => {
      const next = { ...p, startDate: start };
      return minWeeksFor(start, pausedDays(pauses(next, phases, today)), today);
    },
  };
}

/** 終わりの日（実際の。止まった日だけ後ろへ）。週数を変えたときの見せ方に使う */
export function effectiveEndFor(p: Phase, phases: Phase[], today: DateKey, startDate: DateKey, weeks: number): DateKey {
  const next = { ...p, startDate, endDate: endDateFor(startDate, weeks) };
  return effectiveEnd(next, pauses(next, phases, today)) ?? endDateFor(startDate, weeks);
}
