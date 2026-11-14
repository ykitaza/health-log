// 「成長を見る」画面の下の「成長の記録」（Figma 成長 11-2）のカードに出す値と言葉。どれも純粋な関数で、DB は読まない
// （読むのは lib/growthData.ts。スコアの計算は lib/growth.ts、部位の数え方は lib/partBalance.ts）
import { DateKey, daysBetween, formatMonthDay } from './date';
import { BIG3_LABELS, BIG3_ROLES, Big3Role } from './exercises';
import { GrowthScore, longestTrainingStreak, PersonalBestEvent, personalBestEvents, ScoreDetail, WeekScore } from './growth';
import { formatMinutes } from './health';
import { BALANCE_PARTS, PartBalance } from './partBalance';
import { exerciseDailySeries, setVolume, trainingDates, TrainingSetRow, vehicleRatio } from './training';
import { fmt1, kgToUnit, trimNumber, WeightUnit } from './units';

/** 見出しの下の1行（「始めたとき（6月7日）→ 今日（11月11日）・158日」）。記録がなければ null */
export function recordsSpan(start: DateKey | null, today: DateKey): { text: string; label: string } | null {
  if (start == null) return null;
  const days = daysBetween(start, today) + 1;
  return {
    text: `始めたとき（${formatMonthDay(start)}）→ 今日（${formatMonthDay(today)}）・${days}日`,
    label: `成長の記録、${formatMonthDay(start)}から今日まで${days}日`,
  };
}

// ── ① 成長スコアの内訳 ──

const pts = (n: number) => `${Math.round(n)}点`;

/** 柱ごとの数え方の1行（lib/growth.ts の scoreDetail と growthScore から）。その柱の記録がなければ、そのことを */
export function scoreDetailLines(d: ScoreDetail, score: GrowthScore): { training: string; meal: string; sleep: string } {
  const volume = d.volumeRatio == null
    ? `負荷量 前4週の記録なし（回数の割合で） → ${pts(d.volumePoints)}`
    : `負荷量 前4週の週平均の${Math.round(d.volumeRatio * 100)}% → ${pts(d.volumePoints)}`;
  return {
    training: `回数 ${d.trainDays} / ${d.weeklyTarget}日 → ${pts(d.countPoints)}　＋　${volume}`,
    meal: d.mealDays === 0 || score.meal.points == null ? '直近7日に食事の記録がありません'
      : `食事を記録した${d.mealDays}日のうち、目標に届いた日 ${d.mealGoalDays}日 → ${pts(score.meal.points)}`,
    sleep: d.sleepAvgMin == null || score.sleep.points == null ? '直近7日に睡眠の記録がありません'
      : `記録した日の平均 ${formatMinutes(Math.round(d.sleepAvgMin))} ÷ 7時間 → ${pts(score.sleep.points)}`,
  };
}

/**
 * 週ごとの点数の棒の両はしの文字。左は最初の週（始まりは最初の記録の日。それより前の日は数えていないので）、右は今週（「今」）。
 * 週がなければ null
 */
export function weekBarsEnds(weeks: WeekScore[], first: DateKey | null): { left: string; right: string } | null {
  if (weeks.length === 0) return null;
  const w0 = weeks[0];
  const start = first != null && first > w0.start ? first : w0.start;
  return { left: `${formatMonthDay(start)}の週　${w0.total}`, right: `今　${weeks[weeks.length - 1].total}` };
}

/** ①の読み上げ（「成長スコア 78点、直近7日。先週より 4点高い。筋トレ 27点、40点満点。…週ごとの点数 23週、最初 42点、今 78点」） */
export function scoreCardLabel(score: GrowthScore | null, weeks: WeekScore[]): string {
  if (!score) return '成長スコアの内訳。まだ記録がありません';
  const diff = score.diffFromLastWeek;
  const parts = [`成長スコアの内訳。成長スコア ${score.total}点、直近7日`];
  if (diff != null) parts.push(diff === 0 ? '先週と同じ' : diff > 0 ? `先週より ${diff}点高い` : `先週より ${-diff}点低い`);
  for (const [name, p] of [['筋トレ', score.training], ['食事', score.meal], ['睡眠', score.sleep]] as const) {
    parts.push(p.points == null ? `${name} 記録なし` : `${name} ${Math.round(p.points)}点、${p.max}点満点`);
  }
  if (weeks.length > 0) parts.push(`週ごとの点数 ${weeks.length}週、最初 ${weeks[0].total}点、今 ${weeks[weeks.length - 1].total}点`);
  return parts.join('。');
}

// ── ② 強くなった（BIG3 の推定1RM） ──

export type Big3Growth = {
  role: Big3Role;
  name: string;
  /** その種目を最初に記録した日と、その日の推定1RM（kg） */
  startDate: DateKey;
  startKg: number;
  /** 今の推定1RM（kg）：today までの最高（ホームの BIG3 と同じ定義） */
  nowKg: number;
  /** 伸び率（%、四捨五入）。始めたときの値が 0 以下なら null */
  pct: number | null;
};

/**
 * BIG3 の種目ごとの「始めたとき → 今」。割り当て（ホームの BIG3 と同じ）がない種目、推定1RM の出る記録がない種目は出さない。
 * 並びはベンチプレス・スクワット・デッドリフト
 */
export function big3Growth(sets: TrainingSetRow[], big3: Partial<Record<Big3Role, string>>, today: DateKey): Big3Growth[] {
  const out: Big3Growth[] = [];
  for (const role of BIG3_ROLES) {
    const id = big3[role];
    if (!id) continue;
    const series = exerciseDailySeries(sets, id).filter((p) => p.max1RM > 0 && p.date <= today);
    if (series.length === 0) continue;
    const startKg = series[0].max1RM;
    const nowKg = Math.max(...series.map((p) => p.max1RM));
    out.push({
      role, name: BIG3_LABELS[role], startDate: series[0].date, startKg, nowKg,
      pct: startKg > 0 ? Math.round(((nowKg - startKg) / startKg) * 100) : null,
    });
  }
  return out;
}

/** 伸び率の文字（「↑ +38%」「±0%」「↓ −5%」）。向きは矢印と符号でも伝える */
export function pctText(pct: number | null): { dir: 'up' | 'down' | 'flat'; text: string; spoken: string } | null {
  if (pct == null) return null;
  if (pct === 0) return { dir: 'flat', text: '±0%', spoken: '変わらず' };
  return pct > 0 ? { dir: 'up', text: `↑ +${pct}%`, spoken: `${pct}%増` } : { dir: 'down', text: `↓ −${-pct}%`, spoken: `${-pct}%減` };
}

/** ②の読み上げ（「強くなった、BIG3 の推定1RM。ベンチプレス 60kg から 82.5kg、38%増。…」） */
export function big3CardLabel(lifts: Big3Growth[], unit: WeightUnit): string {
  const head = '強くなった、BIG3 の推定1RM';
  if (lifts.length === 0) return `${head}。まだ記録がありません`;
  const w = (kg: number) => `${trimNumber(Math.round(kgToUnit(kg, unit) * 10) / 10)}${unit}`;
  return [head, ...lifts.map((l) => [`${l.name} ${w(l.startKg)} から ${w(l.nowKg)}`, pctText(l.pct)?.spoken].filter(Boolean).join('、'))].join('。');
}

// ── ③ 体の変化 ──

export type BodyChange = { from: { date: DateKey; value: number }; to: { date: DateKey; value: number }; diff: number };

/** いちばん古い記録と、いちばん新しい記録（today まで）。記録がなければ null。1件なら同じ記録で差は 0 */
export function bodyChange(points: { date: DateKey; value: number }[], today: DateKey): BodyChange | null {
  const list = points.filter((p) => p.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (list.length === 0) return null;
  const from = list[0];
  const to = list[list.length - 1];
  return { from, to, diff: to.value - from.value };
}

/** 差の文字（「−3.6」「+0.4」「±0」。0.05 未満は ±0）。良し悪しの色は付けない */
export function signedText(v: number): string {
  if (Math.abs(v) < 0.05) return '±0';
  return v > 0 ? `+${fmt1(v)}` : `−${fmt1(-v)}`;
}

/**
 * ③の下の注記。体重と体脂肪率で記録の日が同じなら「始めたとき 6月7日・今 11月11日（それぞれいちばん古い・新しい記録）」、
 * 違えば項目ごとに日付を書く。両方なければ null
 */
export function bodyDatesNote(weight: BodyChange | null, fat: BodyChange | null): string | null {
  const span = (c: BodyChange) => `${formatMonthDay(c.from.date)} → ${formatMonthDay(c.to.date)}`;
  const tail = '（それぞれいちばん古い・新しい記録）';
  if (weight && fat) {
    if (weight.from.date === fat.from.date && weight.to.date === fat.to.date) {
      return `始めたとき ${formatMonthDay(weight.from.date)}・今 ${formatMonthDay(weight.to.date)}${tail}`;
    }
    return `体重 ${span(weight)}、体脂肪率 ${span(fat)}${tail}`;
  }
  const one = weight ?? fat;
  return one ? `始めたとき ${formatMonthDay(one.from.date)}・今 ${formatMonthDay(one.to.date)}${tail}` : null;
}

/** ③の読み上げ（「体の変化。体重 72.0kg から 68.4kg、3.6kg 減。体脂肪率 22.0% から 17.5%、4.5ポイント減」） */
export function bodyCardLabel(weight: BodyChange | null, fat: BodyChange | null, unit: WeightUnit): string {
  const change = (d: number, u: string) => (Math.abs(d) < 0.05 ? '変わらず' : `${fmt1(Math.abs(d))}${u} ${d > 0 ? '増' : '減'}`);
  const parts = ['体の変化'];
  if (weight) {
    const a = kgToUnit(weight.from.value, unit), b = kgToUnit(weight.to.value, unit);
    parts.push(`体重 ${fmt1(a)}${unit} から ${fmt1(b)}${unit}、${change(b - a, unit)}`);
  }
  if (fat) parts.push(`体脂肪率 ${fmt1(fat.from.value)}% から ${fmt1(fat.to.value)}%、${change(fat.diff, 'ポイント')}`);
  if (!weight && !fat) parts.push('体重と体脂肪率の記録がまだありません');
  return parts.join('。');
}

// ── ④ 積み重ね（これまで） ──

export type Totals = {
  /** これまでの総負荷量（kg）。ホームの合計負荷量と同じ setVolume の合計 */
  volumeKg: number;
  /** 乗用車（1台 1.5t。ホームの車のたとえと同じ vehicleRatio）の何台分か */
  cars: number;
  /** 筋トレした日の数（セットの記録がある日） */
  trainingDays: number;
  /** 記録した食事の数 */
  meals: number;
  /** いちばん長く続いた連続（筋トレした日が続いた最長の日数。lib/growth.ts の longestTrainingStreak） */
  longestStreak: number;
};

export function totals(sets: TrainingSetRow[], mealCount: number, today: DateKey): Totals {
  const past = sets.filter((s) => s.date <= today);
  const volumeKg = past.reduce((a, s) => a + setVolume(s), 0);
  const dates = trainingDates(past);
  return { volumeKg, cars: vehicleRatio(volumeKg, 'car'), trainingDays: dates.length, meals: mealCount, longestStreak: longestTrainingStreak(dates, today) };
}

/** 総負荷量の数字（t、小数1桁。lb なら千 lb） */
export function volumeText(kg: number, unit: WeightUnit): { value: string; unit: string } {
  return { value: fmt1(kgToUnit(kg, unit) / 1000), unit: unit === 'kg' ? 't' : 'k lb' };
}

/** 車の台数（「275」。1台に満たないときは小数1桁） */
export function carsCount(cars: number): string {
  return cars >= 1 ? String(Math.round(cars)) : fmt1(cars);
}

/** ④の読み上げ */
export function totalsCardLabel(t: Totals, unit: WeightUnit): string {
  const v = volumeText(t.volumeKg, unit);
  return `積み重ね、これまで。総負荷量 ${v.value}${unit === 'kg' ? 'トン' : '千ポンド'}、乗用車 ${carsCount(t.cars)}台分。`
    + `筋トレした日 ${t.trainingDays}日、記録した食事 ${t.meals}食、いちばん長く続いた連続 ${t.longestStreak}日`;
}

// ── ⑤ 部位の積み重ね ──

/** それぞれの期間でいちばん多い部位の名前（同じ数なら並びの先）。記録がなければ null */
export function topPart(b: PartBalance): string | null {
  if (b.total === 0) return null;
  const max = Math.max(...b.sets);
  return BALANCE_PARTS[b.sets.indexOf(max)];
}

/** ⑤の下の一言（「外周は、その期間でいちばん多い部位（これまでは胸、直近2週は脚）」）。記録がなければ null */
export function partsNote(all: PartBalance, recent: PartBalance, names = { all: 'これまで', recent: '直近2週' }): string | null {
  const a = topPart(all);
  if (a == null) return null;
  const r = topPart(recent);
  const which = r == null ? `${names.all}は${a}。${names.recent}は記録なし` : a === r ? `どちらも${a}` : `${names.all}は${a}、${names.recent}は${r}`;
  return `外周は、その期間でいちばん多い部位（${which}）`;
}

/** ⑤の読み上げ（「部位の積み重ね、これまでの部位ごとのセット数。胸 180、…。直近2週は 胸 18、…」） */
export function partsCardLabel(all: PartBalance, recent: PartBalance): string {
  const list = (b: PartBalance) => BALANCE_PARTS.map((p, i) => `${p} ${b.sets[i]}`).join('、');
  if (all.total === 0) return '部位の積み重ね。まだ記録がありません';
  return `部位の積み重ね、これまでの部位ごとのセット数。${list(all)}。直近2週は ${recent.total === 0 ? '記録なし' : list(recent)}`;
}

// ── ⑥ 自己ベストの年表 ──

/** 新しい順に出す件数 */
export const PB_TIMELINE_COUNT = 5;

/** 自己ベストを更新した日（lib/growth.ts の personalBestEvents）の、新しい順の5件 */
export function pbTimeline(sets: TrainingSetRow[], today: DateKey, count = PB_TIMELINE_COUNT): PersonalBestEvent[] {
  return personalBestEvents(sets, today).slice(-count).reverse();
}

/** 年表の1行の文字（「120 kg × 5」「推定1RM 140.0 kg」）と読み上げ */
export function pbRowText(e: PersonalBestEvent, name: string, unit: WeightUnit): { set: string; e1rm: string; label: string } {
  const w = trimNumber(kgToUnit(e.weightKg, unit));
  const e1rm = `推定1RM ${fmt1(kgToUnit(e.e1rm, unit))} ${unit}`;
  return { set: `${w} ${unit} × ${e.reps}`, e1rm, label: `${formatMonthDay(e.date)}、${name}、${w}${unit} ${e.reps}回、${e1rm}` };
}
