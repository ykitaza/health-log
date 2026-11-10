import { averageBetween } from './body';
import { addDays, DateKey, weekday } from './date';

// 睡眠・心拍・歩数の表示（からだのタブ、ホームの体調のカード）

/** その日までの7日（その日を含む）の、記録のある日の平均（からだの今日で、その日の記録がない行に薄く出す）。記録がなければ null */
export function sevenDayAverage(points: { date: DateKey; value: number }[], date: DateKey): number | null {
  return averageBetween(points, addDays(date, -6), date);
}

/** 分を「7時間12分」に（1時間未満は「45分」） */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}分` : m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/** 時刻（ISO 8601）を、端末の時刻で「6:55」に */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 心拍のまとめを「安静時 58 ・ 平均 72（52〜140）拍/分」に（ない値は出さない） */
export function formatHeartRate(h: { restingBpm: number | null; avgBpm: number | null; minBpm: number | null; maxBpm: number | null }): string {
  const r = (n: number) => String(Math.round(n));
  const parts: string[] = [];
  if (h.restingBpm != null) parts.push(`安静時 ${r(h.restingBpm)}`);
  if (h.avgBpm != null) parts.push(`平均 ${r(h.avgBpm)}${h.minBpm != null && h.maxBpm != null ? `（${r(h.minBpm)}〜${r(h.maxBpm)}）` : ''}`);
  return `${parts.join(' ・ ')} 拍/分`;
}

// 睡眠・心拍の推移の画面

/** 分を「6:56」に（時間:分） */
export function formatHM(min: number): string {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** 数の平均（空なら null） */
export function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 時刻（ISO 8601）の平均を、端末の時刻で「その日の何分目か」（0〜1439）にする。寝た時刻のように 0時をまたぐものは、
 * 正午より前を次の日として足してから平均する（23:50 と 0:10 の平均を 0:00 にする）。空なら null
 */
export function averageClock(isos: string[], acrossMidnight: boolean): number | null {
  const mins = isos.map((iso) => {
    const d = new Date(iso);
    const m = d.getHours() * 60 + d.getMinutes();
    return acrossMidnight && m < 12 * 60 ? m + 24 * 60 : m;
  });
  const avg = average(mins);
  return avg == null ? null : Math.round(avg) % (24 * 60);
}

// からだの推移のタブの睡眠のカード

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 長く眠れた日（明るい色の棒）にする睡眠の長さ（分）。7時間 */
export const LONG_SLEEP_MIN = 7 * 60;

/**
 * 今日までの7日の睡眠（記録のない日は asleepMin が null）と、記録のある日の平均、7時間以上の日の曜日（「火」「土」）
 */
export function sleepWeek(days: { date: DateKey; asleepMin: number }[], today: DateKey) {
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    const asleepMin = days.find((d) => d.date === date)?.asleepMin ?? null;
    return { date, weekday: WEEKDAY_JA[weekday(date)], asleepMin, long: asleepMin != null && asleepMin >= LONG_SLEEP_MIN };
  });
  const recorded = week.filter((d) => d.asleepMin != null).map((d) => d.asleepMin!);
  return { days: week, average: average(recorded), longDays: week.filter((d) => d.long).map((d) => d.weekday) };
}

// 歩数

/** 歩数を「8,240」に（3桁ごとのカンマ） */
export function formatSteps(steps: number): string {
  return Math.round(steps).toLocaleString('en-US');
}

/**
 * 今日までの7日の歩数（記録のない日は steps が null）と、記録のある日の平均、いちばん多い日（同じなら新しい日）。
 * からだの推移のタブの歩数のカード
 */
export function stepWeek(days: { date: DateKey; steps: number }[], today: DateKey) {
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    const steps = days.find((d) => d.date === date)?.steps ?? null;
    return { date, weekday: WEEKDAY_JA[weekday(date)], steps };
  });
  const recorded = week.filter((d): d is typeof d & { steps: number } => d.steps != null);
  const best = recorded.reduce<(typeof recorded)[number] | null>((b, d) => (b == null || d.steps >= b.steps ? d : b), null);
  return { days: week, average: average(recorded.map((d) => d.steps)), best };
}
