// レポートの週次の「ケガの振り返り（INJURY REVIEW）」の材料：期間のケガを、サーバーの period_overview と同じ3分類で数える。
// 分類の決まりは services/mcp/connector/period_overview.py と services/training/training/presentation/views.py の period_injuries と同じ：
// - occurred：期間（start〜end、両端を含む）に痛めたもの
// - reviewed：期間に振り返りを書いたもの（付ける振り返りは期間の分だけ）
// - fixing：end の時点で直している途中のもの（end より後に直せたにしたものも含む。end より後に痛めたものは含まない）
// Report のスキーマには関わらない。端末のケガの記録（db/repositories/injuries.ts）からだけ計算する純粋な関数と、その読み込み
import type { Repositories } from '@/db';
import type { DateKey } from './date';
import { formatMonthDay } from './date';
import {
  injuryNumbers, RESULTS, type InjuryStatus, type ReviewResult, type Side, siteDetail, siteLabel, STATUS_NAMES,
} from './injuries';

/**
 * 分類に使うケガの形（db/repositories/injuries.ts の Injury と同じ形。lastReview は使わないので省ける）。
 * status・fixedOn は今の値。期間の終わり時点の状態は statusAtPeriodEnd で出す
 */
export type InjuryReportInjury = {
  id: string;
  occurredOn: DateKey;
  site: string;
  side: Side | null;
  exerciseId: string | null;
  /** 種目の名前（種目がない・端末にないときは null） */
  exerciseName: string | null;
  phase: string;
  symptom: string;
  cause: string;
  fix: string;
  status: InjuryStatus;
  fixedOn: DateKey | null;
  createdAt: string;
  /** これまでの振り返りの総数 */
  reviewCount: number;
};

/** 分類に使う振り返りの形（db/repositories/injuries.ts の InjuryReview と同じ形） */
export type InjuryReportReviewInput = {
  id: string;
  injuryId: string;
  date: DateKey;
  result: ReviewResult;
  note: string;
  exerciseId: string | null;
  exerciseName: string | null;
};

/** 表示用の振り返り（期間の分だけを付ける） */
export type InjuryReportReview = {
  id: string;
  date: DateKey;
  result: ReviewResult;
  /** 結果の言葉（直せた・まだ・痛んだ） */
  resultLabel: string;
  note: string;
  /** 試した種目の名前（なければ null） */
  exercise: string | null;
  exerciseId: string | null;
};

/** 表示用のケガ（番号・部位の名前・期間の終わり時点の状態までそろえたもの） */
export type InjuryReportEntry = {
  id: string;
  /** アプリのケガ一覧と同じ番号（INJ-01…。記録した順） */
  number: string;
  occurredOn: DateKey;
  site: string;
  /** 部位の表示名（左右つき。lib/injuries.ts の siteLabel） */
  siteName: string;
  /** 部位の詳しい名前（補足用） */
  siteDetail: string;
  side: Side | null;
  /** 種目の名前（なければ null） */
  exercise: string | null;
  exerciseId: string | null;
  phase: string;
  symptom: string;
  cause: string;
  fix: string;
  /** 期間の終わり（end）時点の状態。end より後に直せたケガは、end 時点では直している途中 */
  status: InjuryStatus;
  /** 状態の言葉（直している途中・直せた） */
  statusLabel: string;
  /** 今の状態（end 時点の状態と違うことがある） */
  currentStatus: InjuryStatus;
  fixedOn: DateKey | null;
  /** これまでの振り返りの総数 */
  reviewCount: number;
  /** 期間の振り返り（新しい順。サーバーの period_injuries と同じ並び） */
  periodReviews: InjuryReportReview[];
  /** 期間の振り返りの数（occurred・fixing の行では 0） */
  periodReviewCount: number;
};

/** 期間のケガの振り返り（3分類＋それぞれの総数） */
export type InjuryPeriodReport = {
  start: DateKey;
  end: DateKey;
  occurred: InjuryReportEntry[];
  reviewed: InjuryReportEntry[];
  fixing: InjuryReportEntry[];
  occurredTotal: number;
  reviewedTotal: number;
  fixingTotal: number;
};

/**
 * 期間の終わり（end）時点の状態。今は直せたケガでも、直せた日が end より後なら end 時点では直している途中。
 * 直せた日がない直せたケガは、今の状態のまま（サーバーは直せた日がないと fixing に数えない決まりとそろう）
 */
export function statusAtPeriodEnd(injury: Pick<InjuryReportInjury, 'status' | 'fixedOn'>, end: DateKey): InjuryStatus {
  if (injury.fixedOn != null) return injury.fixedOn <= end ? 'fixed' : 'fixing';
  return injury.status;
}

/** end の時点で直している途中か（サーバーの period_injuries の fixing の決まりそのまま） */
export function isFixingAtPeriodEnd(injury: Pick<InjuryReportInjury, 'occurredOn' | 'status' | 'fixedOn'>, end: DateKey): boolean {
  return injury.occurredOn <= end
    && (injury.status === 'fixing' || (injury.fixedOn != null && injury.fixedOn > end));
}

function toEntry(
  injury: InjuryReportInjury, number: string, end: DateKey, periodReviews: InjuryReportReview[],
): InjuryReportEntry {
  const status = statusAtPeriodEnd(injury, end);
  return {
    id: injury.id,
    number,
    occurredOn: injury.occurredOn,
    site: injury.site,
    siteName: siteLabel(injury.site, injury.side),
    siteDetail: siteDetail(injury.site),
    side: injury.side,
    exercise: injury.exerciseName,
    exerciseId: injury.exerciseId,
    phase: injury.phase,
    symptom: injury.symptom,
    cause: injury.cause,
    fix: injury.fix,
    status,
    statusLabel: STATUS_NAMES[status],
    currentStatus: injury.status,
    fixedOn: injury.fixedOn,
    reviewCount: injury.reviewCount,
    periodReviews,
    periodReviewCount: periodReviews.length,
  };
}

/**
 * 期間のケガを3分類する（純粋な関数）。
 * injuries はケガの一覧（並びはそのまま使う。db の list() の「痛めた日の新しい順」で、サーバーの records の並びとそろう）、
 * reviews は全ケガの振り返りを平らに並べたもの（ケガごとに db の reviews() を集めたもの）。
 * サーバーと違い、件数の上限（10件・振り返り5件）は付けない（端末の表示なので、期間の分は全部出す。総数は *_total に入れる）
 */
export function classifyInjuriesForPeriod(
  injuries: InjuryReportInjury[], reviews: InjuryReportReviewInput[], start: DateKey, end: DateKey,
): InjuryPeriodReport {
  const numbers = injuryNumbers(injuries);
  const numberOf = (i: InjuryReportInjury) => numbers.get(i.id) ?? '';

  // ケガごとの、期間の振り返り（新しい順。同じ日は入力の並びを保つ）
  const periodByInjury = new Map<string, InjuryReportReview[]>();
  for (const r of reviews) {
    if (r.date < start || r.date > end) continue;
    const list = periodByInjury.get(r.injuryId) ?? [];
    list.push({
      id: r.id, date: r.date, result: r.result, resultLabel: RESULTS[r.result].label,
      note: r.note, exercise: r.exerciseName, exerciseId: r.exerciseId,
    });
    periodByInjury.set(r.injuryId, list);
  }
  for (const list of periodByInjury.values()) {
    // 日付の新しい順（安定ソート：同じ日は reviews() の古い順のまま残る）
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  const occurred = injuries
    .filter((i) => start <= i.occurredOn && i.occurredOn <= end)
    .map((i) => toEntry(i, numberOf(i), end, []));

  // 期間に振り返りを書いたもの。いちばん新しい期間の振り返りの日の新しい順（同じ日はケガの並びのまま。サーバーと同じ）
  const reviewed = injuries
    .filter((i) => (periodByInjury.get(i.id)?.length ?? 0) > 0)
    .map((i) => toEntry(i, numberOf(i), end, periodByInjury.get(i.id)!))
    .sort((a, b) => {
      const da = a.periodReviews[0].date, db = b.periodReviews[0].date;
      return da < db ? 1 : da > db ? -1 : 0;
    });

  const fixing = injuries
    .filter((i) => isFixingAtPeriodEnd(i, end))
    .map((i) => toEntry(i, numberOf(i), end, []));

  return {
    start, end,
    occurred, reviewed, fixing,
    occurredTotal: occurred.length, reviewedTotal: reviewed.length, fixingTotal: fixing.length,
  };
}

/** 分類に出てくるケガ（重なりを除いた数）。ブロックを出すかどうかと、読み上げのまとめに使う */
export function injuryPeriodInjuryCount(report: InjuryPeriodReport): number {
  return new Set([...report.occurred, ...report.reviewed, ...report.fixing].map((e) => e.id)).size;
}

/** 読み上げのまとめ：「ケガの振り返り、11月3日から11月9日。この期間に痛めたもの1件、振り返り1件、直している途中2件」 */
export function injuryPeriodReportLabel(report: InjuryPeriodReport): string {
  const head = `ケガの振り返り、${formatMonthDay(report.start)}から${formatMonthDay(report.end)}。`;
  if (injuryPeriodInjuryCount(report) === 0) return `${head}この期間のケガの記録はありません`;
  return head + [
    report.occurredTotal > 0 ? `この期間に痛めたもの${report.occurredTotal}件` : null,
    report.reviewedTotal > 0 ? `振り返り${report.reviewedTotal}件` : null,
    report.fixingTotal > 0 ? `直している途中${report.fixingTotal}件` : null,
  ].filter(Boolean).join('、');
}

/**
 * 端末の記録から期間のケガの振り返りを読む（ケガの一覧＋ケガごとの振り返り。振り返りはケガ1件ずつ読む）。
 * 画面からは hooks/data.ts の useFocusData で使う
 */
export async function loadInjuryPeriodReport(r: Repositories, start: DateKey, end: DateKey): Promise<InjuryPeriodReport> {
  const injuries = await r.injuries.list();
  const reviews = (await Promise.all(injuries.map((i) => r.injuries.reviews(i.id)))).flat();
  return classifyInjuriesForPeriod(injuries, reviews, start, end);
}
