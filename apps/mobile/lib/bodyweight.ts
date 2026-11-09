// 自重の種目（回数だけ）の負荷量。サーバー（services/training/training/domain/bodyweight.py）と同じ結果になるようにする
// （testdata/training/bodyweight.json で確かめる）。
//
// 自重の負荷量 ＝ その日の体重 × 種目の割合（体重に対する割合、0〜1）× 回数（セットごと）。
// 体重は、その日の体重。なければ、その前のいちばん近い日の体重（30日以内）。それもなければ入れない。
// 割合は種目ごとに持つ。持っていない種目（同期で割合が届いていない種目など）は、名前から決める。
// 推定1RM は今までどおり重量のあるセットだけで出す（自重の種目は出さない）。
import { addDays, DateKey, daysBetween } from './date';
import type { RecordType } from './sets';
import type { TrainingSetRow } from './training';

export const LOOKBACK_DAYS = 30;
/** 名前で決まらない自重の種目 */
export const DEFAULT_RATIO = 0.65;

/** 名前に含む言葉と割合。上から順に見る（「膝つき腕立て」を「腕立て」より先に見る）。プランクなど時間で行う種目は入れない */
export const NAME_RATIOS: readonly (readonly [string, number])[] = [
  ['プランク', 0],
  ['膝つき', 0.5],
  ['懸垂', 1],
  ['チンニング', 1],
  ['チンアップ', 1],
  ['プルアップ', 1],
  ['ディップス', 0.95],
  ['スクワット', 0.7],
  ['腕立て', 0.65],
  ['プッシュアップ', 0.65],
  ['クランチ', 0.3],
  ['腹筋', 0.3],
  ['シットアップ', 0.3],
  ['レッグレイズ', 0.3],
  ['アブローラー', 0.3],
];

/** 種目の追加・編集の画面の、よく使う割合（%） */
export const RATIO_CHIPS = [100, 95, 70, 65, 50, 30] as const;

/** 名前を比べる形（サーバーの catalog.normalize と同じ）：全角と半角をそろえ（NFKC）、小文字にし、空白を除く */
function normalize(name: string): string {
  let s = name;
  try { s = s.normalize('NFKC'); } catch { /* normalize がない環境では、そのまま比べる */ }
  return s.toLowerCase().replace(/\s+/g, '');
}

/** 名前から決める割合（種目の割合の初期値） */
export function defaultRatio(name: string): number {
  const key = normalize(name);
  return NAME_RATIOS.find(([word]) => key.includes(normalize(word)))?.[1] ?? DEFAULT_RATIO;
}

/** その種目の割合。重量×回数の種目は null（重量で出す）。割合を持たなければ名前から決める */
export function ratioOf(e: { recordType: RecordType; name: string; bodyweightRatio: number | null }): number | null {
  if (e.recordType !== 'reps_only') return null;
  return e.bodyweightRatio ?? defaultRatio(e.name);
}

/** その日の体重。なければ、その前のいちばん近い日の体重（30日以内）。weights は日ごとの体重（日付の順でなくてよい） */
export function weightOn(weights: { date: DateKey; weightKg: number }[], date: DateKey): number | null {
  let best: { date: DateKey; weightKg: number } | null = null;
  for (const w of weights) {
    if (w.date <= date && daysBetween(w.date, date) <= LOOKBACK_DAYS && (!best || w.date > best.date)) best = w;
  }
  return best ? best.weightKg : null;
}

/** 回数だけのセット（割合のある行）に、自重の負荷（体重 × 割合）を入れる。体重がなければ null */
export function withBodyweight<T extends TrainingSetRow>(rows: T[], weights: { date: DateKey; weightKg: number }[]): T[] {
  return rows.map((r) => {
    if (r.weightKg != null || r.bodyweightRatio == null) return r;
    const kg = weightOn(weights, r.date);
    return { ...r, bodyweightLoadKg: kg == null ? null : kg * r.bodyweightRatio };
  });
}

/** 体重の記録がないため、負荷量に入らなかった自重のセットの数（割合が 0 の種目は数えない） */
export function missingBodyweight(rows: TrainingSetRow[]): number {
  return rows.filter((r) => r.weightKg == null && (r.reps ?? 0) > 0 && (r.bodyweightRatio ?? 0) > 0 && r.bodyweightLoadKg == null).length;
}

/** その日の種目（記録の画面）に、体重の記録がないため負荷量に入らなかった自重のセットがあるか */
export function entriesMissingBodyweight(entries: { bodyweightRatio: number | null; sets: { weightKg: number | null; reps: number | null; bodyweightLoadKg?: number | null }[] }[]): boolean {
  return entries.some((e) => missingBodyweight(e.sets.map((st) => ({
    date: '', exerciseId: '', bodyPartId: '', ...st, bodyweightRatio: e.bodyweightRatio,
  }))) > 0);
}

/** 体重がないことの知らせ（ホームとその日の画面に小さく出す） */
export const MISSING_BODYWEIGHT_NOTE = '体重の記録がないので自重の種目は入っていません';

/** ホームの知らせを出すか：今日までの28日間（合計負荷量／28日間）に、体重がなくて入らなかった自重のセットがある */
export function recentMissingBodyweight(rows: TrainingSetRow[], today: DateKey): boolean {
  const from = addDays(today, -27);
  return missingBodyweight(rows.filter((r) => r.date >= from && r.date <= today)) > 0;
}

/** 割合の入力（%、0〜100）。数でない・範囲の外は null。小数は 0.1% まで */
export function parseRatioPct(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n : null;
}

/** 割合（0〜1）を画面の % の文字にする */
export function ratioToPct(ratio: number): string {
  return String(Math.round(ratio * 1000) / 10);
}
